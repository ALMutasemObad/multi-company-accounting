import { hash, verify } from "argon2";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/auth/auth-service.js";
import { PrismaAuthStore } from "../src/auth/prisma-auth-store.js";
import { createDatabase } from "../src/database.js";
import { SecurityEventService } from "../src/security/security-event-service.js";

const enabled = process.env.RUN_DB_TESTS === "true";
const databaseUrl = process.env.DATABASE_URL ?? "";
const password = process.env.SEED_ADMIN_PASSWORD ?? "";
const prisma = enabled ? createDatabase(databaseUrl) : null;

describe.runIf(enabled)("security event monitoring with MariaDB", () => {
  const testType = "TEST_CRITICAL_SECURITY_EVENT";
  const accountantEmail = "it.security.accountant@mcap.local";
  const reviewerEmail = "it.security.reviewer@mcap.local";
  let companyId: bigint;
  const testUserIds: bigint[] = [];

  beforeAll(async () => {
    const admin = await prisma!.user.findUniqueOrThrow({ where: { emailNormalized: "admin@mcap.local" } });
    companyId = (await prisma!.userCompany.findFirstOrThrow({
      where: { userId: admin.id, isActive: true },
      select: { companyId: true },
    })).companyId;
    const passwordHash = await hash(password);
    for (const [emailNormalized, displayName] of [[accountantEmail, "محاسب اختبار الأمان"], [reviewerEmail, "مراجع اختبار الأمان"]] as const) {
      const user = await prisma!.user.upsert({
        where: { emailNormalized },
        update: { displayName, passwordHash, isActive: true, failedLoginAttempts: 0, lockedUntil: null },
        create: { emailNormalized, displayName, passwordHash },
      });
      testUserIds.push(user.id);
      await prisma!.userCompany.upsert({
        where: { userId_companyId: { userId: user.id, companyId } },
        update: { isActive: true },
        create: { userId: user.id, companyId },
      });
    }
    await prisma!.securityEvent.deleteMany({ where: { OR: [{ eventType: testType }, { userAgent: { in: ["MCAP Security Integration Test", "MCAP Failed Login Test", "MCAP Account Lock Test"] } }] } });
    await prisma!.auditLog.deleteMany({ where: { action: "SECURITY_EVENT_ACKNOWLEDGED", entityType: "SECURITY_EVENT" } });
  });

  afterAll(async () => {
    await prisma!.session.deleteMany({ where: { userId: { in: testUserIds } } });
    await prisma!.securityEvent.deleteMany({ where: { OR: [{ eventType: testType }, { userAgent: { in: ["MCAP Security Integration Test", "MCAP Failed Login Test", "MCAP Account Lock Test"] } }] } });
    await prisma!.auditLog.deleteMany({ where: { action: "SECURITY_EVENT_ACKNOWLEDGED", entityType: "SECURITY_EVENT" } });
    await prisma!.userCompanyRole.deleteMany({ where: { userId: { in: testUserIds }, companyId } });
    await prisma!.userCompany.deleteMany({ where: { userId: { in: testUserIds }, companyId } });
    await prisma!.user.deleteMany({ where: { id: { in: testUserIds } } });
    await prisma!.$disconnect();
  });

  const application = () => {
    const auth = new AuthService(new PrismaAuthStore(prisma!), { verify }, { preAuthTtlMinutes: 10, sessionTtlHours: 12 });
    return createApp({ NODE_ENV: "test", PORT: 3000, WEB_ORIGIN: "http://localhost:5173", SESSION_COOKIE_SECURE: false, PRE_AUTH_TTL_MINUTES: 10, SESSION_TTL_HOURS: 12, DATABASE_URL: databaseUrl }, { auth, security: new SecurityEventService(prisma!) });
  };

  async function authenticate(email = "admin@mcap.local") {
    const agent = request.agent(application());
    const csrf = await agent.get("/api/v1/auth/csrf").expect(200);
    const login = await agent.post("/api/v1/auth/login").set("X-CSRF-Token", csrf.body.csrfToken).set("User-Agent", "MCAP Security Integration Test").send({ email, password }).expect(200);
    const companies = await agent.get("/api/v1/auth/companies").expect(200);
    await agent.put("/api/v1/auth/context").set("X-CSRF-Token", login.body.csrfToken).send({ companyId: companies.body.data[0].id }).expect(204);
    return { agent, csrfToken: login.body.csrfToken };
  }

  it("records authentication risk, filters alerts, and acknowledges a critical event", async () => {
    const failedAgent = request.agent(application());
    const preAuth = await failedAgent.get("/api/v1/auth/csrf").expect(200);
    await failedAgent.post("/api/v1/auth/login").set("X-CSRF-Token", preAuth.body.csrfToken).set("User-Agent", "MCAP Failed Login Test").send({ email: accountantEmail, password: "wrong-password" }).expect(401);
    const failed = await prisma!.securityEvent.findFirst({ where: { companyId, eventType: "LOGIN_FAILED", emailSnapshot: accountantEmail }, orderBy: { id: "desc" } });
    expect(failed).toMatchObject({ severity: "WARNING", userAgent: "MCAP Failed Login Test" });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const lockAgent = request.agent(application());
      const lockCsrf = await lockAgent.get("/api/v1/auth/csrf").expect(200);
      await lockAgent.post("/api/v1/auth/login").set("X-CSRF-Token", lockCsrf.body.csrfToken).set("User-Agent", "MCAP Account Lock Test").send({ email: reviewerEmail, password: "wrong-password" }).expect(401);
    }
    const locked = await prisma!.securityEvent.findFirst({ where: { companyId, eventType: "ACCOUNT_LOCKED", emailSnapshot: reviewerEmail }, orderBy: { id: "desc" } });
    expect(locked).toMatchObject({ severity: "CRITICAL" });
    const lockedAgent = request.agent(application());
    const lockedCsrf = await lockedAgent.get("/api/v1/auth/csrf").expect(200);
    const lockedResponse = await lockedAgent.post("/api/v1/auth/login").set("X-CSRF-Token", lockedCsrf.body.csrfToken).set("User-Agent", "MCAP Account Lock Test").send({ email: reviewerEmail, password }).expect(401);
    expect(lockedResponse.body.code).toBe("ACCOUNT_LOCKED");
    expect(await prisma!.securityEvent.findFirst({ where: { companyId, eventType: "LOCKED_ACCOUNT_LOGIN_ATTEMPT", emailSnapshot: reviewerEmail }, orderBy: { id: "desc" } })).toMatchObject({ severity: "HIGH" });

    const admin = await prisma!.user.findUniqueOrThrow({ where: { emailNormalized: "admin@mcap.local" } });
    const critical = await prisma!.securityEvent.create({ data: { companyId, userId: admin.id, eventType: testType, severity: "CRITICAL", emailSnapshot: admin.emailNormalized, ipAddress: "203.0.113.9", details: { test: true } } });
    const { agent, csrfToken } = await authenticate();
    const list = await agent.get(`/api/v1/security-events?severity=CRITICAL&unacknowledgedOnly=true&search=203.0.113.9`).expect(200);
    expect(list.body.data.some((item: { id: string }) => item.id === critical.id.toString())).toBe(true);
    const summary = await agent.get("/api/v1/security-events/summary").expect(200);
    expect(summary.body.unacknowledgedAlerts).toBeGreaterThan(0);
    expect(summary.body.last24Hours.critical).toBeGreaterThan(0);
    const options = await agent.get("/api/v1/security-events/options").expect(200);
    expect(options.body.eventTypes).toContain(testType);

    const acknowledged = await agent.post(`/api/v1/security-events/${critical.id}/acknowledge`).set("X-CSRF-Token", csrfToken).expect(200);
    expect(acknowledged.body.acknowledgedAt).toBeTruthy();
    expect(acknowledged.body.acknowledgedBy.name).toBeTruthy();
    const audit = await prisma!.auditLog.findFirst({ where: { companyId, action: "SECURITY_EVENT_ACKNOWLEDGED", entityId: critical.id.toString() } });
    expect(audit).toBeTruthy();
  });

  it("denies the security log to the accountant role", async () => {
    const { agent } = await authenticate(accountantEmail);
    await agent.get("/api/v1/security-events").expect(403);
  });
});
