import { NextRequest, NextResponse } from 'next/server';
import {
  generateOAuthState,
  generatePKCE,
  getAuthorizationUrl,
} from '@/lib/oauth/google-oauth';

export async function GET(req: NextRequest) {
  const state = generateOAuthState();
  const { codeVerifier, codeChallenge } = generatePKCE();

  const authUrl = getAuthorizationUrl(state, codeChallenge);
  const response = NextResponse.redirect(authUrl);

  const isProduction = process.env.NODE_ENV === 'production';
  const cookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 60 * 10, // 10 minutes
  };

  response.cookies.set('oauth_state', state, cookieOptions);
  response.cookies.set('oauth_verifier', codeVerifier, cookieOptions);

  return response;
}
