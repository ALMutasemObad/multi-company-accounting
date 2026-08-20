import type { PrismaClient } from '@prisma/client';
import type { ActorContext } from '../users/user-service.js';

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
}
