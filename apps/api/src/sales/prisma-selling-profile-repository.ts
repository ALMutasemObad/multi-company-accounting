import { Prisma } from "@prisma/client";
import type { SellingProfileRepository, SellingProfileValues } from "./selling-profile-ports.js";
import { SellingProfileError } from "./selling-profile-policy.js";

export class PrismaSellingProfileRepository implements SellingProfileRepository {
  async findMany(tx: Prisma.TransactionClient, companyId: bigint, itemIds: bigint[]) {
    if (itemIds.length > 100) throw new RangeError("UNBOUNDED_PROFILE_QUERY");
    if (!itemIds.length) return [];
    const rows = await tx.salesItemSellingProfile.findMany({ where: { companyId, inventoryItemId: { in: itemIds } }, orderBy: { id: "asc" } });
    return rows.map(row => ({ ...row, unitPrice: row.unitPrice.toFixed(4) }));
  }
  async create(tx: Prisma.TransactionClient, companyId: bigint, inventoryItemId: bigint, values: SellingProfileValues) {
    try {
      const row = await tx.salesItemSellingProfile.create({ data: { companyId, inventoryItemId, ...values } });
      return { ...row, unitPrice: row.unitPrice.toFixed(4) };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new SellingProfileError("PROFILE_EXISTS");
      throw error;
    }
  }
  async update(tx: Prisma.TransactionClient, companyId: bigint, inventoryItemId: bigint, version: number, values: SellingProfileValues) {
    const changed = await tx.salesItemSellingProfile.updateMany({ where: { companyId, inventoryItemId, version },
      data: { ...values, version: { increment: 1 } } });
    if (changed.count !== 1) throw new SellingProfileError("VERSION_CONFLICT");
    const row = await tx.salesItemSellingProfile.findFirstOrThrow({ where: { companyId, inventoryItemId } });
    return { ...row, unitPrice: row.unitPrice.toFixed(4) };
  }
}
