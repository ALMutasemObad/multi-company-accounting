import type { Prisma } from "@prisma/client";
import type { TreasuryCompanyProvisioningPort } from "../platform/company-provisioning-ports.js";
import { upsertGlobalPaymentMethods } from "./treasury-service.js";

export class TreasuryCompanyProvisioningAdapter implements TreasuryCompanyProvisioningPort {
  async provisionTreasury(tx: Prisma.TransactionClient) {
    await upsertGlobalPaymentMethods(tx);
  }
}
