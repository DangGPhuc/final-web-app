import { NextResponse } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import { authTransaction } from '@/server/auth-database';
import { consumeOAuthState, findOrCreateUserFromIdentity } from '@/server/auth-repository';
import { exchangeAndVerifyGoogleOidc, validateRedirectPath } from '@/server/oidc';
import {
  issueSession,
  createSessionCookieHeader,
  revokeExistingSessionIfPresent,
} from '@/server/session';
import { logSecurityEvent } from '@/server/logger';
import { ApiError } from '@/server/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const requestId = randomUUID();
  const timestamp = new Date().toISOString();
  const url = new URL(req.url);

  // Check for provider-level errors returned in query params
  const providerError = url.searchParams.get('error');
  if (providerError) {
    logSecurityEvent({
      event: 'AUTH_LOGIN_FAILED',
      requestId,
      errorCode: 'AUTH_PROVIDER_REJECTED',
      provider: 'google',
      timestamp,
    });
    return NextResponse.json(
      { error: 'AUTH_PROVIDER_REJECTED', requestId },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code || !state) {
    logSecurityEvent({
      event: 'AUTH_LOGIN_FAILED',
      requestId,
      errorCode: 'AUTH_STATE_INVALID',
      provider: 'google',
      timestamp,
    });
    return NextResponse.json(
      { error: 'AUTH_STATE_INVALID', requestId },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const stateHash = createHash('sha256').update(state).digest('hex');

  try {
    const { rawToken, redirectPath, userId } = await authTransaction(async (client) => {
      // 1. Atomically consume OAuth state (guards against replay, expiry, tampering)
      const stateRecord = await consumeOAuthState(client, stateHash);

      // 2. Exchange authorization code & verify Google ID token using OIDC library
      const identityClaims = await exchangeAndVerifyGoogleOidc(url, {
        codeVerifier: stateRecord.codeVerifier,
        nonceHash: stateRecord.nonceHash,
      });

      // 3. Authoritative identity mapping (find or create user; never email-link)
      const { userId } = await findOrCreateUserFromIdentity(client, identityClaims);

      // 4. Session fixation prevention: revoke any pre-existing session if present
      await revokeExistingSessionIfPresent(client, req);

      // 5. Issue fresh opaque FinTrack session (24h absolute lifetime)
      const { rawToken } = await issueSession(client, userId);

      return {
        rawToken,
        redirectPath: stateRecord.redirectPath,
        userId,
      };
    });

    // 6. Emit security audit events strictly post-commit with safe fields only
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

    // 7. Secure redirect to validated relative path with HttpOnly session cookie
    const safeTarget = validateRedirectPath(redirectPath);
    const destination = new URL(safeTarget, url.origin);

    const res = NextResponse.redirect(destination.toString(), {
      status: 302,
      headers: {
        'Cache-Control': 'no-store',
      },
    });

    // Set __Host-fintrack_session cookie (Secure, HttpOnly, SameSite=Lax, Path=/, no Domain)
    res.headers.set('Set-Cookie', createSessionCookieHeader(rawToken));
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

    return NextResponse.json(
      { error: errorCode, requestId },
      { status, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
