import type { Account, AccountType, CostCenter } from '@prisma/client';
import { Router, type ErrorRequestHandler, type Request } from 'express';
import { z, ZodError } from 'zod';
import type { AuthService } from '../auth/auth-service.js';
import { openApiRequestBodySchemas as bodies } from '../generated/openapi-request-guards.js';
import { AccountError, AccountService } from './account-service.js';
import { readWithPosContext } from '../platform/pos-request-context.js';

const id = z.string().regex(/^[1-9][0-9]*$/).transform(BigInt);
const pagination = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25), search: z.string().trim().min(1).max(200).optional() });
const booleanQuery = z.enum(['true', 'false']).transform((value) => value === 'true');
const accountClasses = z.string().transform((value) => value.split(',')).pipe(
  z.array(z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'])).min(1).max(5),
);
const accountQuery = pagination.extend({
  parentId: id.optional(),
  active: booleanQuery.optional(),
  allowsPosting: booleanQuery.optional(),
  accountClasses: accountClasses.optional(),
});
const costCenterQuery = pagination.extend({ active: booleanQuery.optional() });
function sid(request: Request) { return Object.fromEntries((request.headers.cookie ?? '').split(';').map((part) => part.trim().split('=', 2)).filter(([key, value]) => key && value)).sid; }
const accountJson = (v: Account) => ({ id: v.id.toString(), accountTypeId: v.accountTypeId.toString(), parentAccountId: v.parentAccountId?.toString() ?? null, code: v.code, nameAr: v.nameAr, nameEn: v.nameEn, level: v.level, allowsPosting: v.allowsPosting, isControlAccount: v.isControlAccount, isActive: v.isActive, sourceTemplateCode: v.sourceTemplateCode ?? null, sourceTemplateKey: v.sourceTemplateKey ?? null });
const typeJson = (v: AccountType) => ({ id: v.id.toString(), code: v.code, nameAr: v.nameAr, class: v.class, normalBalance: v.normalBalance, statementSection: v.statementSection });
const centerJson = (v: CostCenter) => ({ id: v.id.toString(), parentId: v.parentId?.toString() ?? null, code: v.code, nameAr: v.nameAr, nameEn: v.nameEn, isActive: v.isActive });

export function createAccountRouter(auth: AuthService, service: AccountService) {
  const router = Router(); const authorize = (req: Request, permission: string, csrf: boolean) => auth.authorize({ sid: sid(req), csrfToken: req.header('X-CSRF-Token') ?? undefined, permission, requireCsrf: csrf });
  router.get('/account-types', async (req, res) => { await authorize(req, 'accounts.view', false); res.json({ data: (await service.listTypes()).map(typeJson) }); });
  router.get('/accounts', async (req, res) => { res.json(await readWithPosContext(req, () => authorize(req, 'accounts.view', false), async context => {
    const q = accountQuery.parse(req.query); const result = await service.listAccounts(context, q);
    return { data: result.data.map(accountJson), meta: { page: q.page, pageSize: q.pageSize, total: result.total, totalPages: Math.ceil(result.total / q.pageSize) } };
  })); });
  router.post('/accounts', async (req, res) => { const context = await authorize(req, 'accounts.create', true); res.status(201).json(accountJson(await service.createAccount(context, bodies.createAccount.parse(req.body)))); });
  router.get('/accounts/default-template', async (req, res) => { const context = await authorize(req, 'accounts.view', false); res.json(await service.getDefaultTemplateStatus(context)); });
  router.post('/accounts/default-template/apply', async (req, res) => { const context = await authorize(req, 'accounts.template.apply', true); res.json(await service.applyDefaultTemplate(context)); });
  router.get('/accounts/:accountId', async (req, res) => { const context = await authorize(req, 'accounts.view', false); res.json(accountJson(await service.getAccount(context, id.parse(req.params.accountId)))); });
  router.patch('/accounts/:accountId', async (req, res) => { const context = await authorize(req, 'accounts.update', true); res.json(accountJson(await service.updateAccount(context, id.parse(req.params.accountId), bodies.updateAccount.parse(req.body)))); });
  router.post('/accounts/:accountId/deactivate', async (req, res) => { const context = await authorize(req, 'accounts.deactivate', true); const body = bodies.deactivateAccount.parse(req.body); res.json(accountJson(await service.deactivateAccount(context, id.parse(req.params.accountId), body.reason))); });
  router.delete('/accounts/:accountId', async (req, res) => { const context = await authorize(req, 'accounts.delete', true); const body = bodies.deleteAccount.parse(req.body); res.json(await service.deleteAccount(context, id.parse(req.params.accountId), body.reason)); });
  router.get('/cost-centers', async (req, res) => { const context = await authorize(req, 'cost_centers.manage', false); const q = costCenterQuery.parse(req.query); const result = await service.listCostCenters(context, q); res.json({ data: result.data.map(centerJson), meta: { page: q.page, pageSize: q.pageSize, total: result.total, totalPages: Math.ceil(result.total / q.pageSize) } }); });
  router.post('/cost-centers', async (req, res) => { const context = await authorize(req, 'cost_centers.manage', true); res.status(201).json(centerJson(await service.createCostCenter(context, bodies.createCostCenter.parse(req.body)))); });
  router.get('/cost-centers/:costCenterId', async (req, res) => { const context = await authorize(req, 'cost_centers.manage', false); res.json(centerJson(await service.getCostCenter(context, id.parse(req.params.costCenterId)))); });
  router.patch('/cost-centers/:costCenterId', async (req, res) => { const context = await authorize(req, 'cost_centers.manage', true); res.json(centerJson(await service.updateCostCenter(context, id.parse(req.params.costCenterId), bodies.updateCostCenter.parse(req.body)))); });
  router.post('/cost-centers/:costCenterId/deactivate', async (req, res) => { const context = await authorize(req, 'cost_centers.manage', true); const body = bodies.deactivateCostCenter.parse(req.body); res.json(centerJson(await service.deactivateCostCenter(context, id.parse(req.params.costCenterId), body.reason))); });
  const errors: ErrorRequestHandler = (error, _req, res, next) => { if (error instanceof ZodError) { res.status(400).json({ status: 400, code: 'VALIDATION_ERROR', errors: error.issues }); return; } if (error instanceof AccountError) { const status = error.reason === 'NOT_FOUND' ? 404 : ['CODE_EXISTS', 'ACCOUNT_IN_USE', 'TEMPLATE_CONFLICT'].includes(error.reason) ? 409 : 422; res.status(status).json({ status, code: 'BUSINESS_RULE_VIOLATION', reason: error.reason }); return; } next(error); }; router.use(errors); return router;
}
