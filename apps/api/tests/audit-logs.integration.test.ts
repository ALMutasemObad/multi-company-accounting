import { hash, verify } from "argon2";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createAuditService } from "../src/composition/create-audit-service.js";
import { AuthService } from "../src/auth/auth-service.js";
import { PrismaAuthStore } from "../src/auth/prisma-auth-store.js";
import { createDatabase } from "../src/database.js";
import { testAuthOptions } from "./helpers/test-auth-options.js";

const enabled = process.env.RUN_DB_TESTS === "true";
const databaseUrl = process.env.DATABASE_URL ?? "";
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "";
const prisma = enabled ? createDatabase(databaseUrl) : null;
const viewerEmail = "audit.viewer.integration@mcap.local";
const viewerPassword = "Audit-Viewer-2026!";

async function authenticate(app: ReturnType<typeof createApp>, email: string, password: string, companyId: string) {
  const agent = request.agent(app);
  const csrf = await agent.get("/api/v1/auth/csrf").expect(200);
  const login = await agent.post("/api/v1/auth/login").set("X-CSRF-Token", csrf.body.csrfToken).send({ email, password }).expect(200);
  await agent.put("/api/v1/auth/context").set("X-CSRF-Token", login.body.csrfToken).send({ companyId }).expect(204);
  return agent;
}

