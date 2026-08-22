import { Router, type ErrorRequestHandler, type Request } from 'express';
import type { AuthService } from './auth-service.js';
import {
  completePasswordResetRequestSchema,
  startPasswordResetRequestSchema,
} from '../generated/openapi-request-guards.js';
import { PasswordResetError, type PasswordResetService } from './password-reset-service.js';

function cookies(header: string | undefined) {
  return Object.fromEntries((header ?? '').split(';').map((part) => part.trim().split('=', 2)).filter(([key, value]) => key && value));
}

const metadata = (request: Request) => ({
  ...(request.ip ? { ipAddress: request.ip.slice(0, 64) } : {}),
  ...(request.get('user-agent') ? { userAgent: request.get('user-agent')!.slice(0, 500) } : {}),
});

async function requirePreAuth(auth: AuthService, request: Request) {
  await auth.validatePreAuth({
    sid: cookies(request.headers.cookie).sid,
    csrfToken: request.header('X-CSRF-Token') ?? undefined,
  });
}

export function createPasswordResetRouter(auth: AuthService, service: PasswordResetService) {
  const router = Router();

  router.post('/forgot', async (request, response) => {
    await requirePreAuth(auth, request);
    const body = startPasswordResetRequestSchema.parse(request.body);
    response.status(202).json(await service.requestReset(body, metadata(request)));
  });

  router.post('/reset', async (request, response) => {
    await requirePreAuth(auth, request);
    const body = completePasswordResetRequestSchema.parse(request.body);
    await service.resetPassword(body, metadata(request));
    response.status(204).end();
  });

  const errorHandler: ErrorRequestHandler = (error, _request, response, next) => {
    if (!(error instanceof PasswordResetError)) {
      next(error);
      return;
    }
    response.status(400).json({
      type: 'about:blank',
      title: 'Password reset failed',
      status: 400,
      code: 'PASSWORD_RESET_TOKEN_INVALID',
      requestId: response.locals.requestId,
    });
  };
  router.use(errorHandler);
  return router;
}
