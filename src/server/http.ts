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
  rateLimitMode?: 'normal' | 'none';
  customHeaders?: Record<string, string>;
  successOnlyHeaders?: Record<string, string>;
  successStatus?: number;
  afterCommit?: (result: unknown, meta: { requestId: string; userId: string; timestamp: string }) => void | Promise<void>;
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
  const commonHeaders: Record<string, string> = {
    'Cache-Control': 'no-store',
    'X-Request-Id': requestId,
    Vary: 'Cookie',
    ...(options?.customHeaders ?? {}),
  };
  // Defensive: ensure common headers do not contain Set-Cookie
  delete commonHeaders['Set-Cookie'];
  delete commonHeaders['set-cookie'];

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

    // Rate-limiting check in separate isolated transaction to ensure counts persist even on error
    const rateLimitMode = options?.rateLimitMode ?? 'normal';
    if (rateLimitMode !== 'none') {
      const businessScope = options?.rateLimitScope;
      const allowed = await transaction(async c => {
        const user = await authenticate(c, hash);
        authenticatedUserId = user;
        // Stacked rate limits: every authenticated request consumes 'global'
        const globalAllowed = await rateLimit(c, user, 'global');
        if (!globalAllowed) {
          return false;
        }
        // Mutating or sensitive operations also consume their specific business scope
        if (businessScope && businessScope !== 'global') {
          const businessAllowed = await rateLimit(c, user, businessScope);
          if (!businessAllowed) {
            return false;
          }
        }
        return true;
      });

      if (!allowed) {
        throw new ApiError(429, 'RATE_LIMITED');
      }
    }

    // Read bounded input outside DB transaction so a slow client cannot exhaust DB pool slots
    const input = req.method === 'POST' ? await body(req) : undefined;

    // Execute business mutation with row-locking on active session if mutating
    const result = await transaction(async c => {
      const user = await authenticate(c, hash, { forMutation: isMutation });
      authenticatedUserId = user;
      return run(c, user, { requestId, hash, input });
    });

    // Execute post-commit hook strictly after successful transaction commit
    if (options?.afterCommit && authenticatedUserId) {
      try {
        await options.afterCommit(result, { requestId, userId: authenticatedUserId, timestamp });
      } catch (logErr) {
        // Operational logging failure AFTER COMMIT must NOT cause client retry
        console.error('Post-commit hook error:', logErr);
      }
    }

    const status = options?.successStatus ?? (req.method === 'POST' ? 201 : 200);
    const successHeaders: Record<string, string> = {
      ...commonHeaders,
      ...(options?.successOnlyHeaders ?? {}),
    };

    return Response.json(
      { success: true, data: result },
      { status, headers: successHeaders }
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
    } else if (errorCode === 'WALLET_LIMIT_REACHED' || errorCode === 'TRANSFER_DAILY_LIMIT_REACHED') {
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

    const errorHeaders: Record<string, string> = {
      ...commonHeaders,
      ...(status === 429 ? { 'Retry-After': '60' } : {}),
    };
    delete errorHeaders['Set-Cookie'];
    delete errorHeaders['set-cookie'];

    return Response.json(
      { success: false, code: errorCode, requestId },
      {
        status,
        headers: errorHeaders,
      }
    );
  }
}
