/**
 * Pure validation and enforcement logic for test database safety.
 *
 * Prevents accidental execution of destructive integration tests against
 * production, staging, or local personal databases (such as personal_finance).
 */

const FORBIDDEN_DB_NAMES = new Set([
  'personal_finance',
  'postgres',
  'template0',
  'template1',
]);

/**
 * Strips user credentials (especially passwords) from a connection URL string
 * for safe logging and error presentation.
 */
export function sanitizeDatabaseUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return '[empty-url]';
  }
  try {
    const parsed = new URL(rawUrl);
    if (parsed.password) {
      parsed.password = '***';
    }
    return parsed.toString();
  } catch {
    return '[malformed-url]';
  }
}

/**
 * Validates that the provided environment explicitly opts into destructive
 * tests and points to a verified disposable test database.
 *
 * Throws a descriptive, fail-closed Error if any check fails.
 * Guarantees that raw passwords are never printed or leaked in error messages.
 *
 * @param {Record<string, string | undefined>} [env=process.env]
 */
export function validateTestDatabaseEnvironment(env = process.env) {
  // 1. Explicit opt-in flag check
  if (!env || env.ALLOW_DESTRUCTIVE_DB_TESTS !== 'true') {
    throw new Error(
      'Destructive DB tests require explicit opt-in.\n' +
      'To run tests against PostgreSQL, you must explicitly set:\n' +
      '  ALLOW_DESTRUCTIVE_DB_TESTS=true\n' +
      '  DATABASE_TEST_URL=postgresql://user:pass@host:port/your_test_db\n' +
      'The real application database was NOT touched.'
    );
  }

  // 2. Require DATABASE_TEST_URL
  const rawUrl = env.DATABASE_TEST_URL;
  if (!rawUrl || typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    throw new Error(
      'DATABASE_TEST_URL is missing or empty.\n' +
      'Destructive DB tests require an explicit disposable test database via DATABASE_TEST_URL.\n' +
      'The real application database was NOT touched.'
    );
  }

  // 3. Parse as PostgreSQL URL
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(
      'DATABASE_TEST_URL is malformed.\n' +
      'DATABASE_TEST_URL must be a valid PostgreSQL connection URL.\n' +
      'The real application database was NOT touched.'
    );
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error(
      `DATABASE_TEST_URL protocol "${parsed.protocol}" is invalid. Expected "postgresql:" or "postgres:".\n` +
      'The real application database was NOT touched.'
    );
  }

  // 4. Validate database name from pathname
  const pathname = parsed.pathname.replace(/^\/+/, '');
  const dbName = pathname.split('/')[0]?.split('?')[0] || '';
  const lowerDbName = dbName.toLowerCase();

  if (
    !dbName ||
    FORBIDDEN_DB_NAMES.has(lowerDbName) ||
    lowerDbName === 'personal_finance' ||
    rawUrl.includes('/personal_finance')
  ) {
    throw new Error(
      `DATABASE_TEST_URL points to forbidden database "${dbName || '[empty]'}".\n` +
      'DATABASE_TEST_URL must reference a dedicated disposable test database.\n' +
      'The real application database was NOT touched.'
    );
  }

  // 5. Require explicit "test" marker in database name
  if (!lowerDbName.includes('test')) {
    throw new Error(
      `DATABASE_TEST_URL database name "${dbName}" does not contain the required "test" marker.\n` +
      'DATABASE_TEST_URL must reference a disposable test database containing "test" (e.g. fintrack_test).\n' +
      'The real application database was NOT touched.'
    );
  }

  const sanitizedUrl = sanitizeDatabaseUrl(rawUrl);

  return {
    valid: true,
    dbName,
    sanitizedUrl,
    testUrl: rawUrl,
  };
}

/**
 * Enforces test database safety by validating the environment and authoritatively
 * overriding process.env.DATABASE_URL with DATABASE_TEST_URL.
 *
 * @param {Record<string, string | undefined>} [env=process.env]
 */
export function enforceTestDatabaseSafety(env = process.env) {
  const result = validateTestDatabaseEnvironment(env);
  // Authoritatively set DATABASE_URL from DATABASE_TEST_URL ONLY after validation succeeds
  env.DATABASE_URL = result.testUrl;
  return result;
}

/**
 * Checks if a given test file path represents a DB-backed integration test module.
 */
export function isDbBackedTest(testPath) {
  if (!testPath || typeof testPath !== 'string') return false;
  return /cockpit-persistence|factory-reset/i.test(testPath);
}
