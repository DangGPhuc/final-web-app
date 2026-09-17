import 'server-only';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { transaction } from './database';
import { authenticate, checkMutationOrigin, sessionHash } from './session';
import { rateLimit } from './repository';
import type { RateLimitScope } from './repository';
import { ApiError } from './errors';
import { readBoundedJsonBody } from '@/lib/api-guard';
import { logSecurityEvent } from './logger';

export interface RouteContext {
  requestId: string;
  hash: string;
  input?: Record<string, unknown>;
}

export interface HandleOptions {
  rateLimitScope?: RateLimitScope;
  customHeaders?: Record<string, string>;
}

export async function body(req: Request) {
  const result = await readBoundedJsonBody(req, 4096);
  if (!result.ok) throw new ApiError(result.status, 'INVALID_BODY');
  return result.data;
}

export async function handle(
  req: Request,
  run: (c: PoolClient, user: string, context: RouteContext) => Promise<unknown>,
  options?: HandleOptions
) {
  const requestId = randomUUID();
  const timestamp = new Date().toISOString();
  const headers: Record<string, string> = {
    'Cache-Control': 'no-store',
    'X-Request-Id': requestId,
    Vary: 'Cookie',
    ...(options?.customHeaders ?? {}),
  };

  let authenticatedUserId: string | undefined;

  try {
    if (process.env.ENABLE_BACKEND_API !== 'true') {
      throw new ApiError(503, 'BACKEND_DISABLED');
    }

    const isMutation = !['GET', 'HEAD'].includes(req.method);
    if (isMutation) {
      checkMutationOrigin(req);
    }

    const hash = sessionHash(req);

    // Rate-limiting check in separate isolated transaction to ensure rate-limiting counts persist even on error
    const scope = options?.rateLimitScope ?? 'global';
    const allowed = await transaction(async c => {
      const user = await authenticate(c, hash);
      authenticatedUserId = user;
      return rateLimit(c, user, scope);
    });

    if (!allowed) {
      throw new ApiError(429, 'RATE_LIMITED');
    }

    // Read bounded input outside DB transaction so a slow client cannot exhaust DB pool slots
    const input = req.method === 'POST' ? await body(req) : undefined;

    // Execute business mutation with row-locking on active session if mutating
    const result = await transaction(async c => {
      const user = await authenticate(c, hash, { forMutation: isMutation });
      authenticatedUserId = user;
      return run(c, user, { requestId, hash, input });
    });

    return Response.json(
      { success: true, data: result },
      { status: req.method === 'POST' ? 201 : 200, headers }
    );
  } catch (error) {
    const known = error instanceof ApiError;
    const errorCode = known ? error.code : 'SERVICE_UNAVAILABLE';
    const status = known ? error.status : 503;

    // Structured security logging for security-relevant outcomes
    if (errorCode === 'UNAUTHENTICATED') {
      logSecurityEvent({ event: 'SECURITY_UNAUTHENTICATED', requestId, errorCode, timestamp });
    } else if (errorCode === 'INVALID_ORIGIN') {
      logSecurityEvent({ event: 'SECURITY_INVALID_ORIGIN', requestId, errorCode, timestamp });
    } else if (errorCode === 'CROSS_SITE_REQUEST') {
      logSecurityEvent({ event: 'SECURITY_CROSS_SITE_REQUEST', requestId, errorCode, timestamp });
    } else if (errorCode === 'RATE_LIMITED') {
      logSecurityEvent({
        event: 'SECURITY_RATE_LIMITED',
        requestId,
        errorCode,
        timestamp,
        userId: authenticatedUserId,
      });
    } else if (errorCode === 'WALLET_NOT_FOUND') {
      logSecurityEvent({
        event: 'SECURITY_BOLA_DENIED',
        requestId,
        errorCode,
        timestamp,
        userId: authenticatedUserId,
      });
    } else if (errorCode === 'WALLET_LIMIT_REACHED') {
      logSecurityEvent({
        event: 'SECURITY_QUOTA_EXCEEDED',
        requestId,
        errorCode,
        timestamp,
        userId: authenticatedUserId,
      });
    } else if (!known) {
      logSecurityEvent({
        event: 'SECURITY_UNEXPECTED_FAILURE',
        requestId,
        errorCode: 'INTERNAL_ERROR',
        timestamp,
      });
    }

    return Response.json(
      { success: false, code: errorCode, requestId },
      {
        status,
        headers: {
          ...headers,
          ...(status === 429 ? { 'Retry-After': '60' } : {}),
        },
      }
    );
  }
}
