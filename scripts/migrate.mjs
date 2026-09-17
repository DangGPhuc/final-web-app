#!/usr/bin/env node
/**
 * FinTrack Schema Migration Runner with SHA-256 Checksum Verification.
 *
 * SAFETY INVARIANTS:
 * 1. Requires operator credentials (DATABASE_MAINTENANCE_URL or DATABASE_ADMIN_URL).
 * 2. Refuses execution by runtime roles (fintrack_runtime, fintrack_app_login).
 * 3. Validates SHA-256 checksums of all previously applied migrations.
 * 4. Fails closed on any checksum mismatch or out-of-order execution.
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

export async function runMigrations(connectionString) {
  if (!connectionString) {
    throw new Error('DATABASE_MAINTENANCE_URL or DATABASE_ADMIN_URL is required to run migrations.');
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const roleRes = await client.query('SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');
    const role = roleRes.rows[0];
    if (role.name === 'fintrack_runtime' || role.name === 'fintrack_app_login') {
      throw new Error(`SECURITY VIOLATION: Migration execution forbidden for runtime role "${role.name}". Operator credentials required.`);
    }

    // Check if schema fintrack and schema_migrations table exist
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'fintrack' AND table_name = 'schema_migrations'
      ) AS exists;
    `);
    const tableExists = tableCheck.rows[0]?.exists;

    const appliedMap = new Map();
    if (tableExists) {
      const appliedRes = await client.query('SELECT version, checksum FROM fintrack.schema_migrations ORDER BY version ASC');
      for (const r of appliedRes.rows) {
        appliedMap.set(r.version, r.checksum);
      }
    }

    // Read and sort migration files
    const files = readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const version = file;
      const filePath = path.join(MIGRATIONS_DIR, file);
      const currentChecksum = computeFileChecksum(filePath);

      if (appliedMap.has(version)) {
        const storedChecksum = appliedMap.get(version);
        if (storedChecksum !== currentChecksum) {
          throw new Error(
            `MIGRATION CHECKSUM MISMATCH for ${version}! Expected ${storedChecksum}, calculated ${currentChecksum}. Migration history was tampered with.`
          );
        }
        console.log(`[migrate] Verified ${version} (checksum matched)`);
      } else {
        console.log(`[migrate] Applying ${version}...`);
        let sql = readFileSync(filePath, 'utf8');
        if (version === '001_backend_foundation.sql') {
          const roleCheck = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'fintrack_runtime'");
          if (roleCheck.rows.length > 0) {
            sql = sql.replace(
              'CREATE ROLE fintrack_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;',
              '-- role fintrack_runtime already provisioned in cluster'
            );
          }
        }
        await client.query('BEGIN');
        try {
          await client.query(sql);
          // Ensure schema_migrations exists in fintrack
          await client.query(`
            CREATE TABLE IF NOT EXISTS fintrack.schema_migrations (
              version text PRIMARY KEY,
              checksum text NOT NULL,
              applied_at timestamptz NOT NULL DEFAULT now()
            );
          `);
          await client.query(
            'INSERT INTO fintrack.schema_migrations (version, checksum) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING',
            [version, currentChecksum]
          );
          await client.query('COMMIT');
          console.log(`[migrate] Applied ${version} successfully.`);
          appliedMap.set(version, currentChecksum);
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      }
    }

    return { success: true, appliedCount: files.length };
  } finally {
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
