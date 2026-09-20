import crypto from 'crypto';

/**
 * Token Security — Authenticated Encryption (AES-256-GCM)
 *
 * Requirements:
 * - Encryption master key comes ONLY from TOKEN_ENCRYPTION_KEY env variable.
 * - Never log or print plaintext tokens, keys, or auth codes.
 * - Uses authenticated encryption (AES-256-GCM) with random IV and auth tag.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Standard 96 bits for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits auth tag

let testEncryptionKey: string | null = null;

/**
 * For unit testing only: inject an ephemeral encryption key
 */
export function setTestEncryptionKey(key: string | null): void {
  testEncryptionKey = key;
}

function getMasterKey(): Buffer {
  const rawKey = testEncryptionKey || process.env.TOKEN_ENCRYPTION_KEY;
  if (!rawKey || typeof rawKey !== 'string' || rawKey.trim() === '') {
    throw new Error('TOKEN_ENCRYPTION_KEY is required and must be configured.');
  }

  const trimmed = rawKey.trim();

  // Exactly 64 hex characters -> 32 bytes
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }

  // Exactly 32 bytes UTF-8 string
  const utf8Buf = Buffer.from(trimmed, 'utf8');
  if (utf8Buf.length === 32) {
    return utf8Buf;
  }

  // Exactly 32 bytes base64 decoded
  if (/^[A-Za-z0-9+/=]{43,44}$/.test(trimmed)) {
    const base64Buf = Buffer.from(trimmed, 'base64');
    if (base64Buf.length === 32) {
      return base64Buf;
    }
  }

  throw new Error(
    'TOKEN_ENCRYPTION_KEY must provide exactly 32 bytes of key material (e.g. 64 hexadecimal characters).'
  );
}

/**
 * Encrypt plaintext string using AES-256-GCM
 * Returns payload in format: "iv:authTag:ciphertext" (hex encoded)
 */
export function encryptToken(plaintext: string): string {
  if (!plaintext) return '';
  const key = getMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt ciphertext payload using AES-256-GCM
 * Verifies authenticity before returning decrypted plaintext
 */
export function decryptToken(payload: string): string {
  if (!payload) return '';
  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted token payload format');
  }

  const [ivHex, authTagHex, ciphertextHex] = parts;
  const key = getMasterKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertextHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
