import { Router, type ErrorRequestHandler, type Request } from 'express';
import { z, ZodError } from 'zod';
import type { AuthService } from '../auth/auth-service.js';
import {
  createCompanyCurrencyRequestSchema,
  replaceCompanyCurrenciesRequestSchema,
  upsertCompanyExchangeRateRequestSchema,
  updateCurrentCompanyRequestSchema,
  replaceCompanySettingsRequestSchema,
} from '../generated/openapi-request-guards.js';
import { CompanyCurrencyError, type CompanyService } from './company-service.js';

const id = z.string().regex(/^[1-9][0-9]*$/).transform(BigInt);
const date = z.string().date();
const rateFilterSchema = z.object({ currencyId: id.optional(), dateFrom: date.optional(), dateTo: date.optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(250).default(100) }).refine((value) => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo);
const sid = (request: Request) => Object.fromEntries((request.headers.cookie ?? '').split(';').map((part) => part.trim().split('=', 2)).filter(([key, value]) => key && value)).sid;
const serialize = (company: { id: bigint; name: string; baseCurrencyId: bigint; timezone: string; isActive: boolean; manualJournalMakerCheckerEnabled: boolean; updatedAt: Date; baseCurrency: { code: string; nameAr: string } }) => ({ id: company.id.toString(), name: company.name, baseCurrencyId: company.baseCurrencyId.toString(), baseCurrency: { code: company.baseCurrency.code, nameAr: company.baseCurrency.nameAr }, timezone: company.timezone, isActive: company.isActive, manualJournalMakerCheckerEnabled: company.manualJournalMakerCheckerEnabled, updatedAt: company.updatedAt.toISOString() });
const settings = (company: { manualJournalMakerCheckerEnabled: boolean; updatedAt: Date }) => ({ data: [{ key: 'accounting.manual_journal_maker_checker_enabled', value: company.manualJournalMakerCheckerEnabled, updatedAt: company.updatedAt.toISOString() }] });
const currencySetting = (value: { id: bigint; code: string; nameAr: string; decimals: number; isBase: boolean; isCustom: boolean; isEnabled: boolean; latestExchangeRate: { toFixed(decimals: number): string } | null; latestExchangeRateDate: Date | null }) => ({ id: value.id.toString(), code: value.code, nameAr: value.nameAr, decimals: value.decimals, isBase: value.isBase, isCustom: value.isCustom, isEnabled: value.isEnabled, latestExchangeRate: value.latestExchangeRate?.toFixed(8) ?? null, latestExchangeRateDate: value.latestExchangeRateDate?.toISOString().slice(0, 10) ?? null });
const exchangeRate = (value: { id: bigint; rateDate: Date; rate: { toFixed(decimals: number): string }; source: string | null; updatedAt: Date; companyCurrency: { currency: { id: bigint; code: string; nameAr: string } }; updatedBy: { id: bigint; displayName: string } }) => ({ id: value.id.toString(), currency: { id: value.companyCurrency.currency.id.toString(), code: value.companyCurrency.currency.code, nameAr: value.companyCurrency.currency.nameAr }, rateDate: value.rateDate.toISOString().slice(0, 10), rate: value.rate.toFixed(8), source: value.source, updatedAt: value.updatedAt.toISOString(), updatedBy: { id: value.updatedBy.id.toString(), displayName: value.updatedBy.displayName } });

export function createCompanyRouter(auth: AuthService, companies: CompanyService) {
  const router = Router();
  const authorize = (request: Request, permission: string, requireCsrf: boolean) => auth.authorize({ sid: sid(request), csrfToken: request.header('X-CSRF-Token') ?? undefined, permission, requireCsrf });
  router.get('/companies/current', async (request, response) => { const context = await authorize(request, 'companies.view', false); response.json(serialize(await companies.get(context))); });
  router.patch('/companies/current', async (request, response) => { const context = await authorize(request, 'companies.update', true); response.json(serialize(await companies.update(context, updateCurrentCompanyRequestSchema.parse(request.body)))); });
  router.get('/settings', async (request, response) => { const context = await authorize(request, 'settings.manage', false); response.json(settings(await companies.get(context))); });
  router.put('/settings', async (request, response) => { const context = await authorize(request, 'settings.manage', true); const body = replaceCompanySettingsRequestSchema.parse(request.body); response.json(settings(await companies.updateMakerChecker(context, body.settings[0]!.value))); });
  router.get('/company-currencies', async (request, response) => { const context = await authorize(request, 'currencies.view', false); response.json({ data: (await companies.listCurrencyCatalog(context)).map(currencySetting) }); });
  router.post('/company-currencies', async (request, response) => { const context = await authorize(request, 'currencies.create', true); const body = createCompanyCurrencyRequestSchema.parse(request.body); response.status(201).json(currencySetting(await companies.createCompanyCurrency(context, body))); });
  router.put('/company-currencies', async (request, response) => { const context = await authorize(request, 'currencies.manage', true); const body = replaceCompanyCurrenciesRequestSchema.parse(request.body); response.json({ data: (await companies.updateCompanyCurrencies(context, body.currencyIds)).map(currencySetting) }); });
  router.get('/exchange-rates', async (request, response) => { const context = await authorize(request, 'currencies.view', false); const query = rateFilterSchema.parse(request.query); const result = await companies.listExchangeRates(context, query); response.json({ data: result.data.map(exchangeRate), meta: { page: query.page, pageSize: query.pageSize, total: result.total, totalPages: Math.ceil(result.total / query.pageSize) } }); });
  router.put('/exchange-rates', async (request, response) => { const context = await authorize(request, 'currencies.manage', true); const body = upsertCompanyExchangeRateRequestSchema.parse(request.body); response.json(exchangeRate(await companies.upsertExchangeRate(context, body))); });
  router.get('/exchange-rates/resolve', async (request, response) => { const context = await authorize(request, 'currencies.view', false); const query = z.object({ currencyId: id, rateDate: date }).parse(request.query); const value = await companies.resolveExchangeRate(context, query.currencyId, query.rateDate); response.json({ rate: value.rate.toFixed(8), rateDate: value.rateDate?.toISOString().slice(0, 10) ?? null, source: value.source }); });
  const errors: ErrorRequestHandler = (error, _request, response, next) => { if (error instanceof ZodError) { response.status(400).json({ type: 'about:blank', title: 'Validation failed', status: 400, code: 'VALIDATION_ERROR', errors: error.issues }); return; } if (error instanceof CompanyCurrencyError) { const status = error.reason === 'CURRENCY_NOT_FOUND' ? 404 : error.reason === 'CURRENCY_CODE_EXISTS' ? 409 : 422; response.status(status).json({ type: 'about:blank', title: status === 409 ? 'Currency already exists' : 'Currency rule violation', status, code: status === 409 ? 'CONFLICT' : 'BUSINESS_RULE_VIOLATION', reason: error.reason }); return; } next(error); };
  router.use(errors);
  return router;
}
