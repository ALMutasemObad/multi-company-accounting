import { describe, expect, it } from "vitest";
import { parseOpenApiResponseBody } from "../src/generated/openapi-request-guards.js";

// Coordinator-owned contract fixtures; the usage service/router tests belong to track C.
function fixture() {
  return {
    companyId: "9007199254740993",
    measuredAt: "2026-08-31T09:12:34.567Z",
    consistency: "BEST_EFFORT",
    plan: { id: "18446744073709551615", displayName: "الباقة الأساسية", billingCycle: "ANNUAL" },
    period: {
      kind: "STATISTICAL_MONTH_TO_DATE", timezone: "UTC",
      startsAt: "2026-08-01T00:00:00.000Z", endsAtExclusive: "2026-08-31T09:12:34.567Z",
      billingPeriodStatus: "NOT_CONFIGURED",
    },
    metrics: {
      users: {
        used: 3, included: 5, remaining: 2, excess: 0, state: "WITHIN_LIMIT",
        comparisonBasis: "CURRENT_SNAPSHOT", definition: "ACTIVE_COMPANY_USERS",
      },
      employees: {
        used: 0, included: null, remaining: null, excess: null, state: "NOT_CONFIGURED",
        comparisonBasis: "CURRENT_SNAPSHOT", definition: "ACTIVE_OR_ON_LEAVE_EMPLOYEES",
      },
      postedDocuments: {
        used: 120, included: 100, remaining: null, excess: null, state: "UNKNOWN",
        comparisonBasis: "UNCONFIRMED_PERIOD", definition: "DOCUMENTS_POSTED_IN_WINDOW",
      },
    },
  };
}

const parse = (value: unknown) => parseOpenApiResponseBody("getCompanySubscriptionUsage", 200, value);

describe("coordinated subscription usage OpenAPI contract", () => {
  it("preserves large string IDs and distinguishes known snapshots from an unconfirmed period", () => {
    const value = fixture();
    expect(parse(value)).toEqual(value);
  });

  it("allows missing plan/quotas without claiming unlimited usage or an available balance", () => {
    const value = fixture();
    const unknown = (metric: object) => ({ ...metric, included: null, remaining: null, excess: null, state: "NOT_CONFIGURED" });
    expect(parse({
      ...value, plan: null,
      metrics: {
        users: unknown(value.metrics.users), employees: unknown(value.metrics.employees),
        postedDocuments: unknown(value.metrics.postedDocuments),
      },
    })).toMatchObject({ plan: null, metrics: { postedDocuments: { state: "NOT_CONFIGURED" } } });
  });

  it("allows an unknown snapshot count without turning it into zero", () => {
    const value = fixture();
    expect(parse({ ...value, metrics: { ...value.metrics, users: {
      ...value.metrics.users, used: null, remaining: null, excess: null, state: "UNKNOWN",
    } } })).toMatchObject({ metrics: { users: { used: null, state: "UNKNOWN" } } });
  });

  it.each(["used", "included", "remaining", "excess"] as const)("rejects invalid numeric values for %s", (key) => {
    for (const invalid of [-1, 0.1, Number.MAX_SAFE_INTEGER + 1, "1"]) {
      const value = fixture();
      expect(() => parse({ ...value, metrics: { ...value.metrics, users: { ...value.metrics.users, [key]: invalid } } })).toThrow();
    }
  });

  it.each(["WITHIN_LIMIT", "AT_LIMIT", "EXCEEDED"])("never reports %s for the statistical document period", (state) => {
    const value = fixture();
    expect(() => parse({ ...value, metrics: { ...value.metrics, postedDocuments: {
      ...value.metrics.postedDocuments, state, remaining: 0, excess: 20,
    } } })).toThrow();
  });

  it("rejects a fabricated document balance even when its state still says UNKNOWN", () => {
    const value = fixture();
    expect(() => parse({ ...value, metrics: { ...value.metrics, postedDocuments: {
      ...value.metrics.postedDocuments, remaining: 0, excess: 20,
    } } })).toThrow();
  });

  it("does not accept a configured limit labeled as NOT_CONFIGURED or vice versa", () => {
    const value = fixture();
    expect(() => parse({ ...value, metrics: { ...value.metrics, users: {
      ...value.metrics.users, state: "NOT_CONFIGURED", remaining: null, excess: null,
    } } })).toThrow();
    expect(() => parse({ ...value, metrics: { ...value.metrics, employees: {
      ...value.metrics.employees, state: "UNKNOWN",
    } } })).toThrow();
  });

  it("rejects mixed counter definitions and undisclosed financial/person detail fields", () => {
    const value = fixture();
    expect(() => parse({ ...value, metrics: { ...value.metrics, users: {
      ...value.metrics.users, definition: "DOCUMENTS_POSTED_IN_WINDOW",
    } } })).toThrow();
    expect(() => parse({ ...value, invoiceAmount: "10.0000" })).toThrow();
    expect(() => parse({ ...value, plan: { ...value.plan, internalNotes: "private" } })).toThrow();
    expect(() => parse({ ...value, metrics: { ...value.metrics, users: {
      ...value.metrics.users, emails: ["private@example.test"],
    } } })).toThrow();
  });

  it("rejects a guessed billing-period status, non-UTC instants, and numeric identifiers", () => {
    const value = fixture();
    expect(() => parse({ ...value, period: { ...value.period, billingPeriodStatus: "CONFIRMED" } })).toThrow();
    expect(() => parse({ ...value, measuredAt: "2026-08-31T12:12:34.567+03:00" })).toThrow();
    expect(() => parse({ ...value, companyId: 1 })).toThrow();
    expect(() => parse({ ...value, plan: { ...value.plan, id: 2 } })).toThrow();
  });

  it.each([400, 401, 403, 404, 429, 500, 503, 504])("declares the %i error response", (status) => {
    expect(parseOpenApiResponseBody("getCompanySubscriptionUsage", status, { code: "TEST_ERROR", status }))
      .toMatchObject({ code: "TEST_ERROR", status });
  });
});
