import { Router, type ErrorRequestHandler, type Request } from 'express';
import { z, ZodError } from 'zod';
import type { AuthService } from '../auth/auth-service.js';
import { FiscalError, FiscalService } from './fiscal-service.js';

const id = z.string().regex(/^[1-9][0-9]*$/).transform(BigInt);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const periodInput = z.object({ periodNumber: z.number().int().min(1).max(255), name: z.string().trim().min(1).max(80), startDate: isoDate, endDate: isoDate }).strict();
const createYear = z.object({ name: z.string().trim().min(1).max(80), startDate: isoDate, endDate: isoDate, periods: z.array(periodInput).min(1) }).strict();
const updateYear = z.object({ name: z.string().trim().min(1).max(80).optional(), startDate: isoDate.optional(), endDate: isoDate.optional() }).strict().refine((value) => Object.keys(value).length > 0);
const updatePeriod = z.object({ name: z.string().trim().min(1).max(80).optional(), startDate: isoDate.optional(), endDate: isoDate.optional(), version: z.number().int().min(0) }).strict();
const closePeriod = z.object({ version: z.number().int().min(0), reviewConfirmed: z.literal(true), requirePeriodCloseDocument: z.boolean().default(false) }).strict();
const reopenPeriod = z.object({ version: z.number().int().min(0), reason: z.string().trim().min(10).max(500) }).strict();
const pagination = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) });
const periodQuery = pagination.extend({ status: z.enum(['OPEN', 'CLOSED', 'REOPENED']).optional() });

function sid(request: Request) { return Object.fromEntries((request.headers.cookie ?? '').split(';').map((part) => part.trim().split('=', 2)).filter(([key, value]) => key && value)).sid; }
function serializeYear(year: any) { return { id: year.id.toString(), name: year.name, startDate: year.startDate.toISOString().slice(0, 10), endDate: year.endDate.toISOString().slice(0, 10), status: year.status, ...(year.periods ? { periods: year.periods.map(FiscalService.serializePeriod) } : {}) }; }

export function createFiscalRouter(auth: AuthService, fiscal: FiscalService) {
  const router = Router();
  const authorize = (request: Request, permission: string, requireCsrf: boolean) => auth.authorize({ sid: sid(request), csrfToken: request.header('X-CSRF-Token') ?? undefined, permission, requireCsrf });
  router.get('/fiscal-years', async (request, response) => { const context = await authorize(request, 'fiscal_periods.view', false); const page = pagination.parse(request.query); const result = await fiscal.listYears(context, page.page, page.pageSize); response.json({ data: result.data.map(serializeYear), meta: { ...page, total: result.total, totalPages: Math.ceil(result.total / page.pageSize) } }); });
  router.post('/fiscal-years', async (request, response) => { const context = await authorize(request, 'fiscal_periods.manage', true); response.status(201).json(serializeYear(await fiscal.createYear(context, createYear.parse(request.body)))); });
  router.get('/fiscal-years/:fiscalYearId', async (request, response) => { const context = await authorize(request, 'fiscal_periods.view', false); response.json(serializeYear(await fiscal.getYear(context, id.parse(request.params.fiscalYearId)))); });
  router.patch('/fiscal-years/:fiscalYearId', async (request, response) => { const context = await authorize(request, 'fiscal_periods.manage', true); response.json(serializeYear(await fiscal.updateYear(context, id.parse(request.params.fiscalYearId), updateYear.parse(request.body)))); });
  router.get('/fiscal-periods', async (request, response) => { const context = await authorize(request, 'fiscal_periods.view', false); const query = periodQuery.parse(request.query); const result = await fiscal.listPeriods(context, query); response.json({ data: result.data.map(FiscalService.serializePeriod), meta: { page: query.page, pageSize: query.pageSize, total: result.total, totalPages: Math.ceil(result.total / query.pageSize) } }); });
  router.get('/fiscal-periods/:periodId', async (request, response) => { const context = await authorize(request, 'fiscal_periods.view', false); response.json(FiscalService.serializePeriod(await fiscal.getPeriod(context, id.parse(request.params.periodId)))); });
  router.patch('/fiscal-periods/:periodId', async (request, response) => { const context = await authorize(request, 'fiscal_periods.manage', true); response.json(FiscalService.serializePeriod(await fiscal.updatePeriod(context, id.parse(request.params.periodId), updatePeriod.parse(request.body)))); });
  router.post('/fiscal-periods/:periodId/close', async (request, response) => { const context = await authorize(request, 'fiscal_periods.close', true); const body = closePeriod.parse(request.body); const key = z.string().min(8).max(200).parse(request.header('Idempotency-Key')); response.json(await fiscal.closePeriod(context, id.parse(request.params.periodId), { version: body.version, reviewConfirmed: true, requirePeriodCloseDocument: body.requirePeriodCloseDocument, idempotencyKey: key })); });
  router.post('/fiscal-periods/:periodId/reopen', async (request, response) => { const context = await authorize(request, 'fiscal_periods.reopen', true); const body = reopenPeriod.parse(request.body); const key = z.string().min(8).max(200).parse(request.header('Idempotency-Key')); response.json(await fiscal.reopenPeriod(context, id.parse(request.params.periodId), { ...body, idempotencyKey: key })); });
  const errors: ErrorRequestHandler = (error, _request, response, next) => { if (error instanceof ZodError) { response.status(400).json({ status: 400, code: 'VALIDATION_ERROR', errors: error.issues }); return; } if (error instanceof FiscalError) { const status = error.reason === 'NOT_FOUND' ? 404 : ['VERSION_CONFLICT', 'IDEMPOTENCY_MISMATCH', 'IDEMPOTENCY_IN_PROGRESS'].includes(error.reason) ? 409 : 422; response.status(status).json({ status, code: 'BUSINESS_RULE_VIOLATION', reason: error.reason }); return; } next(error); };
  router.use(errors); return router;
}
