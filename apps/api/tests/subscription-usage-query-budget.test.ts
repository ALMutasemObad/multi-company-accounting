import type { PrismaClient } from "@prisma/client";
import { createServer, request as httpRequest } from "node:http";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { AuthService } from "../src/auth/auth-service.js";
import { createSubscriptionUsageService } from "../src/composition/create-subscription-usage-service.js";
import { parseOpenApiResponseBody } from "../src/generated/openapi-request-guards.js";
import { OperationalMetrics } from "../src/operations/metrics.js";
import {
  ClientDisconnectedError, RequestDeadlineExceededError, currentRequestContext, runWithRequestContext,
  type RequestExecutionContext,
} from "../src/operations/request-context.js";
import type { PlatformCompanyUsageInput } from "../src/platform-operations/platform-operations-ports.js";
import { PrismaPlatformAnalyticsQueryAdapter } from "../src/platform-operations/prisma-platform-analytics-query-adapter.js";
import { SubscriptionUsagePlanAdapter } from "../src/platform-subscriptions/subscription-usage-plan-adapter.js";
import { SubscriptionUsageService } from "../src/platform-subscriptions/subscription-usage-service.js";

const asOf = new Date("2026-08-31T21:00:00.000Z");
const input: PlatformCompanyUsageInput = {
  companyId: 9n, periodStart: new Date("2026-08-01T00:00:00.000Z"), periodEndExclusive: asOf,
};
const range = { gte: input.periodStart, lt: input.periodEndExclusive };
const subscription = {
  id: 8n, currentPeriodStart: null, currentPeriodEnd: null,
  planVersion: {
    id: 12n, displayName: "Quota fixture", billingCycle: "ANNUAL",
    includedUsers: 5, includedEmployees: 3, includedPostedDocuments: 100,
  },
};

function fixture() {
  // Only aggregate delegates and limited projections exist: domain findMany calls fail.
  const company = { findUnique: vi.fn().mockResolvedValue({ id: 9n }) };
  const userCompany = { count: vi.fn().mockResolvedValue(2) };
  const employee = { count: vi.fn().mockResolvedValue(3) };
  const accountingDocument = { count: vi.fn().mockResolvedValue(120) };
  const auditLog = { count: vi.fn().mockResolvedValue(987) };
  const platformSubscription = { findUnique: vi.fn().mockResolvedValue(subscription) };
  const platformSubscriptionChange = { findFirst: vi.fn().mockResolvedValue(null) };
  const prisma = {
    company, userCompany, employee, accountingDocument, auditLog, platformSubscription, platformSubscriptionChange,
  } as unknown as PrismaClient;
  const analytics = new PrismaPlatformAnalyticsQueryAdapter(prisma);
  const service = createSubscriptionUsageService(prisma, analytics, () => asOf);
  const reads = () => [
    company.findUnique, userCompany.count, employee.count, accountingDocument.count,
    auditLog.count, platformSubscription.findUnique, platformSubscriptionChange.findFirst,
  ].reduce((total, query) => total + query.mock.calls.length, 0);
  return {
    prisma, analytics, service, company, userCompany, employee, accountingDocument,
    auditLog, platformSubscription, platformSubscriptionChange, reads,
  };
}

type Fixture = ReturnType<typeof fixture>;

function usageApp(f: Fixture, readDeadlineMs = 10_000) {
  const authorize = vi.fn().mockResolvedValue({ companyId: 9n, userId: 7n, sessionId: 1n });
  const app = createApp({
    NODE_ENV: "test", PORT: 3136, WEB_ORIGIN: "http://localhost:4186",
    SESSION_COOKIE_SECURE: false, PRE_AUTH_TTL_MINUTES: 10, SESSION_TTL_HOURS: 12,
    API_READ_DEADLINE_MS: readDeadlineMs,
  }, {
    auth: { authorize } as unknown as AuthService,
    subscriptionUsage: f.service, metrics: new OperationalMetrics(),
  });
  return { app, authorize };
}

