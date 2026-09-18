#!/usr/bin/env node
/**
 * Test & Restore Database URL Safety Validator.
 *
 * Enforces strict safety guards before any destructive script (e.g. backup-restore-drill.sh)
 * can execute DROP DATABASE, DROP SCHEMA, DROP ROLE, or ALTER ROLE.
 *
 * INVARIANTS:
 * 1. Requires ALLOW_DESTRUCTIVE_DB_TESTS=true.
 * 2. Dedicated loopback test host ONLY (localhost, 127.0.0.1, ::1, [::1]).
 *    Remote hosts are NEVER allowed. Future cloud DR testing requires a separate tool.
 * 3. Strict database identifier grammar: ^[a-z][a-z0-9_]{0,62}$.
 * 4. Approved disposable conventions: *_test, *_ci, fintrack_test, fintrack_restore.
 * 5. Source and restore must refer to the same cluster (protocol, host, port, username).
 * 6. Source and restore must be distinct.
 * 7. DATABASE_MAINTENANCE_URL is required; must target the same cluster as source/restore.
 * 8. Maintenance database must be an approved admin database (postgres, template0, template1).
 * 9. Maintenance role must not be a fintrack application identity.
 * 10. Dedicated test cluster check: enumerates pg_database to reject shared clusters
 *     (UNSAFE_SHARED_DATABASE_CLUSTER).
 * 11. Percent-encoding checks apply only to the database pathname, NOT credentials.
 *     Passwords may contain valid percent-encoded characters.
 */
import pg from 'pg';

const STRICT_IDENTIFIER_REGEX = /^[a-z][a-z0-9_]{0,62}$/;
const SAFE_DISPOSABLE_PATTERN = /^([a-z0-9_]+_(test|ci)|fintrack_test|fintrack_restore)$/;
const DISALLOWED_NAMES = ['fintrack', 'postgres', 'production', 'master', 'template0', 'template1'];
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const APPROVED_ADMIN_DBS = new Set(['postgres', 'template0', 'template1']);
const APP_ROLE_NAMES = new Set(['fintrack_runtime', 'fintrack_app_login']);

export function quoteIdentifier(ident) {
  if (!ident || typeof ident !== 'string' || !STRICT_IDENTIFIER_REGEX.test(ident)) {
    throw new Error(
      `INVALID_IDENTIFIER: "${ident}" does not match strict identifier grammar (^[a-z][a-z0-9_]{0,62}$).`
    );
  }
  return `"${ident.replace(/"/g, '""')}"`;
}

export function isLoopbackHost(hostname) {
  if (!hostname) return false;
  const clean = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return LOOPBACK_HOSTS.has(clean) || LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

/**
 * Validate that the raw URL pathname (database identifier part) does not contain
 * suspicious percent-encoding. Credentials (username/password) may use valid percent-encoding.
 * Only the database name itself must be strict ASCII — no encoding tricks.
 */
function rejectEncodedPath(rawUrl, label) {
  // Parse first to isolate the pathname
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`REFUSING DESTRUCTIVE ACTION: Invalid ${label} URL format.`);
  }
  // Check for percent-encoding ONLY in the raw pathname segment
  // URL.pathname decodes it, so we must check the original string's path portion
  const urlStr = rawUrl;
  // Extract the path portion after authority (after the third /)
  const afterProto = urlStr.indexOf('//');
  if (afterProto === -1) {
    throw new Error(`REFUSING DESTRUCTIVE ACTION: Invalid ${label} URL format (no authority).`);
  }
  const afterAuthority = urlStr.indexOf('/', afterProto + 2);
  const rawPath = afterAuthority === -1 ? '' : urlStr.slice(afterAuthority);
  if (rawPath.includes('%')) {
    throw new Error(
      `REFUSING DESTRUCTIVE ACTION: ${label} database path contains suspicious percent-encoding: "${rawPath}". ` +
      'Database identifiers must be plain ASCII — no URL-encoded paths.'
    );
  }
  return parsed;
}

