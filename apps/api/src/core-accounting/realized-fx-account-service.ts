import type { Prisma } from "@prisma/client";

export type RealizedFxAccounts = {
  baseCurrencyId: bigint;
  gainAccountId: bigint;
  lossAccountId: bigint;
};

export interface RealizedFxAccountPort {
  resolve(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    error: () => Error,
  ): Promise<RealizedFxAccounts>;
}

export class RealizedFxAccountService implements RealizedFxAccountPort {
  async resolve(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    error: () => Error,
  ): Promise<RealizedFxAccounts> {
    const [company, accounts] = await Promise.all([
      tx.company.findUnique({ where: { id: companyId }, select: { baseCurrencyId: true } }),
      tx.account.findMany({
        where: {
          companyId,
          sourceTemplateCode: "SMALL_BUSINESS_GENERAL",
          sourceTemplateKey: { in: ["realized-fx-gain", "realized-fx-loss"] },
        },
        include: {
          accountType: { select: { class: true } },
          _count: { select: { children: true } },
        },
      }),
    ]);
    const gain = accounts.find(({ sourceTemplateKey }) => sourceTemplateKey === "realized-fx-gain");
    const loss = accounts.find(({ sourceTemplateKey }) => sourceTemplateKey === "realized-fx-loss");
    if (
      !company ||
      !gain ||
      !loss ||
      !gain.isActive ||
      !loss.isActive ||
      !gain.allowsPosting ||
      !loss.allowsPosting ||
      gain._count.children > 0 ||
      loss._count.children > 0 ||
      gain.accountType.class !== "REVENUE" ||
      loss.accountType.class !== "EXPENSE"
    ) {
      throw error();
    }
    return {
      baseCurrencyId: company.baseCurrencyId,
      gainAccountId: gain.id,
      lossAccountId: loss.id,
    };
  }
}
