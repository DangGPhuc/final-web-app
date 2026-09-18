#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'db/migrations');

export async function verifyMigrationHistory(dbUrl) {
  const targetUrl = dbUrl || process.env.DATABASE_MAINTENANCE_URL || process.env.DATABASE_URL;
  if (!targetUrl) {
    throw new Error('verifyMigrationHistory requires a target database URL.');
  }

  const pool = new pg.Pool({
    connectionString: targetUrl,
    connectionTimeoutMillis: 5000,
  });

  try {
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      throw new Error('No migration files found in db/migrations.');
    }

    const { rows } = await pool.query(
      `SELECT version, checksum, applied_at FROM fintrack.schema_migrations ORDER BY version ASC`
    );

    if (rows.length !== files.length) {
      throw new Error(
        `Migration history row count mismatch: found ${rows.length} rows in schema_migrations, expected ${files.length} repository files.`
      );
    }

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const filePath = path.join(MIGRATIONS_DIR, file);
      const content = fs.readFileSync(filePath, 'utf8');
      const expectedChecksum = crypto.createHash('sha256').update(content).digest('hex');

      const row = rows[i];
      if (row.version !== file) {
        throw new Error(
          `Migration history version mismatch at index ${i}: DB has "${row.version}", repo has "${file}".`
        );
      }

      if (row.checksum !== expectedChecksum) {
        throw new Error(
          `Migration checksum mismatch for "${file}": DB has "${row.checksum}", repo hash is "${expectedChecksum}".`
        );
      }
    }

    return { total: rows.length, versions: rows.map((r) => r.version) };
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith('verify-migration-history.mjs')) {
  const url = process.argv[2] || process.env.DATABASE_MAINTENANCE_URL;
  verifyMigrationHistory(url)
    .then(({ total, versions }) => {
      console.log(`[verify-migration-history] Verified all ${total} migration checksums match repository files exactly: ${versions.join(', ')}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(`[verify-migration-history] ERROR: ${err.message}`);
      process.exit(1);
    });
}