export function validateTestDbUrls(sourceUrl, restoreUrl) {
  if (process.env.ALLOW_DESTRUCTIVE_DB_TESTS !== 'true') {
    throw new Error(
      'REFUSING DESTRUCTIVE ACTION: ALLOW_DESTRUCTIVE_DB_TESTS=true is strictly required.'
    );
  }

  if (!sourceUrl || !restoreUrl) {
    throw new Error(
      'DATABASE_TEST_URL and DATABASE_RESTORE_URL are strictly required.'
    );
  }

  // Reject percent-encoding in pathname only (credentials may use valid percent-encoding)
  const sourceParsed = rejectEncodedPath(sourceUrl, 'Source');
  const restoreParsed = rejectEncodedPath(restoreUrl, 'Restore');

  // Validate protocol
  const validProtocols = ['postgres:', 'postgresql:'];
  if (!validProtocols.includes(sourceParsed.protocol) || !validProtocols.includes(restoreParsed.protocol)) {
    throw new Error('REFUSING DESTRUCTIVE ACTION: Database protocol must be postgres: or postgresql:.');
  }

  // Loopback-only policy. Remote hosts are NEVER allowed.
  // Future cloud DR testing requires a separate, purpose-built tool.
  if (!isLoopbackHost(sourceParsed.hostname)) {
    throw new Error(
      `REFUSING DESTRUCTIVE ACTION: Remote source host "${sourceParsed.hostname}" is forbidden. ` +
      'Destructive operations are restricted to localhost/loopback test clusters only.'
    );
  }

  if (!isLoopbackHost(restoreParsed.hostname)) {
    throw new Error(
      `REFUSING DESTRUCTIVE ACTION: Remote restore host "${restoreParsed.hostname}" is forbidden. ` +
      'Destructive operations are restricted to localhost/loopback test clusters only.'
    );
  }

  // Consistency: source and restore must point to the same test cluster
  const sourcePort = sourceParsed.port || '5432';
  const restorePort = restoreParsed.port || '5432';
  if (
    sourceParsed.protocol !== restoreParsed.protocol ||
    sourceParsed.hostname.toLowerCase() !== restoreParsed.hostname.toLowerCase() ||
    sourcePort !== restorePort ||
    sourceParsed.username !== restoreParsed.username
  ) {
    throw new Error(
      'REFUSING DESTRUCTIVE ACTION: Source and restore URLs must refer to the same PostgreSQL test cluster ' +
      '(protocol, hostname, port, and username must match).'
    );
  }

  function validateAndExtractDbName(parsed, label) {
    const rawPath = parsed.pathname;
    const name = rawPath.replace(/^\//, '');

    if (!name) {
      throw new Error(`REFUSING DESTRUCTIVE ACTION: Unable to extract database name from ${label} URL.`);
    }

    // Whitespace rejection
    if (/\s/.test(name)) {
      throw new Error(`REFUSING DESTRUCTIVE ACTION: ${label} database name contains whitespace: "${name}".`);
    }

    // Strict identifier grammar
    if (!STRICT_IDENTIFIER_REGEX.test(name)) {
      throw new Error(
        `REFUSING DESTRUCTIVE ACTION: ${label} database name "${name}" violates strict identifier grammar (must match ^[a-z][a-z0-9_]{0,62}$).`
      );
    }

    // Disallowed system or production database names
    if (DISALLOWED_NAMES.includes(name.toLowerCase())) {
      throw new Error(
        `REFUSING DESTRUCTIVE ACTION: ${label} database "${name}" is a forbidden production or system database name.`
      );
    }

    // Safe disposable naming convention
    if (!SAFE_DISPOSABLE_PATTERN.test(name)) {
      throw new Error(
        `REFUSING DESTRUCTIVE ACTION: ${label} database "${name}" does not match safe disposable patterns (*_test, *_ci, fintrack_test, fintrack_restore).`
      );
    }

    return name;
  }

  const sourceDb = validateAndExtractDbName(sourceParsed, 'Source');
  const restoreDb = validateAndExtractDbName(restoreParsed, 'Restore');

  if (sourceDb.toLowerCase() === restoreDb.toLowerCase()) {
    throw new Error(
      `REFUSING DESTRUCTIVE ACTION: Source database "${sourceDb}" and restore database "${restoreDb}" must be distinct.`
    );
  }

  return {
    sourceDb,
    restoreDb,
    sourceQuoted: quoteIdentifier(sourceDb),
    restoreQuoted: quoteIdentifier(restoreDb),
    host: sourceParsed.hostname,
    port: sourcePort,
  };
}

/**
 * Validate the maintenance URL against the source URL.
 *
 * Requirements:
 * - Must be non-empty (DATABASE_MAINTENANCE_URL is required).
 * - Must use postgres: or postgresql: protocol.
 * - Must target a loopback host.
 * - Must target the SAME hostname and port as the source URL (MAINTENANCE_CLUSTER_MISMATCH).
 * - The database name must be an approved administrative database
 *   (postgres, template0, template1). Non-admin databases are rejected.
 * - Credentials may differ from source (admin user model is expected).
 */
export function validateMaintenanceUrl(maintenanceUrl, sourceUrl) {
  if (!maintenanceUrl) {
    throw new Error(
      'REFUSING DESTRUCTIVE ACTION: DATABASE_MAINTENANCE_URL is required for cluster-global operations. ' +
      'Do not derive a maintenance connection from DATABASE_TEST_URL.'
    );
  }

  // Reject percent-encoding in the maintenance DB pathname
  const maintParsed = rejectEncodedPath(maintenanceUrl, 'Maintenance');

  const validProtocols = ['postgres:', 'postgresql:'];
  if (!validProtocols.includes(maintParsed.protocol)) {
    throw new Error('REFUSING DESTRUCTIVE ACTION: Maintenance URL protocol must be postgres: or postgresql:.');
  }

  if (!isLoopbackHost(maintParsed.hostname)) {
    throw new Error(
      `REFUSING DESTRUCTIVE ACTION: Maintenance host "${maintParsed.hostname}" is not a loopback address. ` +
      'Destructive operations require a local dedicated test cluster.'
    );
  }

  // Parse source for cluster comparison
  let sourceParsed;
  try {
    sourceParsed = new URL(sourceUrl);
  } catch {
    throw new Error('REFUSING DESTRUCTIVE ACTION: Invalid source URL for maintenance cluster comparison.');
  }

  const maintPort = maintParsed.port || '5432';
  const sourcePort = sourceParsed.port || '5432';

  if (
    maintParsed.hostname.toLowerCase() !== sourceParsed.hostname.toLowerCase() ||
    maintPort !== sourcePort
  ) {
    throw new Error(
      `MAINTENANCE_CLUSTER_MISMATCH: Maintenance URL (${maintParsed.hostname}:${maintPort}) ` +
      `does not match source cluster (${sourceParsed.hostname}:${sourcePort}). ` +
      'All three URLs (source, restore, maintenance) must target the same PostgreSQL cluster.'
    );
  }

  // Validate the maintenance database name is an approved admin database
  const maintDb = maintParsed.pathname.replace(/^\//, '');
  if (!maintDb) {
    throw new Error('REFUSING DESTRUCTIVE ACTION: Maintenance URL has no database name.');
  }
  if (!APPROVED_ADMIN_DBS.has(maintDb.toLowerCase())) {
    throw new Error(
      `REFUSING DESTRUCTIVE ACTION: Maintenance database "${maintDb}" is not an approved admin database. ` +
      'Maintenance URL must target: postgres, template0, or template1.'
    );
  }

  return {
    maintDb,
    maintHost: maintParsed.hostname,
    maintPort,
  };
}

/**
 * Validate that the current database role is not a fintrack application identity.
 * The role must have operator-level access; hardcoding to "postgres" is not required
 * since managed environments may use other operator roles.
 *
 * @param {import('pg').Client} client - A connected pg.Client
 */
export async function validateMaintenanceRole(client) {
  const result = await client.query('SELECT current_user AS name');
  const currentUser = result.rows[0]?.name;
  if (APP_ROLE_NAMES.has(currentUser)) {
    throw new Error(
      `REFUSING DESTRUCTIVE ACTION: Current database role "${currentUser}" is a fintrack application identity. ` +
      'Cluster-global operations require operator credentials, not application runtime credentials.'
    );
  }
  return currentUser;
}

export async function verifyDedicatedCluster(maintenanceUrl, allowedDatabases = []) {
  if (!maintenanceUrl) {
    throw new Error('verifyDedicatedCluster requires an administrative maintenance URL.');
  }

  const client = new pg.Client({
    connectionString: maintenanceUrl,
    connectionTimeoutMillis: 5000,
  });

  await client.connect();
  try {
    // Verify the connected role is not an application identity
    await validateMaintenanceRole(client);

    const { rows } = await client.query('SELECT datname FROM pg_database');
    const systemDbs = ['postgres', 'template0', 'template1'];
    const allowedSet = new Set([
      ...systemDbs,
      ...allowedDatabases.map(d => d.toLowerCase()),
    ]);

    for (const row of rows) {
      const dbName = row.datname.toLowerCase();
      if (!allowedSet.has(dbName)) {
        throw new Error(
          `UNSAFE_SHARED_DATABASE_CLUSTER: Unexpected non-template database "${row.datname}" detected in PostgreSQL cluster. ` +
          'Cluster-global mutations (DROP ROLE, ALTER ROLE) are strictly forbidden on shared clusters.'
        );
      }
    }

    return { totalDatabases: rows.length };
  } finally {
    await client.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith('validate-test-db.mjs')) {
  const args = process.argv.slice(2);
  const positional = args.filter(a => !a.startsWith('--'));
  const source = positional[0] || process.env.DATABASE_TEST_URL;
  const restore = positional[1] || process.env.DATABASE_RESTORE_URL;
  const maint = positional[2] || process.env.DATABASE_MAINTENANCE_URL;

  if (args.includes('--print-restore-name')) {
    try {
      const { restoreDb } = validateTestDbUrls(source, restore);
      process.stdout.write(restoreDb);
      process.exit(0);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  }

  if (args.includes('--print-quoted-restore-name')) {
    try {
      const { restoreQuoted } = validateTestDbUrls(source, restore);
      process.stdout.write(restoreQuoted);
      process.exit(0);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  }

  (async () => {
    try {
      const { sourceDb, restoreDb, sourceQuoted, restoreQuoted } = validateTestDbUrls(source, restore);
      console.log(`[validate-test-db] Verified safe test URLs: source=${sourceDb} (${sourceQuoted}), restore=${restoreDb} (${restoreQuoted})`);

      // Maintenance URL is required for cluster validation
      validateMaintenanceUrl(maint, source);
      console.log('[validate-test-db] Maintenance URL validated against source cluster.');

      await verifyDedicatedCluster(maint, [sourceDb, restoreDb, 'fintrack_upgrade_test']);
      console.log('[validate-test-db] Verified dedicated test cluster: no unexpected databases present.');

      process.exit(0);
    } catch (err) {
      console.error(`[validate-test-db] ERROR: ${err.message}`);
      process.exit(1);
    }
  })();
}
