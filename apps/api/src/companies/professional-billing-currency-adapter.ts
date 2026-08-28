import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  ProfessionalBillingCurrencyPort,
  ProfessionalBillingCurrencyReference,
} from "../projects/project-reference-ports.js";

const reference = (row: {
  currency: { id: bigint; code: string; nameAr: string; decimals: number };
}): ProfessionalBillingCurrencyReference => row.currency;

export class ProfessionalBillingCurrencyAdapter implements ProfessionalBillingCurrencyPort {
  constructor(private readonly prisma: PrismaClient) {}

  async findInCompany(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    currencyId: bigint,
  ) {
    const row = await tx.companyCurrency.findFirst({
      where: { companyId, currencyId },
      select: { currency: { select: { id: true, code: true, nameAr: true, decimals: true } } },
    });
    return row ? reference(row) : null;
  }

  async findEnabledInCompany(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    currencyId: bigint,
  ) {
    const row = await tx.companyCurrency.findFirst({
      where: {
        companyId,
        currencyId,
        isActive: true,
        currency: {
          isActive: true,
          OR: [
            { scope: "GLOBAL", ownerCompanyId: null },
            { scope: "COMPANY", ownerCompanyId: companyId },
          ],
        },
      },
      select: { currency: { select: { id: true, code: true, nameAr: true, decimals: true } } },
    });
    return row ? reference(row) : null;
  }

  async listEnabledInCompany(companyId: bigint) {
    const rows = await this.prisma.companyCurrency.findMany({
      where: {
        companyId,
        isActive: true,
        currency: {
          isActive: true,
          OR: [
            { scope: "GLOBAL", ownerCompanyId: null },
            { scope: "COMPANY", ownerCompanyId: companyId },
          ],
        },
      },
      select: { currency: { select: { id: true, code: true, nameAr: true, decimals: true } } },
      orderBy: [{ currency: { code: "asc" } }],
    });
    return rows.map(reference);
  }

  async listInCompany(companyId: bigint) {
    const rows = await this.prisma.companyCurrency.findMany({
      where: { companyId },
      select: { currency: { select: { id: true, code: true, nameAr: true, decimals: true } } },
      orderBy: [{ currency: { code: "asc" } }],
    });
    return rows.map(reference);
  }
}
