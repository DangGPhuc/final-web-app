import { describe, it, expect } from 'vitest';
import {
  generateOAuthState,
  generatePKCE,
  getAuthorizationUrl,
  exchangeCodeForTokens,
  fetchGoogleUserProfile,
} from '../src/lib/oauth/google-oauth';

describe('Google OAuth 2.0 Flow with PKCE & CSRF Protection', () => {
  it('generates secure 64-char hex CSRF state', () => {
    const state1 = generateOAuthState();
    const state2 = generateOAuthState();

    expect(state1.length).toBe(64);
    expect(state2.length).toBe(64);
    expect(state1).not.toBe(state2);
  });

  it('generates PKCE code_verifier and SHA-256 code_challenge', () => {
    const { codeVerifier, codeChallenge } = generatePKCE();

    expect(codeVerifier).toBeDefined();
    expect(codeChallenge).toBeDefined();
    expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(codeChallenge.length).toBeGreaterThanOrEqual(43);
    expect(codeVerifier).not.toBe(codeChallenge);
  });

  it('builds Google authorization URL with offline access, consent prompt, and gmail.readonly scope', () => {
    const origId = process.env.GOOGLE_CLIENT_ID;
    const origSec = process.env.GOOGLE_CLIENT_SECRET;
    const origRed = process.env.GOOGLE_REDIRECT_URI;
    const origKey = process.env.TOKEN_ENCRYPTION_KEY;

    process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
    process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/api/google/callback';
    process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    try {
      const state = generateOAuthState();
      const { codeChallenge } = generatePKCE();
      const url = getAuthorizationUrl(state, codeChallenge);

      expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth');
      expect(url).toContain('access_type=offline');
      expect(url).toContain('prompt=select_account+consent');
      expect(url).toContain('code_challenge_method=S256');
      expect(url).toContain(encodeURIComponent(codeChallenge));
      expect(url).toContain(state);
      expect(url).toContain(encodeURIComponent('https://www.googleapis.com/auth/gmail.readonly'));
    } finally {
      process.env.GOOGLE_CLIENT_ID = origId;
      process.env.GOOGLE_CLIENT_SECRET = origSec;
      process.env.GOOGLE_REDIRECT_URI = origRed;
      process.env.TOKEN_ENCRYPTION_KEY = origKey;
    }
  });

  it('fails closed when Google OAuth configuration is missing', () => {
    const origId = process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_ID;

    try {
      const state = generateOAuthState();
      const { codeChallenge } = generatePKCE();
      expect(() => getAuthorizationUrl(state, codeChallenge)).toThrow(
        'Cấu hình Google OAuth chưa hoàn thiện: thiếu [GOOGLE_CLIENT_ID].'
      );
    } finally {
      process.env.GOOGLE_CLIENT_ID = origId;
    }
  });

  it('exchanges mock code for tokens in test mode', async () => {
    const tokens = await exchangeCodeForTokens('mock_code_testuser@gmail.com', 'test_verifier');

    expect(tokens.access_token).toBeDefined();
    expect(tokens.refresh_token).toBeDefined();
    expect(tokens.token_type).toBe('Bearer');
  });

  it('extracts Google user profile with stable googleSub identity', async () => {
    const profile = await fetchGoogleUserProfile('mock_access_token_123', 'finance@gmail.com');

    expect(profile.sub).toBeDefined();
    expect(profile.sub).toContain('mock_sub_');
    expect(profile.email).toBe('finance@gmail.com');
  });

  describe('Mock OAuth Security Regression Tests', () => {
    it('strictly prohibits mock OAuth codes in production mode', async () => {
      const origEnv = process.env.NODE_ENV;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (process.env as any).NODE_ENV = 'production';

        await expect(
          exchangeCodeForTokens('mock_code_attacker@gmail.com', 'verifier')
        ).rejects.toThrow('Mock OAuth codes are strictly prohibited in this environment.');

        await expect(
          fetchGoogleUserProfile('mock_access_token_hacker')
        ).rejects.toThrow('Mock access tokens are strictly prohibited in this environment.');
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (process.env as any).NODE_ENV = origEnv;
      }
    });
  });
});
