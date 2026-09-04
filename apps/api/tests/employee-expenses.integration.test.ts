import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EmployeeExpenseCostCenterAdapter } from "../src/accounts/employee-expense-cost-center-adapter.js";
import { ApprovalError, ApprovalService } from "../src/approvals/approval-service.js";
import type { ApprovalSubjectPort } from "../src/approvals/approval-subject-port.js";
import { EmployeeExpenseCurrencyAdapter } from "../src/companies/employee-expense-currency-adapter.js";
import { createDatabase } from "../src/database.js";
import { EmployeeExpenseApprovalAdapter } from "../src/employee-expenses/employee-expense-approval-adapter.js";
import { EmployeeExpenseService } from "../src/employee-expenses/employee-expense-service.js";
import { EmployeeExpenseEmployeeAdapter } from "../src/hr/employee-expense-employee-adapter.js";

const enabled = process.env.RUN_DB_TESTS === "true" && Boolean(process.env.DATABASE_URL);
const prisma = enabled ? createDatabase(process.env.DATABASE_URL!) : null;

describe.runIf(enabled)("employee expense claim lifecycle with MariaDB", () => {
  let expenses: EmployeeExpenseService;
  let approvals: ApprovalService;
  let companyId: bigint;
  let makerId: bigint;
  let checkerId: bigint;
  let costCenterId: bigint;
  let employeeId: bigint;
  const makerEmail = "expense.maker@mcap.local";
  const idempotencyKeys = [
    "it-expense-create-concurrent-0001",
    "it-expense-create-approval-0001",
    "it-expense-request-approval-0001",
    "it-expense-maker-approve-0001",
    "it-expense-checker-approve-0001",
  ];

  const makerContext = () => ({ companyId, userId: makerId });
  const checkerContext = () => ({ companyId, userId: checkerId });
  const line = () => ({
    incurredOn: "2060-09-04",
    merchant: "IT-EXP Rail",
    description: "IT-EXP client travel",
    receiptReference: "IT-EXP-RCP-01",
    costCenterId,
    amount: "125.50",
  });

  async function clean() {
    if (!prisma || !companyId) return;
    const claims = await prisma.employeeExpenseClaim.findMany({
      where: { companyId, purpose: { startsWith: "IT-EXP" } },
      select: { publicId: true },
    });
    const subjectIds = claims.map(({ publicId }) => publicId);
    const requests = subjectIds.length ? await prisma.approvalRequest.findMany({
      where: { companyId, subjectType: "EMPLOYEE_EXPENSE_CLAIM", subjectId: { in: subjectIds } },
      select: { id: true, publicId: true },
    }) : [];
    const requestPublicIds = requests.map(({ publicId }) => publicId);
    if (subjectIds.length || requestPublicIds.length) {
      await prisma.auditLog.deleteMany({
        where: { companyId, OR: [
          { entityType: "EMPLOYEE_EXPENSE_CLAIM", entityId: { in: subjectIds } },
          { entityType: "APPROVAL_REQUEST", entityId: { in: requestPublicIds } },
        ] },
      });
    }
    const requestIds = requests.map(({ id }) => id);
    if (requestIds.length) {
      await prisma.approvalDecision.deleteMany({ where: { companyId, approvalRequestId: { in: requestIds } } });
      await prisma.approvalRequest.deleteMany({ where: { companyId, id: { in: requestIds } } });
    }
    if (subjectIds.length) {
      await prisma.employeeExpenseClaim.deleteMany({ where: { companyId, publicId: { in: subjectIds } } });
    }
    const keyHashes = idempotencyKeys.map((key) => createHash("sha256").update(key).digest());
    await prisma.idempotencyRecord.deleteMany({
      where: { companyId, keyHash: { in: keyHashes } },
    });
  }

  beforeAll(async () => {
    const admin = await prisma!.user.findUniqueOrThrow({ where: { emailNormalized: "admin@mcap.local" } });
    checkerId = admin.id;
    companyId = (await prisma!.userCompany.findFirstOrThrow({ where: { userId: admin.id, isActive: true } })).companyId;
    await clean();
    const oldMaker = await prisma!.user.findUnique({ where: { emailNormalized: makerEmail } });
    if (oldMaker) {
      await prisma!.employee.updateMany({ where: { companyId, userId: oldMaker.id }, data: { userId: null } });
      await prisma!.userCompanyRole.deleteMany({ where: { companyId, userId: oldMaker.id } });
      await prisma!.userCompany.deleteMany({ where: { companyId, userId: oldMaker.id } });
      await prisma!.user.delete({ where: { id: oldMaker.id } });
    }
    makerId = (await prisma!.user.create({
      data: { emailNormalized: makerEmail, displayName: "IT-EXP Maker", passwordHash: admin.passwordHash },
    })).id;
    await prisma!.userCompany.create({ data: { userId: makerId, companyId } });
    employeeId = (await prisma!.employee.create({
      data: {
        companyId,
        userId: makerId,
        employeeNumber: `IT-EXP-${makerId}`,
        nameAr: "IT-EXP موظف المصروفات",
        nameEn: "IT-EXP Expense employee",
        employmentType: "FULL_TIME",
        hireDate: new Date("2060-01-01T00:00:00.000Z"),
        createdById: checkerId,
        updatedById: checkerId,
      },
    })).id;
    costCenterId = (await prisma!.costCenter.upsert({
      where: { companyId_code: { companyId, code: "IT-EXP-CC" } },
      update: { isActive: true },
      create: { companyId, code: "IT-EXP-CC", nameAr: "IT-EXP مركز المصروفات", nameEn: "IT-EXP expenses" },
    })).id;
    expenses = new EmployeeExpenseService(
      prisma!,
      new EmployeeExpenseEmployeeAdapter(),
      new EmployeeExpenseCostCenterAdapter(prisma!),
      new EmployeeExpenseCurrencyAdapter(),
    );
    const unavailable: ApprovalSubjectPort = {
      request: async () => { throw new Error("not used"); },
      approve: async () => { throw new Error("not used"); },
      reject: async () => { throw new Error("not used"); },
    };
    approvals = new ApprovalService(prisma!, {
      FINANCIAL_CLOSE_RUN: unavailable,
      PROFESSIONAL_TIMESHEET: unavailable,
      EMPLOYEE_EXPENSE_CLAIM: new EmployeeExpenseApprovalAdapter(expenses),
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await clean();
    if (employeeId) await prisma.employee.deleteMany({ where: { id: employeeId, companyId } });
    if (costCenterId) await prisma.costCenter.deleteMany({ where: { id: costCenterId, companyId } });
    if (makerId) {
      await prisma.userCompanyRole.deleteMany({ where: { companyId, userId: makerId } });
      await prisma.userCompany.deleteMany({ where: { companyId, userId: makerId } });
      await prisma.user.deleteMany({ where: { id: makerId, emailNormalized: makerEmail } });
    }
    await prisma.$disconnect();
  });

  it("creates exactly one decimal claim under concurrent idempotent retries", async () => {
    const input = {
      purpose: "IT-EXP client visit",
      lines: [line(), { ...line(), merchant: "IT-EXP Taxi", amount: "30.25" }],
      idempotencyKey: "it-expense-create-concurrent-0001",
    };
    const [created, replay] = await Promise.all([
      expenses.create(makerContext(), input),
      expenses.create(makerContext(), input),
    ]);

    expect(replay).toEqual(created);
    expect(created.claim.totalAmount).toBe("155.7500");
    expect(await prisma!.employeeExpenseClaim.count({
      where: { companyId, publicId: created.claim.id },
    })).toBe(1);
    await expect(expenses.create(makerContext(), { ...input, purpose: "IT-EXP changed" }))
      .rejects.toMatchObject({ reason: "IDEMPOTENCY_MISMATCH" });
  });

  it("enforces maker/checker and stops at READY_FOR_PAYMENT without financial writes", async () => {
    const created = await expenses.create(makerContext(), {
      purpose: "IT-EXP approval journey",
      lines: [line()],
      idempotencyKey: "it-expense-create-approval-0001",
    });
    const beforePayments = await prisma!.payment.count({ where: { companyId } });
    const beforeDocuments = await prisma!.accountingDocument.count({ where: { companyId } });
    const requested = await approvals.request(makerContext(), {
      subjectType: "EMPLOYEE_EXPENSE_CLAIM",
      subjectId: created.claim.id,
      subjectVersion: created.claim.version,
      idempotencyKey: "it-expense-request-approval-0001",
    });

    await expect(approvals.approve(makerContext(), requested.approvalRequest.id, {
      version: requested.approvalRequest.version,
      idempotencyKey: "it-expense-maker-approve-0001",
    })).rejects.toBeInstanceOf(ApprovalError);

    await approvals.approve(checkerContext(), requested.approvalRequest.id, {
      version: requested.approvalRequest.version,
      idempotencyKey: "it-expense-checker-approve-0001",
    });
    const approved = await prisma!.employeeExpenseClaim.findFirstOrThrow({
      where: { companyId, publicId: created.claim.id },
    });
    expect(approved.status).toBe("READY_FOR_PAYMENT");
    expect(approved.approvedById).toBe(checkerId);
    expect(await prisma!.payment.count({ where: { companyId } })).toBe(beforePayments);
    expect(await prisma!.accountingDocument.count({ where: { companyId } })).toBe(beforeDocuments);
  });

  it("isolates reads and cost-center references by company", async () => {
    const foreignCompanyId = companyId + 9_000_000n;
    const result = await expenses.list({ companyId: foreignCompanyId, userId: makerId }, {
      page: 1,
      pageSize: 25,
      scope: "company",
    });
    expect(result.data).toEqual([]);
    expect(await expenses.listCostCenters({ companyId: foreignCompanyId, userId: makerId })).toEqual({ data: [] });
  });
});
