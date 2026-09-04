import type { Prisma } from "@prisma/client";
import type {
  EmployeeExpenseCurrencyPort,
  EmployeeExpenseCurrencyReference,
} from "../employee-expenses/employee-expense-reference-ports.js";

export class EmployeeExpenseCurrencyAdapter implements EmployeeExpenseCurrencyPort {
  async findBaseCurrency(
    tx: Prisma.TransactionClient,
    companyId: bigint,
  ): Promise<EmployeeExpenseCurrencyReference | null> {
    const company = await tx.company.findFirst({
      where: { id: companyId, isActive: true },
      select: { baseCurrency: { select: { code: true, decimals: true, isActive: true } } },
    });
    if (!company?.baseCurrency.isActive) return null;
    return { code: company.baseCurrency.code, decimals: company.baseCurrency.decimals };
  }
}
