import crypto from 'crypto';

/**
 * Server-side Google OAuth 2.0 Client with PKCE and CSRF State Protection
 *
 * Scopes:
 * - openid
 * - email
 * - profile
 * - https://www.googleapis.com/auth/gmail.readonly
 *
 * Access type: offline, prompt: select_account consent
 */

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
  token_type: string;
}

export interface GoogleUserProfile {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

export function isMockOAuthAllowed(): boolean {
  if (process.env.NODE_ENV === 'production') {
    return false;
  }
  return process.env.NODE_ENV === 'test' || process.env.ALLOW_MOCK_OAUTH === 'true';
}

export function generateOAuthState(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  return { codeVerifier, codeChallenge };
}

export function validateOAuthConfig(): void {
  const missing: string[] = [];
  if (!process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID.trim() === '') {
    missing.push('GOOGLE_CLIENT_ID');
  }
  if (!process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET.trim() === '') {
    missing.push('GOOGLE_CLIENT_SECRET');
  }
  if (!process.env.GOOGLE_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI.trim() === '') {
    missing.push('GOOGLE_REDIRECT_URI');
  }
  if (!process.env.TOKEN_ENCRYPTION_KEY || process.env.TOKEN_ENCRYPTION_KEY.trim() === '') {
    missing.push('TOKEN_ENCRYPTION_KEY');
  }

  if (missing.length > 0) {
    throw new Error(
      `Cấu hình Google OAuth chưa hoàn thiện: thiếu [${missing.join(', ')}].`
    );
  }
}

export function getAuthorizationUrl(state: string, codeChallenge: string): string {
  // Fail closed if OAuth or encryption configuration is missing
  validateOAuthConfig();

  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI!;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile https://www.googleapis.com/auth/gmail.readonly',
    access_type: 'offline',
    prompt: 'select_account consent',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string
): Promise<GoogleTokens> {
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/google/callback';

  // Support test / mock flow ONLY when explicitly allowed (test or safe non-prod flag)
  if (code.startsWith('mock_')) {
    if (!isMockOAuthAllowed()) {
      throw new Error('Mock OAuth codes are strictly prohibited in this environment.');
    }
    const mockEmail = code.includes('@') ? code.replace('mock_code_', '') : 'user@gmail.com';
    return {
      access_token: `mock_access_token_${Date.now()}`,
      refresh_token: `mock_refresh_token_${Date.now()}`,
      id_token: `mock_id_token_${Date.now()}`,
      expires_in: 3600,
      token_type: 'Bearer',
    };
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to exchange Google OAuth code: ${response.status} ${errorText}`);
  }

  return response.json();
}

export async function fetchGoogleUserProfile(
  accessToken: string,
  fallbackEmail?: string
): Promise<GoogleUserProfile> {
  if (accessToken.startsWith('mock_')) {
    if (!isMockOAuthAllowed()) {
      throw new Error('Mock access tokens are strictly prohibited in this environment.');
    }
    const email = fallbackEmail || 'demouser@gmail.com';
    return {
      sub: `mock_sub_${Buffer.from(email).toString('hex').slice(0, 16)}`,
      email,
      name: 'Google User',
      picture: 'https://lh3.googleusercontent.com/a/default-user',
    };
  }

  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch Google user profile: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  return {
    sub: data.sub,
    email: data.email,
    name: data.name,
    picture: data.picture,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<string> {
  if (refreshToken.startsWith('mock_')) {
    if (!isMockOAuthAllowed()) {
      throw new Error('Mock refresh tokens are strictly prohibited in this environment.');
    }
    return `mock_access_token_${Date.now()}`;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to refresh Google access token: ${response.status}`);
  }

  const data = await response.json();
  return data.access_token;
}

export async function revokeGoogleToken(token: string): Promise<boolean> {
  if (token.startsWith('mock_')) {
    if (!isMockOAuthAllowed()) {
      return false;
    }
    return true;
  }

  try {
    const response = await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    return response.ok;
  } catch {
    return false;
  }
}
