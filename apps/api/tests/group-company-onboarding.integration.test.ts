import { randomUUID } from "node:crypto";
import { hash, verify } from "argon2";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../src/database.js";
import { createGroupCompanyOnboardingService } from "../src/composition/create-group-company-onboarding-service.js";
import { createOrganizationMembershipService } from "../src/composition/create-organization-membership-service.js";
import { permissionDefinitions } from "../src/platform/reference-data.js";
import { createStartPlanFixture } from "./subscription-start-plan-fixture.js";
import { GroupCompanyOnboardingService } from "../src/organizations/group-company-onboarding-service.js";
import { GroupCompanyOnboardingIdentityAdapter } from "../src/users/group-company-onboarding-identity-adapter.js";
import { GroupCompanyOnboardingTenantAdapter } from "../src/companies/group-company-onboarding-tenant-adapter.js";
import { AccountingCompanyProvisioningAdapter } from "../src/accounts/company-provisioning-adapter.js";
import { TreasuryCompanyProvisioningAdapter } from "../src/treasury/company-provisioning-adapter.js";
import { PrismaNewCompanySubscriptionProvisioningAdapter } from "../src/platform-subscriptions/prisma-new-company-subscription-provisioning-adapter.js";
import { PrismaAuditAppendAdapter } from "../src/audit/prisma-audit-append-adapter.js";
import { AuthService } from "../src/auth/auth-service.js";
import { PrismaAuthStore } from "../src/auth/prisma-auth-store.js";
import { testAuthOptions } from "./helpers/test-auth-options.js";
import { createApp } from "../src/app.js";

const enabled = process.env.RUN_DB_TESTS === "true" && Boolean(process.env.DATABASE_URL);
const db = enabled ? createDatabase(process.env.DATABASE_URL!) : null;
const input = { companyName: "New company", timezone: "Asia/Riyadh", baseCurrencyCode: "SAR" };

