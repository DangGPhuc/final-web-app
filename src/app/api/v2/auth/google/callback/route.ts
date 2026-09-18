import { NextResponse } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import { authTransaction } from '@/server/auth-database';
import { consumeOAuthState, findOrCreateUserFromIdentity } from '@/server/auth-repository';
import {
  exchangeAndVerifyGoogleOidc,
  validateRedirectPath,
  extractOAuthBinder,
  hashOAuthBinder,
  clearOAuthBinderCookieHeader,
  getCanonicalAppOrigin,
} from '@/server/oidc';
import {
  issueSession,
  createSessionCookieHeader,
  revokeExistingSessionIfPresent,
  SESSION_MAX_AGE_SECONDS,
} from '@/server/session';
import { logSecurityEvent } from '@/server/logger';
import { ApiError } from '@/server/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const requestId = randomUUID();
  const timestamp = new Date().toISOString();
  const url = new URL(req.url);

  // 1. Extract and validate browser binder cookie
  const rawBinder = extractOAuthBinder(req);

  // 2. Handle provider-level errors returned by Google
  const providerError = url.searchParams.get('error');
  if (providerError) {
    const state = url.searchParams.get('state');
    if (state && rawBinder) {
      try {
        const stateHash = createHash('sha256').update(state).digest('hex');
        const binderHash = hashOAuthBinder(rawBinder);
        // Atomically consume state on provider denial to prevent leaving stale active state
        await authTransaction(async (client) => {
          await consumeOAuthState(client, stateHash, binderHash);
        });
      } catch {
        // If state or binder validation fails, proceed to reject
      }
    }

    logSecurityEvent({
      event: 'AUTH_LOGIN_FAILED',
      requestId,
      errorCode: 'AUTH_PROVIDER_REJECTED',
      provider: 'google',
      timestamp,
    });

    const res = NextResponse.json(
      { error: 'AUTH_PROVIDER_REJECTED', requestId },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
    res.headers.set('Set-Cookie', clearOAuthBinderCookieHeader());
    return res;
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code || !state || !rawBinder) {
    logSecurityEvent({
      event: 'AUTH_LOGIN_FAILED',
      requestId,
      errorCode: 'AUTH_STATE_INVALID',
      provider: 'google',
      timestamp,
    });
    const res = NextResponse.json(
      { error: 'AUTH_STATE_INVALID', requestId },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
    res.headers.set('Set-Cookie', clearOAuthBinderCookieHeader());
    return res;
  }

  const stateHash = createHash('sha256').update(state).digest('hex');
  const binderHash = hashOAuthBinder(rawBinder);

  try {
    // ========================================================================
    // PHASE A — SHORT DB TRANSACTION
    // Atomically claim and consume OAuth state (validates state, binder, expiry, replay)
    // ========================================================================
    const stateRecord = await authTransaction(async (client) => {
      return consumeOAuthState(client, stateHash, binderHash);
    });

    // ========================================================================
    // PHASE B — NO DATABASE TRANSACTION
    // External Google OIDC token exchange & claim verification outside DB tx
    // ========================================================================
    const identityClaims = await exchangeAndVerifyGoogleOidc(url, {
      codeVerifier: stateRecord.codeVerifier,
      nonceHash: stateRecord.nonceHash,
    });

    // ========================================================================
    // PHASE C — SHORT DB TRANSACTION
    // Authoritative identity resolution, session revocation, and issuance
    // ========================================================================
    const sessionExpiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);

    const { rawToken, userId, maxAgeSeconds } = await authTransaction(async (client) => {
      // 1. Authoritative identity mapping (advisory lock + find/create user + server-generated UUID)
      const { userId } = await findOrCreateUserFromIdentity(client, identityClaims);

      // 2. Session fixation prevention: revoke any pre-existing session if present
      await revokeExistingSessionIfPresent(client, req);

      // 3. Issue fresh opaque FinTrack session with explicit expiration
      const { rawToken, maxAgeSeconds } = await issueSession(client, userId, sessionExpiresAt);

      return { rawToken, userId, maxAgeSeconds };
    });

    // Post-commit: emit security audit events with safe fields only
    logSecurityEvent({
      event: 'AUTH_LOGIN_SUCCEEDED',
      requestId,
      errorCode: 'OK',
      provider: 'google',
      userId,
      timestamp,
    });

    logSecurityEvent({
      event: 'AUTH_SESSION_ISSUED',
      requestId,
      errorCode: 'OK',
      provider: 'google',
      userId,
      timestamp,
    });

    // Redirect to canonical APP_ORIGIN (rejects poisoned Host / request origin)
    const canonicalOrigin = getCanonicalAppOrigin();
    const safeTarget = validateRedirectPath(stateRecord.redirectPath);
    const destination = new URL(safeTarget, canonicalOrigin);

    const res = NextResponse.redirect(destination.toString(), {
      status: 302,
      headers: {
        'Cache-Control': 'no-store',
      },
    });

    // Emit session cookie (Max-Age never outlives DB expires_at)
    res.headers.append('Set-Cookie', createSessionCookieHeader(rawToken, maxAgeSeconds));
    // Clear transient OAuth browser binder cookie
    res.headers.append('Set-Cookie', clearOAuthBinderCookieHeader());
    return res;
  } catch (err: unknown) {
    const errorCode =
      err instanceof ApiError
        ? err.code
        : 'AUTH_UNEXPECTED_FAILURE';
    const status = err instanceof ApiError ? err.status : 500;

    logSecurityEvent({
      event: 'AUTH_LOGIN_FAILED',
      requestId,
      errorCode,
      provider: 'google',
      timestamp,
    });

    const res = NextResponse.json(
      { error: errorCode, requestId },
      { status, headers: { 'Cache-Control': 'no-store' } }
    );
    res.headers.set('Set-Cookie', clearOAuthBinderCookieHeader());
    return res;
  }
}
