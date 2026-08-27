import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  ProfessionalCustomerPort,
  ProfessionalCustomerReference,
} from "../projects/project-reference-ports.js";

const select = {
  id: true,
  code: true,
  nameAr: true,
  nameEn: true,
  isActive: true,
} as const;

export class ProfessionalCustomerAdapter implements ProfessionalCustomerPort {
  constructor(private readonly prisma: PrismaClient) {}

  findInCompany(tx: Prisma.TransactionClient, companyId: bigint, customerId: bigint) {
    return tx.customer.findFirst({ where: { id: customerId, companyId }, select });
  }

  listInCompany(
    companyId: bigint,
    input: { ids?: bigint[] | undefined; search?: string | undefined; limit: number },
  ): Promise<ProfessionalCustomerReference[]> {
    return this.prisma.customer.findMany({
      where: {
        companyId,
        ...(input.ids ? { id: { in: input.ids } } : { isActive: true }),
        ...(input.search ? {
          OR: [
            { code: { contains: input.search } },
            { nameAr: { contains: input.search } },
            { nameEn: { contains: input.search } },
          ],
        } : {}),
      },
      select,
      orderBy: [{ code: "asc" }, { id: "asc" }],
      take: input.limit,
    });
  }
}