describe.runIf(enabled)("group company creation on a real database", () => {
  let plan: Awaited<ReturnType<typeof createStartPlanFixture>>;
  let passwordHash: string;
  const service = () => createGroupCompanyOnboardingService(db!, plan.version.id.toString());
  const ports = () => ({
    identity: new GroupCompanyOnboardingIdentityAdapter(), tenant: new GroupCompanyOnboardingTenantAdapter(db!),
    accounting: new AccountingCompanyProvisioningAdapter(), treasury: new TreasuryCompanyProvisioningAdapter(),
    subscriptions: new PrismaNewCompanySubscriptionProvisioningAdapter(plan.version.id.toString()), audit: new PrismaAuditAppendAdapter(),
  });
  async function fixture(role: "OWNER" | "ADMIN" | "VIEWER" = "OWNER") {
    const suffix = randomUUID();
    const organization = await db!.organization.create({ data: { code: suffix, name: "Unchanged group" } });
    const user = await db!.user.create({ data: { emailNormalized: `${suffix}@example.test`, passwordHash, displayName: "Existing owner" } });
    await db!.organizationMembership.create({ data: { organizationId: organization.id, userId: user.id, role } });
    return { organization, user };
  }
  beforeAll(async () => {
    // Minimal fixture setup: do not run a global seed that also rewrites existing roles.
    await db!.currency.upsert({ where: { scopeKey_code: { scopeKey: "GLOBAL", code: "SAR" } }, update: {}, create: { code: "SAR", nameAr: "ريال سعودي", decimals: 2, scopeKey: "GLOBAL", scope: "GLOBAL" } });
    await db!.permission.createMany({ data: permissionDefinitions.map(([code, module, descriptionAr]) => ({ code, module, descriptionAr })), skipDuplicates: true });
    plan = await createStartPlanFixture(db!, "SAR");
    passwordHash = await hash("test-only-owner-password");
  }, 60_000);
  // Fixture rows are intentionally retained in the isolated test database as evidence.
  afterAll(async () => { await db!.$disconnect(); });

  it("creates a company's isolated setup without existing company access or identity changes", async () => {
    const { organization, user } = await fixture();
    const created = await service().create(user.id, organization.id, randomUUID(), input);
    const companyId = BigInt(created.company.id);
    expect(await db!.organization.findUnique({ where: { id: organization.id } })).toEqual(organization);
    expect(await db!.user.findUnique({ where: { id: user.id } })).toEqual(user);
    expect(await db!.userCompany.count({ where: { userId: user.id } })).toBe(1);
    expect(await db!.userCompanyRole.findFirst({ where: { userId: user.id, companyId }, include: { role: true } })).toMatchObject({ role: { code: "ADMINISTRATOR" } });
    expect(await db!.account.count({ where: { companyId } })).toBeGreaterThan(0);
    expect(await db!.platformSubscription.findUnique({ where: { companyId } })).toMatchObject({ planVersionId: plan.version.id, status: "ACTIVE" });
    expect(await db!.platformSubscriptionEntitlement.findMany({ where: { companyId } })).toMatchObject([{ moduleId: plan.core.id }]);
    expect(await db!.organizationAuditLog.count({ where: { organizationId: organization.id, action: "ORGANIZATION_COMPANY_CREATED" } })).toBe(1);
    expect((await createOrganizationMembershipService(db!).dashboard(user.id, organization.id, 30)).companies.map(row => row.id)).toEqual([created.company.id]);
  });

  it("replays concurrent identical requests, rejects payload mismatch, and replays after 24 hours", async () => {
    const { organization, user } = await fixture();
    const key = randomUUID();
    const results = await Promise.all([service().create(user.id, organization.id, key, input), service().create(user.id, organization.id, key, input)]);
    expect(results[0]).toEqual(results[1]);
    expect(await db!.company.count({ where: { organizationId: organization.id } })).toBe(1);
    await expect(service().create(user.id, organization.id, key, { ...input, companyName: "Different" })).rejects.toMatchObject({ reason: "IDEMPOTENCY_MISMATCH" });
    await db!.organizationIdempotencyRecord.updateMany({ where: { organizationId: organization.id }, data: { expiresAt: new Date("2020-01-01") } });
    expect(await service().create(user.id, organization.id, key, input)).toEqual(results[0]);
    expect(await db!.company.count({ where: { organizationId: organization.id } })).toBe(1);
    await db!.organizationIdempotencyRecord.updateMany({ where: { organizationId: organization.id }, data: { responseBody: { invalid: true } } });
    await expect(service().create(user.id, organization.id, key, input)).rejects.toMatchObject({ reason: "COMPANY_SETUP_UNAVAILABLE" });
    expect(await db!.company.count({ where: { organizationId: organization.id } })).toBe(1);
  }, 60_000);

  it("isolates keys by user and group, and denies a foreign group before returning a saved result", async () => {
    const a = await fixture(); const b = await fixture(); const key = randomUUID();
    const first = await service().create(a.user.id, a.organization.id, key, input);
    await expect(service().create(b.user.id, a.organization.id, key, input)).rejects.toMatchObject({ reason: "ORGANIZATION_ACCESS_DENIED" });
    const second = await service().create(b.user.id, b.organization.id, key, input);
    await db!.organizationMembership.create({ data: { organizationId: a.organization.id, userId: b.user.id, role: "OWNER" } });
    const third = await service().create(b.user.id, a.organization.id, key, input);
    expect(new Set([first.company.id, second.company.id, third.company.id]).size).toBe(3);
    expect(await db!.userCompany.count({ where: { userId: a.user.id, companyId: BigInt(third.company.id) } })).toBe(0);
  }, 60_000);

  it.each(["ADMIN", "VIEWER"] as const)("denies organization %s without creating a company", async role => {
    const { organization, user } = await fixture(role);
    await expect(service().create(user.id, organization.id, randomUUID(), input)).rejects.toMatchObject({ reason: "ORGANIZATION_ROLE_FORBIDDEN" });
    expect(await db!.company.count({ where: { organizationId: organization.id } })).toBe(0);
  });

  it("denies disabled identity/membership and company administrator without OWNER, including replay", async () => {
    const { organization, user } = await fixture(); const key = randomUUID();
    await service().create(user.id, organization.id, key, input);
    await db!.organizationMembership.update({ where: { organizationId_userId: { organizationId: organization.id, userId: user.id } }, data: { role: "VIEWER" } });
    await expect(service().create(user.id, organization.id, key, input)).rejects.toMatchObject({ reason: "ORGANIZATION_ROLE_FORBIDDEN" });
    await db!.organizationMembership.updateMany({ where: { organizationId: organization.id }, data: { role: "OWNER", isActive: false } });
    await expect(service().create(user.id, organization.id, key, input)).rejects.toMatchObject({ reason: "ORGANIZATION_ACCESS_DENIED" });
    await db!.organizationMembership.updateMany({ where: { organizationId: organization.id }, data: { isActive: true } });
    await db!.user.update({ where: { id: user.id }, data: { isActive: false } });
    await expect(service().create(user.id, organization.id, key, input)).rejects.toMatchObject({ reason: "ORGANIZATION_ACCESS_DENIED" });
  });

  it("rolls back every owner setup and replay record when subscription or audit fails", async () => {
    const { organization, user } = await fixture(); const key = randomUUID();
    await expect(createGroupCompanyOnboardingService(db!, "").create(user.id, organization.id, key, input)).rejects.toMatchObject({ reason: "NOT_CONFIGURED" });
    const real = ports();
    const failing = new GroupCompanyOnboardingService(db!, { ...real, audit: { append: async (tx, entry) => { await real.audit.append(tx, entry); throw new Error("audit failure"); } } });
    await expect(failing.create(user.id, organization.id, key, input)).rejects.toThrow("audit failure");
    expect(await db!.company.count({ where: { organizationId: organization.id } })).toBe(0);
    expect(await db!.userCompany.count({ where: { userId: user.id } })).toBe(0);
    expect(await db!.organizationAuditLog.count({ where: { organizationId: organization.id } })).toBe(0);
    expect(await db!.organizationIdempotencyRecord.count({ where: { organizationId: organization.id } })).toBe(0);
    await expect(service().create(user.id, organization.id, key, input)).resolves.toBeDefined();
  }, 60_000);

  it("serializes owner revocation against creation in both lock acquisition orders", async () => {
    const { organization, user } = await fixture();
    let release!: () => void; let locked!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const acquired = new Promise<void>(resolve => { locked = resolve; });
    const revocation = db!.$transaction(async tx => {
      await tx.organizationMembership.updateMany({ where: { organizationId: organization.id, userId: user.id }, data: { role: "VIEWER" } });
      locked(); await gate;
    }, { timeout: 15_000 });
    await acquired;
    const create = service().create(user.id, organization.id, randomUUID(), input);
    release(); await revocation;
    await expect(create).rejects.toMatchObject({ reason: "ORGANIZATION_ROLE_FORBIDDEN" });
    await db!.organizationMembership.updateMany({ where: { organizationId: organization.id }, data: { role: "OWNER" } });
    let releaseCreate!: () => void; let ownerLocked!: () => void;
    const createGate = new Promise<void>(resolve => { releaseCreate = resolve; });
    const ownerAcquired = new Promise<void>(resolve => { ownerLocked = resolve; });
    const real = ports();
    const paused = new GroupCompanyOnboardingService(db!, { ...real, identity: {
      grantNewCompanyAdministrator: real.identity.grantNewCompanyAdministrator.bind(real.identity),
      authorizeOwner: async (tx, userId, organizationId) => { await real.identity.authorizeOwner(tx, userId, organizationId); ownerLocked(); await createGate; },
    } });
    const key = randomUUID(); const creating = paused.create(user.id, organization.id, key, input);
    await ownerAcquired;
    // PrismaPromise is lazy: attach then now so revocation actually competes while
    // the creator still holds its authorization locks, rather than after it commits.
    const revoke = db!.organizationMembership.updateMany({ where: { organizationId: organization.id }, data: { role: "VIEWER" } }).then(result => result);
    releaseCreate(); await creating; await revoke;
    await expect(service().create(user.id, organization.id, key, input)).rejects.toMatchObject({ reason: "ORGANIZATION_ROLE_FORBIDDEN" });
    expect(await db!.company.count({ where: { organizationId: organization.id } })).toBe(1);
  }, 60_000);

  it("requires real authenticated session and CSRF, validates generated contract and exposes new company via auth", async () => {
    const { organization, user } = await fixture();
    const auth = new AuthService(new PrismaAuthStore(db!), { verify }, testAuthOptions(db!));
    const app = createApp({ NODE_ENV: "test", PORT: 3000, WEB_ORIGIN: "http://localhost:5173", SESSION_COOKIE_SECURE: false, PRE_AUTH_TTL_MINUTES: 10, SESSION_TTL_HOURS: 12, DATABASE_URL: process.env.DATABASE_URL! }, {
      auth, organizationMemberships: createOrganizationMembershipService(db!), groupCompanyOnboarding: service(),
    });
    const agent = request.agent(app); const path = `/api/v1/organizations/${organization.id}/companies`;
    await agent.post(path).send(input).expect(401);
    const csrf = await agent.get("/api/v1/auth/csrf").expect(200);
    const login = await agent.post("/api/v1/auth/login").set("X-CSRF-Token", csrf.body.csrfToken).send({ email: user.emailNormalized, password: "test-only-owner-password" }).expect(200);
    await agent.post(path).set("Idempotency-Key", randomUUID()).send(input).expect(403);
    await agent.post(path).set("X-CSRF-Token", login.body.csrfToken).send(input).expect(400);
    await agent.post(path).set("X-CSRF-Token", login.body.csrfToken).set("Idempotency-Key", randomUUID()).send({ ...input, organizationName: "Do not rename", adminEmail: "other@example.test" }).expect(400);
    const key = randomUUID();
    const created = await agent.post(path).set("X-CSRF-Token", login.body.csrfToken).set("Idempotency-Key", key).send(input).expect(201);
    expect(created.headers["cache-control"]).toContain("no-store");
    const replay = await agent.post(path).set("X-CSRF-Token", login.body.csrfToken).set("Idempotency-Key", key).send(input).expect(201);
    expect(replay.body).toEqual(created.body);
    const companies = await agent.get("/api/v1/auth/companies").expect(200);
    expect(companies.body.data.map((row: { id: string }) => row.id)).toContain(created.body.company.id);
    await agent.put("/api/v1/auth/context").set("X-CSRF-Token", login.body.csrfToken).send({ companyId: created.body.company.id }).expect(204);
  }, 60_000);
});
