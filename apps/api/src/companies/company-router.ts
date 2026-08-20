import { Router, type ErrorRequestHandler, type Request } from 'express';
import { z, ZodError } from 'zod';
import type { AuthService } from '../auth/auth-service.js';
import type { CompanyService } from './company-service.js';

const updateSchema = z.object({ name: z.string().trim().min(1).max(200).optional(), timezone: z.string().trim().min(1).max(64).optional() }).strict().refine((value) => Object.keys(value).length > 0);
const settingsSchema = z.object({ settings: z.array(z.object({ key: z.literal('accounting.manual_journal_maker_checker_enabled'), value: z.boolean() }).strict()).length(1) }).strict();
const sid = (request: Request) => Object.fromEntries((request.headers.cookie ?? '').split(';').map((part) => part.trim().split('=', 2)).filter(([key, value]) => key && value)).sid;
const serialize = (company: { id: bigint; name: string; baseCurrencyId: bigint; timezone: string; isActive: boolean; manualJournalMakerCheckerEnabled: boolean; updatedAt: Date; baseCurrency: { code: string; nameAr: string } }) => ({ id: company.id.toString(), name: company.name, baseCurrencyId: company.baseCurrencyId.toString(), baseCurrency: { code: company.baseCurrency.code, nameAr: company.baseCurrency.nameAr }, timezone: company.timezone, isActive: company.isActive, manualJournalMakerCheckerEnabled: company.manualJournalMakerCheckerEnabled, updatedAt: company.updatedAt.toISOString() });
const settings = (company: { manualJournalMakerCheckerEnabled: boolean; updatedAt: Date }) => ({ data: [{ key: 'accounting.manual_journal_maker_checker_enabled', value: company.manualJournalMakerCheckerEnabled, updatedAt: company.updatedAt.toISOString() }] });

export function createCompanyRouter(auth: AuthService, companies: CompanyService) {
  const router = Router();
  const authorize = (request: Request, permission: string, requireCsrf: boolean) => auth.authorize({ sid: sid(request), csrfToken: request.header('X-CSRF-Token') ?? undefined, permission, requireCsrf });
  router.get('/companies/current', async (request, response) => { const context = await authorize(request, 'companies.view', false); response.json(serialize(await companies.get(context))); });
  router.patch('/companies/current', async (request, response) => { const context = await authorize(request, 'companies.update', true); response.json(serialize(await companies.update(context, updateSchema.parse(request.body)))); });
  router.get('/settings', async (request, response) => { const context = await authorize(request, 'settings.manage', false); response.json(settings(await companies.get(context))); });
  router.put('/settings', async (request, response) => { const context = await authorize(request, 'settings.manage', true); const body = settingsSchema.parse(request.body); response.json(settings(await companies.updateMakerChecker(context, body.settings[0]!.value))); });
  const errors: ErrorRequestHandler = (error, _request, response, next) => { if (error instanceof ZodError) { response.status(400).json({ type: 'about:blank', title: 'Validation failed', status: 400, code: 'VALIDATION_ERROR', errors: error.issues }); return; } next(error); };
  router.use(errors);
  return router;
}
