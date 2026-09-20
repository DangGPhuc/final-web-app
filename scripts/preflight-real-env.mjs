#!/usr/bin/env node

/**
 * scripts/preflight-real-env.mjs
 *
 * Safe, zero-leak preflight verification script for Phase 5 Real Environment Integration.
 * Validates critical environment variables, security keys, and runtime assumptions
 * WITHOUT printing secret values to stdout, stderr, or log streams.
 *
 * Outputs ONLY: configured / missing / invalid
 *
 * Exit code:
 *   0 = All checks configured and valid
 *   1 = One or more checks missing or invalid
 */

import fs from 'node:fs';
import path from 'node:path';

// Parse .env and .env.local files safely into memory without modifying existing process.env
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

    // Strip wrapping quotes if present
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

// Load environment in precedence order:
// 1. Existing process.env (e.g. shell / CI)
// 2. .env.local (gitignored local overrides)
// 3. .env (gitignored local defaults)
const rootDir = process.cwd();
const localEnv = parseEnvFile(path.join(rootDir, '.env.local'));
const baseEnv = parseEnvFile(path.join(rootDir, '.env'));

export function getEnvVal(key) {
  if (process.env[key] !== undefined && process.env[key] !== '') {
    return process.env[key];
  }
  if (localEnv[key] !== undefined && localEnv[key] !== '') {
    return localEnv[key];
  }
  if (baseEnv[key] !== undefined && baseEnv[key] !== '') {
    return baseEnv[key];
  }
  return undefined;
}

const KNOWN_PLACEHOLDER_SUBSTRINGS = [
  'replace_with',
  'your-google-client',
  'example.com',
  'user:password@localhost',
];

