#!/usr/bin/env node
/**
 * DEPRECATED STUB — session-maintenance.mjs
 *
 * This file is preserved for historical operator familiarity only.
 * It delegates entirely to the canonical implementation: scripts/backend-maintenance.mjs
 *
 * CANONICAL COMMAND:
 *   DATABASE_MAINTENANCE_URL=<url> node scripts/backend-maintenance.mjs
 *   npm run maintenance:backend
 *
 * DO NOT add independent retention logic here. All retention policy
 * (session purge, idempotency purge) is implemented in backend-maintenance.mjs.
 */
import { runMaintenance } from './backend-maintenance.mjs';

const connectionString =
  process.env.DATABASE_MAINTENANCE_URL ||
  process.env.DATABASE_ADMIN_URL;

if (!connectionString) {
  console.error(
    'ERROR: DATABASE_MAINTENANCE_URL or DATABASE_ADMIN_URL is required. ' +
    'Fallback to DATABASE_URL is strictly forbidden.'
  );
  process.exit(1);
}

console.warn(
  '[session-maintenance] WARNING: session-maintenance.mjs is a deprecated stub. ' +
  'Use "npm run maintenance:backend" or "node scripts/backend-maintenance.mjs" directly.'
);

runMaintenance(connectionString)
  .then((stats) => {
    console.log('[session-maintenance] Delegated to backend-maintenance: completed successfully.', stats);
    process.exit(0);
  })
  .catch((err) => {
    console.error('[session-maintenance] Maintenance error:', err.message);
    process.exit(1);
  });
