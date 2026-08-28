import type { Prisma } from "@prisma/client";
import type { AccountingCompanyProvisioningPort } from "../platform/company-provisioning-ports.js";
import { accountTypeDefinitions } from "../platform/reference-data.js";
import { applyDefaultChartTemplate } from "./default-chart-template.js";

export class AccountingCompanyProvisioningAdapter implements AccountingCompanyProvisioningPort {
  async provisionAccounting(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    initializeDefaultChart: boolean,
  ) {
    for (const definition of accountTypeDefinitions) {
      await tx.accountType.upsert({
        where: { code: definition.code },
        update: definition,
        create: definition,
      });
    }
    if (!initializeDefaultChart) return null;
    const chart = await applyDefaultChartTemplate(tx, companyId);
    return {
      templateCode: chart.templateCode,
      version: chart.version,
      accountsCreated: chart.created,
    };
  }
}
