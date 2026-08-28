import type { Prisma, PrismaClient } from "@prisma/client";
import type { RegistrationTenantPort } from "../registration/registration-owner-ports.js";

export class RegistrationTenantAdapter implements RegistrationTenantPort {
  constructor(private readonly prisma: PrismaClient) {}

  listGlobalCurrencies() {
    return this.prisma.currency.findMany({
      where: { scope: "GLOBAL", scopeKey: "GLOBAL", isActive: true },
      orderBy: { code: "asc" },
      select: { code: true, nameAr: true, decimals: true },
    });
  }

  async isActiveGlobalCurrency(tx: Prisma.TransactionClient, code: string) {
    const currency = await tx.currency.findUnique({
      where: { scopeKey_code: { scopeKey: "GLOBAL", code } },
      select: { isActive: true },
    });
    return currency?.isActive === true;
  }
}
