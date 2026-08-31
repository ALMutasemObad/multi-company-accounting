import type { Prisma } from "@prisma/client";
import type { ActorContext } from "../platform/actor-context.js";
import {
  assertReferenceActor, assertReferenceId, boundedReferenceOptions, referenceOptionsMeta, referenceRevision,
  type ReferenceOptionsQuery, type ReferenceResult,
} from "../platform/reference-option.js";
import type { CashierContextCurrencyPort, CashierContextCurrencyReference } from "./cashier-context-currency-port.js";

// Company, CompanyCurrency and Currency all belong to Companies/Tenant.
const selection = {
  companyId: true, currencyId: true, isActive: true, updatedAt: true,
  company: { select: { baseCurrencyId: true, isActive: true } },
  currency: { select: { id: true, code: true, nameAr: true, decimals: true, scope: true, ownerCompanyId: true, isActive: true } },
} as const;
type Row = Prisma.CompanyCurrencyGetPayload<{ select: typeof selection }>;

function visible(companyId: bigint, search?: string): Prisma.CompanyCurrencyWhereInput {
  return {
    companyId, isActive: true, company: { isActive: true },
    currency: {
      isActive: true, OR: [{ scope: "GLOBAL", ownerCompanyId: null }, { scope: "COMPANY", ownerCompanyId: companyId }],
      ...(search ? { AND: [{ OR: [{ code: { contains: search } }, { nameAr: { contains: search } }] }] } : {}),
    },
  };
}

function project(row: Row): CashierContextCurrencyReference {
  const currency = row.currency;
  return {
    id: currency.id.toString(), label: `${currency.code} — ${currency.nameAr}`, code: currency.code, nameAr: currency.nameAr, nameEn: null,
    isBase: row.company.baseCurrencyId === currency.id, decimals: currency.decimals,
    revision: referenceRevision("enabled-currency", [
      row.companyId.toString(), row.currencyId.toString(), row.isActive, row.updatedAt.toISOString(),
      row.company.baseCurrencyId.toString(), row.company.isActive, currency.id.toString(), currency.code, currency.nameAr,
      currency.decimals, currency.scope, currency.ownerCompanyId?.toString() ?? null, currency.isActive,
    ]),
  };
}

export class CashierContextCurrencyAdapter implements CashierContextCurrencyPort {
  async reference(tx: Prisma.TransactionClient, actor: ActorContext, id: bigint): Promise<ReferenceResult<CashierContextCurrencyReference>> {
    assertReferenceActor(actor);
    assertReferenceId(id);
    const row = await tx.companyCurrency.findFirst({ where: { currencyId: id, ...visible(actor.companyId) }, select: selection });
    return row ? { status: "available", reference: project(row) } : { status: "unavailable" };
  }

  async options(tx: Prisma.TransactionClient, actor: ActorContext, query: ReferenceOptionsQuery) {
    assertReferenceActor(actor);
    const bounded = boundedReferenceOptions(query);
    const where = visible(actor.companyId, bounded.search);
    const rows = await tx.companyCurrency.findMany({ where, select: selection, orderBy: [{ currency: { code: "asc" } }, { currencyId: "asc" }], skip: bounded.skip, take: bounded.pageSize });
    const total = await tx.companyCurrency.count({ where });
    return { data: rows.map((row) => ({ ...project(row), isAvailable: true })), meta: referenceOptionsMeta(bounded, total) };
  }
}
