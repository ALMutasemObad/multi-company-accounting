import { Prisma, type PrismaClient } from '@prisma/client';
import { appendAudit } from '../audit/prisma-audit-append-adapter.js';
import { reserveMasterDataCode } from '../platform/master-data-code-service.js';
import type { ActorContext } from '../platform/actor-context.js';
import { lockAccountRows, orderedAccountIds } from './account-row-lock.js';
import type { ActivatedAccountUsageGuard } from './account-usage-guard.js';
import type { AccountUsageFact } from './account-usage-query-port.js';
import { applyDefaultChartTemplate, inspectDefaultChartTemplate } from './default-chart-template.js';

export type AccountErrorReason = 'NOT_FOUND' | 'CODE_EXISTS' | 'INVALID_PARENT' | 'CYCLE_DETECTED' | 'LEVEL_EXCEEDED' | 'HAS_ACTIVE_CHILDREN' | 'HAS_CHILDREN' | 'ACCOUNT_IN_USE' | 'POSTING_NOT_ALLOWED' | 'TEMPLATE_CONFLICT' | 'VERSION_CONFLICT';
export class AccountError extends Error {
  constructor(
    public readonly reason: AccountErrorReason,
    public readonly details?: { usageFacts: AccountUsageFact[] },
  ) { super(reason); }
}

type Page = {
  page: number;
  pageSize: number;
  search?: string | undefined;
  parentId?: bigint | undefined;
  active?: boolean | undefined;
  allowsPosting?: boolean | undefined;
  accountClasses?: Array<'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE'> | undefined;
};
type AccountInput = { accountTypeId: bigint; parentAccountId?: bigint | null | undefined; code: string; nameAr: string; nameEn?: string | null | undefined; allowsPosting: boolean; isControlAccount?: boolean | undefined };
type AccountUpdate = { expectedVersion: number; accountTypeId?: bigint | undefined; parentAccountId?: bigint | null | undefined; code?: string | undefined; nameAr?: string | undefined; nameEn?: string | null | undefined; allowsPosting?: boolean | undefined; isControlAccount?: boolean | undefined };
type CostCenterInput = { parentId?: bigint | null | undefined; nameAr: string; nameEn?: string | null | undefined };
type CostCenterUpdate = { parentId?: bigint | null | undefined; nameAr?: string | undefined; nameEn?: string | null | undefined };

const hierarchyAccountSelect = {
  id: true,
  parentAccountId: true,
  level: true,
  version: true,
  isActive: true,
  allowsPosting: true,
  accountTypeId: true,
} as const;

type HierarchyAccount = Prisma.AccountGetPayload<{ select: typeof hierarchyAccountSelect }>;

