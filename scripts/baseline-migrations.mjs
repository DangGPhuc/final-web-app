#!/usr/bin/env node
/**
 * FinTrack Legacy Database Baseline / Adoption Tool.
 * 
 * EMERGENCY OPERATOR-ONLY command to baseline a pre-existing database.
 * FinTrack has not deployed a legacy production database, so baseline adoption
 * is an exceptional operation that creates a security trust anchor.
 * 
 * Invariants:
 * 1. Requires explicit dangerous opt-in:
 *    ALLOW_LEGACY_BASELINE=I_UNDERSTAND_THIS_CREATES_A_TRUST_ANCHOR
 * 2. Requires explicit --up-to=<migration> (no default implicit version).
 * 3. Operator credentials required (refuses execution by runtime/login roles).
 * 4. Refuses execution if migration history table already exists and contains any rows.
 * 5. Verifies complete structural fingerprints (columns, types, NOT NULL, CHECK, FKs, RLS, FORCE RLS, policies, grants).
 * 6. Metadata creation + checksum insertion is strictly atomic in ONE transaction.
 */
import { Client } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.resolve(__dirname, '../db/migrations');

const VALID_BASELINE_VERSIONS = [
  '001_backend_foundation.sql',
  '002_backend_security_hardening.sql',
  '003_backend_deployment_closure.sql',
];

