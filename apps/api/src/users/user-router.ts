import { Router, type ErrorRequestHandler, type Request } from 'express';
import { z, ZodError } from 'zod';
import type { AuthService } from '../auth/auth-service.js';
import { openApiRequestBodySchemas as bodies } from '../generated/openapi-request-guards.js';
import type { UserService } from './user-service.js';
import { UserManagementError } from './user-service.js';

const idSchema = z.string().regex(/^[1-9][0-9]*$/).transform(BigInt);
const paginationSchema = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25), search: z.string().max(200).optional(), status: z.enum(['ACTIVE', 'LOCKED', 'DISABLED']).optional() });

function sid(request: Request) {
  const entries = (request.headers.cookie ?? '').split(';').map((part) => part.trim().split('=', 2)).filter(([key, value]) => key && value);
  return Object.fromEntries(entries).sid;
}

function serializeUser(user: { id: bigint; emailNormalized: string; displayName: string; nameEn: string | null; isActive: boolean; lockedUntil: Date | null; lastLoginAt: Date | null; createdAt: Date; updatedAt: Date }) {
  const status = !user.isActive ? 'DISABLED' : user.lockedUntil && user.lockedUntil > new Date() ? 'LOCKED' : 'ACTIVE';
  return { id: user.id.toString(), email: user.emailNormalized, nameAr: user.displayName, nameEn: user.nameEn, status, lastLoginAt: user.lastLoginAt?.toISOString() ?? null, createdAt: user.createdAt.toISOString(), updatedAt: user.updatedAt.toISOString() };
}

function serializeRole(role: { id: bigint; code: string; nameAr: string; nameEn: string | null; isSystemRole: boolean; isActive: boolean; permissions: Array<{ permission: { id: bigint; code: string } }>; _count: { assignments: number } }) {
  return { id: role.id.toString(), code: role.code, nameAr: role.nameAr, nameEn: role.nameEn, isSystemRole: role.isSystemRole, isActive: role.isActive, assignedUsers: role._count.assignments, permissionIds: role.permissions.map((item) => item.permission.id.toString()), permissions: role.permissions.map((item) => item.permission.code) };
}

export function createUserRouter(auth: AuthService, users: UserService) {
  const router = Router();
  const authorize = (request: Request, permission: string, requireCsrf: boolean) => auth.authorize({ sid: sid(request), csrfToken: request.header('X-CSRF-Token') ?? undefined, permission, requireCsrf });

  router.get('/users', async (request, response) => {
    const context = await authorize(request, 'users.view', false);
    const page = paginationSchema.parse(request.query);
    const result = await users.list(context, page);
    response.json({ data: result.data.map(serializeUser), meta: { page: page.page, pageSize: page.pageSize, total: result.total, totalPages: Math.ceil(result.total / page.pageSize) } });
  });
  router.post('/users', async (request, response) => {
    const context = await authorize(request, 'users.create', true);
    response.status(201).json(serializeUser(await users.create(context, bodies.createUser.parse(request.body))));
  });
  router.get('/users/:userId', async (request, response) => {
    const context = await authorize(request, 'users.view', false);
    response.json(serializeUser(await users.get(context, idSchema.parse(request.params.userId))));
  });
  router.patch('/users/:userId', async (request, response) => {
    const context = await authorize(request, 'users.update', true);
    response.json(serializeUser(await users.update(context, idSchema.parse(request.params.userId), bodies.updateUser.parse(request.body))));
  });
  router.post('/users/:userId/disable', async (request, response) => {
    const context = await authorize(request, 'users.disable', true);
    response.json(serializeUser(await users.disable(context, idSchema.parse(request.params.userId), bodies.disableUser.parse(request.body).reason)));
  });
  router.get('/users/:userId/roles', async (request, response) => {
    const context = await authorize(request, 'roles.view', false);
    const data = await users.roles(context, idSchema.parse(request.params.userId));
    response.json({ data: data.map((item) => ({ roleId: item.roleId.toString(), roleCode: item.role.code, isActive: item.role.isActive, assignedAt: item.createdAt.toISOString() })) });
  });
  router.put('/users/:userId/roles', async (request, response) => {
    const context = await authorize(request, 'roles.manage', true);
    const body = bodies.replaceUserRoles.parse(request.body);
    const data = await users.replaceRoles(context, idSchema.parse(request.params.userId), body.roleIds);
    response.json({ data: data.map((item) => ({ roleId: item.roleId.toString(), roleCode: item.role.code, isActive: item.role.isActive, assignedAt: item.createdAt.toISOString() })) });
  });
  router.get('/roles', async (request, response) => {
    const context = await authorize(request, 'roles.view', false);
    const data = await users.listRoles(context);
    response.json({ data: data.map(serializeRole) });
  });
  router.post('/roles', async (request, response) => {
    const context = await authorize(request, 'roles.manage', true);
    const body = bodies.createRole.parse(request.body);
    response.status(201).json(serializeRole(await users.createRole(context, body)));
  });
  router.patch('/roles/:roleId', async (request, response) => {
    const context = await authorize(request, 'roles.manage', true);
    response.json(serializeRole(await users.updateRole(context, idSchema.parse(request.params.roleId), bodies.updateRole.parse(request.body))));
  });
  router.put('/roles/:roleId/permissions', async (request, response) => {
    const context = await authorize(request, 'roles.manage', true);
    const body = bodies.replaceRolePermissions.parse(request.body);
    response.json(serializeRole(await users.replaceRolePermissions(context, idSchema.parse(request.params.roleId), body.permissionIds)));
  });
  router.post('/roles/:roleId/deactivate', async (request, response) => {
    const context = await authorize(request, 'roles.manage', true);
    response.json(serializeRole(await users.deactivateRole(context, idSchema.parse(request.params.roleId), bodies.deactivateRole.parse(request.body).reason)));
  });
  router.get('/permissions', async (request, response) => {
    await authorize(request, 'roles.view', false);
    const data = await users.listPermissions();
    response.json({ data: data.map((permission) => ({ id: permission.id.toString(), code: permission.code, module: permission.module, descriptionAr: permission.descriptionAr })) });
  });

  const errors: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof ZodError) { response.status(400).json({ type: 'about:blank', title: 'Validation failed', status: 400, code: 'VALIDATION_ERROR', errors: error.issues }); return; }
    if (error instanceof UserManagementError) {
      const status = error.reason === 'NOT_FOUND' ? 404 : error.reason === 'EMAIL_EXISTS' || error.reason === 'ROLE_CODE_EXISTS' ? 409 : 422;
      response.status(status).json({ type: 'about:blank', title: 'User management failed', status, code: error.reason }); return;
    }
    next(error);
  };
  router.use(errors);
  return router;
}