function assertQuotaQueries(f: Fixture, scopedInput = input) {
  expect(f.company.findUnique).toHaveBeenCalledExactlyOnceWith({ where: { id: scopedInput.companyId }, select: { id: true } });
  expect(f.userCompany.count).toHaveBeenCalledExactlyOnceWith({
    where: { companyId: scopedInput.companyId, isActive: true, user: { isActive: true } },
  });
  expect(f.employee.count).toHaveBeenCalledExactlyOnceWith({
    where: { companyId: scopedInput.companyId, status: { in: ["ACTIVE", "ON_LEAVE"] } },
  });
  expect(f.accountingDocument.count).toHaveBeenCalledExactlyOnceWith({
    where: { companyId: scopedInput.companyId, postedAt: { gte: scopedInput.periodStart, lt: scopedInput.periodEndExclusive } },
  });
}

function assertNoCounts(f: Fixture) {
  expect(f.userCompany.count).not.toHaveBeenCalled();
  expect(f.employee.count).not.toHaveBeenCalled();
  expect(f.accountingDocument.count).not.toHaveBeenCalled();
  expect(f.auditLog.count).not.toHaveBeenCalled();
}

describe("subscription usage aggregate query budget (mock query counts, not a DB benchmark)", () => {
  it("reduces the previous composition from seven reads to six, preserving the snapshot", async () => {
    const previous = fixture();
    // Reproduce the previous composition through the preserved four-counter billing port.
    const previousService = new SubscriptionUsageService(
      { measure: (scope) => previous.analytics.companyUsage(scope) },
      new SubscriptionUsagePlanAdapter(previous.prisma), () => asOf,
    );
    const current = fixture();
    expect(await current.service.companyUsage(9n)).toEqual(await previousService.companyUsage(9n));
    expect(previous.reads()).toBe(7);
    expect(current.reads()).toBe(6);
    expect(previous.auditLog.count).toHaveBeenCalledTimes(1);
    expect(current.auditLog.count).not.toHaveBeenCalled();
    assertQuotaQueries(current);
    assertQuotaQueries(previous);
    expect(current.platformSubscription.findUnique.mock.calls).toEqual(previous.platformSubscription.findUnique.mock.calls);
    expect(current.platformSubscriptionChange.findFirst.mock.calls).toEqual(previous.platformSubscriptionChange.findFirst.mock.calls);
  });

  it("never even accesses Audit on a real GET usage request, and validates the unchanged DTO", async () => {
    const f = fixture();
    const auditAccess = vi.fn(() => { throw new Error("GET usage must not access Audit"); });
    Object.defineProperty(f.prisma, "auditLog", { get: auditAccess });
    const { app, authorize } = usageApp(f);
    const result = await request(app).get("/api/v1/subscription/usage").set("Cookie", "sid=query-budget").expect(200);
    expect(authorize.mock.invocationCallOrder[0]).toBeLessThan(f.company.findUnique.mock.invocationCallOrder[0]!);
    expect(auditAccess).not.toHaveBeenCalled();
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.body.consistency).toBe("BEST_EFFORT");
    expect(Object.keys(result.body.metrics)).toEqual(["users", "employees", "postedDocuments"]);
    expect(parseOpenApiResponseBody("getCompanySubscriptionUsage", 200, result.body)).toEqual(result.body);
    expect(f.reads()).toBe(6);
    assertQuotaQueries(f);
  });

  it("keeps billing companyUsage at one existence lookup plus its original four counters", async () => {
    const f = fixture();
    expect(await f.analytics.companyUsage(input)).toEqual({ users: 2, employees: 3, postedDocuments: 120, operations: 987 });
    assertQuotaQueries(f);
    expect(f.auditLog.count).toHaveBeenCalledExactlyOnceWith({ where: { companyId: 9n, createdAt: range } });
    expect(f.reads()).toBe(5);
  });

  it.each(["companyQuotaUsage", "companyUsage"] as const)("%s never counts a missing company or swallows a lookup failure", async (method) => {
    const f = fixture();
    f.company.findUnique.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("lookup unavailable"));
    await expect(f.analytics[method](input)).resolves.toBeNull();
    await expect(f.analytics[method](input)).rejects.toThrow("lookup unavailable");
    expect(f.reads()).toBe(2);
    assertNoCounts(f);
  });

  it("uses five reads without a subscription and performs fresh counts on repeated requests", async () => {
    const f = fixture();
    f.platformSubscription.findUnique.mockResolvedValue(null);
    expect((await f.service.companyUsage(9n)).plan).toBeNull();
    expect(f.reads()).toBe(5);
    f.userCompany.count.mockResolvedValue(4);
    expect((await f.service.companyUsage(9n)).metrics.users.used).toBe(4);
    expect(f.reads()).toBe(10);
    expect(f.platformSubscriptionChange.findFirst).not.toHaveBeenCalled();
    expect(f.auditLog.count).not.toHaveBeenCalled();
  });

  it.each([0, 4_000_000_000, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1])("keeps bounded results and UNKNOWN semantics for count %s", async (count) => {
    const f = fixture();
    for (const query of [f.userCompany.count, f.employee.count, f.accountingDocument.count]) query.mockResolvedValue(count);
    const result = await f.service.companyUsage(9n);
    const safe = Number.isSafeInteger(count);
    expect(result.metrics.users.used).toBe(safe ? count : null);
    expect(result.metrics.employees.used).toBe(safe ? count : null);
    expect(result.metrics.postedDocuments).toMatchObject({ used: safe ? count : null, remaining: null, excess: null, state: "UNKNOWN" });
    if (!safe) expect(result.metrics.users).toMatchObject({ state: "UNKNOWN", remaining: null, excess: null });
    expect(JSON.stringify(result).length).toBeLessThan(1800);
    expect(parseOpenApiResponseBody("getCompanySubscriptionUsage", 200, result)).toEqual(result);
    expect(f.reads()).toBe(6);
  });

  it("isolates company scopes while counting start-inclusive/end-exclusive and reversed posted documents", async () => {
    const f = fixture();
    const users = [
      { companyId: 9n, isActive: true, user: { isActive: true } },
      { companyId: 9n, isActive: false, user: { isActive: true } },
      { companyId: 9n, isActive: true, user: { isActive: false } },
      { companyId: 10n, isActive: true, user: { isActive: true } },
      { companyId: 10n, isActive: true, user: { isActive: true } },
    ];
    const employees = [
      { companyId: 9n, status: "ACTIVE" }, { companyId: 9n, status: "ON_LEAVE" },
      { companyId: 9n, status: "TERMINATED" }, { companyId: 10n, status: "ACTIVE" },
    ];
    const documents = [
      { companyId: 9n, postedAt: new Date(input.periodStart.getTime() - 1), status: "POSTED" },
      { companyId: 9n, postedAt: input.periodStart, status: "POSTED" },
      { companyId: 9n, postedAt: new Date(asOf.getTime() - 1), status: "REVERSED" },
      { companyId: 9n, postedAt: asOf, status: "POSTED" },
      { companyId: 9n, postedAt: null, status: "DRAFT" },
      { companyId: 10n, postedAt: input.periodStart, status: "REVERSED" },
    ];
    f.userCompany.count.mockImplementation(async ({ where }: {
      where: { companyId: bigint; isActive: boolean; user: { isActive: boolean } };
    }) => users.filter((row) => row.companyId === where.companyId && row.isActive === where.isActive && row.user.isActive === where.user.isActive).length);
    f.employee.count.mockImplementation(async ({ where }: { where: { companyId: bigint; status: { in: string[] } } }) =>
      employees.filter((row) => row.companyId === where.companyId && where.status.in.includes(row.status)).length);
    f.accountingDocument.count.mockImplementation(async ({ where }: {
      where: { companyId: bigint; postedAt: { gte: Date; lt: Date }; status?: string };
    }) => documents.filter((row) => row.companyId === where.companyId && row.postedAt !== null
      && row.postedAt >= where.postedAt.gte && row.postedAt < where.postedAt.lt
      && (where.status === undefined || row.status === where.status)).length);

    const [first, second] = await Promise.all([
      f.analytics.companyQuotaUsage(input), f.analytics.companyQuotaUsage({ ...input, companyId: 10n }),
    ]);
    expect(first).toEqual({ users: 1, employees: 2, postedDocuments: 2 });
    expect(second).toEqual({ users: 2, employees: 1, postedDocuments: 1 });
    expect(f.company.findUnique.mock.calls).toEqual([
      [{ where: { id: 9n }, select: { id: true } }], [{ where: { id: 10n }, select: { id: true } }],
    ]);
    expect(f.accountingDocument.count.mock.calls).toEqual([
      [{ where: { companyId: 9n, postedAt: range } }], [{ where: { companyId: 10n, postedAt: range } }],
    ]);
    const billing = await f.analytics.companyUsage(input);
    expect(billing).toEqual({ ...first, operations: 987 });
    expect(f.userCompany.count.mock.calls[2]).toEqual(f.userCompany.count.mock.calls[0]);
    expect(f.employee.count.mock.calls[2]).toEqual(f.employee.count.mock.calls[0]);
    expect(f.accountingDocument.count.mock.calls[2]).toEqual(f.accountingDocument.count.mock.calls[0]);
    expect(await f.analytics.companyQuotaUsage({ ...input, periodEndExclusive: input.periodStart }))
      .toEqual({ users: 1, employees: 2, postedDocuments: 0 });
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfilled) => { resolve = fulfilled; });
  return { promise, resolve };
}

