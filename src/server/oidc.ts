import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import {
  discovery,
  calculatePKCECodeChallenge,
  randomPKCECodeVerifier,
  randomNonce,
  randomState,
  authorizationCodeGrant,
  type Configuration,
} from 'openid-client';
import { ApiError } from './errors';

export interface VerifiedIdentityClaims {
  provider: 'google';
  providerSubject: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface OAuthStateRecord {
  stateHash: string;
  provider: 'google';
  codeVerifier: string;
  nonceHash: string;
  redirectPath: string;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}

// In-memory discovery cache to prevent fetching Google metadata on every request
let cachedConfig: Configuration | undefined;
let mockExchangeHandler:
  | ((currentUrl: URL, expectedNonce: string, codeVerifier: string) => Promise<VerifiedIdentityClaims>)
  | undefined;

export function setMockOidcExchangeHandler(
  handler:
    | ((currentUrl: URL, expectedNonce: string, codeVerifier: string) => Promise<VerifiedIdentityClaims>)
    | undefined
): void {
  mockExchangeHandler = handler;
}

export function resetOidcConfigForTesting(): void {
  cachedConfig = undefined;
  mockExchangeHandler = undefined;
}

export function validateRedirectPath(raw: string | null | undefined): string {
  if (!raw) return '/';
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.startsWith('/\\')) {
    throw new ApiError(400, 'AUTH_INVALID_REDIRECT');
  }
  if (/[\r\n\0]/.test(trimmed) || trimmed.includes('\\')) {
    throw new ApiError(400, 'AUTH_INVALID_REDIRECT');
  }
  try {
    const decoded = decodeURIComponent(trimmed);
    if (decoded.startsWith('//') || decoded.startsWith('/\\') || decoded.includes('\\')) {
      throw new ApiError(400, 'AUTH_INVALID_REDIRECT');
    }
  } catch {
    throw new ApiError(400, 'AUTH_INVALID_REDIRECT');
  }
  try {
    const parsed = new URL(trimmed, 'https://localhost');
    if (parsed.origin !== 'https://localhost') {
      throw new ApiError(400, 'AUTH_INVALID_REDIRECT');
    }
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    throw new ApiError(400, 'AUTH_INVALID_REDIRECT');
  }
}

export async function generateOAuthParams(redirectPath: string = '/'): Promise<{
  state: string;
  stateHash: string;
  codeVerifier: string;
  codeChallenge: string;
  nonce: string;
  nonceHash: string;
  validatedRedirectPath: string;
}> {
  const validatedRedirectPath = validateRedirectPath(redirectPath);
  const state = randomState();
  const codeVerifier = randomPKCECodeVerifier();
  const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
  const nonce = randomNonce();

  const stateHash = createHash('sha256').update(state).digest('hex');
  const nonceHash = createHash('sha256').update(nonce).digest('hex');

  return {
    state,
    stateHash,
    codeVerifier,
    codeChallenge,
    nonce,
    nonceHash,
    validatedRedirectPath,
  };
}

export function getGoogleOidcCredentials(): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} {
  const clientId = process.env.GOOGLE_OIDC_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OIDC_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OIDC_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new ApiError(503, 'AUTH_UNAVAILABLE');
  }

  return { clientId, clientSecret, redirectUri };
}

export function buildGoogleAuthorizationUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  nonce: string;
}): string {
  const authEndpoint = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authEndpoint.searchParams.set('client_id', params.clientId);
  authEndpoint.searchParams.set('response_type', 'code');
  authEndpoint.searchParams.set('scope', 'openid email profile');
  authEndpoint.searchParams.set('redirect_uri', params.redirectUri);
  authEndpoint.searchParams.set('state', params.state);
  authEndpoint.searchParams.set('code_challenge', params.codeChallenge);
  authEndpoint.searchParams.set('code_challenge_method', 'S256');
  authEndpoint.searchParams.set('nonce', params.nonce);

  return authEndpoint.toString();
}

export async function exchangeAndVerifyGoogleOidc(
  currentUrl: URL,
  stateRecord: {
    codeVerifier: string;
    nonceHash: string;
  }
): Promise<VerifiedIdentityClaims> {
  if (mockExchangeHandler) {
    return mockExchangeHandler(currentUrl, stateRecord.nonceHash, stateRecord.codeVerifier);
  }

  const { clientId, clientSecret, redirectUri } = getGoogleOidcCredentials();

  if (!cachedConfig) {
    try {
      cachedConfig = await discovery(
        new URL('https://accounts.google.com'),
        clientId,
        clientSecret
      );
    } catch {
      throw new ApiError(503, 'AUTH_UNAVAILABLE');
    }
  }

  let tokenSet;
  try {
    tokenSet = await authorizationCodeGrant(cachedConfig, currentUrl, {
      pkceCodeVerifier: stateRecord.codeVerifier,
      idTokenExpected: true,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('expired') || message.includes('invalid_grant')) {
      throw new ApiError(400, 'AUTH_PROVIDER_REJECTED');
    }
    throw new ApiError(400, 'AUTH_PROVIDER_REJECTED');
  }

  const claims = tokenSet.claims();
  if (!claims) {
    throw new ApiError(400, 'AUTH_IDENTITY_INVALID');
  }

  // 1. Verify issuer
  if (claims.iss !== 'https://accounts.google.com') {
    throw new ApiError(400, 'AUTH_IDENTITY_INVALID');
  }

  // 2. Verify audience
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(clientId)) {
    throw new ApiError(400, 'AUTH_IDENTITY_INVALID');
  }

  // 3. Verify nonce
  if (!claims.nonce) {
    throw new ApiError(400, 'AUTH_IDENTITY_INVALID');
  }
  const claimNonceHash = createHash('sha256').update(claims.nonce as string).digest('hex');
  if (claimNonceHash !== stateRecord.nonceHash) {
    throw new ApiError(400, 'AUTH_IDENTITY_INVALID');
  }

  // 4. Verify authoritative provider subject
  if (!claims.sub || typeof claims.sub !== 'string') {
    throw new ApiError(400, 'AUTH_IDENTITY_INVALID');
  }

  // 5. Verify email verification status if email is present
  const email = (claims.email as string) ?? null;
  const emailVerified = Boolean(claims.email_verified);
  if (email && !emailVerified) {
    throw new ApiError(400, 'AUTH_IDENTITY_INVALID');
  }

  const displayName = (claims.name as string) ?? null;
  const avatarUrl = (claims.picture as string) ?? null;

  // IMPORTANT: Token minimization:
  // tokenSet.access_token and tokenSet.refresh_token are NOT returned and are discarded here!
  return {
    provider: 'google',
    providerSubject: claims.sub,
    email,
    emailVerified,
    displayName,
    avatarUrl,
  };
}