function knownUnique(error: unknown) { return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'; }
function knownWriteConflict(error: unknown) { return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034'; }

export class AccountService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly accountUsageGuard: ActivatedAccountUsageGuard,
  ) {}

  listTypes() { return this.prisma.accountType.findMany({ orderBy: { id: 'asc' } }); }

  listAccounts(context: ActorContext, input: Page) {
    const where: Prisma.AccountWhereInput = { companyId: context.companyId, ...(input.parentId !== undefined ? { parentAccountId: input.parentId } : {}), ...(input.active !== undefined ? { isActive: input.active } : {}), ...(input.allowsPosting !== undefined ? { allowsPosting: input.allowsPosting } : {}), ...(input.accountClasses?.length ? { accountType: { class: { in: input.accountClasses } } } : {}), ...(input.search ? { OR: [{ code: { contains: input.search } }, { nameAr: { contains: input.search } }, { nameEn: { contains: input.search } }] } : {}) };
    return this.prisma.$transaction(async (tx) => ({ data: await tx.account.findMany({ where, include: { accountType: true }, orderBy: [{ code: 'asc' }], skip: (input.page - 1) * input.pageSize, take: input.pageSize }), total: await tx.account.count({ where }) }));
  }

  async getAccount(context: ActorContext, id: bigint) {
    const value = await this.prisma.account.findFirst({ where: { id, companyId: context.companyId }, include: { accountType: true } });
    if (!value) throw new AccountError('NOT_FOUND'); return value;
  }

  async createAccount(context: ActorContext, input: AccountInput) {
    try { return await this.prisma.$transaction(async (tx) => {
      await tx.accountType.findUniqueOrThrow({ where: { id: input.accountTypeId } }).catch(() => { throw new AccountError('NOT_FOUND'); });
      if (input.parentAccountId != null) await lockAccountRows(tx, context.companyId, [input.parentAccountId]);
      const parent = input.parentAccountId == null ? null : await tx.account.findFirst({ where: { id: input.parentAccountId, companyId: context.companyId }, select: hierarchyAccountSelect });
      if (input.parentAccountId != null && (!parent || !parent.isActive || parent.allowsPosting)) throw new AccountError('INVALID_PARENT');
      const level = parent ? parent.level + 1 : 1; if (level > 20) throw new AccountError('LEVEL_EXCEEDED');
      const account = await tx.account.create({ data: { companyId: context.companyId, accountTypeId: input.accountTypeId, parentAccountId: input.parentAccountId ?? null, code: input.code, nameAr: input.nameAr, nameEn: input.nameEn ?? null, level, allowsPosting: input.allowsPosting, isControlAccount: input.isControlAccount ?? false }, include: { accountType: true } });
      await this.audit(tx, context, 'ACCOUNT_CREATED', 'ACCOUNT', account.id); return account;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }); } catch (error) { if (knownUnique(error)) throw new AccountError('CODE_EXISTS'); throw error; }
  }

  async updateAccount(context: ActorContext, id: bigint, input: AccountUpdate) {
    try { return await this.prisma.$transaction(async (tx) => {
      const changesHierarchy = input.parentAccountId !== undefined || input.allowsPosting === true;
      const discovered = changesHierarchy
        ? await this.hierarchyForUpdate(tx, context.companyId, id, input.parentAccountId, input.parentAccountId !== undefined)
        : { root: await this.accountOrThrow(tx, context.companyId, id), descendants: [], ancestors: { rows: [] as HierarchyAccount[], cycle: false } };
      const lockIds = orderedAccountIds([
        discovered.root.id,
        ...discovered.descendants.map(({ id: accountId }) => accountId),
        ...discovered.ancestors.rows.map(({ id: accountId }) => accountId),
      ]);
      const lockedIds = await lockAccountRows(tx, context.companyId, lockIds);
      if (lockedIds.length !== lockIds.length) throw new AccountError('VERSION_CONFLICT');

      const current = await tx.account.findFirst({ where: { id, companyId: context.companyId }, select: hierarchyAccountSelect });
      if (!current) throw new AccountError('VERSION_CONFLICT');
      if (current.version !== input.expectedVersion) throw new AccountError('VERSION_CONFLICT');
      if (input.accountTypeId !== undefined) await tx.accountType.findUniqueOrThrow({ where: { id: input.accountTypeId } }).catch(() => { throw new AccountError('NOT_FOUND'); });
      const invalidatesUsedAccount =
        (input.allowsPosting === false && current.allowsPosting)
        || (input.accountTypeId !== undefined && input.accountTypeId !== current.accountTypeId);
      if (invalidatesUsedAccount) await this.assertAccountUnused(tx, context.companyId, id);
      const parentId = input.parentAccountId === undefined ? current.parentAccountId : input.parentAccountId;
      const descendants = changesHierarchy ? await this.descendants(tx, context.companyId, id) : [];
      const ancestors = { rows: [] as HierarchyAccount[], cycle: false };
      if (input.parentAccountId !== undefined && parentId != null) {
        const refreshedAncestors = await this.ancestors(tx, context.companyId, parentId);
        ancestors.rows = refreshedAncestors.rows;
        ancestors.cycle = refreshedAncestors.cycle;
      }
      const locked = new Set(lockedIds.map(String));
      const finalHierarchyIds = [id, ...descendants.map(({ id: accountId }) => accountId), ...ancestors.rows.map(({ id: accountId }) => accountId)];
      if (finalHierarchyIds.some((accountId) => !locked.has(accountId.toString()))) throw new AccountError('VERSION_CONFLICT');
      if (ancestors.cycle || ancestors.rows.some(({ id: accountId }) => accountId === id)) throw new AccountError('CYCLE_DETECTED');

      let newLevel = 1;
      if (parentId != null) {
        if (input.parentAccountId !== undefined) {
          if (parentId === id) throw new AccountError('CYCLE_DETECTED');
          const parent = ancestors.rows[0];
          if (!parent || !parent.isActive || parent.allowsPosting) throw new AccountError('INVALID_PARENT');
          newLevel = parent.level + 1;
        } else newLevel = current.level;
      }
      const delta = newLevel - current.level;
      if (newLevel > 20 || descendants.some((item) => item.level + delta > 20)) throw new AccountError('LEVEL_EXCEEDED');
      if (input.allowsPosting === true && descendants.length > 0) throw new AccountError('POSTING_NOT_ALLOWED');
      const rootData: Prisma.AccountUpdateManyMutationInput = { ...(input.accountTypeId !== undefined ? { accountTypeId: input.accountTypeId } : {}), ...(input.parentAccountId !== undefined ? { parentAccountId: input.parentAccountId } : {}), ...(input.code !== undefined ? { code: input.code } : {}), ...(input.nameAr !== undefined ? { nameAr: input.nameAr } : {}), ...(input.nameEn !== undefined ? { nameEn: input.nameEn } : {}), ...(input.allowsPosting !== undefined ? { allowsPosting: input.allowsPosting } : {}), ...(input.isControlAccount !== undefined ? { isControlAccount: input.isControlAccount } : {}), level: newLevel, version: { increment: 1 } };
      const changed = [{ id, version: input.expectedVersion, level: current.level, root: true }, ...descendants.filter(() => delta !== 0).map((item) => ({ ...item, root: false }))].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
      for (const item of changed) {
        const result = await tx.account.updateMany({
          where: { id: item.id, companyId: context.companyId, version: item.version },
          data: item.root ? rootData : { level: item.level + delta, version: { increment: 1 } },
        });
        if (result.count !== 1) throw new AccountError('VERSION_CONFLICT');
      }
      const account = await tx.account.findFirstOrThrow({ where: { id, companyId: context.companyId }, include: { accountType: true } });
      await this.audit(tx, context, 'ACCOUNT_UPDATED', 'ACCOUNT', id); return account;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }); } catch (error) { if (knownUnique(error)) throw new AccountError('CODE_EXISTS'); if (knownWriteConflict(error)) throw new AccountError('VERSION_CONFLICT'); throw error; }
  }

  async deactivateAccount(context: ActorContext, id: bigint, reason: string, expectedVersion: number) {
    try { return await this.prisma.$transaction(async (tx) => { const locked = await lockAccountRows(tx, context.companyId, [id]); if (locked.length !== 1) throw new AccountError('NOT_FOUND'); const current = await tx.account.findFirst({ where: { id, companyId: context.companyId } }); if (!current) throw new AccountError('NOT_FOUND'); if (current.version !== expectedVersion) throw new AccountError('VERSION_CONFLICT'); if (await tx.account.count({ where: { companyId: context.companyId, parentAccountId: id, isActive: true } })) throw new AccountError('HAS_ACTIVE_CHILDREN'); await this.assertAccountUnused(tx, context.companyId, id); const changed = await tx.account.updateMany({ where: { id, companyId: context.companyId, version: expectedVersion }, data: { isActive: false, version: { increment: 1 } } }); if (changed.count !== 1) throw new AccountError('VERSION_CONFLICT'); const value = await tx.account.findFirstOrThrow({ where: { id, companyId: context.companyId }, include: { accountType: true } }); await this.audit(tx, context, 'ACCOUNT_DEACTIVATED', 'ACCOUNT', id, reason); return value; }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }); } catch (error) { if (knownWriteConflict(error)) throw new AccountError('VERSION_CONFLICT'); throw error; }
  }

  getDefaultTemplateStatus(context: ActorContext) {
    return this.prisma.$transaction((tx) => inspectDefaultChartTemplate(tx, context.companyId));
  }

  async applyDefaultTemplate(context: ActorContext) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const result = await applyDefaultChartTemplate(tx, context.companyId);
        await appendAudit(tx, { data: { companyId: context.companyId, actorUserId: context.userId, action: 'DEFAULT_CHART_TEMPLATE_APPLIED', entityType: 'COMPANY', entityId: context.companyId.toString(), details: { templateCode: result.templateCode, version: result.version, created: result.created, linked: result.linked, existing: result.existing } } });
        return result;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
      if (knownWriteConflict(error)) throw new AccountError('VERSION_CONFLICT');
      if (error instanceof Error && error.message.startsWith('DEFAULT_CHART_VERSION_CONFLICT:')) throw new AccountError('VERSION_CONFLICT');
      if (knownUnique(error) || (error instanceof Error && error.message.startsWith('DEFAULT_CHART_CONFLICT:'))) throw new AccountError('TEMPLATE_CONFLICT');
      throw error;
    }
  }

  async deleteAccount(context: ActorContext, id: bigint, reason: string, expectedVersion: number) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const locked = await lockAccountRows(tx, context.companyId, [id]);
        if (locked.length !== 1) throw new AccountError('NOT_FOUND');
        const account = await tx.account.findFirst({
          where: { id, companyId: context.companyId },
          include: { _count: { select: { children: true } } },
        });
        if (!account) throw new AccountError('NOT_FOUND');
        if (account.version !== expectedVersion) throw new AccountError('VERSION_CONFLICT');
        if (account._count.children > 0) throw new AccountError('HAS_CHILDREN');
        await this.assertAccountUnused(tx, context.companyId, id);
        const deleted = await tx.account.deleteMany({ where: { id, companyId: context.companyId, version: expectedVersion } });
        if (deleted.count !== 1) throw new AccountError('VERSION_CONFLICT');
        await appendAudit(tx, { data: { companyId: context.companyId, actorUserId: context.userId, action: 'ACCOUNT_DELETED', entityType: 'ACCOUNT', entityId: id.toString(), details: { reason, code: account.code, nameAr: account.nameAr, sourceTemplateCode: account.sourceTemplateCode, sourceTemplateKey: account.sourceTemplateKey } } });
        return { id: id.toString(), deleted: true };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
      if (knownWriteConflict(error)) throw new AccountError('VERSION_CONFLICT');
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') throw new AccountError('ACCOUNT_IN_USE');
      throw error;
    }
  }

  async assertPostingAllowed(companyId: bigint, id: bigint) { const value = await this.prisma.account.findFirst({ where: { id, companyId }, include: { _count: { select: { children: true } } } }); if (!value) throw new AccountError('NOT_FOUND'); if (!value.isActive || !value.allowsPosting || value._count.children > 0) throw new AccountError('POSTING_NOT_ALLOWED'); return value; }

  listCostCenters(context: ActorContext, input: Page) { const where: Prisma.CostCenterWhereInput = { companyId: context.companyId, ...(input.active !== undefined ? { isActive: input.active } : {}), ...(input.search ? { OR: [{ code: { contains: input.search } }, { nameAr: { contains: input.search } }, { nameEn: { contains: input.search } }] } : {}) }; return this.prisma.$transaction(async (tx) => ({ data: await tx.costCenter.findMany({ where, orderBy: { code: 'asc' }, skip: (input.page - 1) * input.pageSize, take: input.pageSize }), total: await tx.costCenter.count({ where }) })); }
  async getCostCenter(context: ActorContext, id: bigint) { const value = await this.prisma.costCenter.findFirst({ where: { id, companyId: context.companyId } }); if (!value) throw new AccountError('NOT_FOUND'); return value; }
  async createCostCenter(context: ActorContext, input: CostCenterInput) { try { return await this.prisma.$transaction(async (tx) => { if (input.parentId != null && !await tx.costCenter.findFirst({ where: { id: input.parentId, companyId: context.companyId, isActive: true } })) throw new AccountError('INVALID_PARENT'); const code = await reserveMasterDataCode(tx, context.companyId, 'COST_CENTER'); const value = await tx.costCenter.create({ data: { companyId: context.companyId, parentId: input.parentId ?? null, code, nameAr: input.nameAr, nameEn: input.nameEn ?? null } }); await this.audit(tx, context, 'COST_CENTER_CREATED', 'COST_CENTER', value.id); return value; }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); } catch (error) { if (knownUnique(error)) throw new AccountError('CODE_EXISTS'); throw error; } }
  async updateCostCenter(context: ActorContext, id: bigint, input: CostCenterUpdate) { return this.prisma.$transaction(async (tx) => { const current = await tx.costCenter.findFirst({ where: { id, companyId: context.companyId } }); if (!current) throw new AccountError('NOT_FOUND'); if (input.parentId != null) { if (input.parentId === id) throw new AccountError('CYCLE_DETECTED'); let cursor = await tx.costCenter.findFirst({ where: { id: input.parentId, companyId: context.companyId, isActive: true } }); if (!cursor) throw new AccountError('INVALID_PARENT'); while (cursor.parentId != null) { if (cursor.parentId === id) throw new AccountError('CYCLE_DETECTED'); cursor = await tx.costCenter.findFirst({ where: { id: cursor.parentId, companyId: context.companyId } }); if (!cursor) throw new AccountError('INVALID_PARENT'); } } const value = await tx.costCenter.update({ where: { id }, data: { ...(input.parentId !== undefined ? { parentId: input.parentId } : {}), ...(input.nameAr !== undefined ? { nameAr: input.nameAr } : {}), ...(input.nameEn !== undefined ? { nameEn: input.nameEn } : {}) } }); await this.audit(tx, context, 'COST_CENTER_UPDATED', 'COST_CENTER', id); return value; }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
  async deactivateCostCenter(context: ActorContext, id: bigint, reason: string) { return this.prisma.$transaction(async (tx) => { if (!await tx.costCenter.findFirst({ where: { id, companyId: context.companyId } })) throw new AccountError('NOT_FOUND'); if (await tx.costCenter.count({ where: { companyId: context.companyId, parentId: id, isActive: true } })) throw new AccountError('HAS_ACTIVE_CHILDREN'); const value = await tx.costCenter.update({ where: { id }, data: { isActive: false } }); await this.audit(tx, context, 'COST_CENTER_DEACTIVATED', 'COST_CENTER', id, reason); return value; }); }

  private async hierarchyForUpdate(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    rootId: bigint,
    requestedParentId: bigint | null | undefined,
    includeAncestors: boolean,
  ) {
    const root = await this.accountOrThrow(tx, companyId, rootId);
    const descendants = await this.descendants(tx, companyId, rootId);
    const parentId = requestedParentId === undefined ? root.parentAccountId : requestedParentId;
    const ancestors = !includeAncestors || parentId == null
      ? { rows: [] as HierarchyAccount[], cycle: false }
      : await this.ancestors(tx, companyId, parentId);
    return { root, descendants, ancestors };
  }

  private async accountOrThrow(tx: Prisma.TransactionClient, companyId: bigint, id: bigint) {
    const account = await tx.account.findFirst({ where: { id, companyId }, select: hierarchyAccountSelect });
    if (!account) throw new AccountError('NOT_FOUND');
    return account;
  }

  private async descendants(tx: Prisma.TransactionClient, companyId: bigint, root: bigint) {
    const result: HierarchyAccount[] = [];
    const seen = new Set([root.toString()]);
    let ids = [root];
    while (ids.length) {
      const rows = await tx.account.findMany({
        where: { companyId, parentAccountId: { in: ids } },
        select: hierarchyAccountSelect,
      });
      for (const row of rows) {
        if (seen.has(row.id.toString())) throw new AccountError('CYCLE_DETECTED');
        seen.add(row.id.toString());
        result.push(row);
      }
      ids = rows.map((row) => row.id);
    }
    return result;
  }

  private async ancestors(tx: Prisma.TransactionClient, companyId: bigint, start: bigint) {
    const rows: HierarchyAccount[] = [];
    const seen = new Set<string>();
    let cursorId: bigint | null = start;
    while (cursorId != null) {
      if (seen.has(cursorId.toString())) return { rows, cycle: true };
      seen.add(cursorId.toString());
      const cursor: HierarchyAccount | null = await tx.account.findFirst({
        where: { id: cursorId, companyId },
        select: hierarchyAccountSelect,
      });
      if (!cursor) throw new AccountError('INVALID_PARENT');
      rows.push(cursor);
      cursorId = cursor.parentAccountId;
    }
    return { rows, cycle: false };
  }
  private async assertAccountUnused(tx: Prisma.TransactionClient, companyId: bigint, accountId: bigint) {
    const usage = await this.accountUsageGuard.inspect(tx, companyId, accountId);
    if (usage.inUse) throw new AccountError('ACCOUNT_IN_USE', { usageFacts: usage.facts });
  }
  private audit(tx: Prisma.TransactionClient, context: ActorContext, action: string, entityType: string, id: bigint, reason?: string) { return appendAudit(tx, { data: { companyId: context.companyId, actorUserId: context.userId, action, entityType, entityId: id.toString(), ...(reason ? { details: { reason } } : {}) } }); }
}
