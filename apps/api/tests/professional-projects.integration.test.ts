import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../src/database.js";
import {
  ProfessionalProjectError,
  ProfessionalProjectService,
} from "../src/projects/professional-project-service.js";
import { ProfessionalCustomerAdapter } from "../src/sales/professional-customer-adapter.js";
import { ProfessionalPeopleAdapter } from "../src/users/professional-people-adapter.js";

const enabled = process.env.RUN_DB_TESTS === "true" && Boolean(process.env.DATABASE_URL);
const prisma = enabled ? createDatabase(process.env.DATABASE_URL!) : null;

describe.runIf(enabled)("professional projects and time with MariaDB", () => {
  let service: ProfessionalProjectService;
  let companyId: bigint;
  let userId: bigint;
  let memberUserId: bigint;
  let customerId: bigint;
  let accountId: bigint;
  let foreignOrganizationId: bigint;
  let foreignCompanyId: bigint;
  let foreignAccountId: bigint;
  let foreignCustomerId: bigint;
  let projectId = "";
  let timeEntryId = "";

  const context = () => ({ companyId, userId });
  const memberContext = () => ({ companyId, userId: memberUserId });

  async function cleanMainRows() {
    await prisma!.idempotencyRecord.deleteMany({
      where: {
        companyId,
        operation: { in: [
          "CREATE_PROFESSIONAL_PROJECT",
          "ASSIGN_PROFESSIONAL_PROJECT_MEMBER",
          "UNASSIGN_PROFESSIONAL_PROJECT_MEMBER",
          "TRANSITION_PROFESSIONAL_PROJECT",
          "CREATE_PROFESSIONAL_TIME_ENTRY",
        ] },
      },
    });
    await prisma!.auditLog.deleteMany({ where: { companyId, entityType: { in: ["PROFESSIONAL_PROJECT", "PROFESSIONAL_TIME_ENTRY"] } } });
    const projects = await prisma!.professionalProject.findMany({ where: { companyId, nameAr: { startsWith: "IT-PRO-" } }, select: { id: true } });
    const ids = projects.map(({ id }) => id);
    if (ids.length) {
      await prisma!.professionalTimeEntry.deleteMany({ where: { companyId, projectId: { in: ids } } });
      await prisma!.professionalProjectMember.deleteMany({ where: { companyId, projectId: { in: ids } } });
      await prisma!.professionalProject.deleteMany({ where: { companyId, id: { in: ids } } });
    }
    await prisma!.customer.deleteMany({ where: { companyId, code: "IT-PRO-CUSTOMER" } });
    await prisma!.account.deleteMany({ where: { companyId, code: "IT-PRO-AR" } });
  }

  beforeAll(async () => {
    const admin = await prisma!.user.findUniqueOrThrow({ where: { emailNormalized: "admin@mcap.local" } });
    userId = admin.id;
    companyId = (await prisma!.userCompany.findFirstOrThrow({ where: { userId, isActive: true } })).companyId;
    await cleanMainRows();

    const member = await prisma!.user.upsert({
      where: { emailNormalized: "professional.member@mcap.local" },
      update: { displayName: "عضو مشروع اختباري", isActive: true },
      create: {
        emailNormalized: "professional.member@mcap.local",
        passwordHash: admin.passwordHash,
        displayName: "عضو مشروع اختباري",
      },
    });
    memberUserId = member.id;
    await prisma!.userCompany.upsert({
      where: { userId_companyId: { userId: memberUserId, companyId } },
      update: { isActive: true },
      create: { userId: memberUserId, companyId },
    });

    const assetType = await prisma!.accountType.findFirstOrThrow({ where: { class: "ASSET" } });
    accountId = (await prisma!.account.create({
      data: { companyId, accountTypeId: assetType.id, code: "IT-PRO-AR", nameAr: "ذمم عميل مهني اختباري", level: 1, allowsPosting: true },
    })).id;
    customerId = (await prisma!.customer.create({
      data: { companyId, receivableAccountId: accountId, code: "IT-PRO-CUSTOMER", nameAr: "عميل مهني اختباري" },
    })).id;

    const mainCompany = await prisma!.company.findUniqueOrThrow({ where: { id: companyId } });
    foreignOrganizationId = (await prisma!.organization.create({ data: { name: "IT-PRO-Foreign Organization" } })).id;
    foreignCompanyId = (await prisma!.company.create({
      data: {
        organizationId: foreignOrganizationId,
        baseCurrencyId: mainCompany.baseCurrencyId,
        name: "IT-PRO-Foreign Company",
        timezone: "Asia/Riyadh",
      },
    })).id;
    await prisma!.userCompany.create({ data: { userId, companyId: foreignCompanyId } });
    foreignAccountId = (await prisma!.account.create({
      data: { companyId: foreignCompanyId, accountTypeId: assetType.id, code: "IT-PRO-F-AR", nameAr: "ذمم أجنبية", level: 1, allowsPosting: true },
    })).id;
    foreignCustomerId = (await prisma!.customer.create({
      data: { companyId: foreignCompanyId, receivableAccountId: foreignAccountId, code: "IT-PRO-F-CUSTOMER", nameAr: "عميل شركة أخرى" },
    })).id;

    service = new ProfessionalProjectService(
      prisma!,
      new ProfessionalCustomerAdapter(prisma!),
      new ProfessionalPeopleAdapter(prisma!),
    );
  });

  afterAll(async () => {
    if (!prisma) return;
    await cleanMainRows();
    await prisma.userCompany.deleteMany({ where: { userId: memberUserId, companyId } });
    await prisma.user.deleteMany({ where: { id: memberUserId, emailNormalized: "professional.member@mcap.local" } });
    await prisma.customer.deleteMany({ where: { id: foreignCustomerId, companyId: foreignCompanyId } });
    await prisma.account.deleteMany({ where: { id: foreignAccountId, companyId: foreignCompanyId } });
    await prisma.masterDataCodeSequence.deleteMany({ where: { companyId: foreignCompanyId } });
    await prisma.userCompany.deleteMany({ where: { companyId: foreignCompanyId } });
    await prisma.company.deleteMany({ where: { id: foreignCompanyId } });
    await prisma.organization.deleteMany({ where: { id: foreignOrganizationId } });
    await prisma.$disconnect();
  });

  it("creates one project under concurrent retry and rejects a mismatched payload", async () => {
    const input = {
      customerId,
      nameAr: "IT-PRO-قضية استشارية",
      kind: "LEGAL_MATTER" as const,
      billingModel: "TIME_AND_MATERIALS" as const,
      startDate: "2057-08-27",
      targetEndDate: null,
      description: "نطاق اختباري لا يحتوي بيانات عميل حقيقية",
      idempotencyKey: "it-professional-project-create-0001",
    };
    const [first, retry] = await Promise.all([
      service.createProject(context(), input),
      service.createProject(context(), input),
    ]);
    expect(retry).toEqual(first);
    projectId = first.project.id;
    expect(first.project.code).toMatch(/^PRJ-\d{6}$/u);
    expect(first.project.memberCount).toBe(1);
    expect(await prisma!.professionalProject.count({ where: { publicId: projectId, companyId } })).toBe(1);
    expect(await prisma!.professionalProjectMember.count({ where: { companyId, project: { publicId: projectId }, role: "MANAGER", isActive: true } })).toBe(1);

    await expect(service.createProject(context(), { ...input, nameAr: "IT-PRO-payload مختلف" }))
      .rejects.toMatchObject({ reason: "IDEMPOTENCY_MISMATCH" });

    await expect(service.createProject(context(), {
      ...input,
      nameAr: "IT-PRO-نطاق تاريخ غير صالح",
      targetEndDate: "2057-08-26",
      idempotencyKey: "it-professional-invalid-date-range",
    })).rejects.toMatchObject({ reason: "INVALID_DATE_RANGE" });
  });

  it("assigns a professional, records time once, and protects ownership and billing rules", async () => {
    const assigned = await service.assignMember(context(), projectId, {
      projectVersion: 0,
      userId: memberUserId,
      role: "PROFESSIONAL",
      idempotencyKey: "it-professional-member-assign-0001",
    });
    expect(assigned.member.user.id).toBe(memberUserId.toString());
    expect(assigned.projectVersion).toBe(1);

    const entryInput = {
      projectId,
      workDate: "2057-08-27",
      minutes: 125,
      isBillable: true,
      description: "بحث وتحليل مهني اختباري",
      idempotencyKey: "it-professional-time-create-0001",
    };
    const [first, retry] = await Promise.all([
      service.createTimeEntry(memberContext(), entryInput),
      service.createTimeEntry(memberContext(), entryInput),
    ]);
    expect(retry).toEqual(first);
    timeEntryId = first.timeEntry.id;
    expect(await prisma!.professionalTimeEntry.count({ where: { publicId: first.timeEntry.id, companyId } })).toBe(1);
    const list = await service.listTimeEntries(context(), { page: 1, pageSize: 25, projectId });
    expect(list.summary).toEqual({ trackedMinutes: 125, billableMinutes: 125, nonBillableMinutes: 0 });

    await expect(service.updateTimeEntry(context(), first.timeEntry.id, { version: 0, minutes: 60 }))
      .rejects.toMatchObject({ reason: "NOT_FOUND" });

    await expect(service.updateProject(context(), projectId, { version: 1, billingModel: "NON_BILLABLE" }))
      .rejects.toMatchObject({ reason: "BILLABLE_TIME_EXISTS" });
    const nonBillable = await service.createProject(context(), {
      customerId,
      nameAr: "IT-PRO-مشروع داخلي",
      kind: "PROFESSIONAL_PROJECT",
      billingModel: "NON_BILLABLE",
      startDate: "2057-08-27",
      idempotencyKey: "it-professional-nonbillable-project",
    });
    await expect(service.createTimeEntry(context(), { ...entryInput, projectId: nonBillable.project.id, idempotencyKey: "it-professional-time-billable-denied", workDate: "2057-08-28" }))
      .rejects.toMatchObject({ reason: "BILLABLE_NOT_ALLOWED" });
  });

  it("keeps company data isolated and preserves the last active manager", async () => {
    const foreignContext = { companyId: foreignCompanyId, userId };
    expect((await service.listProjects(foreignContext, { page: 1, pageSize: 25 })).data).toEqual([]);
    await expect(service.getProject(foreignContext, projectId)).rejects.toMatchObject({ reason: "NOT_FOUND" });
    await expect(service.createProject(foreignContext, {
      customerId,
      nameAr: "IT-PRO-cross-company",
      kind: "PROFESSIONAL_PROJECT",
      billingModel: "FIXED_FEE",
      startDate: "2057-08-27",
      idempotencyKey: "it-professional-foreign-customer",
    })).rejects.toMatchObject({ reason: "CUSTOMER_NOT_FOUND" });

    await expect(service.unassignMember(context(), projectId, userId, {
      projectVersion: 1,
      memberVersion: 0,
      reason: "محاولة إزالة آخر مدير",
      idempotencyKey: "it-professional-last-manager",
    })).rejects.toMatchObject({ reason: "LAST_MANAGER" });

    await service.unassignMember(context(), projectId, memberUserId, {
      projectVersion: 1,
      memberVersion: 0,
      reason: "انتهاء الإسناد الاختباري",
      idempotencyKey: "it-professional-member-unassign-0001",
    });
    await expect(service.deleteTimeEntry(memberContext(), timeEntryId, { version: 0, reason: "محاولة بعد انتهاء الإسناد" }))
      .rejects.toMatchObject({ reason: "MEMBER_INACTIVE" });
  });
});
