/**
 * Test Database Safety Guard.
 * 
 * Prevents accidental execution of destructive test routines (DROP SCHEMA, DROP ROLE, DROP TABLE)
 * against non-test or production databases.
 */

export function assertSafeTestDatabaseUrl(url: string | undefined): string {
  if (!url) {
    throw new Error('DATABASE_TEST_URL is required for real PostgreSQL tests.');
  }

  if (process.env.ALLOW_DESTRUCTIVE_DB_TESTS !== 'true') {
    throw new Error(
      'REFUSING DESTRUCTIVE TEST: ALLOW_DESTRUCTIVE_DB_TESTS=true is required to execute destructive database tests.'
    );
  }

  let dbName = '';
  try {
    const parsed = new URL(url);
    dbName = parsed.pathname.replace(/^\//, '');
  } catch {
    const parts = url.split('/');
    dbName = parts[parts.length - 1] || '';
  }

  const disallowedNames = ['fintrack', 'production', 'postgres', 'master'];
  if (disallowedNames.includes(dbName.toLowerCase())) {
    throw new Error(
      `REFUSING DESTRUCTIVE TEST: Database name "${dbName}" is strictly forbidden. Destructive operations cannot target production or system databases.`
    );
  }

  const isSafePattern = /_test$|_ci$|^fintrack_test$/i.test(dbName);
  if (!isSafePattern) {
    throw new Error(
      `REFUSING DESTRUCTIVE TEST: Database name "${dbName}" does not match approved test naming patterns (*_test, *_ci, fintrack_test).`
    );
  }

  return dbName;
}
