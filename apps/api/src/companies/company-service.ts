import { Prisma, type PrismaClient } from '@prisma/client';
import type { ActorContext } from '../users/user-service.js';

export type CompanyCurrencyErrorReason = 'CURRENCY_NOT_FOUND' | 'CURRENCY_NOT_ENABLED' | 'CURRENCY_CODE_EXISTS' | 'CURRENCY_IN_USE' | 'BASE_CURRENCY_RATE' | 'RATE_NOT_FOUND';

export class CompanyCurrencyError extends Error {
  constructor(public readonly reason: CompanyCurrencyErrorReason) { super(reason); }
}

export type ExchangeRateInput = { currencyId: bigint; rateDate: string; rate: string; source?: string | null | undefined };
export type CompanyCurrencyCreateInput = { code: string; nameAr: string; decimals: number };

export class CompanyService {
  constructor(private readonly prisma: PrismaClient) {}

  get(context: ActorContext) {
    return this.prisma.company.findUniqueOrThrow({ where: { id: context.companyId }, include: { baseCurrency: true } });
  }

  async update(context: ActorContext, input: { name?: string | undefined; timezone?: string | undefined }) {
    const data = { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.timezone !== undefined ? { timezone: input.timezone } : {}) };
    const company = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.company.update({ where: { id: context.companyId }, data, include: { baseCurrency: true } });
      await tx.auditLog.create({ data: { companyId: context.companyId, actorUserId: context.userId, action: 'COMPANY_UPDATED', entityType: 'COMPANY', entityId: context.companyId.toString(), details: input } });
      return updated;
    });
    return company;
  }

  async updateMakerChecker(context: ActorContext, enabled: boolean) {
    const company = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.company.update({ where: { id: context.companyId }, data: { manualJournalMakerCheckerEnabled: enabled }, include: { baseCurrency: true } });
      await tx.auditLog.create({ data: { companyId: context.companyId, actorUserId: context.userId, action: 'COMPANY_SETTING_UPDATED', entityType: 'COMPANY', entityId: context.companyId.toString(), details: { key: 'accounting.manual_journal_maker_checker_enabled', value: enabled } } });
      return updated;
    });
    return company;
  }

  async listCurrencyCatalog(context: ActorContext) {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: context.companyId }, select: { baseCurrencyId: true } });
    const currencies = await this.prisma.currency.findMany({
      where: { isActive: true, OR: [{ scope: 'GLOBAL', ownerCompanyId: null }, { scope: 'COMPANY', ownerCompanyId: context.companyId }] },
      orderBy: { code: 'asc' },
      include: {
        companyCurrencies: {
          where: { companyId: context.companyId },
          include: { rates: { orderBy: { rateDate: 'desc' }, take: 1 } },
        },
      },
    });
    return currencies.map((currency) => {
      const setting = currency.companyCurrencies[0];
      const latest = setting?.rates[0];
      const isBase = currency.id === company.baseCurrencyId;
      return {
        id: currency.id,
        code: currency.code,
        nameAr: currency.nameAr,
        decimals: currency.decimals,
        isBase,
        isCustom: currency.scope === 'COMPANY',
        isEnabled: isBase || Boolean(setting?.isActive),
        latestExchangeRate: isBase ? new Prisma.Decimal(1) : latest?.rate ?? null,
        latestExchangeRateDate: isBase ? null : latest?.rateDate ?? null,
      };
    });
  }

  async createCompanyCurrency(context: ActorContext, input: CompanyCurrencyCreateInput) {
    const code = input.code.trim().toUpperCase();
    const nameAr = input.nameAr.trim();
    const existing = await this.prisma.currency.findFirst({
      where: {
        code,
        OR: [{ scope: 'GLOBAL', ownerCompanyId: null }, { scope: 'COMPANY', ownerCompanyId: context.companyId }],
      },
      select: { id: true },
    });
    if (existing) throw new CompanyCurrencyError('CURRENCY_CODE_EXISTS');

    try {
      return await this.prisma.$transaction(async (tx) => {
        const currency = await tx.currency.create({
          data: {
            code,
            nameAr,
            decimals: input.decimals,
            scope: 'COMPANY',
            scopeKey: `COMPANY:${context.companyId}`,
            ownerCompanyId: context.companyId,
          },
        });
        await tx.companyCurrency.create({ data: { companyId: context.companyId, currencyId: currency.id } });
        await tx.auditLog.create({
          data: {
            companyId: context.companyId,
            actorUserId: context.userId,
            action: 'COMPANY_CURRENCY_CREATED',
            entityType: 'CURRENCY',
            entityId: currency.id.toString(),
            details: { code, nameAr, decimals: input.decimals, scope: 'COMPANY' },
          },
        });
        return {
          id: currency.id,
          code: currency.code,
          nameAr: currency.nameAr,
          decimals: currency.decimals,
          isBase: false,
          isCustom: true,
          isEnabled: true,
          latestExchangeRate: null,
          latestExchangeRateDate: null,
        };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new CompanyCurrencyError('CURRENCY_CODE_EXISTS');
      }
      throw error;
    }
  }

  async updateCompanyCurrencies(context: ActorContext, requestedCurrencyIds: bigint[]) {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: context.companyId }, select: { baseCurrencyId: true } });
    const currencyIds = [...new Set([...requestedCurrencyIds, company.baseCurrencyId].map(String))].map((value) => BigInt(value));
    const currencies = await this.prisma.currency.findMany({
      where: {
        id: { in: currencyIds },
        isActive: true,
        OR: [{ scope: 'GLOBAL', ownerCompanyId: null }, { scope: 'COMPANY', ownerCompanyId: context.companyId }],
      },
      select: { id: true, code: true },
    });
    if (currencies.length !== currencyIds.length) throw new CompanyCurrencyError('CURRENCY_NOT_FOUND');

    await this.prisma.$transaction(async (tx) => {
      const currenciesToDisable = await tx.companyCurrency.findMany({
        where: { companyId: context.companyId, currencyId: { notIn: currencyIds }, isActive: true },
        select: { currencyId: true },
      });
      const disabledCurrencyIds = currenciesToDisable.map(({ currencyId }) => currencyId);
      if (disabledCurrencyIds.length) {
        const usageWhere = { companyId: context.companyId, currencyId: { in: disabledCurrencyIds } };
        const usage = await Promise.all([
          tx.journalLine.findFirst({ where: usageWhere, select: { id: true } }),
          tx.receipt.findFirst({ where: usageWhere, select: { id: true } }),
          tx.payment.findFirst({ where: usageWhere, select: { id: true } }),
          tx.salesInvoice.findFirst({ where: usageWhere, select: { id: true } }),
          tx.purchaseInvoice.findFirst({ where: usageWhere, select: { id: true } }),
        ]);
        if (usage.some(Boolean)) throw new CompanyCurrencyError('CURRENCY_IN_USE');
      }
      await tx.companyCurrency.updateMany({
        where: { companyId: context.companyId, currencyId: { notIn: currencyIds }, isActive: true },
        data: { isActive: false },
      });
      for (const currencyId of currencyIds) {
        await tx.companyCurrency.upsert({
          where: { companyId_currencyId: { companyId: context.companyId, currencyId } },
          update: { isActive: true },
          create: { companyId: context.companyId, currencyId },
        });
      }
      await tx.auditLog.create({
        data: {
          companyId: context.companyId,
          actorUserId: context.userId,
          action: 'COMPANY_CURRENCIES_UPDATED',
          entityType: 'COMPANY',
          entityId: context.companyId.toString(),
          details: { enabledCurrencyCodes: currencies.map(({ code }) => code).sort() },
        },
      });
    });
    return this.listCurrencyCatalog(context);
  }

  async listExchangeRates(context: ActorContext, filter: { currencyId?: bigint | undefined; dateFrom?: string | undefined; dateTo?: string | undefined; page: number; pageSize: number }) {
    const where: Prisma.CompanyExchangeRateWhereInput = {
      companyId: context.companyId,
      companyCurrency: { currency: { OR: [{ scope: 'GLOBAL', ownerCompanyId: null }, { scope: 'COMPANY', ownerCompanyId: context.companyId }] } },
      ...(filter.currencyId ? { currencyId: filter.currencyId } : {}),
      ...(filter.dateFrom || filter.dateTo ? { rateDate: { ...(filter.dateFrom ? { gte: this.date(filter.dateFrom) } : {}), ...(filter.dateTo ? { lte: this.date(filter.dateTo) } : {}) } } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.companyExchangeRate.findMany({
        where,
        orderBy: [{ rateDate: 'desc' }, { id: 'desc' }],
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize,
        include: { companyCurrency: { include: { currency: true } }, updatedBy: { select: { id: true, displayName: true } } },
      }),
      this.prisma.companyExchangeRate.count({ where }),
    ]);
    return { data, total };
  }

  async upsertExchangeRate(context: ActorContext, input: ExchangeRateInput) {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: context.companyId }, select: { baseCurrencyId: true } });
    if (input.currencyId === company.baseCurrencyId) throw new CompanyCurrencyError('BASE_CURRENCY_RATE');
    const setting = await this.prisma.companyCurrency.findFirst({
      where: {
        companyId: context.companyId,
        currencyId: input.currencyId,
        currency: { OR: [{ scope: 'GLOBAL', ownerCompanyId: null }, { scope: 'COMPANY', ownerCompanyId: context.companyId }] },
      },
      include: { currency: true },
    });
    if (!setting?.isActive || !setting.currency.isActive) throw new CompanyCurrencyError('CURRENCY_NOT_ENABLED');
    const rateDate = this.date(input.rateDate);
    const rate = new Prisma.Decimal(input.rate);

    return this.prisma.$transaction(async (tx) => {
      const previous = await tx.companyExchangeRate.findUnique({
        where: { companyId_currencyId_rateDate: { companyId: context.companyId, currencyId: input.currencyId, rateDate } },
        select: { rate: true, source: true },
      });
      const value = await tx.companyExchangeRate.upsert({
        where: { companyId_currencyId_rateDate: { companyId: context.companyId, currencyId: input.currencyId, rateDate } },
        update: { rate, source: input.source ?? null, updatedById: context.userId },
        create: { companyId: context.companyId, currencyId: input.currencyId, rateDate, rate, source: input.source ?? null, updatedById: context.userId },
        include: { companyCurrency: { include: { currency: true } }, updatedBy: { select: { id: true, displayName: true } } },
      });
      await tx.auditLog.create({
        data: {
          companyId: context.companyId,
          actorUserId: context.userId,
          action: 'EXCHANGE_RATE_UPSERTED',
          entityType: 'COMPANY_EXCHANGE_RATE',
          entityId: value.id.toString(),
          details: { currencyCode: setting.currency.code, rateDate: input.rateDate, rate: rate.toFixed(8), source: input.source ?? null, previousRate: previous?.rate.toFixed(8) ?? null, previousSource: previous?.source ?? null },
        },
      });
      return value;
    });
  }

  async resolveExchangeRate(context: ActorContext, currencyId: bigint, rateDate: string) {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: context.companyId }, select: { baseCurrencyId: true } });
    if (currencyId === company.baseCurrencyId) return { rate: new Prisma.Decimal(1), rateDate: null, source: 'BASE_CURRENCY' };
    const setting = await this.prisma.companyCurrency.findFirst({
      where: {
        companyId: context.companyId,
        currencyId,
        currency: { OR: [{ scope: 'GLOBAL', ownerCompanyId: null }, { scope: 'COMPANY', ownerCompanyId: context.companyId }] },
      },
      include: { currency: true },
    });
    if (!setting?.isActive || !setting.currency.isActive) throw new CompanyCurrencyError('CURRENCY_NOT_ENABLED');
    const value = await this.prisma.companyExchangeRate.findFirst({
      where: { companyId: context.companyId, currencyId, rateDate: { lte: this.date(rateDate) } },
      orderBy: { rateDate: 'desc' },
    });
    if (!value) throw new CompanyCurrencyError('RATE_NOT_FOUND');
    return { rate: value.rate, rateDate: value.rateDate, source: value.source };
  }

  private date(value: string) {
    return new Date(`${value}T00:00:00.000Z`);
  }
}
