import { NextRequest, NextResponse } from 'next/server';
import {
  generateOAuthState,
  generatePKCE,
  getAuthorizationUrl,
  validateOAuthConfig,
} from '@/lib/oauth/google-oauth';

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  Pragma: 'no-cache',
};

export async function GET(req: NextRequest) {
  try {
    validateOAuthConfig();

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

    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    response.headers.set('Pragma', 'no-cache');

    return response;
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Lỗi cấu hình OAuth',
      },
      {
        status: 500,
        headers: NO_CACHE_HEADERS,
      }
    );
  }
}
