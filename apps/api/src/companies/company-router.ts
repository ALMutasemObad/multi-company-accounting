import { Router, type ErrorRequestHandler, type Request } from 'express';
import { z, ZodError } from 'zod';
import type { AuthService } from '../auth/auth-service.js';
import {
  createCompanyCurrencyRequestSchema,
  replaceCompanyCurrenciesRequestSchema,
  upsertCompanyExchangeRateRequestSchema,
  updateCurrentCompanyRequestSchema,
  updateCompanyComplianceRequestSchema,
  updateCompanyProfileRequestSchema,
  replaceCompanySettingsRequestSchema,
} from '../generated/openapi-request-guards.js';
import { CompanyCurrencyError, enabledCurrencyOptionsQuerySchema, type CompanyService } from './company-service.js';
import { CompanyProfileError, type CompanyProfileService } from './company-profile-service.js';

const id = z.string().regex(/^[1-9][0-9]*$/).transform(BigInt);
const date = z.string().date();
const rateFilterSchema = z.object({ currencyId: id.optional(), dateFrom: date.optional(), dateTo: date.optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(250).default(100) }).refine((value) => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo);
const sid = (request: Request) => Object.fromEntries((request.headers.cookie ?? '').split(';').map((part) => part.trim().split('=', 2)).filter(([key, value]) => key && value)).sid;
const serialize = (company: { id: bigint; name: string; baseCurrencyId: bigint; timezone: string; isActive: boolean; manualJournalMakerCheckerEnabled: boolean; updatedAt: Date; baseCurrency: { code: string; nameAr: string } }) => ({ id: company.id.toString(), name: company.name, baseCurrencyId: company.baseCurrencyId.toString(), baseCurrency: { code: company.baseCurrency.code, nameAr: company.baseCurrency.nameAr }, timezone: company.timezone, isActive: company.isActive, manualJournalMakerCheckerEnabled: company.manualJournalMakerCheckerEnabled, updatedAt: company.updatedAt.toISOString() });
const settings = (company: { manualJournalMakerCheckerEnabled: boolean; updatedAt: Date }) => ({ data: [{ key: 'accounting.manual_journal_maker_checker_enabled', value: company.manualJournalMakerCheckerEnabled, updatedAt: company.updatedAt.toISOString() }] });
const currencySetting = (value: { id: bigint; code: string; nameAr: string; decimals: number; isBase: boolean; isCustom: boolean; isEnabled: boolean; latestExchangeRate: { toFixed(decimals: number): string } | null; latestExchangeRateDate: Date | null }) => ({ id: value.id.toString(), code: value.code, nameAr: value.nameAr, decimals: value.decimals, isBase: value.isBase, isCustom: value.isCustom, isEnabled: value.isEnabled, latestExchangeRate: value.latestExchangeRate?.toFixed(8) ?? null, latestExchangeRateDate: value.latestExchangeRateDate?.toISOString().slice(0, 10) ?? null });
type EnabledCurrency = Awaited<ReturnType<CompanyService['listEnabledCurrencies']>>[number];
const enabledCurrency = (value: EnabledCurrency) => {
  const isBase = value.company.baseCurrencyId === value.currency.id;
  const latest = value.rates[0];
  return {
    id: value.currency.id.toString(),
    code: value.currency.code,
    nameAr: value.currency.nameAr,
    decimals: value.currency.decimals,
    isBase,
    latestExchangeRate: isBase ? '1.00000000' : latest?.rate.toFixed(8) ?? null,
    latestExchangeRateDate: isBase ? null : latest?.rateDate.toISOString().slice(0, 10) ?? null,
  };
};
const exchangeRate = (value: { id: bigint; rateDate: Date; rate: { toFixed(decimals: number): string }; source: string | null; updatedAt: Date; companyCurrency: { currency: { id: bigint; code: string; nameAr: string } }; updatedBy: { id: bigint; displayName: string } }) => ({ id: value.id.toString(), currency: { id: value.companyCurrency.currency.id.toString(), code: value.companyCurrency.currency.code, nameAr: value.companyCurrency.currency.nameAr }, rateDate: value.rateDate.toISOString().slice(0, 10), rate: value.rate.toFixed(8), source: value.source, updatedAt: value.updatedAt.toISOString(), updatedBy: { id: value.updatedBy.id.toString(), displayName: value.updatedBy.displayName } });

