import type { Prisma } from "@prisma/client";
import type { PayrollCompanyPort } from "../payroll/payroll-reference-ports.js";
export class PayrollCompanyAdapter implements PayrollCompanyPort {
  async get(tx: Prisma.TransactionClient, companyId: bigint) {
    const company = await tx.company.findFirst({ where: { id: companyId, isActive: true }, select: {
      organizationId: true, baseCurrency: { select: { id: true, code: true, decimals: true, isActive: true } },
    } });
    if (!company?.baseCurrency.isActive) return null;
    return { organizationId: company.organizationId, currencyId: company.baseCurrency.id,
      currencyCode: company.baseCurrency.code, currencyDecimals: company.baseCurrency.decimals };
  }
}