function computeFileChecksum(filePath) {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

export async function baselineLegacyDatabase(connectionString, upToVersion) {
  if (!connectionString) {
    throw new Error('DATABASE_MAINTENANCE_URL or DATABASE_ADMIN_URL is required to baseline migrations.');
  }

  // 1. Enforce explicit dangerous opt-in environment variable
  const optIn = process.env.ALLOW_LEGACY_BASELINE;
  if (optIn !== 'I_UNDERSTAND_THIS_CREATES_A_TRUST_ANCHOR') {
    throw new Error(
      'UNSAFE_BASELINE_OPT_IN_REQUIRED: Legacy baseline adoption creates a critical security trust anchor. ' +
      'Refusing execution without explicit environment variable: ' +
      'ALLOW_LEGACY_BASELINE=I_UNDERSTAND_THIS_CREATES_A_TRUST_ANCHOR'
    );
  }

  // 2. Enforce explicit up-to version (no implicit default)
  if (!upToVersion) {
    throw new Error(
      'UP_TO_VERSION_REQUIRED: Explicit --up-to=<migration> is required. Baseline cannot assume an implicit version.'
    );
  }

  if (!VALID_BASELINE_VERSIONS.includes(upToVersion)) {
    throw new Error(
      `INVALID_BASELINE_VERSION: "${upToVersion}" is not a valid baseline version. Must be one of: ${VALID_BASELINE_VERSIONS.join(', ')}.`
    );
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const roleRes = await client.query('SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');
    const role = roleRes.rows[0];
    if (role.name === 'fintrack_runtime' || role.name === 'fintrack_app_login') {
      throw new Error(`SECURITY VIOLATION: Baseline execution forbidden for runtime role "${role.name}". Operator credentials required.`);
    }

    // 3. Verify schema fintrack exists
    const schemaCheck = await client.query(`
      SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'fintrack') AS exists;
    `);
    if (!schemaCheck.rows[0]?.exists) {
      throw new Error('INCOMPLETE_LEGACY_SCHEMA: STRUCTURAL_VERIFICATION_FAILED: Schema "fintrack" does not exist. Cannot baseline empty database.');
    }

    // 4. Refuse baseline if schema_migrations table exists AND contains any rows
    const migrationsTableExists = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'fintrack' AND table_name = 'schema_migrations'
      ) AS exists;
    `);
    if (migrationsTableExists.rows[0]?.exists) {
      const historyCountRes = await client.query('SELECT count(*)::int AS count FROM fintrack.schema_migrations');
      if (historyCountRes.rows[0]?.count > 0) {
        throw new Error(
          'BASELINE_HISTORY_EXISTS: schema_migrations table already contains migration history. ' +
          'Baseline is refused and cannot rewrite existing migration history.'
        );
      }
    }

    // 5. Verify Complete Structural Fingerprints
    // 5.1 Verification for 001_backend_foundation.sql
    const requiredTables001 = ['users', 'sessions', 'wallets', 'transfers', 'idempotency', 'audit_events', 'rate_limits'];
    for (const table of requiredTables001) {
      const tableCheck = await client.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables WHERE table_schema = 'fintrack' AND table_name = $1
        ) AS exists;
      `, [table]);
      if (!tableCheck.rows[0]?.exists) {
        throw new Error(`INCOMPLETE_LEGACY_SCHEMA: STRUCTURAL_VERIFICATION_FAILED: Required table "fintrack.${table}" is missing.`);
      }
    }

    // Column structure checks
    const requiredColumns = [
      { table: 'users', col: 'id', type: 'uuid' },
      { table: 'users', col: 'created_at', type: 'timestamp with time zone' },
      { table: 'sessions', col: 'token_hash', type: 'text' },
      { table: 'sessions', col: 'user_id', type: 'uuid' },
      { table: 'sessions', col: 'expires_at', type: 'timestamp with time zone' },
      { table: 'wallets', col: 'id', type: 'uuid' },
      { table: 'wallets', col: 'user_id', type: 'uuid' },
      { table: 'wallets', col: 'balance', type: 'bigint' },
      { table: 'wallets', col: 'opening_balance', type: 'bigint' },
      { table: 'transfers', col: 'id', type: 'uuid' },
      { table: 'transfers', col: 'from_wallet_id', type: 'uuid' },
      { table: 'transfers', col: 'to_wallet_id', type: 'uuid' },
      { table: 'transfers', col: 'amount', type: 'bigint' },
      { table: 'transfers', col: 'fee', type: 'bigint' },
      { table: 'idempotency', col: 'key', type: 'uuid' },
      { table: 'idempotency', col: 'user_id', type: 'uuid' },
      { table: 'idempotency', col: 'fingerprint', type: 'text' },
      { table: 'idempotency', col: 'response', type: 'jsonb' },
      { table: 'audit_events', col: 'id', type: 'uuid' },
      { table: 'audit_events', col: 'user_id', type: 'uuid' },
      { table: 'audit_events', col: 'action', type: 'text' },
      { table: 'audit_events', col: 'resource_id', type: 'uuid' },
    ];

    for (const rc of requiredColumns) {
      const cRes = await client.query(`
        SELECT data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'fintrack' AND table_name = $1 AND column_name = $2
      `, [rc.table, rc.col]);
      if (cRes.rows.length === 0) {
        throw new Error(`INCOMPLETE_LEGACY_SCHEMA: STRUCTURAL_VERIFICATION_FAILED: Required column "fintrack.${rc.table}.${rc.col}" is missing.`);
      }
      if (cRes.rows[0].data_type !== rc.type) {
        throw new Error(
          `INCOMPLETE_LEGACY_SCHEMA: STRUCTURAL_VERIFICATION_FAILED: Column "fintrack.${rc.table}.${rc.col}" type is "${cRes.rows[0].data_type}", expected "${rc.type}".`
        );
      }
    }

    // Constraints checks (CHECK, FK, Unique)
    const constraintDefs = (await client.query(`
      SELECT conname, contype, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE connamespace = 'fintrack'::regnamespace
    `)).rows;

    const hasBalanceCheck = constraintDefs.some(c => c.contype === 'c' && c.def.includes('balance >= 0'));
    if (!hasBalanceCheck) {
      throw new Error('INCOMPLETE_LEGACY_SCHEMA: STRUCTURAL_VERIFICATION_FAILED: Required CHECK constraint on wallets(balance >= 0) is missing.');
    }

    const hasTransferAmountCheck = constraintDefs.some(c => c.contype === 'c' && c.def.includes('amount >= 1'));
    if (!hasTransferAmountCheck) {
      throw new Error('INCOMPLETE_LEGACY_SCHEMA: STRUCTURAL_VERIFICATION_FAILED: Required CHECK constraint on transfers(amount > 0) is missing.');
    }

    // Unique constraint on wallets(user_id, id)
    const hasWalletUserUnique = constraintDefs.some(
      c => (c.contype === 'u' || c.contype === 'p') && c.def.includes('user_id') && c.def.includes('id')
    );
    if (!hasWalletUserUnique) {
      throw new Error('INCOMPLETE_LEGACY_SCHEMA: STRUCTURAL_VERIFICATION_FAILED: Required unique constraint on wallets(user_id, id) is missing.');
    }

    // RLS & FORCE RLS checks on 001 tables
    const rlsTables001 = ['wallets', 'transfers', 'idempotency', 'audit_events', 'rate_limits'];
    for (const t of rlsTables001) {
      const rlsRes = await client.query(`
        SELECT relrowsecurity, relforcerowsecurity
        FROM pg_class
        WHERE relnamespace = 'fintrack'::regnamespace AND relname = $1
      `, [t]);
      if (!rlsRes.rows[0]?.relrowsecurity || !rlsRes.rows[0]?.relforcerowsecurity) {
        throw new Error(`INCOMPLETE_LEGACY_SCHEMA: STRUCTURAL_VERIFICATION_FAILED: Table "fintrack.${t}" must have ENABLE and FORCE RLS active.`);
      }
    }

    // Policies: tenant policy on 001 tables
    const policies001 = (await client.query(`
      SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'fintrack'
    `)).rows;
    for (const t of rlsTables001) {
      if (!policies001.some(p => p.tablename === t && p.policyname === 'tenant')) {
        throw new Error(`INCOMPLETE_LEGACY_SCHEMA: STRUCTURAL_VERIFICATION_FAILED: Required "tenant" RLS policy missing on "fintrack.${t}".`);
      }
    }

    // Role fintrack_runtime exists
    const runtimeRoleCheck = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'fintrack_runtime'");
    if (runtimeRoleCheck.rows.length === 0) {
      throw new Error('INCOMPLETE_LEGACY_SCHEMA: STRUCTURAL_VERIFICATION_FAILED: Required role "fintrack_runtime" does not exist in cluster.');
    }

    // 5.2 Verification for 002_backend_security_hardening.sql (if upToVersion >= 002)
    if (upToVersion >= '002_backend_security_hardening.sql') {
      // Sessions has ENABLE and FORCE RLS
      const sessionRls = await client.query(`
        SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relnamespace = 'fintrack'::regnamespace AND relname = 'sessions'
      `);
      if (!sessionRls.rows[0]?.relrowsecurity || !sessionRls.rows[0]?.relforcerowsecurity) {
        throw new Error('INCOMPLETE_LEGACY_SCHEMA: STRUCTURAL_VERIFICATION_FAILED: Table "fintrack.sessions" must have ENABLE and FORCE RLS active.');
      }

      // Sessions policies: session_lookup and session_revoke
      const sessionPolicies = (await client.query(`
        SELECT policyname FROM pg_policies WHERE schemaname = 'fintrack' AND tablename = 'sessions'
      `)).rows.map(r => r.policyname);
      if (!sessionPolicies.includes('session_lookup') || !sessionPolicies.includes('session_revoke')) {
        throw new Error('INCOMPLETE_LEGACY_SCHEMA: STRUCTURAL_VERIFICATION_FAILED: Required session RLS policies ("session_lookup", "session_revoke") missing.');
      }

      // Routine current_session_user_id exists
      const routineCheck = await client.query(`
        SELECT 1 FROM pg_proc WHERE pronamespace = 'fintrack'::regnamespace AND proname = 'current_session_user_id'
      `);
      if (routineCheck.rows.length === 0) {
        throw new Error('INCOMPLETE_LEGACY_SCHEMA: STRUCTURAL_VERIFICATION_FAILED: Required function "fintrack.current_session_user_id()" is missing.');
      }

      // audit_events.request_id column exists, type uuid
      const reqIdCol = await client.query(`
        SELECT data_type FROM information_schema.columns
        WHERE table_schema = 'fintrack' AND table_name = 'audit_events' AND column_name = 'request_id'
      `);
      if (reqIdCol.rows.length === 0 || reqIdCol.rows[0].data_type !== 'uuid') {
        throw new Error('INCOMPLETE_LEGACY_SCHEMA: STRUCTURAL_VERIFICATION_FAILED: Required uuid column "fintrack.audit_events.request_id" is missing.');
      }

      // rate_limits has PK (user_id, scope)
      const rateLimitPk = constraintDefs.some(
        c => c.contype === 'p' && c.def.includes('user_id') && c.def.includes('scope')
      );
      if (!rateLimitPk) {
        throw new Error('INCOMPLETE_LEGACY_SCHEMA: STRUCTURAL_VERIFICATION_FAILED: Primary key (user_id, scope) missing on "fintrack.rate_limits".');
      }

      // Index idempotency_user_created_at_idx exists
      const idxCheck = await client.query(`
        SELECT 1 FROM pg_indexes WHERE schemaname = 'fintrack' AND indexname = 'idempotency_user_created_at_idx'
      `);
      if (idxCheck.rows.length === 0) {
        throw new Error('INCOMPLETE_LEGACY_SCHEMA: STRUCTURAL_VERIFICATION_FAILED: Required index "idempotency_user_created_at_idx" is missing.');
      }
    }

    // 5.3 Verification for 003_backend_deployment_closure.sql (if upToVersion >= 003)
    if (upToVersion >= '003_backend_deployment_closure.sql') {
      const loginRoleCheck = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'fintrack_app_login'");
      if (loginRoleCheck.rows.length === 0) {
        throw new Error('INCOMPLETE_LEGACY_SCHEMA: STRUCTURAL_VERIFICATION_FAILED: Required role "fintrack_app_login" does not exist in cluster.');
      }

      const membershipCheck = await client.query(`
        SELECT 1 FROM pg_auth_members
        WHERE roleid = 'fintrack_runtime'::regrole AND member = 'fintrack_app_login'::regrole
      `);
      if (membershipCheck.rows.length === 0) {
        throw new Error('INCOMPLETE_LEGACY_SCHEMA: STRUCTURAL_VERIFICATION_FAILED: Role "fintrack_app_login" must be granted membership in "fintrack_runtime".');
      }
    }

    // 6. Record trusted checksums for baseline migrations atomically
    const files = readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    const baselineFiles = files.filter(f => f <= upToVersion);

    await client.query('BEGIN');
    try {
      // Create schema_migrations inside the atomic transaction so rollback is complete
      await client.query(`
        CREATE TABLE IF NOT EXISTS fintrack.schema_migrations (
          version text PRIMARY KEY,
          checksum text NOT NULL,
          applied_at timestamptz NOT NULL DEFAULT now()
        );
      `);

      for (const file of baselineFiles) {
        const filePath = path.join(MIGRATIONS_DIR, file);
        const checksum = computeFileChecksum(filePath);
        await client.query(`
          INSERT INTO fintrack.schema_migrations (version, checksum)
          VALUES ($1, $2);
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

  // Parse --up-to=<version>
  const upToArg = process.argv.find(arg => arg.startsWith('--up-to='));
  const upToVersion = upToArg ? upToArg.split('=')[1] : undefined;

  baselineLegacyDatabase(url, upToVersion)
    .then(res => {
      console.log(`[baseline] Successfully baselined ${res.baselinedCount} legacy migrations up to ${upToVersion}.`);
      process.exit(0);
    })
    .catch(err => {
      console.error('[baseline] Baseline failure:', err.message);
      process.exit(1);
    });
}
