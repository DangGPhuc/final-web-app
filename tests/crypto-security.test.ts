import { describe, it, expect } from 'vitest';
import { encryptToken, decryptToken } from '../src/lib/security/crypto';

describe('Token Security — AES-256-GCM Authenticated Encryption', () => {
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
});
