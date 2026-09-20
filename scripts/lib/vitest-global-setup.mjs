import { enforceTestDatabaseSafety, isDbBackedTest } from './test-db-safety.mjs';

/**
 * Vitest globalSetup hook.
 *
 * Runs in the main process before workers are spawned or test files are loaded.
 * Ensures that if DB-backed tests are included in the test run, explicit opt-in
 * and disposable test database validation succeed before any tests execute.
 */
export default function globalSetup(project) {
  const patterns = project?.vitest?.filenamePattern;

  // If no specific pattern is provided, Vitest runs all test files (which includes DB tests)
  const isFullSuiteRun = !patterns || (Array.isArray(patterns) && patterns.length === 0);

  // If specific patterns are provided, check if any of them target DB-backed tests
  const targetsDbTest =
    Array.isArray(patterns) &&
    patterns.some(pattern => isDbBackedTest(typeof pattern === 'string' ? pattern : String(pattern)));

  if (isFullSuiteRun || targetsDbTest) {
    enforceTestDatabaseSafety(process.env);
  }
}
