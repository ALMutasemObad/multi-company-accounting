import { Prisma, type PrismaClient } from '@prisma/client';
import { reserveMasterDataCode } from '../platform/master-data-code-service.js';
import type { ActorContext } from '../users/user-service.js';
import { applyDefaultChartTemplate, inspectDefaultChartTemplate } from './default-chart-template.js';

export type AccountErrorReason = 'NOT_FOUND' | 'CODE_EXISTS' | 'INVALID_PARENT' | 'CYCLE_DETECTED' | 'LEVEL_EXCEEDED' | 'HAS_ACTIVE_CHILDREN' | 'HAS_CHILDREN' | 'ACCOUNT_IN_USE' | 'POSTING_NOT_ALLOWED' | 'TEMPLATE_CONFLICT';
export class AccountError extends Error { constructor(public readonly reason: AccountErrorReason) { super(reason); } }

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
type AccountUpdate = { accountTypeId?: bigint | undefined; parentAccountId?: bigint | null | undefined; code?: string | undefined; nameAr?: string | undefined; nameEn?: string | null | undefined; allowsPosting?: boolean | undefined; isControlAccount?: boolean | undefined };
type CostCenterInput = { parentId?: bigint | null | undefined; nameAr: string; nameEn?: string | null | undefined };
type CostCenterUpdate = { parentId?: bigint | null | undefined; nameAr?: string | undefined; nameEn?: string | null | undefined };