const KNOWN_WEAK_OWNER_SECRETS = new Set([
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

export function runPreflightChecks(envGetter = getEnvVal) {
  const results = [];

  // Helper to add check result
  const record = (name, status, detail) => {
    results.push({ name, status, detail });
  };

  // 1. DATABASE_URL
  const dbUrl = envGetter('DATABASE_URL');
  if (!dbUrl) {
    record('DATABASE_URL', 'missing', 'Environment variable not set');
  } else {
    const trimmed = dbUrl.trim();
    if (KNOWN_PLACEHOLDER_SUBSTRINGS.some((ph) => trimmed.includes(ph))) {
      record('DATABASE_URL', 'invalid', 'Placeholder value detected');
    } else {
      try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
          record('DATABASE_URL', 'invalid', 'Protocol must be postgresql:// or postgres://');
        } else if (!parsed.hostname) {
          record('DATABASE_URL', 'invalid', 'Missing database host in URL');
        } else {
          record('DATABASE_URL', 'configured', 'Valid PostgreSQL connection string');
        }
      } catch {
        record('DATABASE_URL', 'invalid', 'Invalid URL format');
      }
    }
  }

  // 2. TOKEN_ENCRYPTION_KEY (AES-256-GCM master key: 32 bytes / 64 hex characters)
  const encKey = envGetter('TOKEN_ENCRYPTION_KEY');
  if (!encKey) {
    record('TOKEN_ENCRYPTION_KEY', 'missing', 'Master key for Gmail refresh tokens not set');
  } else {
    const trimmed = encKey.trim();
    if (KNOWN_PLACEHOLDER_SUBSTRINGS.some((ph) => trimmed.includes(ph))) {
      record('TOKEN_ENCRYPTION_KEY', 'invalid', 'Placeholder value detected');
    } else if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      record('TOKEN_ENCRYPTION_KEY', 'configured', 'Valid 64-hex char (32-byte) key');
    } else if (Buffer.byteLength(trimmed, 'utf8') === 32) {
      record('TOKEN_ENCRYPTION_KEY', 'configured', 'Valid 32-byte UTF-8 key');
    } else {
      record('TOKEN_ENCRYPTION_KEY', 'invalid', 'Must be exactly 32 bytes (64 hex characters recommended)');
    }
  }

  // 3. OWNER_SECRET_KEY (Owner session signing key: >= 32 chars, high strength)
  const ownerKey = envGetter('OWNER_SECRET_KEY');
  if (!ownerKey) {
    record('OWNER_SECRET_KEY', 'missing', 'Owner unlock secret key not set');
  } else {
    const trimmed = ownerKey.trim();
    if (KNOWN_PLACEHOLDER_SUBSTRINGS.some((ph) => trimmed.includes(ph))) {
      record('OWNER_SECRET_KEY', 'invalid', 'Placeholder value detected');
    } else if (trimmed.length < 32) {
      record('OWNER_SECRET_KEY', 'invalid', 'Length too short (minimum 32 characters required)');
    } else if (KNOWN_WEAK_OWNER_SECRETS.has(trimmed.toLowerCase())) {
      record('OWNER_SECRET_KEY', 'invalid', 'Matches known weak secret');
    } else {
      record('OWNER_SECRET_KEY', 'configured', 'Strong key meeting length requirement (>= 32 chars)');
    }
  }

  // 4. APP_ORIGIN (Canonical application origin)
  const appOrigin = envGetter('APP_ORIGIN');
  if (!appOrigin) {
    record('APP_ORIGIN', 'missing', 'Canonical application origin not set');
  } else {
    const trimmed = appOrigin.trim();
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        record('APP_ORIGIN', 'invalid', 'Origin must be HTTP or HTTPS URL');
      } else {
        record('APP_ORIGIN', 'configured', `Valid origin (${parsed.protocol}//${parsed.host})`);
      }
    } catch {
      record('APP_ORIGIN', 'invalid', 'Invalid URL format');
    }
  }

  // 5. GOOGLE_CLIENT_ID
  const clientId = envGetter('GOOGLE_CLIENT_ID');
  if (!clientId) {
    record('GOOGLE_CLIENT_ID', 'missing', 'OAuth Client ID not set');
  } else {
    const trimmed = clientId.trim();
    if (KNOWN_PLACEHOLDER_SUBSTRINGS.some((ph) => trimmed.includes(ph))) {
      record('GOOGLE_CLIENT_ID', 'invalid', 'Placeholder value detected');
    } else if (trimmed.length < 10) {
      record('GOOGLE_CLIENT_ID', 'invalid', 'Client ID value too short');
    } else {
      record('GOOGLE_CLIENT_ID', 'configured', 'Client ID is set');
    }
  }

  // 6. GOOGLE_CLIENT_SECRET
  const clientSecret = envGetter('GOOGLE_CLIENT_SECRET');
  if (!clientSecret) {
    record('GOOGLE_CLIENT_SECRET', 'missing', 'OAuth Client Secret not set');
  } else {
    const trimmed = clientSecret.trim();
    if (KNOWN_PLACEHOLDER_SUBSTRINGS.some((ph) => trimmed.includes(ph))) {
      record('GOOGLE_CLIENT_SECRET', 'invalid', 'Placeholder value detected');
    } else if (trimmed.length < 8) {
      record('GOOGLE_CLIENT_SECRET', 'invalid', 'Client Secret value too short');
    } else {
      record('GOOGLE_CLIENT_SECRET', 'configured', 'Client Secret is set');
    }
  }

  // 7. GOOGLE_REDIRECT_URI
  const redirectUri = envGetter('GOOGLE_REDIRECT_URI');
  if (!redirectUri) {
    record('GOOGLE_REDIRECT_URI', 'missing', 'OAuth redirect URI not set');
  } else {
    const trimmed = redirectUri.trim();
    try {
      const parsed = new URL(trimmed);
      if (!parsed.pathname.endsWith('/api/google/callback')) {
        record('GOOGLE_REDIRECT_URI', 'invalid', 'Must end with /api/google/callback');
      } else if (appOrigin && !trimmed.startsWith(appOrigin.trim())) {
        record('GOOGLE_REDIRECT_URI', 'invalid', 'Must match APP_ORIGIN prefix');
      } else {
        record('GOOGLE_REDIRECT_URI', 'configured', 'Valid OAuth callback URI');
      }
    } catch {
      record('GOOGLE_REDIRECT_URI', 'invalid', 'Invalid URL format');
    }
  }

  // 8. ALLOW_DEMO_DATA (Must be false or unset for real-environment integration)
  const allowDemo = envGetter('ALLOW_DEMO_DATA');
  if (!allowDemo || allowDemo.trim().toLowerCase() === 'false') {
    record('ALLOW_DEMO_DATA', 'configured', 'Disabled (false) for real environment');
  } else if (allowDemo.trim().toLowerCase() === 'true') {
    record('ALLOW_DEMO_DATA', 'invalid', 'Must be false for real-environment integration');
  } else {
    record('ALLOW_DEMO_DATA', 'invalid', 'Must be explicit boolean false');
  }

  // 9. ALLOW_MOCK_OAUTH (Must be false or unset for real-environment integration)
  const allowMock = envGetter('ALLOW_MOCK_OAUTH');
  if (!allowMock || allowMock.trim().toLowerCase() === 'false') {
    record('ALLOW_MOCK_OAUTH', 'configured', 'Disabled (false) for real environment');
  } else if (allowMock.trim().toLowerCase() === 'true') {
    record('ALLOW_MOCK_OAUTH', 'invalid', 'Must be false for real-environment integration');
  } else {
    record('ALLOW_MOCK_OAUTH', 'invalid', 'Must be explicit boolean false');
  }

  // 10. Runtime Assumptions
  const nodeEnv = envGetter('NODE_ENV') || 'development (default)';
  const runtimeAssumptions = {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    nodeEnv,
  };

  const isAllConfigured = results.every((r) => r.status === 'configured');
  const missingCount = results.filter((r) => r.status === 'missing').length;
  const invalidCount = results.filter((r) => r.status === 'invalid').length;

  return {
    results,
    runtimeAssumptions,
    isAllConfigured,
    missingCount,
    invalidCount,
  };
}

