import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  exchangeCodeForTokens,
  fetchGoogleUserProfile,
  isMockOAuthAllowed,
} from '@/lib/oauth/google-oauth';
import { encryptToken } from '@/lib/security/crypto';

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  const redirectBase = `${url.protocol}//${url.host}`;

  if (error || !code) {
    const res = NextResponse.redirect(
      `${redirectBase}?tab=settings&oauth_error=${encodeURIComponent(error || 'missing_code')}`
    );
    res.cookies.delete('oauth_state');
    res.cookies.delete('oauth_verifier');
    return res;
  }

  const storedState = req.cookies.get('oauth_state')?.value;
  const storedVerifier = req.cookies.get('oauth_verifier')?.value;

  // Validate CSRF state strictly
  if (!storedState || storedState !== state) {
    const res = NextResponse.redirect(
      `${redirectBase}?tab=settings&oauth_error=state_mismatch`
    );
    res.cookies.delete('oauth_state');
    res.cookies.delete('oauth_verifier');
    return res;
  }

  // Reject mock codes if not permitted
  if (code.startsWith('mock_') && !isMockOAuthAllowed()) {
    const res = NextResponse.redirect(
      `${redirectBase}?tab=settings&oauth_error=mock_oauth_prohibited`
    );
    res.cookies.delete('oauth_state');
    res.cookies.delete('oauth_verifier');
    return res;
  }

  try {
    const tokens = await exchangeCodeForTokens(code, storedVerifier || '');
    const userProfile = await fetchGoogleUserProfile(tokens.access_token);

    if (!tokens.refresh_token) {
      // In case Google did not return a refresh token (e.g. existing consent without prompt=consent)
      // Check if we already have an existing connection for this sub
      const existing = await prisma.gmailConnection.findUnique({
        where: { googleSub: userProfile.sub },
      });

      if (!existing) {
        throw new Error('Google did not provide a refresh token. Consent prompt required.');
      }
    }

    const encryptedRefreshToken = tokens.refresh_token
      ? encryptToken(tokens.refresh_token)
      : undefined;

    await prisma.gmailConnection.upsert({
      where: { googleSub: userProfile.sub },
      update: {
        email: userProfile.email,
        displayName: userProfile.name,
        avatarUrl: userProfile.picture,
        ...(encryptedRefreshToken ? { encryptedRefreshToken } : {}),
        updatedAt: new Date(),
        revokedAt: null,
      },
      create: {
        googleSub: userProfile.sub,
        email: userProfile.email,
        displayName: userProfile.name,
        avatarUrl: userProfile.picture,
        encryptedRefreshToken: encryptedRefreshToken || '',
      },
    });

    const res = NextResponse.redirect(`${redirectBase}?tab=settings&oauth_success=1`);
    res.cookies.delete('oauth_state');
    res.cookies.delete('oauth_verifier');
    return res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'oauth_exchange_failed';
    const res = NextResponse.redirect(
      `${redirectBase}?tab=settings&oauth_error=${encodeURIComponent(msg)}`
    );
    res.cookies.delete('oauth_state');
    res.cookies.delete('oauth_verifier');
    return res;
  }
}