function knownUnique(error: unknown) { return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'; }

export class AccountService {
  constructor(private readonly prisma: PrismaClient) {}

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
      const parent = input.parentAccountId == null ? null : await tx.account.findFirst({ where: { id: input.parentAccountId, companyId: context.companyId } });
      if (input.parentAccountId != null && (!parent || !parent.isActive || parent.allowsPosting)) throw new AccountError('INVALID_PARENT');
      const level = parent ? parent.level + 1 : 1; if (level > 20) throw new AccountError('LEVEL_EXCEEDED');
      const account = await tx.account.create({ data: { companyId: context.companyId, accountTypeId: input.accountTypeId, parentAccountId: input.parentAccountId ?? null, code: input.code, nameAr: input.nameAr, nameEn: input.nameEn ?? null, level, allowsPosting: input.allowsPosting, isControlAccount: input.isControlAccount ?? false }, include: { accountType: true } });
      await this.audit(tx, context, 'ACCOUNT_CREATED', 'ACCOUNT', account.id); return account;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); } catch (error) { if (knownUnique(error)) throw new AccountError('CODE_EXISTS'); throw error; }
  }

  async updateAccount(context: ActorContext, id: bigint, input: AccountUpdate) {
    try { return await this.prisma.$transaction(async (tx) => {
      const current = await tx.account.findFirst({ where: { id, companyId: context.companyId } }); if (!current) throw new AccountError('NOT_FOUND');
      if (input.accountTypeId !== undefined) await tx.accountType.findUniqueOrThrow({ where: { id: input.accountTypeId } }).catch(() => { throw new AccountError('NOT_FOUND'); });
      const parentId = input.parentAccountId === undefined ? current.parentAccountId : input.parentAccountId;
      let newLevel = 1;
      if (parentId != null) {
        if (parentId === id) throw new AccountError('CYCLE_DETECTED');
        let cursor = await tx.account.findFirst({ where: { id: parentId, companyId: context.companyId } });
        if (!cursor || !cursor.isActive || cursor.allowsPosting) throw new AccountError('INVALID_PARENT');
        newLevel = cursor.level + 1;
        while (cursor.parentAccountId != null) { if (cursor.parentAccountId === id) throw new AccountError('CYCLE_DETECTED'); cursor = await tx.account.findFirst({ where: { id: cursor.parentAccountId, companyId: context.companyId } }) as typeof cursor; if (!cursor) throw new AccountError('INVALID_PARENT'); }
      }
      const descendants = await this.descendants(tx, context.companyId, id); const delta = newLevel - current.level;
      if (newLevel > 20 || descendants.some((item) => item.level + delta > 20)) throw new AccountError('LEVEL_EXCEEDED');
      if (input.allowsPosting === true && descendants.length > 0) throw new AccountError('POSTING_NOT_ALLOWED');
      const account = await tx.account.update({ where: { id }, data: { ...(input.accountTypeId !== undefined ? { accountTypeId: input.accountTypeId } : {}), ...(input.parentAccountId !== undefined ? { parentAccountId: input.parentAccountId } : {}), ...(input.code !== undefined ? { code: input.code } : {}), ...(input.nameAr !== undefined ? { nameAr: input.nameAr } : {}), ...(input.nameEn !== undefined ? { nameEn: input.nameEn } : {}), ...(input.allowsPosting !== undefined ? { allowsPosting: input.allowsPosting } : {}), ...(input.isControlAccount !== undefined ? { isControlAccount: input.isControlAccount } : {}), level: newLevel }, include: { accountType: true } });
      for (const item of descendants) await tx.account.update({ where: { id: item.id }, data: { level: item.level + delta } });
      await this.audit(tx, context, 'ACCOUNT_UPDATED', 'ACCOUNT', id); return account;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); } catch (error) { if (knownUnique(error)) throw new AccountError('CODE_EXISTS'); throw error; }
  }

  async deactivateAccount(context: ActorContext, id: bigint, reason: string) {
    return this.prisma.$transaction(async (tx) => { const current = await tx.account.findFirst({ where: { id, companyId: context.companyId } }); if (!current) throw new AccountError('NOT_FOUND'); if (await tx.account.count({ where: { companyId: context.companyId, parentAccountId: id, isActive: true } })) throw new AccountError('HAS_ACTIVE_CHILDREN'); const value = await tx.account.update({ where: { id }, data: { isActive: false }, include: { accountType: true } }); await this.audit(tx, context, 'ACCOUNT_DEACTIVATED', 'ACCOUNT', id, reason); return value; });
  }

  getDefaultTemplateStatus(context: ActorContext) {
    return this.prisma.$transaction((tx) => inspectDefaultChartTemplate(tx, context.companyId));
  }

  async applyDefaultTemplate(context: ActorContext) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const result = await applyDefaultChartTemplate(tx, context.companyId);
        await tx.auditLog.create({ data: { companyId: context.companyId, actorUserId: context.userId, action: 'DEFAULT_CHART_TEMPLATE_APPLIED', entityType: 'COMPANY', entityId: context.companyId.toString(), details: { templateCode: result.templateCode, version: result.version, created: result.created, linked: result.linked, existing: result.existing } } });
        return result;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (knownUnique(error) || (error instanceof Error && error.message.startsWith('DEFAULT_CHART_CONFLICT:'))) throw new AccountError('TEMPLATE_CONFLICT');
      throw error;
    }
  }

  async deleteAccount(context: ActorContext, id: bigint, reason: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const account = await tx.account.findFirst({
          where: { id, companyId: context.companyId },
          include: { _count: { select: { children: true, journalLines: true, customers: true, cashBankAccounts: true, receiptCounterAccounts: true, suppliers: true, paymentCounterAccounts: true, outputTaxRates: true, inputTaxRates: true, salesInvoiceLines: true, purchaseInvoiceLines: true } } },
        });
        if (!account) throw new AccountError('NOT_FOUND');
        if (account._count.children > 0) throw new AccountError('HAS_CHILDREN');
        const usage = Object.entries(account._count).filter(([key, count]) => key !== 'children' && count > 0).map(([key]) => key);
        if (usage.length > 0) throw new AccountError('ACCOUNT_IN_USE');
        await tx.account.delete({ where: { id } });
        await tx.auditLog.create({ data: { companyId: context.companyId, actorUserId: context.userId, action: 'ACCOUNT_DELETED', entityType: 'ACCOUNT', entityId: id.toString(), details: { reason, code: account.code, nameAr: account.nameAr, sourceTemplateCode: account.sourceTemplateCode, sourceTemplateKey: account.sourceTemplateKey } } });
        return { id: id.toString(), deleted: true };
      });
    } catch (error) {
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

  private async descendants(tx: Prisma.TransactionClient, companyId: bigint, root: bigint) { const result: Array<{ id: bigint; level: number }> = []; let ids = [root]; while (ids.length) { const rows = await tx.account.findMany({ where: { companyId, parentAccountId: { in: ids } }, select: { id: true, level: true } }); result.push(...rows); ids = rows.map((row) => row.id); } return result; }
  private audit(tx: Prisma.TransactionClient, context: ActorContext, action: string, entityType: string, id: bigint, reason?: string) { return tx.auditLog.create({ data: { companyId: context.companyId, actorUserId: context.userId, action, entityType, entityId: id.toString(), ...(reason ? { details: { reason } } : {}) } }); }
}
