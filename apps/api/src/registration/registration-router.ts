import { Router, type ErrorRequestHandler, type Request } from 'express';
import {
  resendSelfRegistrationVerificationRequestSchema,
  startSelfRegistrationRequestSchema,
  verifySelfRegistrationRequestSchema,
} from '../generated/openapi-request-guards.js';
import type { AuthService } from '../auth/auth-service.js';
import { RegistrationError, type RegistrationService } from './registration-service.js';

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

export function createRegistrationRouter(auth: AuthService, registration: RegistrationService) {
  const router = Router();

  router.get('/options', async (_request, response) => {
    response.json(await registration.options());
  });

  router.post('/', async (request, response) => {
    await requirePreAuth(auth, request);
    const body = startSelfRegistrationRequestSchema.parse(request.body);
    response.status(202).json(await registration.start(body, metadata(request)));
  });

  router.post('/resend', async (request, response) => {
    await requirePreAuth(auth, request);
    const body = resendSelfRegistrationVerificationRequestSchema.parse(request.body);
    response.status(202).json(await registration.resend(body.email, metadata(request)));
  });

  router.post('/verify', async (request, response) => {
    await requirePreAuth(auth, request);
    const body = verifySelfRegistrationRequestSchema.parse(request.body);
    const result = await registration.verify(body.token, metadata(request));
    response.status(result.status === 'COMPLETED' ? 201 : 202).json(result);
  });

  const errorHandler: ErrorRequestHandler = (error, _request, response, next) => {
    if (!(error instanceof RegistrationError)) {
      next(error);
      return;
    }
    const status = error.reason === 'INVALID_OR_EXPIRED_TOKEN' || error.reason === 'INVALID_OPTION'
      ? 400
      : error.reason === 'REGISTRATION_CONFLICT' ? 409 : 503;
    const code = error.reason === 'INVALID_OR_EXPIRED_TOKEN'
      ? 'REGISTRATION_TOKEN_INVALID'
      : error.reason;
    response.status(status).json({ type: 'about:blank', title: 'Registration failed', status, code, requestId: response.locals.requestId });
  };
  router.use(errorHandler);
  return router;
}