const endings = ["deadline-clock", "deadline-signal", "disconnect"] as const;
type Ending = typeof endings[number];

function executionScope(ending: Ending) {
  const controller = new AbortController();
  const startedAt = Date.now();
  const context: RequestExecutionContext = {
    requestId: "query-budget-request", requestClass: "READ", startedAt,
    deadlineAt: startedAt + 60_000, signal: controller.signal, deadlineMetricRecorded: false,
  };
  const stop = () => {
    if (ending === "deadline-clock") context.deadlineAt = Date.now() - 1;
    else controller.abort(ending === "disconnect" ? new ClientDisconnectedError() : new RequestDeadlineExceededError());
  };
  return { context, stop, error: ending === "disconnect" ? ClientDisconnectedError : RequestDeadlineExceededError };
}

describe("usage request budget gates new reads without claiming DB query cancellation", () => {
  it.each(["deadline", "disconnect"] as const)("propagates a real HTTP %s to both pending lookup branches", async (ending) => {
    const f = fixture();
    const companyLookup = deferred<{ id: bigint }>();
    const planLookup = deferred<typeof subscription>();
    const started = deferred<RequestExecutionContext>();
    const completed = deferred<unknown>();
    const originalUsage = f.service.companyUsage.bind(f.service);
    vi.spyOn(f.service, "companyUsage").mockImplementation(async (companyId) => {
      try { return await originalUsage(companyId); }
      catch (error) { completed.resolve(error); throw error; }
    });
    f.company.findUnique.mockImplementation(() => {
      started.resolve(currentRequestContext()!);
      return companyLookup.promise;
    });
    f.platformSubscription.findUnique.mockReturnValue(planLookup.promise);
    const { app } = usageApp(f, ending === "deadline" ? 250 : 10_000);
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP server address");
    try {
      if (ending === "deadline") {
        const response = await request(server).get("/api/v1/subscription/usage").expect(504);
        expect(response.headers["cache-control"]).toBe("no-store");
        expect(parseOpenApiResponseBody("getCompanySubscriptionUsage", 504, response.body)).toEqual(response.body);
        expect((await started.promise).signal.reason).toBeInstanceOf(RequestDeadlineExceededError);
      } else {
        const outgoing = httpRequest({ hostname: "127.0.0.1", port: address.port, path: "/api/v1/subscription/usage" });
        outgoing.on("error", () => undefined);
        outgoing.end();
        const context = await started.promise;
        const aborted = new Promise<void>((resolve) => context.signal.addEventListener("abort", () => resolve(), { once: true }));
        outgoing.destroy();
        await aborted;
        expect(context.signal.reason).toBeInstanceOf(ClientDisconnectedError);
      }
      expect(f.reads()).toBe(2);
      companyLookup.resolve({ id: 9n });
      planLookup.resolve(subscription);
      await expect(completed.promise).resolves.toBeInstanceOf(ending === "deadline" ? RequestDeadlineExceededError : ClientDisconnectedError);
      assertNoCounts(f);
      expect(f.platformSubscriptionChange.findFirst).not.toHaveBeenCalled();
      expect(f.reads()).toBe(2);
    } finally {
      companyLookup.resolve({ id: 9n });
      planLookup.resolve(subscription);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it.each(endings)("starts no composition reads for an already ended %s request", async (ending) => {
    const f = fixture();
    const scope = executionScope(ending);
    scope.stop();
    await expect(runWithRequestContext(scope.context, () => f.service.companyUsage(9n))).rejects.toBeInstanceOf(scope.error);
    expect(f.reads()).toBe(0);
  });

  it.each(endings)("starts neither counts nor effective-plan reads if %s occurs during the initial lookups", async (ending) => {
    const f = fixture();
    const scope = executionScope(ending);
    const companyLookup = deferred<{ id: bigint }>();
    const planLookup = deferred<typeof subscription>();
    f.company.findUnique.mockReturnValue(companyLookup.promise);
    f.platformSubscription.findUnique.mockReturnValue(planLookup.promise);
    const work = runWithRequestContext(scope.context, () => f.service.companyUsage(9n));
    const rejected = expect(work).rejects.toBeInstanceOf(scope.error);
    let settled = false;
    void work.then(() => { settled = true; }, () => { settled = true; });
    expect(f.reads()).toBe(2);
    scope.stop();
    await Promise.resolve();
    expect(settled).toBe(false); // The two already-issued queries remain in flight.
    companyLookup.resolve({ id: 9n });
    planLookup.resolve(subscription);
    await rejected;
    assertNoCounts(f);
    expect(f.platformSubscriptionChange.findFirst).not.toHaveBeenCalled();
    expect(f.reads()).toBe(2);
  });

  it.each(endings)("billing starts none of its four counters after %s during company lookup", async (ending) => {
    const f = fixture();
    const scope = executionScope(ending);
    const lookup = deferred<{ id: bigint }>();
    f.company.findUnique.mockReturnValue(lookup.promise);
    const work = runWithRequestContext(scope.context, () => f.analytics.companyUsage(input));
    const rejected = expect(work).rejects.toBeInstanceOf(scope.error);
    scope.stop();
    lookup.resolve({ id: 9n });
    await rejected;
    assertNoCounts(f);
    expect(f.reads()).toBe(1);
  });

  it.each(endings)("gates each count dispatch when %s is observed after the first count starts", async (ending) => {
    const f = fixture();
    const scope = executionScope(ending);
    f.userCompany.count.mockImplementation(async () => { scope.stop(); return 2; });
    await expect(runWithRequestContext(scope.context, () => f.analytics.companyQuotaUsage(input))).rejects.toBeInstanceOf(scope.error);
    expect(f.userCompany.count).toHaveBeenCalledTimes(1);
    expect(f.employee.count).not.toHaveBeenCalled();
    expect(f.accountingDocument.count).not.toHaveBeenCalled();
    expect(f.auditLog.count).not.toHaveBeenCalled();
    expect(f.reads()).toBe(2);
  });

  it.each(endings)("rejects late count results after %s but does not pretend to cancel those queries", async (ending) => {
    const f = fixture();
    const scope = executionScope(ending);
    const counts = deferred<number>();
    const dispatched = deferred<void>();
    f.userCompany.count.mockReturnValue(counts.promise);
    f.employee.count.mockReturnValue(counts.promise);
    f.accountingDocument.count.mockImplementation(() => { dispatched.resolve(); return counts.promise; });
    const work = runWithRequestContext(scope.context, () => f.analytics.companyQuotaUsage(input));
    const rejected = expect(work).rejects.toBeInstanceOf(scope.error);
    let settled = false;
    void work.then(() => { settled = true; }, () => { settled = true; });
    await dispatched.promise;
    scope.stop();
    await Promise.resolve();
    expect(settled).toBe(false);
    assertQuotaQueries(f);
    expect(f.reads()).toBe(4);
    counts.resolve(100);
    await rejected;
    expect(f.reads()).toBe(4);
    expect(f.auditLog.count).not.toHaveBeenCalled();
  });
});
