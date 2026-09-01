import type { Prisma } from "@prisma/client";
import type { ActorContext } from "../platform/actor-context.js";
import {
  assertReferenceActor, assertReferenceId, boundedReferenceOptions, referenceOptionsMeta, referenceRevision,
  type ReferenceOptionsQuery, type ReferenceResult,
} from "../platform/reference-option.js";
import type { CashierContextPaymentMethodPort, CashierContextPaymentMethodReference } from "./cashier-context-treasury-port.js";

const selection = {
  id: true, companyId: true, scope: true, code: true, nameAr: true, requiresReference: true, isActive: true, version: true,
} as const;
type Row = Prisma.PaymentMethodGetPayload<{ select: typeof selection }>;

function visible(companyId: bigint): Prisma.PaymentMethodWhereInput {
  return { isActive: true, OR: [{ scope: "GLOBAL", companyId: null }, { scope: "COMPANY", companyId }] };
}

function project(actor: ActorContext, row: Row): CashierContextPaymentMethodReference {
  return {
    id: row.id.toString(), label: `${row.code} — ${row.nameAr}`, code: row.code, nameAr: row.nameAr, nameEn: null,
    requiresReference: row.requiresReference,
    revision: referenceRevision("payment-method", [
      actor.companyId.toString(), row.id.toString(), row.companyId?.toString() ?? null, row.scope,
      row.code, row.nameAr, row.requiresReference, row.isActive, row.version,
    ]),
  };
}

export class CashierContextPaymentMethodAdapter implements CashierContextPaymentMethodPort {
  async reference(tx: Prisma.TransactionClient, actor: ActorContext, id: bigint): Promise<ReferenceResult<CashierContextPaymentMethodReference>> {
    assertReferenceActor(actor);
    assertReferenceId(id);
    const row = await tx.paymentMethod.findFirst({ where: { id, ...visible(actor.companyId) }, select: selection });
    return row ? { status: "available", reference: project(actor, row) } : { status: "unavailable" };
  }

  async options(tx: Prisma.TransactionClient, actor: ActorContext, query: ReferenceOptionsQuery) {
    assertReferenceActor(actor);
    const bounded = boundedReferenceOptions(query);
    const where: Prisma.PaymentMethodWhereInput = {
      ...visible(actor.companyId),
      ...(bounded.search ? { AND: [{ OR: [{ code: { contains: bounded.search } }, { nameAr: { contains: bounded.search } }] }] } : {}),
    };
    const rows = await tx.paymentMethod.findMany({ where, select: selection, orderBy: [{ code: "asc" }, { id: "asc" }], skip: bounded.skip, take: bounded.pageSize });
    const total = await tx.paymentMethod.count({ where });
    return { data: rows.map((row) => ({ ...project(actor, row), isAvailable: true })), meta: referenceOptionsMeta(bounded, total) };
  }
}
