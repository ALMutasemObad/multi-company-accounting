import type { Prisma } from "@prisma/client";
import type { ActorContext } from "../platform/actor-context.js";
import {
  assertReferenceActor, assertReferenceId, boundedReferenceOptions, referenceOptionsMeta, referenceRevision,
  type ReferenceOption, type ReferenceOptionsQuery, type ReferenceResult,
} from "../platform/reference-option.js";
import type { CashierContextWarehousePort } from "./cashier-context-warehouse-port.js";

const selection = {
  id: true, companyId: true, code: true, nameAr: true, nameEn: true, isActive: true, version: true,
} as const;
type Row = Prisma.WarehouseGetPayload<{ select: typeof selection }>;

function project(row: Row): ReferenceOption {
  return {
    id: row.id.toString(), label: `${row.code} — ${row.nameAr}`, code: row.code, nameAr: row.nameAr, nameEn: row.nameEn,
    revision: referenceRevision("warehouse", [row.companyId.toString(), row.id.toString(), row.code, row.nameAr, row.nameEn, row.isActive, row.version]),
  };
}

export class CashierContextWarehouseAdapter implements CashierContextWarehousePort {
  async reference(tx: Prisma.TransactionClient, actor: ActorContext, id: bigint): Promise<ReferenceResult> {
    assertReferenceActor(actor);
    assertReferenceId(id);
    const row = await tx.warehouse.findFirst({ where: { id, companyId: actor.companyId, isActive: true }, select: selection });
    return row ? { status: "available", reference: project(row) } : { status: "unavailable" };
  }

  async options(tx: Prisma.TransactionClient, actor: ActorContext, query: ReferenceOptionsQuery) {
    assertReferenceActor(actor);
    const bounded = boundedReferenceOptions(query);
    const where: Prisma.WarehouseWhereInput = {
      companyId: actor.companyId, isActive: true,
      ...(bounded.search ? { OR: [{ code: { contains: bounded.search } }, { nameAr: { contains: bounded.search } }, { nameEn: { contains: bounded.search } }] } : {}),
    };
    const rows = await tx.warehouse.findMany({ where, select: selection, orderBy: [{ code: "asc" }, { id: "asc" }], skip: bounded.skip, take: bounded.pageSize });
    const total = await tx.warehouse.count({ where });
    return { data: rows.map((row) => ({ ...project(row), isAvailable: true })), meta: referenceOptionsMeta(bounded, total) };
  }
}
