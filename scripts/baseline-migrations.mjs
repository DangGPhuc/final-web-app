#!/usr/bin/env node
/**
 * FinTrack Legacy Database Baseline / Adoption Tool.
 * 
 * OPERATOR-ONLY command to baseline an existing database that has legacy schema
 * without migration history.
 * 
 * Invariants:
 * 1. Requires explicit operator credentials (DATABASE_MAINTENANCE_URL or DATABASE_ADMIN_URL).
 * 2. Refuses execution by application runtime/login roles.
 * 3. Verifies expected structural fingerprints (tables, columns, functions).
 * 4. Records trusted raw file checksums in fintrack.schema_migrations.
 * 5. NEVER runs automatically during web application startup.
 */
import { Client } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.resolve(__dirname, '../db/migrations');

function computeFileChecksum(filePath) {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

export async function baselineLegacyDatabase(connectionString, upToVersion = '003_backend_deployment_closure.sql') {
  if (!connectionString) {
    throw new Error('DATABASE_MAINTENANCE_URL or DATABASE_ADMIN_URL is required to baseline migrations.');
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const roleRes = await client.query('SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');
    const role = roleRes.rows[0];
    if (role.name === 'fintrack_runtime' || role.name === 'fintrack_app_login') {
      throw new Error(`SECURITY VIOLATION: Baseline execution forbidden for runtime role "${role.name}". Operator credentials required.`);
    }

    // 1. Verify schema fintrack exists
    const schemaCheck = await client.query(`
      SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'fintrack') AS exists;
    `);
    if (!schemaCheck.rows[0]?.exists) {
      throw new Error('STRUCTURAL_VERIFICATION_FAILED: Schema "fintrack" does not exist. Cannot baseline empty database.');
    }

    // 2. Verify expected structural fingerprints
    const expectedTables = ['users', 'sessions', 'wallets', 'transfers', 'rate_limits', 'audit_events'];
    for (const table of expectedTables) {
      const tableCheck = await client.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables WHERE table_schema = 'fintrack' AND table_name = $1
        ) AS exists;
      `, [table]);
      if (!tableCheck.rows[0]?.exists) {
        throw new Error(`STRUCTURAL_VERIFICATION_FAILED: Required table "fintrack.${table}" is missing.`);
      }
    }

    // Verify audit_events.request_id exists
    const colCheck = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'fintrack' AND table_name = 'audit_events' AND column_name = 'request_id'
      ) AS exists;
    `);
    if (!colCheck.rows[0]?.exists) {
      throw new Error('STRUCTURAL_VERIFICATION_FAILED: Required column "fintrack.audit_events.request_id" is missing.');
    }

    // 3. Create schema_migrations table if absent
    await client.query(`
      CREATE TABLE IF NOT EXISTS fintrack.schema_migrations (
        version text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    // 4. Record trusted checksums for baseline migrations
    const files = readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    const baselineFiles = files.filter(f => f <= upToVersion);
    await client.query('BEGIN');
    try {
      for (const file of baselineFiles) {
        const filePath = path.join(MIGRATIONS_DIR, file);
        const checksum = computeFileChecksum(filePath);
        await client.query(`
          INSERT INTO fintrack.schema_migrations (version, checksum)
          VALUES ($1, $2)
          ON CONFLICT (version) DO UPDATE SET checksum = EXCLUDED.checksum;
        `, [file, checksum]);
        console.log(`[baseline] Recorded baseline migration ${file} (${checksum.substring(0, 12)}...)`);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }

    return { success: true, baselinedCount: baselineFiles.length };
  } finally {
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_MAINTENANCE_URL || process.env.DATABASE_ADMIN_URL;
  if (!url) {
    console.error('ERROR: DATABASE_MAINTENANCE_URL or DATABASE_ADMIN_URL is required to run baseline.');
    process.exit(1);
  }

  baselineLegacyDatabase(url)
    .then(res => {
      console.log(`[baseline] Successfully baselined ${res.baselinedCount} legacy migrations.`);
      process.exit(0);
    })
    .catch(err => {
      console.error('[baseline] Baseline failure:', err.message);
      process.exit(1);
    });
}
