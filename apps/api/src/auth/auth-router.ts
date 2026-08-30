import { Router, type ErrorRequestHandler, type Request } from 'express';
import { z } from 'zod';
import { loginRequestSchema, selectCompanyContextRequestSchema } from '../generated/openapi-request-guards.js';
import type { AuthService } from './auth-service.js';
import { AuthError } from './auth-service.js';

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

function cookies(header: string | undefined) {
  return Object.fromEntries((header ?? '').split(';').map((part) => part.trim().split('=', 2)).filter(([key, value]) => key && value));
}
const metadata = (request: Request) => ({ ipAddress: request.ip?.slice(0, 64), userAgent: request.get('user-agent')?.slice(0, 500) });

export function createAuthRouter(auth: AuthService, secureCookie: boolean) {
  const router = Router();
  const cookie = (sid: string, expires: Date) => `sid=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}${secureCookie ? '; Secure' : ''}`;

  router.get('/csrf', async (_request, response) => {
    const result = await auth.issueCsrf();
    response.setHeader('Set-Cookie', cookie(result.sid, result.expiresAt));
    response.json({ csrfToken: result.csrfToken, expiresAt: result.expiresAt.toISOString() });
  });

  router.post('/login', async (request, response) => {
    const body = loginRequestSchema.parse(request.body);
    const result = await auth.login({
      sid: cookies(request.headers.cookie).sid,
      csrfToken: request.header('X-CSRF-Token') ?? undefined,
      metadata: metadata(request),
      ...body,
    });
    response.setHeader('Set-Cookie', cookie(result.sid, result.expiresAt));
    response.json({ user: result.user, csrfToken: result.csrfToken, expiresAt: result.expiresAt.toISOString() });
  });

  router.get('/companies', async (request, response) => {
    const companies = await auth.companies({ sid: cookies(request.headers.cookie).sid });
    response.json({ data: companies.map((company) => ({ ...company, id: company.id.toString() })) });
  });

  router.get('/me', async (request, response) => {
    const result = await auth.me({ sid: cookies(request.headers.cookie).sid });
    response.json({
      user: { ...result.user, id: result.user.id.toString() },
      selectedCompany: result.selectedCompany
        ? { ...result.selectedCompany, id: result.selectedCompany.id.toString() }
        : null,
      modules: result.modules,
      permissions: result.permissions,
    });
  });

  router.put('/context', async (request, response) => {
    const body = selectCompanyContextRequestSchema.parse(request.body);
    await auth.selectCompany({
      sid: cookies(request.headers.cookie).sid,
      csrfToken: request.header('X-CSRF-Token') ?? undefined,
      companyId: body.companyId,
      metadata: metadata(request),
    });
    response.status(204).end();
  });

  router.post('/logout', async (request, response) => {
    await auth.logout({ sid: cookies(request.headers.cookie).sid, csrfToken: request.header('X-CSRF-Token') ?? undefined, metadata: metadata(request) });
    response.setHeader('Set-Cookie', `sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookie ? '; Secure' : ''}`);
    response.status(204).end();
  });

  router.get('/sessions', async (request, response) => {
    const page = paginationSchema.parse(request.query);
    const result = await auth.sessions({ sid: cookies(request.headers.cookie).sid, ...page });
    response.json({
      data: result.data.map((session) => ({
        id: session.id.toString(),
        createdAt: session.createdAt.toISOString(),
        lastActivityAt: session.lastSeenAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
        current: session.id === result.currentSessionId,
        revoked: Boolean(session.revokedAt),
      })),
      meta: { page: page.page, pageSize: page.pageSize, total: result.total, totalPages: Math.ceil(result.total / page.pageSize) },
    });
  });

  router.post('/sessions/:sessionId/revoke', async (request, response) => {
    await auth.revokeSession({
      sid: cookies(request.headers.cookie).sid,
      csrfToken: request.header('X-CSRF-Token') ?? undefined,
      sessionId: z.string().regex(/^[1-9][0-9]*$/).parse(request.params.sessionId),
      metadata: metadata(request),
    });
    response.status(204).end();
  });

  const errorHandler: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof AuthError) {
      const status = error.reason === 'FORBIDDEN' ? 403 : error.reason === 'INVALID_CSRF' ? 403 : 401;
      response.status(status).json({ type: 'about:blank', title: 'Authentication failed', status, code: error.reason });
      return;
    }
    next(error);
  };
  router.use(errorHandler);
  return router;
}
