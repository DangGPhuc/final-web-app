import fs from 'node:fs';
import path from 'node:path';

/**
 * scripts/lib/local-env.mjs
 *
 * Reusable, safe, zero-leak local environment helper module for Phase 5.
 * Used by preflight-real-env.mjs and run-prisma-real-env.mjs.
 */

/**
 * Parses an environment file (.env or .env.local) safely into an object
 * without modifying process.env.
 *
 * @param {string} filePath
 * @returns {Record<string, string>}
 */
export function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  const result = {};

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;

    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();

    // Strip wrapping double or single quotes if present
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }

    result[key] = val;
  }

  return result;
}

export const KNOWN_PLACEHOLDER_SUBSTRINGS = [
  'replace_with',
  'your-google-client',
  'example.com',
  'user:password@localhost',
  '<same_local_random_password>',
  '<local_random_password>',
  '<your_generated_postgres_password>',
  '<password>',
];

export const KNOWN_WEAK_OWNER_SECRETS = new Set([
  'password',
  '12345678',
  '1234567890',
  'owner',
  'admin',
  'cockpit',
  'secret',
  'changeme',
  'cockpit-owner-demo-secret-2026',
]);

export const KNOWN_WEAK_PASSWORDS = new Set([
  'postgres',
  'password',
  '123456',
  '12345678',
  '1234567890',
  'changeme',
  'admin',
  'root',
  'fintrack',
  'cockpit',
  'secret',
]);

/**
 * Returns true if the value matches known placeholder patterns.
 *
 * @param {string | undefined} value
 * @returns {boolean}
 */
export function isPlaceholderValue(value) {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (KNOWN_PLACEHOLDER_SUBSTRINGS.some((ph) => trimmed.includes(ph))) {
    return true;
  }
  // Check for angle bracket placeholders e.g. <something>
  if (/<[a-zA-Z0-9_-]+>/.test(trimmed)) {
    return true;
  }
  return false;
}

/**
 * Validates a DATABASE_URL for operational execution.
 * Returns { valid: boolean, error?: string }.
 * CRITICAL: Never includes the database URL or credentials in the returned error message.
 *
 * @param {string | undefined} dbUrl
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateDatabaseUrlForExecution(dbUrl) {
  if (!dbUrl || typeof dbUrl !== 'string' || dbUrl.trim() === '') {
    return { valid: false, error: 'DATABASE_URL is missing or empty' };
  }
  const trimmed = dbUrl.trim();
  if (isPlaceholderValue(trimmed)) {
    return { valid: false, error: 'DATABASE_URL contains an unconfigured placeholder' };
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
      return { valid: false, error: 'DATABASE_URL protocol must be postgresql:// or postgres://' };
    }
    if (!parsed.hostname) {
      return { valid: false, error: 'DATABASE_URL is missing a valid hostname' };
    }
  } catch {
    return { valid: false, error: 'DATABASE_URL is not a valid URL' };
  }
  return { valid: true };
}
