#!/usr/bin/env node
/**
 * Test & Restore Database URL Safety Validator.
 *
 * Enforces strict safety guards before any destructive script (e.g. backup-restore-drill.sh)
 * can execute DROP DATABASE, DROP SCHEMA, DROP ROLE, or ALTER ROLE.
 *
 * INVARIANTS:
 * 1. Requires ALLOW_DESTRUCTIVE_DB_TESTS=true.
 * 2. Dedicated loopback test host only (localhost, 127.0.0.1, ::1, [::1]) by default.
 *    Remote hosts strictly require ALLOW_REMOTE_DESTRUCTIVE_DB_TESTS=I_UNDERSTAND_THIS_MAY_DESTROY_A_REMOTE_CLUSTER.
 * 3. Strict database identifier grammar: ^[a-z][a-z0-9_]{0,62}$.
 * 4. Approved disposable conventions: *_test, *_ci, fintrack_test, fintrack_restore.
 * 5. Source and restore must refer to the same cluster (protocol, host, port, username).
 * 6. Source and restore must be distinct.
 * 7. Dedicated test cluster check: enumerates pg_database to reject shared clusters (UNSAFE_SHARED_DATABASE_CLUSTER).
 */
import pg from 'pg';

const STRICT_IDENTIFIER_REGEX = /^[a-z][a-z0-9_]{0,62}$/;
const SAFE_DISPOSABLE_PATTERN = /^([a-z0-9_]+_(test|ci)|fintrack_test|fintrack_restore)$/;
const DISALLOWED_NAMES = ['fintrack', 'postgres', 'production', 'master', 'template0', 'template1'];
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

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

  // Reject suspicious percent-encoding before URL decoding
  if (sourceUrl.includes('%') || restoreUrl.includes('%')) {
    throw new Error(
      'REFUSING DESTRUCTIVE ACTION: Database URL contains suspicious percent-encoding.'
    );
  }

  let sourceParsed;
  let restoreParsed;
  try {
    sourceParsed = new URL(sourceUrl);
    restoreParsed = new URL(restoreUrl);
  } catch {
    throw new Error('REFUSING DESTRUCTIVE ACTION: Invalid database URL format.');
  }

  // Validate protocol
  const validProtocols = ['postgres:', 'postgresql:'];
  if (!validProtocols.includes(sourceParsed.protocol) || !validProtocols.includes(restoreParsed.protocol)) {
    throw new Error('REFUSING DESTRUCTIVE ACTION: Database protocol must be postgres: or postgresql:.');
  }

  // Validate host against loopback / dedicated test cluster policy
  const remoteOptIn = process.env.ALLOW_REMOTE_DESTRUCTIVE_DB_TESTS;
  const allowRemote = remoteOptIn === 'I_UNDERSTAND_THIS_MAY_DESTROY_A_REMOTE_CLUSTER';

  if (!isLoopbackHost(sourceParsed.hostname) && !allowRemote) {
    throw new Error(
      `REFUSING DESTRUCTIVE ACTION: Remote source host "${sourceParsed.hostname}" is forbidden. ` +
      'Destructive operations are restricted to localhost/loopback test clusters unless ' +
      'ALLOW_REMOTE_DESTRUCTIVE_DB_TESTS=I_UNDERSTAND_THIS_MAY_DESTROY_A_REMOTE_CLUSTER is explicitly set.'
    );
  }

  if (!isLoopbackHost(restoreParsed.hostname) && !allowRemote) {
    throw new Error(
      `REFUSING DESTRUCTIVE ACTION: Remote restore host "${restoreParsed.hostname}" is forbidden. ` +
      'Destructive operations are restricted to localhost/loopback test clusters unless ' +
      'ALLOW_REMOTE_DESTRUCTIVE_DB_TESTS=I_UNDERSTAND_THIS_MAY_DESTROY_A_REMOTE_CLUSTER is explicitly set.'
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
  const source = args.find(a => !a.startsWith('--')) || process.env.DATABASE_TEST_URL;
  const remaining = args.filter(a => !a.startsWith('--') && a !== source);
  const restore = remaining[0] || process.env.DATABASE_RESTORE_URL;
  const maint = remaining[1] || process.env.DATABASE_MAINTENANCE_URL || (source ? `${source.substring(0, source.lastIndexOf('/') + 1)}postgres` : undefined);

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

      if (maint) {
        await verifyDedicatedCluster(maint, [sourceDb, restoreDb, 'fintrack_upgrade_test']);
        console.log('[validate-test-db] Verified dedicated test cluster: no unexpected databases present.');
      }
      process.exit(0);
    } catch (err) {
      console.error(`[validate-test-db] ERROR: ${err.message}`);
      process.exit(1);
    }
  })();
}
