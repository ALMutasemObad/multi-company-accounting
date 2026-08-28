import type { PrismaClient } from "@prisma/client";
import { RegistrationAccountingAdapter } from "../accounts/registration-accounting-adapter.js";
import { RegistrationTenantAdapter } from "../companies/registration-tenant-adapter.js";
import type { RegistrationOwnerPorts } from "../registration/registration-owner-ports.js";
import { RegistrationSecurityAdapter } from "../security/registration-security-adapter.js";
import { RegistrationIdentityAdapter } from "../users/registration-identity-adapter.js";

export function createRegistrationOwnerPorts(prisma: PrismaClient): RegistrationOwnerPorts {
  return {
    tenant: new RegistrationTenantAdapter(prisma),
    identity: new RegistrationIdentityAdapter(),
    accounting: new RegistrationAccountingAdapter(),
    security: new RegistrationSecurityAdapter(),
  };
}
