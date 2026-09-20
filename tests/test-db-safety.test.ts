import { describe, it, expect } from 'vitest';
import {
  validateTestDatabaseEnvironment,
  enforceTestDatabaseSafety,
  sanitizeDatabaseUrl,
} from '../scripts/lib/test-db-safety.mjs';

describe('Test Database Safety Guard (scripts/lib/test-db-safety.mjs)', () => {
  const VALID_TEST_URL = 'postgresql://postgres:super_secret_pass@localhost:5432/fintrack_test?schema=public';

  describe('1. Missing ALLOW_DESTRUCTIVE_DB_TESTS', () => {
    it('rejects when ALLOW_DESTRUCTIVE_DB_TESTS is undefined or omitted', () => {
      expect(() =>
        validateTestDatabaseEnvironment({ DATABASE_TEST_URL: VALID_TEST_URL })
      ).toThrow(/Destructive DB tests require explicit opt-in/);
    });
  });

  describe('2. Value other than literal "true"', () => {
    it('rejects non-literal values such as "1", "false", "yes", "TRUE", empty string', () => {
      const invalidValues = ['1', 'false', 'yes', 'TRUE', 'True', '', '0', 'null'];
      for (const val of invalidValues) {
        expect(() =>
          validateTestDatabaseEnvironment({
            ALLOW_DESTRUCTIVE_DB_TESTS: val,
            DATABASE_TEST_URL: VALID_TEST_URL,
          })
        ).toThrow(/Destructive DB tests require explicit opt-in/);
      }
    });
  });

  describe('3. Missing DATABASE_TEST_URL', () => {
    it('rejects when DATABASE_TEST_URL is missing, empty, or whitespace', () => {
      expect(() =>
        validateTestDatabaseEnvironment({ ALLOW_DESTRUCTIVE_DB_TESTS: 'true' })
      ).toThrow(/DATABASE_TEST_URL is missing or empty/);

      expect(() =>
        validateTestDatabaseEnvironment({
          ALLOW_DESTRUCTIVE_DB_TESTS: 'true',
          DATABASE_TEST_URL: '',
        })
      ).toThrow(/DATABASE_TEST_URL is missing or empty/);

      expect(() =>
        validateTestDatabaseEnvironment({
          ALLOW_DESTRUCTIVE_DB_TESTS: 'true',
          DATABASE_TEST_URL: '   ',
        })
      ).toThrow(/DATABASE_TEST_URL is missing or empty/);
    });
  });

  describe('4. Malformed URL', () => {
    it('rejects invalid or unparseable URLs', () => {
      const malformedUrls = ['not_a_url', ':::invalid:::', 'http//missing_colon'];
      for (const url of malformedUrls) {
        expect(() =>
          validateTestDatabaseEnvironment({
            ALLOW_DESTRUCTIVE_DB_TESTS: 'true',
            DATABASE_TEST_URL: url,
          })
        ).toThrow(/DATABASE_TEST_URL is malformed/);
      }
    });
  });

  describe('5. Non-PostgreSQL URL', () => {
    it('rejects MySQL, SQLite, HTTP, and other non-Postgres protocols', () => {
      const nonPgUrls = [
        'mysql://root:pass@localhost:3306/fintrack_test',
        'mongodb://root:pass@localhost:27017/fintrack_test',
        'http://localhost:5432/fintrack_test',
        'https://localhost:5432/fintrack_test',
      ];
      for (const url of nonPgUrls) {
        expect(() =>
          validateTestDatabaseEnvironment({
            ALLOW_DESTRUCTIVE_DB_TESTS: 'true',
            DATABASE_TEST_URL: url,
          })
        ).toThrow(/Expected "postgresql:" or "postgres:"/);
      }
    });
  });

  describe('6. DATABASE_TEST_URL ending in /personal_finance or pointing to forbidden DB', () => {
    it('strictly rejects personal_finance database', () => {
      const forbiddenUrls = [
        'postgresql://postgres:pass@localhost:5432/personal_finance',
        'postgresql://postgres:pass@localhost:5432/personal_finance?schema=public',
        'postgres://user:pass@127.0.0.1:5432/personal_finance',
      ];
      for (const url of forbiddenUrls) {
        expect(() =>
          validateTestDatabaseEnvironment({
            ALLOW_DESTRUCTIVE_DB_TESTS: 'true',
            DATABASE_TEST_URL: url,
          })
        ).toThrow(/points to forbidden database/);
      }
    });

    it('strictly rejects default system databases: postgres, template0, template1', () => {
      const systemUrls = [
        'postgresql://postgres:pass@localhost:5432/postgres',
        'postgresql://postgres:pass@localhost:5432/template0',
        'postgresql://postgres:pass@localhost:5432/template1',
      ];
      for (const url of systemUrls) {
        expect(() =>
          validateTestDatabaseEnvironment({
            ALLOW_DESTRUCTIVE_DB_TESTS: 'true',
            DATABASE_TEST_URL: url,
          })
        ).toThrow(/points to forbidden database/);
      }
    });
  });

  describe('7. Database without "test" marker', () => {
    it('rejects database names that do not contain the "test" marker', () => {
      const nonTestDbs = [
        'postgresql://postgres:pass@localhost:5432/fintrack_production',
        'postgresql://postgres:pass@localhost:5432/fintrack_staging',
        'postgresql://postgres:pass@localhost:5432/cockpit_live',
        'postgresql://postgres:pass@localhost:5432/app_db',
      ];
      for (const url of nonTestDbs) {
        expect(() =>
          validateTestDatabaseEnvironment({
            ALLOW_DESTRUCTIVE_DB_TESTS: 'true',
            DATABASE_TEST_URL: url,
          })
        ).toThrow(/does not contain the required "test" marker/);
      }
    });
  });

  describe('8. Accepts fintrack_test and sets DATABASE_URL authoritatively', () => {
    it('accepts valid disposable test database with fintrack_test name', () => {
      const env = {
        ALLOW_DESTRUCTIVE_DB_TESTS: 'true',
        DATABASE_TEST_URL: VALID_TEST_URL,
        DATABASE_URL: 'postgresql://postgres:app_secret@localhost:5432/personal_finance', // existing application DB to be ignored
      };

      const result = validateTestDatabaseEnvironment(env);
      expect(result.valid).toBe(true);
      expect(result.dbName).toBe('fintrack_test');
      expect(result.testUrl).toBe(VALID_TEST_URL);

      // enforceTestDatabaseSafety overrides DATABASE_URL authoritatively
      enforceTestDatabaseSafety(env);
      expect(env.DATABASE_URL).toBe(VALID_TEST_URL);
      expect(env.DATABASE_URL).not.toContain('personal_finance');
    });

    it('accepts postgres: protocol shorthand with test marker', () => {
      const env = {
        ALLOW_DESTRUCTIVE_DB_TESTS: 'true',
        DATABASE_TEST_URL: 'postgres://postgres:pass@localhost:5432/my_test_database',
      };
      const result = validateTestDatabaseEnvironment(env);
      expect(result.valid).toBe(true);
      expect(result.dbName).toBe('my_test_database');
    });
  });

  describe('9. Credential Sanitization (Never expose passwords)', () => {
    it('masks password in sanitizedUrl and never exposes secret password in thrown error messages', () => {
      const SECRET_PASSWORD = 'super_secret_forbidden_cleartext_pw_98765';
      const rawUrlWithSecret = `postgresql://postgres:${SECRET_PASSWORD}@localhost:5432/forbidden_prod_db`;

      // 1. URL sanitizer masks password
      const sanitized = sanitizeDatabaseUrl(rawUrlWithSecret);
      expect(sanitized).toContain(':***@');
      expect(sanitized).not.toContain(SECRET_PASSWORD);

      // 2. Thrown validation errors do not contain the secret password
      try {
        validateTestDatabaseEnvironment({
          ALLOW_DESTRUCTIVE_DB_TESTS: 'true',
          DATABASE_TEST_URL: rawUrlWithSecret,
        });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).not.toContain(SECRET_PASSWORD);
      }

      // 3. For malformed URL sanitizer returns fallback without throwing
      expect(sanitizeDatabaseUrl('malformed_string')).toBe('[malformed-url]');
      expect(sanitizeDatabaseUrl('')).toBe('[empty-url]');
    });
  });
});
