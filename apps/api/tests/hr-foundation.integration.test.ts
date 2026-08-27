import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../src/database.js";
import { HrService } from "../src/hr/hr-service.js";
import { HrIdentityAdapter } from "../src/users/hr-identity-adapter.js";

const enabled = process.env.RUN_DB_TESTS === "true" && Boolean(process.env.DATABASE_URL);
const prisma = enabled ? createDatabase(process.env.DATABASE_URL!) : null;

describe.runIf(enabled)("HR foundation with MariaDB", () => {
  let service: HrService;
  let companyId: bigint;
  let userId: bigint;
  let linkedUserId: bigint;
  let foreignUserId: bigint;
  let foreignOrganizationId: bigint;
  let foreignCompanyId: bigint;
  let departmentId = "";
  let positionId = "";
  let employeeAId = "";
  let employeeBId = "";

  const context = () => ({ companyId, userId });

  async function cleanCompanyRows(targetCompanyId: bigint) {
    await prisma!.idempotencyRecord.deleteMany({
      where: {
        companyId: targetCompanyId,
        operation: { in: [
          "CREATE_HR_DEPARTMENT",
          "CREATE_HR_POSITION",
          "CREATE_EMPLOYEE",
          "TRANSITION_EMPLOYEE",
          "CREATE_EMPLOYMENT_CONTRACT",
          "END_EMPLOYMENT_CONTRACT",
        ] },
      },
    });
    await prisma!.auditLog.deleteMany({
      where: { companyId: targetCompanyId, entityType: { in: ["HR_DEPARTMENT", "HR_POSITION", "EMPLOYEE", "EMPLOYMENT_CONTRACT"] } },
    });
    const employees = await prisma!.employee.findMany({ where: { companyId: targetCompanyId, nameAr: { startsWith: "IT-HR-" } }, select: { id: true } });
    const employeeIds = employees.map(({ id }) => id);
    if (employeeIds.length) {
      await prisma!.employmentContract.deleteMany({ where: { companyId: targetCompanyId, employeeId: { in: employeeIds } } });
      await prisma!.employee.updateMany({ where: { companyId: targetCompanyId, id: { in: employeeIds } }, data: { managerEmployeeId: null } });
      await prisma!.employee.deleteMany({ where: { companyId: targetCompanyId, id: { in: employeeIds } } });
    }
    await prisma!.hrDepartment.deleteMany({ where: { companyId: targetCompanyId, nameAr: { startsWith: "IT-HR-" } } });
    await prisma!.hrPosition.deleteMany({ where: { companyId: targetCompanyId, nameAr: { startsWith: "IT-HR-" } } });
  }

  beforeAll(async () => {
    const admin = await prisma!.user.findUniqueOrThrow({ where: { emailNormalized: "admin@mcap.local" } });
    userId = admin.id;
    companyId = (await prisma!.userCompany.findFirstOrThrow({ where: { userId, isActive: true } })).companyId;
    await cleanCompanyRows(companyId);

    const linked = await prisma!.user.upsert({
      where: { emailNormalized: "hr.linked@mcap.local" },
      update: { displayName: "IT-HR-مستخدم مرتبط", isActive: true },
      create: { emailNormalized: "hr.linked@mcap.local", passwordHash: admin.passwordHash, displayName: "IT-HR-مستخدم مرتبط" },
    });
    linkedUserId = linked.id;
    await prisma!.userCompany.upsert({
      where: { userId_companyId: { userId: linkedUserId, companyId } },
      update: { isActive: true },
      create: { userId: linkedUserId, companyId },
    });

    const mainCompany = await prisma!.company.findUniqueOrThrow({ where: { id: companyId } });
    foreignOrganizationId = (await prisma!.organization.create({ data: { name: "IT-HR-Foreign Organization" } })).id;
    foreignCompanyId = (await prisma!.company.create({
      data: { organizationId: foreignOrganizationId, baseCurrencyId: mainCompany.baseCurrencyId, name: "IT-HR-Foreign Company", timezone: "Asia/Riyadh" },
    })).id;
    await prisma!.userCompany.create({ data: { userId, companyId: foreignCompanyId } });
    const foreign = await prisma!.user.create({
      data: { emailNormalized: `hr.foreign.${foreignCompanyId}@mcap.local`, passwordHash: admin.passwordHash, displayName: "IT-HR-مستخدم أجنبي" },
    });
    foreignUserId = foreign.id;
    await prisma!.userCompany.create({ data: { userId: foreignUserId, companyId: foreignCompanyId } });
    service = new HrService(prisma!, new HrIdentityAdapter(prisma!));
  });

  afterAll(async () => {
    if (!prisma) return;
    await cleanCompanyRows(companyId);
    await cleanCompanyRows(foreignCompanyId);
    await prisma.userCompany.deleteMany({ where: { userId: linkedUserId, companyId } });
    await prisma.user.deleteMany({ where: { id: linkedUserId, emailNormalized: "hr.linked@mcap.local" } });
    await prisma.userCompany.deleteMany({ where: { companyId: foreignCompanyId } });
    await prisma.user.deleteMany({ where: { id: foreignUserId } });
    await prisma.masterDataCodeSequence.deleteMany({ where: { companyId: foreignCompanyId } });
    await prisma.company.deleteMany({ where: { id: foreignCompanyId } });
    await prisma.organization.deleteMany({ where: { id: foreignOrganizationId } });
    await prisma.$disconnect();
  });

  it("creates structure and one employee under concurrent retries", async () => {
    const departmentInput = { nameAr: "IT-HR-القسم القانوني", nameEn: "Legal", description: null, idempotencyKey: "it-hr-department-create-0001" };
    const [department, departmentRetry] = await Promise.all([
      service.createDepartment(context(), departmentInput),
      service.createDepartment(context(), departmentInput),
    ]);
    expect(departmentRetry).toEqual(department);
    departmentId = department.department.id;
    expect(department.department.code).toMatch(/^DEP-\d{6}$/u);

    const position = await service.createPosition(context(), {
      nameAr: "IT-HR-محامٍ مستشار",
      nameEn: "Counsel",
      idempotencyKey: "it-hr-position-create-0001",
    });
    positionId = position.position.id;
    expect(position.position.code).toMatch(/^JOB-\d{6}$/u);

    const employeeInput = {
      nameAr: "IT-HR-الموظف أ",
      nameEn: "Employee A",
      departmentId,
      positionId,
      employmentType: "FULL_TIME" as const,
      hireDate: "2058-01-01",
      workLocation: "الرياض",
      idempotencyKey: "it-hr-employee-create-0001",
    };
    const [employee, employeeRetry] = await Promise.all([
      service.createEmployee(context(), employeeInput),
      service.createEmployee(context(), employeeInput),
    ]);
    expect(employeeRetry).toEqual(employee);
    employeeAId = employee.employee.id;
    expect(employee.employee.employeeNumber).toMatch(/^EMP-\d{6}$/u);
    expect(await prisma!.employee.count({ where: { companyId, publicId: employeeAId } })).toBe(1);
    await expect(service.createEmployee(context(), { ...employeeInput, nameAr: "IT-HR-payload مختلف" }))
      .rejects.toMatchObject({ reason: "IDEMPOTENCY_MISMATCH" });
  });

  it("links identity only inside the company and prevents manager cycles", async () => {
    const employeeB = await service.createEmployee(context(), {
      nameAr: "IT-HR-الموظف ب",
      userId: linkedUserId,
      positionId,
      managerEmployeeId: employeeAId,
      employmentType: "CONTRACTOR",
      hireDate: "2058-01-02",
      idempotencyKey: "it-hr-employee-create-0002",
    });
    employeeBId = employeeB.employee.id;
    expect(employeeB.employee.linkedUser?.id).toBe(linkedUserId.toString());

    await expect(service.createEmployee(context(), {
      nameAr: "IT-HR-ربط مكرر",
      userId: linkedUserId,
      employmentType: "FULL_TIME",
      hireDate: "2058-01-03",
      idempotencyKey: "it-hr-employee-duplicate-user",
    })).rejects.toMatchObject({ reason: "USER_ALREADY_LINKED" });
    await expect(service.createEmployee(context(), {
      nameAr: "IT-HR-ربط عابر للشركة",
      userId: foreignUserId,
      employmentType: "FULL_TIME",
      hireDate: "2058-01-03",
      idempotencyKey: "it-hr-employee-foreign-user",
    })).rejects.toMatchObject({ reason: "USER_NOT_FOUND" });

    await expect(service.updateEmployee(context(), employeeAId, { version: 0, managerEmployeeId: employeeBId }))
      .rejects.toMatchObject({ reason: "MANAGER_CYCLE" });
    await expect(service.updateDepartment(context(), departmentId, { version: 0, isActive: false, reason: "محاولة تعطيل مرجع مستخدم" }))
      .rejects.toMatchObject({ reason: "REFERENCE_IN_USE" });
  });

  it("keeps one active contract and ends it atomically with employment", async () => {
    const contractInput = {
      contractType: "PERMANENT" as const,
      titleAr: "IT-HR-عقد عمل",
      startDate: "2058-01-01",
      notes: null,
      idempotencyKey: "it-hr-contract-create-0001",
    };
    const [contract, contractRetry] = await Promise.all([
      service.createContract(context(), employeeAId, contractInput),
      service.createContract(context(), employeeAId, contractInput),
    ]);
    expect(contractRetry).toEqual(contract);
    expect(await prisma!.employmentContract.count({ where: { companyId, publicId: contract.contract.id } })).toBe(1);
    await expect(service.createContract(context(), employeeAId, { ...contractInput, idempotencyKey: "it-hr-second-active-contract" }))
      .rejects.toMatchObject({ reason: "ACTIVE_CONTRACT_EXISTS" });

    const ended = await service.endContract(context(), employeeAId, contract.contract.id, {
      version: 0,
      endDate: "2058-12-31",
      reason: "تجديد العقد الاختباري",
      idempotencyKey: "it-hr-contract-end-0001",
    });
    expect(ended.contract.status).toBe("ENDED");
    await service.createContract(context(), employeeAId, {
      contractType: "FIXED_TERM",
      titleAr: "IT-HR-عقد بديل",
      startDate: "2059-01-01",
      endDate: "2059-12-31",
      idempotencyKey: "it-hr-contract-create-0002",
    });
    const terminated = await service.transitionEmployee(context(), employeeAId, {
      version: 0,
      status: "TERMINATED",
      effectiveDate: "2059-06-30",
      reason: "إنهاء خدمة اختباري",
      idempotencyKey: "it-hr-employee-terminate-0001",
    });
    expect(terminated.employee.status).toBe("TERMINATED");
    expect(terminated.employee.hasActiveContract).toBe(false);
    expect(await prisma!.employmentContract.count({ where: { companyId, employee: { publicId: employeeAId }, status: "ACTIVE" } })).toBe(0);

    const disabled = await service.updateDepartment(context(), departmentId, { version: 0, isActive: false, reason: "انتهاء استخدام القسم الاختباري" });
    expect(disabled.department.isActive).toBe(false);
  });

  it("keeps company reads isolated and detects stale versions", async () => {
    const foreignContext = { companyId: foreignCompanyId, userId };
    expect((await service.listEmployees(foreignContext, { page: 1, pageSize: 25 })).data).toEqual([]);
    await expect(service.getEmployee(foreignContext, employeeBId)).rejects.toMatchObject({ reason: "NOT_FOUND" });
    await expect(service.updateEmployee(context(), employeeBId, { version: 99, workLocation: "جدة" }))
      .rejects.toMatchObject({ reason: "VERSION_CONFLICT" });
  });
});
