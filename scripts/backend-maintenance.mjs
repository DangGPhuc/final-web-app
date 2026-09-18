#!/usr/bin/env node
/**
 * FinTrack Unified Backend Maintenance Script.
 *
 * SAFETY INVARIANTS:
 * 1. Must NEVER be executed by runtime roles (fintrack_runtime or fintrack_app_login).
 * 2. Requires operator/maintenance credentials via DATABASE_MAINTENANCE_URL or DATABASE_ADMIN_URL.
 * 3. NO fallback to application DATABASE_URL.
 * 4. Idempotency retention: purges records older than 8 days (public SLA: >= 7 days guaranteed).
 * 5. Session retention: purges sessions expired/revoked > 30 days (forensic audit window).
 * 6. Zero secret leakage: logs record counts only, never token hashes.
 */
import { Client } from 'pg';
import { fileURLToPath } from 'node:url';

export async function runMaintenance(connectionString) {
  if (!connectionString) {
    throw new Error('DATABASE_MAINTENANCE_URL or DATABASE_ADMIN_URL is required.');
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const roleCheck = await client.query('SELECT current_user AS name FROM pg_roles WHERE rolname=current_user');
    const currentUser = roleCheck.rows[0]?.name;

    if (
      currentUser === 'fintrack_runtime' ||
      currentUser === 'fintrack_app_login' ||
      currentUser === 'fintrack_auth_runtime' ||
      currentUser === 'fintrack_auth_login'
    ) {
      throw new Error(
        `SECURITY VIOLATION: Maintenance cleanup cannot be executed by application role "${currentUser}". Operator credentials required.`
      );
    }

    console.log(`[backend-maintenance] Connected as role: ${currentUser}`);

    // 1. Purge expired or revoked sessions older than 30-day retention threshold
    const sessionRes = await client.query(`
      DELETE FROM fintrack.sessions
      WHERE (revoked_at IS NOT NULL AND revoked_at < now() - interval '30 days')
         OR (expires_at < now() - interval '30 days');
    `);
    console.log(
      `[backend-maintenance] Purged ${sessionRes.rowCount} session(s) beyond 30-day retention.`
    );

    // 2. Purge idempotency records older than 8 days (SLA guarantee: at least 7 days)
    const idempotencyRes = await client.query(`
      DELETE FROM fintrack.idempotency
      WHERE created_at < now() - interval '8 days';
    `);
    console.log(
      `[backend-maintenance] Purged ${idempotencyRes.rowCount} idempotency record(s) beyond 8-day retention.`
    );

    // 3. Purge expired OAuth login states and consumed states older than 30-day retention
    const oauthStatesRes = await client.query(`
      DELETE FROM fintrack.oauth_login_states
      WHERE (consumed_at IS NOT NULL AND consumed_at < now() - interval '30 days')
         OR (consumed_at IS NULL AND expires_at < now());
    `);
    console.log(
      `[backend-maintenance] Purged ${oauthStatesRes.rowCount} stale OAuth login state(s).`
    );

    return {
      purgedSessions: sessionRes.rowCount,
      purgedIdempotency: idempotencyRes.rowCount,
      purgedOAuthStates: oauthStatesRes.rowCount,
    };
  } finally {
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const connectionString =
    process.env.DATABASE_MAINTENANCE_URL ||
    process.env.DATABASE_ADMIN_URL;

  if (!connectionString) {
    console.error('ERROR: DATABASE_MAINTENANCE_URL or DATABASE_ADMIN_URL is required. Fallback to DATABASE_URL is strictly forbidden.');
    process.exit(1);
  }

  runMaintenance(connectionString)
    .then((stats) => {
      console.log('[backend-maintenance] Maintenance completed successfully:', stats);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[backend-maintenance] Maintenance error:', err.message);
      process.exit(1);
    });
}
