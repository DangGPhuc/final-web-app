import { NextResponse } from 'next/server';
import { authTransaction } from '@/server/auth-database';
import { recordOAuthState } from '@/server/auth-repository';
import {
  generateOAuthParams,
  getGoogleOidcCredentials,
  buildGoogleAuthorizationUrl,
  validateRedirectPath,
  extractOAuthBinder,
  generateOAuthBinder,
  hashOAuthBinder,
  createOAuthBinderCookieHeader,
} from '@/server/oidc';
import { ApiError } from '@/server/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    // 1. Fetch Metadata defense against cross-site start abuse:
    // If Sec-Fetch-Site is present and not same-origin, reject the request.
    const secFetchSite = req.headers.get('sec-fetch-site')?.toLowerCase();
    if (secFetchSite && secFetchSite !== 'same-origin') {
      return NextResponse.json(
        { error: 'AUTH_FORBIDDEN' },
        { status: 403, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const url = new URL(req.url);
    const rawRedirectPath = url.searchParams.get('redirect_path');
    const validatedRedirect = validateRedirectPath(rawRedirectPath);

    // 2. Obtain existing valid browser binder or generate fresh 32-byte raw binder
    const existingBinder = extractOAuthBinder(req);
    const rawBinder = existingBinder ?? generateOAuthBinder().rawBinder;
    const browserBindHash = hashOAuthBinder(rawBinder);

    const {
      state,
      stateHash,
      codeVerifier,
      codeChallenge,
      nonce,
      nonceHash,
    } = await generateOAuthParams(validatedRedirect);

    // 3. Persist state hash and browser binder hash (invalidates any prior active attempt for this binder)
    await authTransaction(async (client) => {
      await recordOAuthState(client, {
        stateHash,
        browserBindHash,
        provider: 'google',
        codeVerifier,
        nonceHash,
        redirectPath: validatedRedirect,
      });
    });

    const { clientId, redirectUri } = getGoogleOidcCredentials();
    const authUrl = buildGoogleAuthorizationUrl({
      clientId,
      redirectUri,
      state,
      codeChallenge,
      nonce,
    });

    const res = NextResponse.redirect(authUrl, {
      status: 302,
      headers: {
        'Cache-Control': 'no-store',
      },
    });

    // 4. Set __Host-fintrack_oauth cookie (Secure, HttpOnly, SameSite=Lax, Path=/, NO Domain, Max-Age 600s)
    res.headers.set('Set-Cookie', createOAuthBinderCookieHeader(rawBinder));
    return res;
  } catch (err: unknown) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { error: err.code },
        { status: err.status, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    return NextResponse.json(
      { error: 'AUTH_UNAVAILABLE' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
