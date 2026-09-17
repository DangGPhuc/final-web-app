#!/usr/bin/env node
/**
 * Out-of-band maintenance script for purging expired / revoked sessions.
 *
 * SAFETY INVARIANTS:
 * 1. Must NEVER be executed by the web runtime role (fintrack_runtime).
 * 2. Requires operator/maintenance credentials via DATABASE_MAINTENANCE_URL or DATABASE_ADMIN_URL.
 * 3. Keeps expired/revoked sessions for a 30-day retention/forensic audit window before deletion.
 */
import { Client } from 'pg';

const connectionString =
  process.env.DATABASE_MAINTENANCE_URL ||
  process.env.DATABASE_ADMIN_URL;

if (!connectionString) {
  console.error('ERROR: DATABASE_MAINTENANCE_URL or DATABASE_ADMIN_URL is required. Fallback to DATABASE_URL is strictly forbidden.');
  process.exit(1);
}

async function runMaintenance() {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    const roleCheck = await client.query('SELECT current_user AS name');
    const currentUser = roleCheck.rows[0]?.name;

    if (currentUser === 'fintrack_runtime' || currentUser === 'fintrack_app_login') {
      console.error(
        `SECURITY VIOLATION: Maintenance cleanup cannot be executed by application role "${currentUser}". Operator credentials required.`
      );
      process.exit(1);
    }

    console.log(`[session-maintenance] Connected as role: ${currentUser}`);

    // Delete sessions expired or revoked for more than 30 days
    const result = await client.query(`
      DELETE FROM fintrack.sessions
      WHERE (revoked_at IS NOT NULL AND revoked_at < now() - interval '30 days')
         OR (expires_at < now() - interval '30 days');
    `);

    console.log(
      `[session-maintenance] Successfully purged ${result.rowCount} session(s) older than 30-day retention threshold.`
    );
  } catch (error) {
    console.error('[session-maintenance] Maintenance failure:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMaintenance();
