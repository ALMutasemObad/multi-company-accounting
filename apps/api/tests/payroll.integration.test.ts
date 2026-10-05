import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../src/database.js";
import { PayrollCompanyAdapter } from "../src/companies/payroll-company-adapter.js";
import { PayrollOwnerAdapter } from "../src/users/payroll-owner-adapter.js";
import { PayrollEmployeeAdapter } from "../src/hr/payroll-employee-adapter.js";
import { PayrollService } from "../src/payroll/payroll-service.js";
import { PayrollVault } from "../src/payroll/payroll-vault.js";
import { ApprovalService } from "../src/approvals/approval-service.js";
import { PayrollApprovalAdapter } from "../src/payroll/payroll-approval-adapter.js";

const enabled = process.env.RUN_DB_TESTS === "true" && Boolean(process.env.DATABASE_URL);
const db = enabled ? createDatabase(process.env.DATABASE_URL!) : null;
describe.runIf(enabled)("private payroll persistence", () => {
  const companies: bigint[] = [];
  let organizationId: bigint;
  let ownerId: bigint;
  let preparerId: bigint;
  let employeeId: string;
  let service: PayrollService;
  let runId: string;
  let approvals: ApprovalService;
  const owner = () => ({ companyId: companies[0]!, userId: ownerId });
  const preparer = () => ({ companyId: companies[0]!, userId: preparerId });
  const key = () => randomUUID();
  beforeAll(async () => {
    ownerId = (await db!.user.findUniqueOrThrow({ where: { emailNormalized: "admin@mcap.local" } })).id;
    preparerId = (await db!.user.create({ data: { emailNormalized: `payroll-${key()}@example.test`, displayName: "Payroll test preparer" } })).id;
    const currency = await db!.currency.findUniqueOrThrow({ where: { scopeKey_code: { scopeKey: "GLOBAL", code: "SAR" } } });
    organizationId = (await db!.organization.create({ data: { name: `IT-PAYROLL-${key()}` } })).id;
    await db!.organizationMembership.create({ data: { organizationId, userId: ownerId, role: "OWNER" } });
    for (let index = 0; index < 2; index++) {
      const company = await db!.company.create({ data: { organizationId, baseCurrencyId: currency.id, name: `IT-PAYROLL-${index}-${key()}`, timezone: "Asia/Riyadh" } });
      companies.push(company.id);
      await db!.userCompany.createMany({ data: [{ companyId: company.id, userId: ownerId }, { companyId: company.id, userId: preparerId }] });
    }
    employeeId = (await db!.employee.create({ data: { companyId: companies[0]!, employeeNumber: "EMP-TEST", nameAr: "موظف اختبار رواتب",
      employmentType: "FULL_TIME", hireDate: new Date("2026-01-01"), createdById: ownerId, updatedById: ownerId } })).publicId;
    service = new PayrollService(db!, new PayrollCompanyAdapter(), new PayrollOwnerAdapter(), new PayrollEmployeeAdapter(),
      new PayrollVault("test", { test: Buffer.alloc(32, 3).toString("base64") }, "test"));
    const unused = { request: async () => { throw new Error("unused subject"); }, approve: async () => { throw new Error("unused subject"); }, reject: async () => { throw new Error("unused subject"); } };
    approvals = new ApprovalService(db!, { FINANCIAL_CLOSE_RUN: unused, PROFESSIONAL_TIMESHEET: unused,
      EMPLOYEE_EXPENSE_CLAIM: unused, PAYROLL_RUN: new PayrollApprovalAdapter(service) });
  });
  afterAll(async () => {
    if (!db) return;
    if (companies.length) {
      const companyId = { in: companies };
      await db.idempotencyRecord.deleteMany({ where: { companyId } });
      await db.auditLog.deleteMany({ where: { companyId } });
      await db.approvalDecision.deleteMany({ where: { companyId } });
      await db.approvalRequest.deleteMany({ where: { companyId } });
      await db.payrollRunSnapshot.deleteMany({ where: { companyId } });
      await db.payrollRun.deleteMany({ where: { companyId } });
      await db.payrollPayAgreement.deleteMany({ where: { companyId } });
      await db.payrollCompanyScope.deleteMany({ where: { companyId } });
      await db.employee.deleteMany({ where: { companyId } });
      await db.userCompany.deleteMany({ where: { companyId } });
      await db.company.deleteMany({ where: { id: companyId } });
    }
    if (organizationId) {
      await db.organizationMembership.deleteMany({ where: { organizationId } });
      await db.organization.delete({ where: { id: organizationId } });
    }
    if (preparerId) await db.user.delete({ where: { id: preparerId } });
    await db.$disconnect();
  });
  it("stores encrypted agreements and calculates a run with owner-only amounts", async () => {
    const input = { employeeId, startsOn: "2026-01-01", basicSalary: "7123.45", fixedAllowance: "200.10", idempotencyKey: key() };
    const agreement = await service.createAgreement(owner(), input);
    expect(await service.createAgreement(owner(), input)).toEqual(agreement);
    await expect(service.listAgreements(preparer(), 1, 25)).rejects.toMatchObject({ reason: "OWNER_REQUIRED" });
    const run = await service.createRun(preparer(), { periodStart: "2026-09-01", periodEndExclusive: "2026-10-01", idempotencyKey: key() });
    runId = run.id;
    await service.calculateRun(preparer(), runId, { expectedVersion: 0, idempotencyKey: key() });
    const privateView = await service.getRun(owner(), runId);
    expect(privateView.details?.netPayable).toBe("7323.55");
    expect(privateView.details?.employees[0]?.basicSalary).toBe("7123.45");
    const restrictedView = await service.getRun(preparer(), runId);
    expect(restrictedView.details).toBeNull();
    expect(restrictedView.run.employeeCount).toBe(1);
    const raw = [
      ...(await db!.payrollPayAgreement.findMany({ where: { companyId: companies[0]! } })).map(row => row.encryptedTerms),
      ...(await db!.payrollRun.findMany({ where: { companyId: companies[0]! } })).map(row => row.encryptedSnapshot),
      ...(await db!.idempotencyRecord.findMany({ where: { companyId: companies[0]! } })).map(row => row.responseBody),
      ...(await db!.auditLog.findMany({ where: { companyId: companies[0]! } })).map(row => row.details),
    ];
    expect(JSON.stringify(raw)).not.toContain("7123.45");
    expect(JSON.stringify(raw)).not.toContain("7323.55");
  });
  it("rejects overlapping cycles concurrently and retains one winner", async () => {
    const attempts = await Promise.allSettled([1, 2].map(() => service.createRun(preparer(), {
      periodStart: "2026-10-01", periodEndExclusive: "2026-11-01", idempotencyKey: key(),
    })));
    expect(attempts.filter(item => item.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter(item => item.status === "rejected")).toHaveLength(1);
    expect((attempts.find(item => item.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ reason: "RUN_OVERLAP" });
  });
  it("submits a real approval and only a different owner can approve", async () => {
    const approval = await approvals.request(preparer(), { subjectType: "PAYROLL_RUN", subjectId: runId, subjectVersion: 1, idempotencyKey: key() });
    await expect(approvals.approve(preparer(), approval.approvalRequest.id, { version: 0, idempotencyKey: key() }))
      .rejects.toMatchObject({ reason: "MAKER_CHECKER_VIOLATION" });
    const accepted = await approvals.approve(owner(), approval.approvalRequest.id, { version: 0, idempotencyKey: key() });
    expect(accepted.approvalRequest.status).toBe("APPROVED");
    expect((await service.getRun(owner(), runId)).run.status).toBe("APPROVED");
    expect((await service.getRun(preparer(), runId)).details).toBeNull();
    expect(JSON.stringify(accepted)).not.toContain("7123.45");
  });
  it("isolates companies and rejects partial month and stale calculations", async () => {
    await expect(service.getRun({ companyId: companies[1]!, userId: ownerId }, runId)).rejects.toMatchObject({ reason: "NOT_FOUND" });
    await expect(service.createRun(preparer(), { periodStart: "2026-11-02", periodEndExclusive: "2026-12-01", idempotencyKey: key() }))
      .rejects.toMatchObject({ reason: "FULL_MONTH_REQUIRED" });
    await expect(service.calculateRun(preparer(), runId, { expectedVersion: 0, idempotencyKey: key() })).rejects.toMatchObject({ reason: "VERSION_CONFLICT" });
  });
  it("retains encrypted calculation history when rejected and never stores private rejection notes", async () => {
    const run = await service.createRun(preparer(), { periodStart: "2026-11-01", periodEndExclusive: "2026-12-01", idempotencyKey: key() });
    await service.calculateRun(preparer(), run.id, { expectedVersion: 0, idempotencyKey: key() });
    let approval = await approvals.request(preparer(), { subjectType: "PAYROLL_RUN", subjectId: run.id, subjectVersion: 1, idempotencyKey: key() });
    const rejected = await approvals.reject(owner(), approval.approvalRequest.id, { version: 0, reason: "Correct salary 7123.45 please", idempotencyKey: key() });
    expect(JSON.stringify(rejected)).not.toContain("7123.45");
    expect((await service.getRun(owner(), run.id)).details).toBeNull();
    await service.calculateRun(preparer(), run.id, { expectedVersion: 3, idempotencyKey: key() });
    approval = await approvals.request(preparer(), { subjectType: "PAYROLL_RUN", subjectId: run.id, subjectVersion: 4, idempotencyKey: key() });
    await db!.employee.update({ where: { publicId: employeeId }, data: { status: "TERMINATED", terminationDate: new Date("2026-11-15"), terminationReason: "Isolated eligibility-change fixture" } });
    try {
      await expect(approvals.approve(owner(), approval.approvalRequest.id, { version: 0, idempotencyKey: key() }))
        .rejects.toMatchObject({ reason: "SUBJECT_INVALID_STATE" });
      await approvals.reject(owner(), approval.approvalRequest.id, { version: 0, reason: "Returned for correction", idempotencyKey: key() });
    } finally { await db!.employee.update({ where: { publicId: employeeId }, data: { status: "ACTIVE", terminationDate: null, terminationReason: null } }); }
    const history = await db!.payrollRunSnapshot.findMany({ where: { companyId: companies[0]!, run: { publicId: run.id } } });
    expect(history).toHaveLength(2);
    expect(history.map(row => row.runVersion).sort()).toEqual([1, 4]);
    expect(JSON.stringify(history.map(row => row.encryptedSnapshot))).not.toContain("7123.45");
    const notes = await db!.approvalDecision.findMany({ where: { companyId: companies[0]! }, select: { reason: true } });
    expect(JSON.stringify(notes)).not.toContain("7123.45");
  });
  it("rejects tampering with a stored snapshot", async () => {
    const saved = await db!.payrollRun.findUniqueOrThrow({ where: { publicId: runId } });
    await db!.payrollRun.update({ where: { id: saved.id }, data: { encryptedSnapshot: { ...(saved.encryptedSnapshot as Record<string, string>), ciphertext: "AAAA" } } });
    try { await expect(service.getRun(owner(), runId)).rejects.toMatchObject({ reason: "SNAPSHOT_CHANGED" }); }
    finally { await db!.payrollRun.update({ where: { id: saved.id }, data: { encryptedSnapshot: saved.encryptedSnapshot! } }); }
  });
  it("ends agreements only as owner, protects calculated coverage and allows a succeeding agreement", async () => {
    await expect(service.createAgreement(owner(), { employeeId, startsOn: "2026-09-01", basicSalary: "1", idempotencyKey: key() }))
      .rejects.toMatchObject({ reason: "CALCULATED_PERIOD_PROTECTED" });
    const agreement = (await service.listAgreements(owner(), 1, 25)).data[0]!;
    await expect(service.endAgreement(preparer(), agreement.id, { expectedVersion: 0, endsBefore: "2026-10-01", idempotencyKey: key() }))
      .rejects.toMatchObject({ reason: "OWNER_REQUIRED" });
    await expect(service.endAgreement(owner(), agreement.id, { expectedVersion: 0, endsBefore: "2026-09-15", idempotencyKey: key() }))
      .rejects.toMatchObject({ reason: "CALCULATED_PERIOD_PROTECTED" });
    const input = { expectedVersion: 0, endsBefore: "2026-10-01", idempotencyKey: key() };
    const ended = await service.endAgreement(owner(), agreement.id, input);
    expect(ended.version).toBe(1);
    expect(await service.endAgreement(owner(), agreement.id, input)).toEqual(ended);
    await expect(service.endAgreement(owner(), agreement.id, { ...input, idempotencyKey: key() })).rejects.toMatchObject({ reason: "VERSION_CONFLICT" });
    await service.createAgreement(owner(), { employeeId, startsOn: "2026-10-01", basicSalary: "8000.00", idempotencyKey: key() });
    expect((await service.getRun(owner(), runId)).details?.netPayable).toBe("7323.55");
    await db!.organizationMembership.update({ where: { organizationId_userId: { organizationId, userId: ownerId } }, data: { role: "ADMIN" } });
    try {
      await expect(service.endAgreement(owner(), agreement.id, input)).rejects.toMatchObject({ reason: "OWNER_REQUIRED" });
      expect((await service.getRun(owner(), runId)).details).toBeNull();
    } finally {
      await db!.organizationMembership.update({ where: { organizationId_userId: { organizationId, userId: ownerId } }, data: { role: "OWNER" } });
    }
  });
});
