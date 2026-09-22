import "dotenv/config";
import { hash } from "argon2";
import { createDatabase } from "../src/database.js";

const databaseUrl = process.env.DATABASE_URL;
const password = process.env.INVENTORY_TEST_PASSWORD;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!password || password.length < 12) throw new Error("INVENTORY_TEST_PASSWORD must contain at least 12 characters");

const prisma = createDatabase(databaseUrl);
const users = [
  { email: "inventory.counter1@mcap.local", nameAr: "مختص المخزون الأول", employeeNumber: "INV-TEST-001" },
  { email: "inventory.counter2@mcap.local", nameAr: "مختص المخزون الثاني", employeeNumber: "INV-TEST-002" },
] as const;

try {
  const company = await prisma.company.findFirstOrThrow({ where: { name: "الشركة التجريبية" } });
  const administrator = await prisma.user.findUniqueOrThrow({ where: { emailNormalized: "admin@mcap.local" } });
  const role = await prisma.role.upsert({
    where: { companyId_code: { companyId: company.id, code: "INVENTORY_SPECIALIST" } },
    update: { nameAr: "مختص مخزون", nameEn: "Inventory specialist", isActive: true },
    create: { companyId: company.id, code: "INVENTORY_SPECIALIST", nameAr: "مختص مخزون", nameEn: "Inventory specialist" },
  });
  const allowedPermissionCodes = [
    "warehouses.view",
    "inventory_catalog.view",
    "inventory_barcodes.view",
    "inventory_barcodes.resolve",
    "inventory_movements.view",
    "inventory_counts.enter",
  ];
  const permissions = await prisma.permission.findMany({ where: { code: { in: allowedPermissionCodes } } });
  await prisma.rolePermission.deleteMany({
    where: { roleId: role.id, permission: { code: { notIn: allowedPermissionCodes } } },
  });
  for (const permission of permissions) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
      update: {},
      create: { roleId: role.id, permissionId: permission.id },
    });
  }

  const passwordHash = await hash(password);
  const created = [];
  for (const entry of users) {
    const user = await prisma.user.upsert({
      where: { emailNormalized: entry.email },
      update: { displayName: entry.nameAr, passwordHash, isActive: true, failedLoginAttempts: 0, lockedUntil: null },
      create: { emailNormalized: entry.email, displayName: entry.nameAr, passwordHash },
    });
    await prisma.userCompany.upsert({
      where: { userId_companyId: { userId: user.id, companyId: company.id } },
      update: { isActive: true },
      create: { userId: user.id, companyId: company.id },
    });
    await prisma.userCompanyRole.upsert({
      where: { userId_companyId_roleId: { userId: user.id, companyId: company.id, roleId: role.id } },
      update: {},
      create: { userId: user.id, companyId: company.id, roleId: role.id },
    });
    await prisma.employee.upsert({
      where: { companyId_employeeNumber: { companyId: company.id, employeeNumber: entry.employeeNumber } },
      update: { userId: user.id, nameAr: entry.nameAr, status: "ACTIVE", updatedById: administrator.id },
      create: {
        companyId: company.id,
        userId: user.id,
        employeeNumber: entry.employeeNumber,
        nameAr: entry.nameAr,
        employmentType: "FULL_TIME",
        hireDate: new Date("2026-09-22T00:00:00.000Z"),
        workLocation: "مشروع جرد المكتبة",
        createdById: administrator.id,
        updatedById: administrator.id,
      },
    });
    created.push({ email: entry.email, nameAr: entry.nameAr, role: role.code });
  }
  console.log(JSON.stringify(created));
} finally {
  await prisma.$disconnect();
}
