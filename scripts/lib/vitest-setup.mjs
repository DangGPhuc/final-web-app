import { expect } from 'vitest';
import { enforceTestDatabaseSafety, isDbBackedTest } from './test-db-safety.mjs';

/**
 * Vitest setup file executed inside each test worker before test modules and
 * their static imports are evaluated.
 *
 * For DB-backed test files, enforces safety validation and guarantees that
 * process.env.DATABASE_URL is authoritatively set from DATABASE_TEST_URL
 * before Prisma Client initializes.
 */
const testPath = expect.getState()?.testPath || '';
if (isDbBackedTest(testPath)) {
  enforceTestDatabaseSafety(process.env);
}
