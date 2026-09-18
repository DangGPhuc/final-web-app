#!/usr/bin/env node
/**
 * Test & Restore Database URL Safety Validator.
 * 
 * Enforces strict safety guards before any destructive script (e.g. backup-restore-drill.sh)
 * can execute DROP DATABASE, DROP SCHEMA, DROP ROLE, or ALTER ROLE.
 */

export function validateTestDbUrls(sourceUrl, restoreUrl) {
  if (process.env.ALLOW_DESTRUCTIVE_DB_TESTS !== 'true') {
    throw new Error(
      'REFUSING DESTRUCTIVE ACTION: ALLOW_DESTRUCTIVE_DB_TESTS=true is strictly required.'
    );
  }

  if (!sourceUrl || !restoreUrl) {
    throw new Error(
      'DATABASE_TEST_URL and DATABASE_RESTORE_URL are strictly required.'
    );
  }

  function extractDbName(urlStr, label) {
    try {
      const parsed = new URL(urlStr);
      const name = parsed.pathname.replace(/^\//, '');
      if (!name) throw new Error();
      return name;
    } catch {
      const parts = urlStr.split('/');
      const name = parts[parts.length - 1] || '';
      if (!name) {
        throw new Error(`Invalid ${label} database URL: unable to extract database name.`);
      }
      return name;
    }
  }

  const sourceDb = extractDbName(sourceUrl, 'source');
  const restoreDb = extractDbName(restoreUrl, 'restore');

  const disallowed = ['fintrack', 'postgres', 'production', 'master'];
  if (disallowed.includes(sourceDb.toLowerCase())) {
    throw new Error(
      `REFUSING DESTRUCTIVE ACTION: Source database "${sourceDb}" is a forbidden production or system database name.`
    );
  }

  if (disallowed.includes(restoreDb.toLowerCase())) {
    throw new Error(
      `REFUSING DESTRUCTIVE ACTION: Restore database "${restoreDb}" is a forbidden production or system database name.`
    );
  }

  const safeDisposablePattern = /_test$|_ci$|^fintrack_test$|^fintrack_restore$/i;
  if (!safeDisposablePattern.test(sourceDb)) {
    throw new Error(
      `REFUSING DESTRUCTIVE ACTION: Source database "${sourceDb}" does not match safe test patterns (*_test, *_ci, fintrack_test, fintrack_restore).`
    );
  }

  if (!safeDisposablePattern.test(restoreDb)) {
    throw new Error(
      `REFUSING DESTRUCTIVE ACTION: Restore database "${restoreDb}" does not match safe restore patterns (*_test, *_ci, fintrack_test, fintrack_restore).`
    );
  }

  if (sourceDb.toLowerCase() === restoreDb.toLowerCase()) {
    throw new Error(
      `REFUSING DESTRUCTIVE ACTION: Source database "${sourceDb}" and restore database "${restoreDb}" must be distinct.`
    );
  }

  return { sourceDb, restoreDb };
}

if (process.argv[1] && process.argv[1].endsWith('validate-test-db.mjs')) {
  const source = process.argv[2] || process.env.DATABASE_TEST_URL;
  const restore = process.argv[3] || process.env.DATABASE_RESTORE_URL;

  try {
    const { sourceDb, restoreDb } = validateTestDbUrls(source, restore);
    console.log(`[validate-test-db] Verified safe test URLs: source=${sourceDb}, restore=${restoreDb}`);
    process.exit(0);
  } catch (err) {
    console.error(`[validate-test-db] ERROR: ${err.message}`);
    process.exit(1);
  }
}
