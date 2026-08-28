import 'dotenv/config';
import { createDatabase } from '../database.js';
import { createCompanyProvisioningService } from '../composition/create-company-provisioning-service.js';
import { companyProvisioningSchema } from './company-provisioning-service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const input = companyProvisioningSchema.parse({
  organizationCode: process.env.PROVISION_ORGANIZATION_CODE,
  organizationName: process.env.PROVISION_ORGANIZATION_NAME,
  companyCode: process.env.PROVISION_COMPANY_CODE,
  companyName: process.env.PROVISION_COMPANY_NAME,
  timezone: process.env.PROVISION_COMPANY_TIMEZONE,
  baseCurrencyCode: process.env.PROVISION_BASE_CURRENCY_CODE,
  adminEmail: process.env.PROVISION_ADMIN_EMAIL,
  adminDisplayName: process.env.PROVISION_ADMIN_DISPLAY_NAME,
  adminPassword: process.env.PROVISION_ADMIN_PASSWORD,
});

const expectedConfirmation = `CREATE:${input.organizationCode}/${input.companyCode}`;
if (process.env.PROVISION_CONFIRM !== expectedConfirmation) {
  throw new Error(`PROVISION_CONFIRM must equal ${expectedConfirmation}`);
}

const prisma = createDatabase(databaseUrl);
try {
  const result = await createCompanyProvisioningService(prisma).provision(input);
  console.log(JSON.stringify({ status: 'ok', ...result }, null, 2));
} finally {
  await prisma.$disconnect();
}