const dateOnly = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;
const dateTime = (value: Date | null) => value?.toISOString() ?? null;
const profileJson = (value: Awaited<ReturnType<CompanyProfileService['getProfile']>>, options: Awaited<ReturnType<CompanyProfileService['options']>>) => ({
  profile: {
    companyId: value.profile.companyId.toString(), tradeName: value.profile.tradeName,
    countryCode: value.profile.countryCode, preferredLocale: value.profile.preferredLocale,
    phone: value.profile.phone, email: value.profile.email, website: value.profile.website,
    primaryContactName: value.profile.primaryContactName,
    primaryBusinessActivity: value.profile.primaryBusinessActivity,
    initialChartTemplateCode: value.profile.initialChartTemplateCode,
    grandfatheredAt: dateTime(value.profile.grandfatheredAt), version: value.profile.version,
    updatedAt: value.profile.updatedAt.toISOString(),
  },
  readiness: value.readiness, brandingAssets: value.brandingAssets, options,
});

const complianceJson = (value: Awaited<ReturnType<CompanyProfileService['getCompliance']>>) => {
  const registration = value.registrations[0] ?? null;
  const tax = value.taxRegistrations[0] ?? null;
  const nationalAddress = value.addresses.find(({ type }) => type === 'NATIONAL') ?? null;
  return {
    version: value.profile.complianceVersion,
    countryCode: value.profile.countryCode,
    legalName: value.profile.legalName,
    legalForm: value.profile.legalForm,
    commercialRegistration: registration ? {
      id: registration.id.toString(), documentType: registration.documentType,
      numberLast4: registration.numberLast4, issuingAuthority: registration.issuingAuthority,
      issuedAt: dateOnly(registration.issuedAt), expiresAt: dateOnly(registration.expiresAt),
      status: registration.status, renewalStatus: registration.renewalStatus,
      verifiedAt: dateTime(registration.verifiedAt), updatedAt: registration.updatedAt.toISOString(),
    } : null,
    taxRegistration: tax ? {
      id: tax.id.toString(), registrationType: tax.registrationType, countryCode: tax.countryCode,
      numberLast4: tax.numberLast4, issuedAt: dateOnly(tax.issuedAt), expiresAt: dateOnly(tax.expiresAt),
      status: tax.status, renewalStatus: tax.renewalStatus,
      verifiedAt: dateTime(tax.verifiedAt), updatedAt: tax.updatedAt.toISOString(),
    } : null,
    nationalAddress: nationalAddress ? {
      id: nationalAddress.id.toString(), line1: nationalAddress.line1, line2: nationalAddress.line2,
      district: nationalAddress.district, city: nationalAddress.city, subdivision: nationalAddress.subdivision,
      postalCode: nationalAddress.postalCode, countryCode: nationalAddress.countryCode,
      displayAddress: nationalAddress.displayAddress, updatedAt: nationalAddress.updatedAt.toISOString(),
    } : null,
    readiness: value.readiness,
    brandingAssets: value.brandingAssets,
  };
};