// CLI execution
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename || '')) {
  const { results, runtimeAssumptions, isAllConfigured, missingCount, invalidCount } = runPreflightChecks();

  console.log('='.repeat(78));
  console.log('   FINTRACK PERSONAL FINANCE COCKPIT — REAL ENVIRONMENT PREFLIGHT');
  console.log('='.repeat(78));
  console.log(`Runtime: Node ${runtimeAssumptions.nodeVersion} (${runtimeAssumptions.platform}/${runtimeAssumptions.arch}) | NODE_ENV: ${runtimeAssumptions.nodeEnv}`);
  console.log('-'.repeat(78));
  console.log(
    'ITEM'.padEnd(25) +
    'STATUS'.padEnd(15) +
    'DIAGNOSTIC CRITERIA (NO VALUES LOGGED)'
  );
  console.log('-'.repeat(78));

  for (const r of results) {
    const statusColor =
      r.status === 'configured'
        ? '\x1b[32mconfigured\x1b[0m'
        : r.status === 'missing'
        ? '\x1b[33mmissing   \x1b[0m'
        : '\x1b[31minvalid   \x1b[0m';

    console.log(
      r.name.padEnd(25) +
      statusColor.padEnd(24) +
      r.detail
    );
  }

  console.log('='.repeat(78));

  if (isAllConfigured) {
    console.log('\x1b[32m[PASS]\x1b[0m All Phase 5 preflight checks configured and valid.');
    console.log('Environment is safe for local persistent PostgreSQL and real Google OAuth.');
    process.exit(0);
  } else {
    console.error(
      `\x1b[31m[FAIL]\x1b[0m Preflight verification failed: ${missingCount} missing, ${invalidCount} invalid.`
    );
    console.error('Please configure missing or invalid items in your private .env.local file.');
    console.error('CRITICAL: Never commit real secret values to Git or paste them into chat.');
    process.exit(1);
  }
}