describe.runIf(enabled)("audit log operations with MariaDB", () => {
  let app: ReturnType<typeof createApp>;
  let companyId: bigint;
  let foreignCompanyId: bigint;
  let adminId: bigint;
  let viewerId: bigint;
  let currentLogId: bigint;
  const startedAt = new Date();

  beforeAll(async () => {
    const admin = await prisma!.user.findUniqueOrThrow({ where: { emailNormalized: "admin@mcap.local" } });
    adminId = admin.id;
    const adminAssignment = await prisma!.userCompany.findFirstOrThrow({
      where: { userId: admin.id, isActive: true },
      include: { company: true },
    });
    const baseCompany = adminAssignment.company;
    companyId = adminAssignment.companyId;
    await prisma!.session.deleteMany({ where: { user: { emailNormalized: viewerEmail } } });
    const existingViewer = await prisma!.user.findUnique({ where: { emailNormalized: viewerEmail } });
    if (existingViewer) {
      await prisma!.userCompanyRole.deleteMany({ where: { userId: existingViewer.id } });
      await prisma!.userCompany.deleteMany({ where: { userId: existingViewer.id } });
      await prisma!.user.delete({ where: { id: existingViewer.id } });
    }
    const viewer = await prisma!.user.create({ data: { emailNormalized: viewerEmail, displayName: "مراجع دون صلاحية", passwordHash: await hash(viewerPassword) } });
    viewerId = viewer.id;
    await prisma!.userCompany.create({ data: { userId: viewer.id, companyId } });
    const foreign = await prisma!.company.create({ data: { organizationId: baseCompany.organizationId, baseCurrencyId: baseCompany.baseCurrencyId, name: "IT Audit Foreign Company", timezone: "Asia/Riyadh" } });
    foreignCompanyId = foreign.id;
    const first = await prisma!.auditLog.create({ data: { companyId, actorUserId: adminId, action: "IT_AUDIT_CREATED", entityType: "TEST_ENTITY", entityId: "=danger", details: { note: "سطر اختباري", amount: 10 }, createdAt: new Date(Date.now() - 60_000) } });
    currentLogId = first.id;
    await prisma!.auditLog.create({ data: { companyId, actorUserId: adminId, action: "IT_AUDIT_CREATED", entityType: "TEST_ENTITY", entityId: "second", details: { note: "سجل ثان" } } });
    await prisma!.auditLog.create({ data: { companyId, actorUserId: adminId, action: "IT_AUDIT_UPDATED", entityType: "OTHER_ENTITY", entityId: "third" } });
    await prisma!.auditLog.create({ data: { companyId: foreign.id, actorUserId: adminId, action: "IT_AUDIT_FOREIGN", entityType: "TEST_ENTITY", entityId: "foreign" } });
    const auth = new AuthService(new PrismaAuthStore(prisma!), { verify }, testAuthOptions(prisma!));
    app = createApp({ NODE_ENV: "test", PORT: 3000, WEB_ORIGIN: "http://localhost:5173", SESSION_COOKIE_SECURE: false, PRE_AUTH_TTL_MINUTES: 10, SESSION_TTL_HOURS: 12, DATABASE_URL: databaseUrl }, { auth, audit: createAuditService(prisma!) });
  });

  afterAll(async () => {
    await prisma!.auditLog.deleteMany({ where: { OR: [{ action: { startsWith: "IT_AUDIT_" } }, { action: "AUDIT_LOG_EXPORTED", actorUserId: adminId, createdAt: { gte: startedAt } }] } });
    await prisma!.session.deleteMany({ where: { userId: viewerId } });
    await prisma!.userCompanyRole.deleteMany({ where: { userId: viewerId } });
    await prisma!.userCompany.deleteMany({ where: { userId: viewerId } });
    await prisma!.user.delete({ where: { id: viewerId } });
    await prisma!.company.delete({ where: { id: foreignCompanyId } });
    await prisma!.$disconnect();
  });

  it("isolates, filters, paginates and exposes details and options", async () => {
    const agent = await authenticate(app, "admin@mcap.local", adminPassword, companyId.toString());
    const result = await agent.get("/api/v1/audit-logs").query({ action: "IT_AUDIT_CREATED", entityType: "TEST_ENTITY", userId: adminId.toString(), page: 1, pageSize: 1 }).expect(200);
    expect(result.body.meta).toMatchObject({ page: 1, pageSize: 1, total: 2, totalPages: 2 });
    expect(result.body.data[0].actor.email).toBe("admin@mcap.local");
    expect(result.body.data.every((item: { action: string }) => item.action !== "IT_AUDIT_FOREIGN")).toBe(true);
    const searched = await agent.get("/api/v1/audit-logs").query({ search: "admin@mcap.local", pageSize: 100 }).expect(200);
    expect(searched.body.data.some((item: { id: string }) => item.id === currentLogId.toString())).toBe(true);
    const detail = await agent.get(`/api/v1/audit-logs/${currentLogId}`).expect(200);
    expect(detail.body.details.note).toBe("سطر اختباري");
    await agent.get("/api/v1/audit-logs/options").expect(200).then((response) => {
      expect(response.body.actions).toContain("IT_AUDIT_CREATED");
      expect(response.body.entityTypes).toContain("TEST_ENTITY");
      expect(response.body.users.some((user: { id: string }) => user.id === adminId.toString())).toBe(true);
    });
    const foreign = await prisma!.auditLog.findFirstOrThrow({ where: { companyId: foreignCompanyId } });
    await agent.get(`/api/v1/audit-logs/${foreign.id}`).expect(404);
  });

  it("exports safe UTF-8 CSV and audits the export", async () => {
    const agent = await authenticate(app, "admin@mcap.local", adminPassword, companyId.toString());
    const response = await agent.get("/api/v1/audit-logs/export.csv").query({ action: "IT_AUDIT_CREATED" }).expect("Content-Type", /text\/csv/).expect(200);
    expect(response.text.charCodeAt(0)).toBe(0xfeff);
    expect(response.text).toContain("'=danger");
    expect(response.headers["x-export-row-count"]).toBe("2");
    expect(await prisma!.auditLog.count({ where: { companyId, actorUserId: adminId, action: "AUDIT_LOG_EXPORTED", createdAt: { gte: startedAt } } })).toBeGreaterThan(0);
  });

  it("rejects users without the audit permission and validates ranges", async () => {
    const viewer = await authenticate(app, viewerEmail, viewerPassword, companyId.toString());
    await viewer.get("/api/v1/audit-logs").expect(403);
    const admin = await authenticate(app, "admin@mcap.local", adminPassword, companyId.toString());
    await admin.get("/api/v1/audit-logs").query({ dateFrom: "2026-12-31", dateTo: "2026-01-01" }).expect(400);
  });
});