export function createCompanyRouter(auth: AuthService, companies: CompanyService, profiles: CompanyProfileService | undefined = companies.profiles) {
  const router = Router();
  const authorize = (request: Request, permission: string, requireCsrf: boolean) => auth.authorize({ sid: sid(request), csrfToken: request.header('X-CSRF-Token') ?? undefined, permission, requireCsrf });
  router.get('/companies/current', async (request, response) => { const context = await authorize(request, 'companies.view', false); response.json(serialize(await companies.get(context))); });
  router.patch('/companies/current', async (request, response) => { const context = await authorize(request, 'companies.update', true); response.json(serialize(await companies.update(context, updateCurrentCompanyRequestSchema.parse(request.body)))); });
  router.get('/company-profile', async (request, response) => {
    const context = await authorize(request, 'companies.profile.view', false);
    if (!profiles) throw new CompanyProfileError('PROFILE_NOT_FOUND');
    const [value, options] = await Promise.all([profiles.getProfile(context), profiles.options()]);
    response.json(profileJson(value, options));
  });
  router.patch('/company-profile', async (request, response) => {
    const context = await authorize(request, 'companies.profile.manage', true);
    if (!profiles) throw new CompanyProfileError('PROFILE_NOT_FOUND');
    const value = await profiles.updateProfile(context, updateCompanyProfileRequestSchema.parse(request.body));
    response.json(profileJson(value, await profiles.options()));
  });
  router.get('/company-compliance', async (request, response) => {
    const context = await authorize(request, 'companies.compliance.view', false);
    if (!profiles) throw new CompanyProfileError('PROFILE_NOT_FOUND');
    response.json(complianceJson(await profiles.getCompliance(context)));
  });
  router.patch('/company-compliance', async (request, response) => {
    const context = await authorize(request, 'companies.compliance.manage', true);
    if (!profiles) throw new CompanyProfileError('PROFILE_NOT_FOUND');
    response.json(complianceJson(await profiles.updateCompliance(context, updateCompanyComplianceRequestSchema.parse(request.body))));
  });
  router.get('/settings', async (request, response) => { const context = await authorize(request, 'settings.manage', false); response.json(settings(await companies.get(context))); });
  router.put('/settings', async (request, response) => { const context = await authorize(request, 'settings.manage', true); const body = replaceCompanySettingsRequestSchema.parse(request.body); response.json(settings(await companies.updateMakerChecker(context, body.settings[0]!.value))); });
  router.get('/company-currencies', async (request, response) => { const context = await authorize(request, 'currencies.view', false); response.json({ data: (await companies.listCurrencyCatalog(context)).map(currencySetting) }); });
  router.get('/currencies', async (request, response) => {
    const context = await authorize(request, 'currencies.view', false);
    const data = (await companies.listEnabledCurrencies(context))
      .map(enabledCurrency)
      .sort((left, right) => Number(right.isBase) - Number(left.isBase) || left.code.localeCompare(right.code));
    response.json({ data });
  });
  router.get('/currencies/options', async (request, response) => {
    const context = await authorize(request, 'currencies.view', false);
    const query = enabledCurrencyOptionsQuerySchema.parse(request.query);
    const result = await companies.listEnabledCurrencyOptions(context, query);
    response.json({
      data: result.data.map((currency) => ({ id: currency.id.toString(), code: currency.code, nameAr: currency.nameAr, decimals: currency.decimals })),
      meta: { page: query.page, pageSize: query.pageSize, total: result.total, totalPages: Math.ceil(result.total / query.pageSize) },
    });
  });
  router.post('/company-currencies', async (request, response) => { const context = await authorize(request, 'currencies.create', true); const body = createCompanyCurrencyRequestSchema.parse(request.body); response.status(201).json(currencySetting(await companies.createCompanyCurrency(context, body))); });
  router.put('/company-currencies', async (request, response) => { const context = await authorize(request, 'currencies.manage', true); const body = replaceCompanyCurrenciesRequestSchema.parse(request.body); response.json({ data: (await companies.updateCompanyCurrencies(context, body.currencyIds)).map(currencySetting) }); });
  router.get('/exchange-rates', async (request, response) => { const context = await authorize(request, 'currencies.view', false); const query = rateFilterSchema.parse(request.query); const result = await companies.listExchangeRates(context, query); response.json({ data: result.data.map(exchangeRate), meta: { page: query.page, pageSize: query.pageSize, total: result.total, totalPages: Math.ceil(result.total / query.pageSize) } }); });
  router.put('/exchange-rates', async (request, response) => { const context = await authorize(request, 'currencies.manage', true); const body = upsertCompanyExchangeRateRequestSchema.parse(request.body); response.json(exchangeRate(await companies.upsertExchangeRate(context, body))); });
  router.get('/exchange-rates/resolve', async (request, response) => { const context = await authorize(request, 'currencies.view', false); const query = z.object({ currencyId: id, rateDate: date }).parse(request.query); const value = await companies.resolveExchangeRate(context, query.currencyId, query.rateDate); response.json({ rate: value.rate.toFixed(8), rateDate: value.rateDate?.toISOString().slice(0, 10) ?? null, source: value.source }); });
  const errors: ErrorRequestHandler = (error, _request, response, next) => { if (error instanceof ZodError) { response.status(400).json({ type: 'about:blank', title: 'Validation failed', status: 400, code: 'VALIDATION_ERROR', errors: error.issues }); return; } if (error instanceof CompanyProfileError) { const status = error.reason === 'PROFILE_NOT_FOUND' ? 404 : error.reason === 'VERSION_CONFLICT' ? 409 : 422; response.status(status).json({ type: 'about:blank', title: 'Company profile operation failed', status, code: error.reason === 'VERSION_CONFLICT' ? 'VERSION_CONFLICT' : 'BUSINESS_RULE_VIOLATION', reason: error.reason }); return; } if (error instanceof CompanyCurrencyError) { const status = error.reason === 'CURRENCY_NOT_FOUND' ? 404 : error.reason === 'CURRENCY_CODE_EXISTS' ? 409 : 422; response.status(status).json({ type: 'about:blank', title: status === 409 ? 'Currency already exists' : 'Currency rule violation', status, code: status === 409 ? 'CONFLICT' : 'BUSINESS_RULE_VIOLATION', reason: error.reason }); return; } next(error); };
  router.use(errors);
  return router;
}
