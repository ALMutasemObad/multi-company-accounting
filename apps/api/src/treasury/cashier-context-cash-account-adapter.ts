import type { Prisma } from "@prisma/client";
import type { AccountingAccountQueryPort, PostingAccountReference } from "../accounts/account-query-port.js";
import { PrismaAccountingAccountQueryAdapter } from "../accounts/prisma-account-query-adapter.js";
import type { ActorContext } from "../platform/actor-context.js";
import {
  assertReferenceActor, assertReferenceId, boundedReferenceOptions, referenceOptionsMeta, referenceRevision,
  type ReferenceOption, type ReferenceOptionsQuery, type ReferenceResult,
} from "../platform/reference-option.js";
import type { CashierContextCashAccountPort } from "./cashier-context-treasury-port.js";

// Do not join Account here: that read and its eligibility facts belong to Accounting.
const selection = {
  id: true, companyId: true, ledgerAccountId: true, accountType: true, code: true,
  nameAr: true, nameEn: true, isActive: true, version: true,
} as const;
type Row = Prisma.CashBankAccountGetPayload<{ select: typeof selection }>;

function available(row: Row, account: PostingAccountReference | null): boolean {
  return row.isActive && account !== null && account.id === row.ledgerAccountId && account.companyId === row.companyId
    && account.isActive && account.allowsPosting && account.childCount === 0;
}

function project(row: Row, account: PostingAccountReference | null): ReferenceOption {
  return {
    id: row.id.toString(), label: `${row.code} — ${row.nameAr}`, code: row.code, nameAr: row.nameAr, nameEn: row.nameEn,
    revision: referenceRevision("cash-account", [
      row.companyId.toString(), row.id.toString(), row.ledgerAccountId.toString(), row.accountType, row.code,
      row.nameAr, row.nameEn, row.isActive, row.version,
      account?.id.toString() ?? null, account?.companyId.toString() ?? null, account?.code ?? null,
      account?.isActive ?? null, account?.allowsPosting ?? null, account?.childCount ?? null,
    ]),
  };
}

export class CashierContextCashAccountAdapter implements CashierContextCashAccountPort {
  constructor(private readonly accounts: AccountingAccountQueryPort = new PrismaAccountingAccountQueryAdapter()) {}

  async reference(tx: Prisma.TransactionClient, actor: ActorContext, id: bigint): Promise<ReferenceResult> {
    assertReferenceActor(actor);
    assertReferenceId(id);
    const row = await tx.cashBankAccount.findFirst({ where: { id, companyId: actor.companyId, isActive: true }, select: selection });
    if (!row) return { status: "unavailable" };
    const account = await this.accounts.findById(tx, actor.companyId, row.ledgerAccountId);
    return available(row, account) ? { status: "available", reference: project(row, account) } : { status: "unavailable" };
  }

  async options(tx: Prisma.TransactionClient, actor: ActorContext, query: ReferenceOptionsQuery) {
    assertReferenceActor(actor);
    const bounded = boundedReferenceOptions(query);
    const where: Prisma.CashBankAccountWhereInput = {
      companyId: actor.companyId, isActive: true,
      ...(bounded.search ? { OR: [{ code: { contains: bounded.search } }, { nameAr: { contains: bounded.search } }, { nameEn: { contains: bounded.search } }] } : {}),
    };
    const rows = await tx.cashBankAccount.findMany({ where, select: selection, orderBy: [{ code: "asc" }, { id: "asc" }], skip: bounded.skip, take: bounded.pageSize });
    const total = await tx.cashBankAccount.count({ where });
    const accounts = new Map<bigint, PostingAccountReference | null>();
    const data: Array<ReferenceOption & { isAvailable: boolean }> = [];
    // At most pageSize owner-port calls, reusing repeated ledger IDs within this read.
    for (const row of rows) {
      if (!accounts.has(row.ledgerAccountId)) accounts.set(row.ledgerAccountId, await this.accounts.findById(tx, actor.companyId, row.ledgerAccountId));
      const account = accounts.get(row.ledgerAccountId) ?? null;
      data.push({ ...project(row, account), isAvailable: available(row, account) });
    }
    // Retain active but unready instruments, so pagination/count never imply a filtered total.
    return { data, meta: referenceOptionsMeta(bounded, total) };
  }
}
