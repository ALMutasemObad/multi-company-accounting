import express, { Router, type ErrorRequestHandler, type Request } from 'express';
import { z } from 'zod';
import { startSocialAuthRequestSchema } from '../generated/openapi-request-guards.js';
import { SocialAuthError, type SocialAuthService } from './social-auth-service.js';
import type { SocialProvider } from './social-auth-policy.js';

const providerSchema = z.enum(['google', 'apple']);
const callbackSchema = z.object({ code: z.string().min(1).max(4096).optional(), state: z.string().min(1).max(1024).optional(), error: z.string().max(200).optional(), user: z.string().max(4096).optional() }).strict();
const cookies = (header?: string) => Object.fromEntries((header ?? '').split(';').map((part) => part.trim().split('=', 2)).filter(([key, value]) => key && value));
const metadata = (request: Request) => ({ ipAddress: request.ip?.slice(0, 64), userAgent: request.get('user-agent')?.slice(0, 500) });
const providerOf = (value: string): SocialProvider => value === 'google' ? 'GOOGLE' : 'APPLE';

export function createSocialAuthRouter(service: SocialAuthService, secureSessionCookie: boolean) {
  const router = Router();
  const sidCookie = (sid: string, expires: Date) => `sid=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}${secureSessionCookie ? '; Secure' : ''}`;
  const bindingName = (provider: string) => `social_${provider}_binding`;
  const bindingCookie = (provider: string, value: string, expires: Date) => `${bindingName(provider)}=${encodeURIComponent(value)}; Path=/api/v1/auth/social/${provider}/callback; HttpOnly; SameSite=None; Secure; Expires=${expires.toUTCString()}`;
  const clearBinding = (provider: string) => `${bindingName(provider)}=; Path=/api/v1/auth/social/${provider}/callback; HttpOnly; SameSite=None; Secure; Max-Age=0`;

  router.get('/providers', (_request, response) => response.json(service.capabilities()));
  router.post('/:provider/start', async (request, response) => {
    const providerSlug = providerSchema.parse(request.params.provider);
    const body = startSocialAuthRequestSchema.parse(request.body);
    const sid = cookies(request.headers.cookie).sid;
    const csrfToken = request.header('X-CSRF-Token');
    const result = await service.start({ provider: providerOf(providerSlug), purpose: body.purpose, consent: body.consent, ...(body.returnPath ? { returnPath: body.returnPath } : {}), ...(sid ? { sid } : {}), ...(csrfToken ? { csrfToken } : {}) });
    response.setHeader('Set-Cookie', bindingCookie(providerSlug, result.browserBinding, result.expiresAt));
    response.json({ authorizationUrl: result.authorizationUrl, expiresAt: result.expiresAt.toISOString() });
  });

  const finish = async (providerSlug: 'google' | 'apple', request: Request, response: express.Response) => {
    const body = callbackSchema.parse(providerSlug === 'apple' ? request.body : request.query);
    const resultMarker = body.error ? 'cancelled' : 'error';
    if (body.error || !body.state || !body.code) { response.setHeader('Set-Cookie', clearBinding(providerSlug)); response.redirect(303, `/login?social=${resultMarker}`); return; }
    const callback = providerSlug === 'apple'
      ? new Request('https://callback.invalid/', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: body.code, state: body.state }) })
      : new URL(`https://callback.invalid/?code=${encodeURIComponent(body.code)}&state=${encodeURIComponent(body.state)}`);
    const browserBinding = cookies(request.headers.cookie)[bindingName(providerSlug)];
    const result = await service.callback({ provider: providerOf(providerSlug), state: body.state, ...(browserBinding ? { browserBinding } : {}), callback, ...(body.user ? { appleUser: body.user } : {}), metadata: metadata(request) });
    const headers = [clearBinding(providerSlug)];
    if (result.kind === 'signed_in' || result.kind === 'linked') headers.push(sidCookie(result.sid, result.expiresAt));
    response.setHeader('Set-Cookie', headers);
    const status = result.kind === 'signed_in' ? 'success' : result.kind === 'linked' ? 'linked' : result.kind;
    const separator = result.returnPath.includes('?') ? '&' : '?';
    response.redirect(303, `${result.returnPath}${separator}social=${status}`);
  };
  const safeFinish = async (provider: 'google' | 'apple', request: Request, response: express.Response) => {
    try { await finish(provider, request, response); }
    catch {
      response.setHeader('Set-Cookie', clearBinding(provider));
      response.redirect(303, '/login?social=error');
    }
  };
  router.get('/google/callback', (request, response) => safeFinish('google', request, response));
  router.post('/apple/callback', express.urlencoded({ extended: false, limit: '16kb', parameterLimit: 8 }), (request, response) => safeFinish('apple', request, response));

  const errors: ErrorRequestHandler = (error, _request, response, next) => {
    if (!(error instanceof SocialAuthError)) { next(error); return; }
    const status = error.code === 'PROVIDER_DISABLED' ? 404 : error.code === 'AUTHENTICATION_REQUIRED' ? 401 : error.code === 'IDENTITY_CONFLICT' ? 409 : 403;
    response.status(status).json({ type: 'about:blank', title: 'Social authentication failed', status, code: error.code });
  };
  router.use(errors);
  return router;
}
