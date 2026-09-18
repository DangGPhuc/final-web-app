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

export const OAUTH_BINDER_COOKIE = '__Host-fintrack_oauth';
export const OAUTH_BINDER_MAX_AGE_SECONDS = 600; // 10 minutes (matches state lifetime)

export interface VerifiedIdentityClaims {
  provider: 'google';
  providerSubject: string;
  email: string;
  emailVerified: true;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface OAuthStateRecord {
  stateHash: string;
  browserBindHash: string;
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
  | ((currentUrl: URL, expectedNonceHash: string, codeVerifier: string) => Promise<VerifiedIdentityClaims>)
  | undefined;

export function setMockOidcExchangeHandler(
  handler:
    | ((currentUrl: URL, expectedNonceHash: string, codeVerifier: string) => Promise<VerifiedIdentityClaims>)
    | undefined
): void {
  mockExchangeHandler = handler;
}

export function resetOidcConfigForTesting(): void {
  cachedConfig = undefined;
  mockExchangeHandler = undefined;
}

export function generateOAuthBinder(): { rawBinder: string; binderHash: string } {
  // 32 cryptographically-random bytes -> base64url raw binder (43 chars)
  const rawBinder = randomBytes(32).toString('base64url');
  const binderHash = createHash('sha256').update(rawBinder).digest('hex');
  return { rawBinder, binderHash };
}

export function hashOAuthBinder(rawBinder: string): string {
  return createHash('sha256').update(rawBinder).digest('hex');
}

export function extractOAuthBinder(req: Request): string | null {
  try {
    const cookies = (req.headers.get('cookie') ?? '')
      .split(';')
      .map((v) => v.trim())
      .filter((v) => v.startsWith(OAUTH_BINDER_COOKIE + '='));
    if (cookies.length !== 1) return null;
    const binder = cookies[0].slice(OAUTH_BINDER_COOKIE.length + 1);
    if (!/^[A-Za-z0-9_-]{43}$/.test(binder)) return null;
    return binder;
  } catch {
    return null;
  }
}

export function createOAuthBinderCookieHeader(
  rawBinder: string,
  maxAge: number = OAUTH_BINDER_MAX_AGE_SECONDS
): string {
  // Enforce Secure, HttpOnly, SameSite=Lax, Path=/, and NO Domain attribute
  return `${OAUTH_BINDER_COOKIE}=${rawBinder}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearOAuthBinderCookieHeader(): string {
  return `${OAUTH_BINDER_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export function getCanonicalAppOrigin(): string {
  const configured = process.env.APP_ORIGIN;
  if (!configured) {
    throw new ApiError(503, 'AUTH_UNAVAILABLE');
  }
  try {
    const parsed = new URL(configured);
    if (parsed.origin !== configured) {
      throw new ApiError(503, 'AUTH_UNAVAILABLE');
    }
    if (parsed.pathname !== '' && parsed.pathname !== '/') {
      throw new ApiError(503, 'AUTH_UNAVAILABLE');
    }
    if (parsed.search || parsed.hash) {
      throw new ApiError(503, 'AUTH_UNAVAILABLE');
    }
    if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
      throw new ApiError(503, 'AUTH_UNAVAILABLE');
    }
    return parsed.origin;
  } catch (err: unknown) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(503, 'AUTH_UNAVAILABLE');
  }
}

export function validateGoogleOidcRedirectUri(redirectUri: string, canonicalAppOrigin: string): void {
  try {
    const parsed = new URL(redirectUri);
    if (parsed.origin !== canonicalAppOrigin) {
      throw new ApiError(503, 'AUTH_UNAVAILABLE');
    }
    if (parsed.pathname !== '/api/v2/auth/google/callback') {
      throw new ApiError(503, 'AUTH_UNAVAILABLE');
    }
    if (parsed.search || parsed.hash) {
      throw new ApiError(503, 'AUTH_UNAVAILABLE');
    }
  } catch (err: unknown) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(503, 'AUTH_UNAVAILABLE');
  }
}

export function buildCanonicalCallbackUrl(incomingUrl: URL, redirectUri: string): URL {
  const canonical = new URL(redirectUri);
  canonical.search = incomingUrl.search;
  return canonical;
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

  const appOrigin = getCanonicalAppOrigin();
  validateGoogleOidcRedirectUri(redirectUri, appOrigin);

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

/**
 * Pure function performing authoritative claim validation on claims extracted from
 * an ID token whose cryptographic signature has already been verified by openid-client.
 *
 * Invariant Note:
 * openid-client verifies token cryptography and signatures against Google's public JWKS.
 * Application logic in this function then directly verifies issuer, audience, subject,
 * email/email_verified policy, and validates SHA256(claims.nonce) against stored nonce_hash.
 */
export function validateGoogleIdentityClaims(
  claims: Record<string, unknown> | null | undefined,
  expectedClientId: string,
  expectedNonceHash: string
): VerifiedIdentityClaims {
  if (!claims || typeof claims !== 'object') {
    throw new ApiError(400, 'AUTH_IDENTITY_INVALID');
  }

  // 1. Verify issuer: must strictly be Google Accounts OIDC issuer
  if (claims.iss !== 'https://accounts.google.com') {
    throw new ApiError(400, 'AUTH_IDENTITY_INVALID');
  }

  // 2. Verify audience: must match configured client ID
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(expectedClientId)) {
    throw new ApiError(400, 'AUTH_IDENTITY_INVALID');
  }

  // 3. Verify nonce: Compare SHA-256 of signed ID-token nonce against stored nonce_hash
  if (!claims.nonce || typeof claims.nonce !== 'string') {
    throw new ApiError(400, 'AUTH_IDENTITY_INVALID');
  }
  const claimNonceHash = createHash('sha256').update(claims.nonce).digest('hex');
  if (claimNonceHash !== expectedNonceHash) {
    throw new ApiError(400, 'AUTH_IDENTITY_INVALID');
  }

  // 4. Verify authoritative provider subject
  if (!claims.sub || typeof claims.sub !== 'string' || claims.sub.trim() === '') {
    throw new ApiError(400, 'AUTH_IDENTITY_INVALID');
  }

  // 5. Strict explicit Email Policy: email MUST exist and email_verified MUST be true
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
  const emailVerified = claims.email_verified === true;
  if (!email || !emailVerified) {
    throw new ApiError(400, 'AUTH_IDENTITY_INVALID');
  }

  const displayName = typeof claims.name === 'string' && claims.name.trim() !== '' ? claims.name.trim() : null;
  const avatarUrl = typeof claims.picture === 'string' && claims.picture.trim() !== '' ? claims.picture.trim() : null;

  // IMPORTANT: Token minimization:
  // tokens (access_token, refresh_token, id_token) are never passed or stored.
  return {
    provider: 'google',
    providerSubject: claims.sub,
    email,
    emailVerified: true,
    displayName,
    avatarUrl,
  };
}

/**
 * PHASE B: External OIDC authorization-code exchange and token verification.
 * Invariant: Must NEVER hold an open database connection or transaction.
 */
export async function exchangeAndVerifyGoogleOidc(
  incomingUrl: URL,
  stateRecord: {
    codeVerifier: string;
    nonceHash: string;
  }
): Promise<VerifiedIdentityClaims> {
  const { clientId, clientSecret, redirectUri } = getGoogleOidcCredentials();
  const canonicalCallbackUrl = buildCanonicalCallbackUrl(incomingUrl, redirectUri);

  if (mockExchangeHandler) {
    return mockExchangeHandler(canonicalCallbackUrl, stateRecord.nonceHash, stateRecord.codeVerifier);
  }

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
    tokenSet = await authorizationCodeGrant(cachedConfig, canonicalCallbackUrl, {
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

  const claims = tokenSet.claims() as Record<string, unknown> | undefined;
  return validateGoogleIdentityClaims(claims, clientId, stateRecord.nonceHash);
}
