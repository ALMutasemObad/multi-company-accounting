import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../src/database.js";
import { GeneralProjectService } from "../src/general-projects/general-project-service.js";
import { GeneralProjectEmployeeAdapter } from "../src/hr/general-project-employee-adapter.js";
import { GeneralProjectCustomerAdapter } from "../src/sales/general-project-customer-adapter.js";

const enabled = process.env.RUN_DB_TESTS === "true" && Boolean(process.env.DATABASE_URL);
const prisma = enabled ? createDatabase(process.env.DATABASE_URL!) : null;

describe.runIf(enabled)("general project register on isolated MySQL/MariaDB", () => {
  let service: GeneralProjectService;
  let organizationId: bigint;
  let companyId: bigint;
  let foreignCompanyId: bigint;
  let userId: bigint;
  let managerId: string;
  let contributorId: string;
  let foreignEmployeeId: string;
  let projectId = "";
  const context = () => ({ companyId, userId });

  beforeAll(async () => {
    const admin = await prisma!.user.findUniqueOrThrow({ where: { emailNormalized: "admin@mcap.local" } });
    userId = admin.id;
    const seededCompany = await prisma!.company.findFirstOrThrow();
    organizationId = (await prisma!.organization.create({ data: { name: `IT-GPR-${randomUUID()}` } })).id;
    companyId = (await prisma!.company.create({ data: { organizationId, baseCurrencyId: seededCompany.baseCurrencyId, name: "IT-GPR-Primary", timezone: "Asia/Riyadh" } })).id;
    foreignCompanyId = (await prisma!.company.create({ data: { organizationId, baseCurrencyId: seededCompany.baseCurrencyId, name: "IT-GPR-Foreign", timezone: "Asia/Riyadh" } })).id;
    await prisma!.userCompany.create({ data: { userId, companyId } });
    await prisma!.userCompany.create({ data: { userId, companyId: foreignCompanyId } });
    const employeeData = { employmentType: "FULL_TIME" as const, hireDate: new Date("2059-01-01T00:00:00.000Z"), createdById: userId, updatedById: userId };
    managerId = (await prisma!.employee.create({ data: { ...employeeData, companyId, userId, employeeNumber: "IT-GPR-MANAGER", nameAr: "مدير مشروع اختباري" } })).publicId;
    contributorId = (await prisma!.employee.create({ data: { ...employeeData, companyId, employeeNumber: "IT-GPR-CONTRIBUTOR", nameAr: "مساهم اختباري" } })).publicId;
    foreignEmployeeId = (await prisma!.employee.create({ data: { ...employeeData, companyId: foreignCompanyId, employeeNumber: "IT-GPR-FOREIGN", nameAr: "موظف شركة أخرى" } })).publicId;
    service = new GeneralProjectService(prisma!, new GeneralProjectEmployeeAdapter(prisma!), new GeneralProjectCustomerAdapter(prisma!));
  });

  afterAll(async () => {
    if (!prisma) return;
    const companies = [companyId, foreignCompanyId].filter((value): value is bigint => value !== undefined);
    if (companies.length) {
      await prisma.idempotencyRecord.deleteMany({ where: { companyId: { in: companies }, operation: { in: ["CREATE_GENERAL_PROJECT", "UPDATE_GENERAL_PROJECT", "TRANSITION_GENERAL_PROJECT", "ASSIGN_GENERAL_PROJECT_MEMBER", "UNASSIGN_GENERAL_PROJECT_MEMBER"] } } });
      await prisma.auditLog.deleteMany({ where: { companyId: { in: companies }, entityType: "GENERAL_PROJECT" } });
      await prisma.generalProjectTaskAssignment.deleteMany({ where: { companyId: { in: companies } } });
      await prisma.generalProjectTask.deleteMany({ where: { companyId: { in: companies } } });
      await prisma.generalProjectPhase.deleteMany({ where: { companyId: { in: companies } } });
      await prisma.generalProjectMember.deleteMany({ where: { companyId: { in: companies } } });
      await prisma.generalProject.deleteMany({ where: { companyId: { in: companies } } });
      await prisma.employee.deleteMany({ where: { companyId: { in: companies } } });
      await prisma.masterDataCodeSequence.deleteMany({ where: { companyId: { in: companies } } });
      await prisma.userCompany.deleteMany({ where: { companyId: { in: companies } } });
      await prisma.company.deleteMany({ where: { id: { in: companies } } });
    }
    if (organizationId !== undefined) await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  it("creates a project once under replay, with an optional customer and GPR code", async () => {
    const input = { nameAr: "IT-GPR-مشروع عام", managerEmployeeId: managerId, idempotencyKey: "it-general-project-create-0001" };
    const [first, replay] = await Promise.all([service.createProject(context(), input), service.createProject(context(), input)]);
    expect(replay).toEqual(first);
    expect(first.project.code).toMatch(/^GPR-\d{6}$/u);
    expect(first.project.customer).toBeNull();
    projectId = first.project.id;
    expect(await prisma!.generalProject.count({ where: { companyId, publicId: projectId } })).toBe(1);
    await expect(service.createProject(context(), { ...input, nameAr: "Changed" })).rejects.toMatchObject({ reason: "IDEMPOTENCY_MISMATCH" });
  });

  it("isolates references and projects between companies", async () => {
    await expect(service.createProject(context(), { nameAr: "Foreign manager", managerEmployeeId: foreignEmployeeId, idempotencyKey: "it-general-project-foreign-0001" }))
      .rejects.toMatchObject({ reason: "EMPLOYEE_INACTIVE" });
    await expect(service.getProject({ companyId: foreignCompanyId, userId }, projectId)).rejects.toMatchObject({ reason: "NOT_FOUND" });
  });

  it("keeps one active manager and enforces versioned transitions", async () => {
    const assigned = await service.assignMember(context(), projectId, { version: 0, employeeId: contributorId, role: "CONTRIBUTOR", idempotencyKey: "it-general-project-assign-0001" });
    expect(assigned.projectVersion).toBe(1);
    await expect(service.assignMember(context(), projectId, { version: 0, employeeId: contributorId, role: "MANAGER", idempotencyKey: "it-general-project-assign-stale-0001" }))
      .rejects.toMatchObject({ reason: "VERSION_CONFLICT" });
    const active = await service.transition(context(), projectId, { version: 1, status: "ACTIVE", idempotencyKey: "it-general-project-active-0001" });
    expect(active.project.status).toBe("ACTIVE");
    const manager = (await service.getProject(context(), projectId)).members.find(member => member.role === "MANAGER")!;
    await expect(service.unassignMember(context(), projectId, manager.id, { version: 2, reason: "Project role handover", idempotencyKey: "it-general-project-unassign-last-0001" }))
      .rejects.toMatchObject({ reason: "LAST_MANAGER" });
    const managerTwo = await service.assignMember(context(), projectId, { version: 2, employeeId: contributorId, role: "MANAGER", idempotencyKey: "it-general-project-assign-manager-0001" });
    expect(managerTwo.projectVersion).toBe(3);
    const unassigned = await service.unassignMember(context(), projectId, manager.id, { version: 3, reason: "Project role handover", idempotencyKey: "it-general-project-unassign-manager-0001" });
    expect(unassigned.projectVersion).toBe(4);
    await expect(service.transition(context(), projectId, { version: 4, status: "ON_HOLD", idempotencyKey: "it-general-project-hold-no-reason-0001" }))
      .rejects.toMatchObject({ code: "REASON_REQUIRED" });
  });

  it("refuses completion while a phase or task is open", async () => {
    const project = await prisma!.generalProject.findFirstOrThrow({ where: { companyId, publicId: projectId } });
    const phase = await prisma!.generalProjectPhase.create({ data: {
      companyId, projectId: project.id, sequence: 1, title: "مرحلة تنفيذ", createdById: userId, updatedById: userId,
    } });
    const task = await prisma!.generalProjectTask.create({ data: {
      companyId, projectId: project.id, phaseId: phase.id, sequence: 1, title: "مهمة تنفيذ", createdById: userId, updatedById: userId,
    } });
    const input = { version: project.version, status: "COMPLETED" as const, idempotencyKey: "it-general-project-complete-0001" };
    await expect(service.transition(context(), projectId, input)).rejects.toMatchObject({ code: "PROJECT_WORK_OPEN" });
    await prisma!.generalProjectTask.update({ where: { id: task.id }, data: { status: "COMPLETED" } });
    await expect(service.transition(context(), projectId, { ...input, idempotencyKey: "it-general-project-complete-0002" }))
      .rejects.toMatchObject({ code: "PROJECT_WORK_OPEN" });
    await prisma!.generalProjectPhase.update({ where: { id: phase.id }, data: { status: "COMPLETED" } });
    const completed = await service.transition(context(), projectId, { ...input, idempotencyKey: "it-general-project-complete-0003" });
    expect(completed.project.status).toBe("COMPLETED");
  });
});
