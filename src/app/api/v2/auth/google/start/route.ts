import { NextResponse } from 'next/server';
import { authTransaction } from '@/server/auth-database';
import { recordOAuthState } from '@/server/auth-repository';
import {
  generateOAuthParams,
  getGoogleOidcCredentials,
  buildGoogleAuthorizationUrl,
  validateRedirectPath,
} from '@/server/oidc';
import { ApiError } from '@/server/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const rawRedirectPath = url.searchParams.get('redirect_path');
    const validatedRedirect = validateRedirectPath(rawRedirectPath);

    const {
      state,
      stateHash,
      codeVerifier,
      codeChallenge,
      nonce,
      nonceHash,
    } = await generateOAuthParams(validatedRedirect);

    await authTransaction(async (client) => {
      await recordOAuthState(client, {
        stateHash,
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

    return NextResponse.redirect(authUrl, {
      status: 302,
      headers: {
        'Cache-Control': 'no-store',
      },
    });
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
