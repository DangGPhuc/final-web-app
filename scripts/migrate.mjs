#!/usr/bin/env node
/**
 * FinTrack Schema Migration Runner with Atomic Transaction Management
 * and Exact-Prefix History Verification.
 *
 * SAFETY INVARIANTS:
 * 1. Requires operator credentials (DATABASE_MAINTENANCE_URL or DATABASE_ADMIN_URL).
 * 2. Refuses execution by application runtime/login roles (fintrack_runtime, fintrack_app_login).
 * 3. Runner strictly owns transaction boundary across migration DDL and checksum recording.
 * 4. Raw migration files on disk remain byte-for-byte immutable; checksums calculated on raw content.
 * 5. Applied migrations must be an EXACT PREFIX of sorted repository migration files.
 * 6. Fails closed on: missing historical file, history gap, out-of-order insertion, checksum mismatch,
 *    or legacy schema without migration history.
 */
import { Client } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.resolve(__dirname, '../db/migrations');

export function computeFileChecksum(filePath) {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Prepares raw migration SQL for runner-managed transaction execution.
 * - Legacy migrations (001-003) have their outer BEGIN; and COMMIT; stripped.
 * - Migrations 004+ must NOT contain top-level transaction control.
 */
export function prepareMigrationForExecution(raw, filename) {
  const legacyMigrations = [
    '001_backend_foundation.sql',
    '002_backend_security_hardening.sql',
    '003_backend_deployment_closure.sql',
  ];

  if (legacyMigrations.includes(filename)) {
    // Strip leading comments and whitespace before finding outer BEGIN;
    const strippedLeading = raw.replace(/^(\s*(--[^\r\n]*\r?\n|\/\*[\s\S]*?\*\/))*\s*/, '');
    if (!strippedLeading.startsWith('BEGIN;')) {
      throw new Error(
        `INVALID_LEGACY_MIGRATION_FORMAT: Expected ${filename} to have outer BEGIN; statement.`
      );
    }
    const afterBegin = strippedLeading.replace(/^BEGIN;\s*/i, '');
    // Check trailing COMMIT; (allowing trailing whitespace/comments)
    const strippedTrailing = afterBegin.replace(/\s*(--[^\r\n]*\r?\n?|\/\*[\s\S]*?\*\/)*\s*$/, '');
    if (!strippedTrailing.endsWith('COMMIT;')) {
      throw new Error(
        `INVALID_LEGACY_MIGRATION_FORMAT: Expected ${filename} to have outer COMMIT; statement.`
      );
    }
    const withoutCommit = strippedTrailing.replace(/\s*COMMIT;\s*$/i, '');
    return withoutCommit;
  }

  // For 004+ migrations: runner owns transaction.
  // Validate that file contains no top-level BEGIN/COMMIT/ROLLBACK statements.
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^(BEGIN|COMMIT|ROLLBACK)(\s+TRANSACTION)?\s*;/i.test(line)) {
      throw new Error(
        `INVALID_MIGRATION_TRANSACTION_CONTROL: Migration ${filename} line ${i + 1} contains transaction control statement "${line}". Migrations 004+ must not contain top-level transaction control; the runner manages transactions atomically.`
      );
    }
  }

  return raw;
}

