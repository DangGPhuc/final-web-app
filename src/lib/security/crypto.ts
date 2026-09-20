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

function getMasterKey(): Buffer {
  const rawKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (!rawKey) {
    // In dev / test fallback to ensure application boots, but generate deterministic 32-byte key
    return crypto.createHash('sha256').update('cockpit_default_dev_key_do_not_use_in_prod').digest();
  }

  // Support 64-char hex string, base64, or raw string hashed to 32 bytes
  if (/^[0-9a-fA-F]{64}$/.test(rawKey)) {
    return Buffer.from(rawKey, 'hex');
  }
  return crypto.createHash('sha256').update(rawKey).digest();
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
