import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encryptToken, decryptToken, setTestEncryptionKey } from '../src/lib/security/crypto';

const VALID_TEST_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('Token Security — AES-256-GCM Authenticated Encryption', () => {
  beforeEach(() => {
    setTestEncryptionKey(VALID_TEST_KEY);
  });

  afterEach(() => {
    setTestEncryptionKey(null);
  });
  it('encrypts and decrypts a Google refresh token cleanly', () => {
    const rawToken = '1//04mock_google_refresh_token_very_long_secret_xyz123';
    const encrypted = encryptToken(rawToken);

    // Payload format: iv:authTag:ciphertext
    expect(encrypted).not.toBe(rawToken);
    expect(encrypted.split(':').length).toBe(3);

    const decrypted = decryptToken(encrypted);
    expect(decrypted).toBe(rawToken);
  });

  it('generates unique ciphertexts for identical tokens (random IV)', () => {
    const rawToken = 'sample_refresh_token_123';
    const enc1 = encryptToken(rawToken);
    const enc2 = encryptToken(rawToken);

    expect(enc1).not.toBe(enc2);
    expect(decryptToken(enc1)).toBe(rawToken);
    expect(decryptToken(enc2)).toBe(rawToken);
  });

  it('fails with authentication error when ciphertext is tampered with', () => {
    const rawToken = 'sample_refresh_token_tamper_test';
    const encrypted = encryptToken(rawToken);
    const [iv, authTag, ciphertext] = encrypted.split(':');

    // Tamper with one character of ciphertext
    const tamperedCiphertext =
      ciphertext.slice(0, -2) + (ciphertext.slice(-2) === 'aa' ? 'bb' : 'aa');
    const tamperedPayload = `${iv}:${authTag}:${tamperedCiphertext}`;

    expect(() => decryptToken(tamperedPayload)).toThrow();
  });

  it('fails with authentication error when auth tag is tampered with', () => {
    const rawToken = 'sample_refresh_token_tag_test';
    const encrypted = encryptToken(rawToken);
    const [iv, authTag, ciphertext] = encrypted.split(':');

    const tamperedAuthTag =
      authTag.slice(0, -2) + (authTag.slice(-2) === '11' ? '22' : '11');
    const tamperedPayload = `${iv}:${tamperedAuthTag}:${ciphertext}`;

    expect(() => decryptToken(tamperedPayload)).toThrow();
  });

  it('returns empty string for empty inputs', () => {
    expect(encryptToken('')).toBe('');
    expect(decryptToken('')).toBe('');
  });

  describe('Fail-Closed Key Validation Regression Tests', () => {
    it('refuses to encrypt when TOKEN_ENCRYPTION_KEY is absent outside controlled tests', () => {
      const origKey = process.env.TOKEN_ENCRYPTION_KEY;
      try {
        delete process.env.TOKEN_ENCRYPTION_KEY;
        setTestEncryptionKey(null);

        expect(() => encryptToken('some_secret_refresh_token')).toThrow(
          'TOKEN_ENCRYPTION_KEY is required and must be configured.'
        );
      } finally {
        process.env.TOKEN_ENCRYPTION_KEY = origKey;
      }
    });

    it('refuses to encrypt when key is invalid length (not 32 bytes)', () => {
      try {
        setTestEncryptionKey('too_short_key_123');
        expect(() => encryptToken('some_secret_refresh_token')).toThrow(
          'TOKEN_ENCRYPTION_KEY must provide exactly 32 bytes'
        );
      } finally {
        setTestEncryptionKey(null);
      }
    });

    it('never leaks key material in thrown errors', () => {
      const sensitiveKey = 'bad_length_key_secret_that_must_not_appear';
      try {
        setTestEncryptionKey(sensitiveKey);
        try {
          encryptToken('some_secret');
          expect.fail('Should have thrown');
        } catch (err: unknown) {
          expect((err as Error).message).not.toContain(sensitiveKey);
        }
      } finally {
        setTestEncryptionKey(null);
      }
    });
  });
});