export async function runMigrations(connectionString) {
  if (!connectionString) {
    throw new Error('DATABASE_MAINTENANCE_URL or DATABASE_ADMIN_URL is required to run migrations.');
  }

  const client = new Client({ connectionString });
  await client.connect();

  let lockAcquired = false;
  try {
    const roleRes = await client.query('SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');
    const role = roleRes.rows[0];
    if (role.name === 'fintrack_runtime' || role.name === 'fintrack_app_login') {
      throw new Error(`SECURITY VIOLATION: Migration execution forbidden for runtime role "${role.name}". Operator credentials required.`);
    }

    // Acquire session-level advisory lock to serialize migration execution across concurrent runners
    await client.query("SELECT pg_advisory_lock(hashtextextended('fintrack:migrations', 0))");
    lockAcquired = true;

    // 1. Check if schema fintrack exists
    const schemaCheck = await client.query(`
      SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'fintrack') AS exists;
    `);
    const schemaExists = schemaCheck.rows[0]?.exists;

    // 2. Check if schema_migrations table exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'fintrack' AND table_name = 'schema_migrations'
      ) AS exists;
    `);
    const tableExists = tableCheck.rows[0]?.exists;

    // 3. Fail closed if legacy fintrack tables exist without migration history
    if (schemaExists && !tableExists) {
      const existingTables = await client.query(`
        SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'fintrack'
      `);
      if (existingTables.rows[0]?.count > 0) {
        throw new Error(
          'LEGACY_SCHEMA_ADOPTION_UNSUPPORTED: Existing fintrack tables detected without schema_migrations table. Legacy schema adoption is unsupported. Restore from a trusted backup with authentic migration history or execute a reviewed dedicated migration plan.'
        );
      }
    }

    // 4. Fetch applied migrations from database ordered by version
    const appliedRows = tableExists
      ? (await client.query('SELECT version, checksum FROM fintrack.schema_migrations ORDER BY version ASC')).rows
      : [];

    // 5. Read all migration files from repository sorted
    const files = readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    // 6. EXACT PREFIX INVARIANT:
    // Applied migrations must be an exact prefix of sorted files in repository.
    if (appliedRows.length > files.length) {
      throw new Error(
        `MIGRATION_HISTORY_GAP: Database has ${appliedRows.length} applied migrations, but repository has only ${files.length} migration files. Applied migrations were deleted from repository.`
      );
    }

    for (let i = 0; i < appliedRows.length; i++) {
      const applied = appliedRows[i];
      const repoFile = files[i];

      if (applied.version !== repoFile) {
        throw new Error(
          `MIGRATION_HISTORY_MISMATCH: Out-of-order insertion or gap detected! Applied migration #${i + 1} is "${applied.version}", but repository file is "${repoFile}".`
        );
      }

      const filePath = path.join(MIGRATIONS_DIR, repoFile);
      const currentChecksum = computeFileChecksum(filePath);
      if (applied.checksum !== currentChecksum) {
        throw new Error(
          `MIGRATION_CHECKSUM_MISMATCH: Checksum mismatch for ${repoFile}! Recorded ${applied.checksum}, file on disk has ${currentChecksum}. Migration history was tampered with.`
        );
      }
      console.log(`[migrate] Verified ${repoFile} (checksum matched)`);
    }

    // 7. Apply pending migrations atomically
    const pendingFiles = files.slice(appliedRows.length);
    if (pendingFiles.length === 0) {
      console.log('[migrate] Database schema is up to date.');
      return { success: true, appliedCount: 0, totalCount: files.length };
    }

    for (const file of pendingFiles) {
      const version = file;
      const filePath = path.join(MIGRATIONS_DIR, file);
      const rawSql = readFileSync(filePath, 'utf8');
      const currentChecksum = computeFileChecksum(filePath);

      let executionSql = prepareMigrationForExecution(rawSql, file);

      // In cluster environment, if fintrack_runtime already provisioned, skip duplicate CREATE ROLE in 001
      if (version === '001_backend_foundation.sql') {
        const roleCheck = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'fintrack_runtime'");
        if (roleCheck.rows.length > 0) {
          executionSql = executionSql.replace(
            'CREATE ROLE fintrack_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;',
            '-- role fintrack_runtime already provisioned in cluster'
          );
        }
      }

      console.log(`[migrate] Applying ${version}...`);
      await client.query('BEGIN');
      try {
        await client.query(executionSql);

        // Ensure schema_migrations table exists (in fintrack schema)
        await client.query(`
          CREATE SCHEMA IF NOT EXISTS fintrack;
          CREATE TABLE IF NOT EXISTS fintrack.schema_migrations (
            version text PRIMARY KEY,
            checksum text NOT NULL,
            applied_at timestamptz NOT NULL DEFAULT now()
          );
        `);

        // Record checksum within the same transaction
        await client.query(
          'INSERT INTO fintrack.schema_migrations (version, checksum) VALUES ($1, $2)',
          [version, currentChecksum]
        );

        await client.query('COMMIT');
        console.log(`[migrate] Applied ${version} successfully.`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    return { success: true, appliedCount: pendingFiles.length, totalCount: files.length };
  } finally {
    if (lockAcquired) {
      try {
        await client.query("SELECT pg_advisory_unlock(hashtextextended('fintrack:migrations', 0))");
      } catch (err) {
        console.error('[migrate] Failed to release advisory lock:', err);
      }
    }
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_MAINTENANCE_URL || process.env.DATABASE_ADMIN_URL;
  if (!url) {
    console.error('ERROR: DATABASE_MAINTENANCE_URL or DATABASE_ADMIN_URL is required to run migrations.');
    process.exit(1);
  }

  runMigrations(url)
    .then(() => {
      console.log('[migrate] All migrations applied and verified.');
      process.exit(0);
    })
    .catch(err => {
      console.error('[migrate] Migration failure:', err.message);
      process.exit(1);
    });
}
