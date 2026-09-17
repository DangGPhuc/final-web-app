import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ApiError } from './errors';
import { transferBalances } from './domain';
import type { parseWallet, parseTransfer } from './domain';

export const MAX_WALLETS_PER_USER = 100;
export const MAX_TRANSFERS_PER_USER_PER_DAY = 1000;

export function getMaxTransfersPerUserPerDay(): number {
  const parsed = parseInt(process.env.MAX_TRANSFERS_PER_USER_PER_DAY || '1000', 10);
  return Number.isNaN(parsed) || parsed <= 0 ? 1000 : parsed;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateRequestId(requestId: string): void {
  if (!requestId || typeof requestId !== 'string' || !UUID_REGEX.test(requestId)) {
    throw new ApiError(400, 'INVALID_REQUEST_ID');
  }
}

export type RateLimitScope = 'global' | 'wallet:create' | 'transfer:create';

export const RATE_LIMIT_CONFIG: Record<RateLimitScope, { maxHits: number; windowSeconds: number }> = {
  global: { maxHits: 60, windowSeconds: 60 },
  'wallet:create': { maxHits: 10, windowSeconds: 60 },
  'transfer:create': { maxHits: 20, windowSeconds: 60 },
};

export async function listWallets(c: PoolClient, user: string, after?: string) {
  return (
    await c.query(
      `SELECT id, name, type, currency, balance::text, opening_balance::text, created_at
       FROM fintrack.wallets
       WHERE user_id = $1 AND ($2::uuid IS NULL OR id > $2::uuid)
       ORDER BY id
       LIMIT 101`,
      [user, after ?? null]
    )
  ).rows;
}

export async function createWallet(
  c: PoolClient,
  user: string,
  input: ReturnType<typeof parseWallet>,
  requestId: string
) {
  validateRequestId(requestId);

  // Concurrency-safe quota check: serialize wallet creation per-user using advisory xact lock
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [user + ':wallet-create']);

  const countRes = await c.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM fintrack.wallets WHERE user_id = $1',
    [user]
  );
  if (parseInt(countRes.rows[0].count, 10) >= MAX_WALLETS_PER_USER) {
    throw new ApiError(422, 'WALLET_LIMIT_REACHED');
  }

  const row = (
    await c.query(
      `INSERT INTO fintrack.wallets(user_id, name, type, opening_balance, balance)
       VALUES ($1, $2, $3, $4, $4)
       RETURNING id, name, type, currency, balance::text, opening_balance::text`,
      [user, input.name, input.type, input.openingBalance]
    )
  ).rows[0];

  await c.query(
    "INSERT INTO fintrack.audit_events(user_id, action, resource_id, request_id) VALUES ($1, 'WALLET_CREATED', $2, $3)",
    [user, row.id, requestId]
  );

  return row;
}

export async function createTransfer(
  c: PoolClient,
  user: string,
  input: ReturnType<typeof parseTransfer>,
  requestId: string
) {
  validateRequestId(requestId);

  // Concurrency-safe daily transfer security quota check per user per UTC calendar day
  const utcDate = new Date().toISOString().slice(0, 10);
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    user + ':transfer-daily:' + utcDate,
  ]);

  const dailyCountRes = await c.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM fintrack.transfers
     WHERE user_id = $1 AND created_at >= $2::timestamptz`,
    [user, `${utcDate}T00:00:00.000Z`]
  );
  if (parseInt(dailyCountRes.rows[0]?.count ?? '0', 10) >= getMaxTransfersPerUserPerDay()) {
    throw new ApiError(422, 'TRANSFER_DAILY_LIMIT_REACHED');
  }

  // Lock in stable UUID order to avoid opposite-direction transfer deadlocks.
  const rows = (
    await c.query<{ id: string; balance: string }>(
      `SELECT id, balance::text
       FROM fintrack.wallets
       WHERE user_id = $1 AND id = ANY($2::uuid[])
       ORDER BY id
       FOR UPDATE`,
      [user, [input.fromWalletId, input.toWalletId]]
    )
  ).rows;

  if (rows.length !== 2) {
    // Both wallets must exist and belong to the authenticated user; otherwise BOLA rejection
    throw new ApiError(404, 'WALLET_NOT_FOUND');
  }

  const fromRow = rows.find(r => r.id === input.fromWalletId)!;
  const toRow = rows.find(r => r.id === input.toWalletId)!;

  const balances = transferBalances(fromRow.balance, toRow.balance, input.amount, input.fee);

  await c.query('UPDATE fintrack.wallets SET balance = $3 WHERE user_id = $1 AND id = $2', [
    user,
    input.fromWalletId,
    balances.from,
  ]);
  await c.query('UPDATE fintrack.wallets SET balance = $3 WHERE user_id = $1 AND id = $2', [
    user,
    input.toWalletId,
    balances.to,
  ]);

  const row = (
    await c.query(
      `INSERT INTO fintrack.transfers(user_id, from_wallet_id, to_wallet_id, amount, fee)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, from_wallet_id, to_wallet_id, amount::text, fee::text`,
      [user, input.fromWalletId, input.toWalletId, input.amount, input.fee]
    )
  ).rows[0];

  await c.query(
    "INSERT INTO fintrack.audit_events(user_id, action, resource_id, request_id) VALUES ($1, 'TRANSFER_CREATED', $2, $3)",
    [user, row.id, requestId]
  );

  return row;
}

export async function idempotent<T>(
  c: PoolClient,
  user: string,
  key: string,
  operation: string,
  input: unknown,
  run: () => Promise<T>
): Promise<T> {
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ operation, input }))
    .digest('hex');

  // Cross-instance serialization; transaction-scoped lock also covers absent keys.
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [user + ':' + key]);

  const prior = (
    await c.query<{ fingerprint: string; response: T }>(
      'SELECT fingerprint, response FROM fintrack.idempotency WHERE user_id = $1 AND key = $2',
      [user, key]
    )
  ).rows[0];

  if (prior) {
    if (prior.fingerprint !== fingerprint) {
      throw new ApiError(409, 'IDEMPOTENCY_CONFLICT');
    }
    return prior.response;
  }

  const response = await run();
  await c.query(
    'INSERT INTO fintrack.idempotency(user_id, key, fingerprint, response) VALUES ($1, $2, $3, $4)',
    [user, key, fingerprint, JSON.stringify(response)]
  );
  return response;
}

export async function rateLimit(
  c: PoolClient,
  user: string,
  scope: RateLimitScope = 'global'
): Promise<boolean> {
  const config = RATE_LIMIT_CONFIG[scope] ?? RATE_LIMIT_CONFIG.global;

  // Single upsert maintaining exactly one bounded row per (user_id, scope).
  // If bucket changes, reset bucket and hits=1. If same bucket, increment hits up to maxHits.
  const result = await c.query(
    `INSERT INTO fintrack.rate_limits(user_id, scope, bucket, hits)
     VALUES ($1, $2, floor(extract(epoch from now()) / $3)::bigint, 1)
     ON CONFLICT (user_id, scope) DO UPDATE
     SET
       hits = CASE
         WHEN fintrack.rate_limits.bucket = EXCLUDED.bucket THEN fintrack.rate_limits.hits + 1
         ELSE 1
       END,
       bucket = EXCLUDED.bucket
     WHERE (
       fintrack.rate_limits.bucket <> EXCLUDED.bucket
       OR fintrack.rate_limits.hits < $4
     )
     RETURNING hits`,
    [user, scope, config.windowSeconds, config.maxHits]
  );

  return result.rows.length === 1;
}

/**
 * Monitoring and support query for idempotency capacity management.
 */
export async function listIdempotencyKeys(c: PoolClient, user: string, limit = 50) {
  return (
    await c.query(
      `SELECT key, fingerprint, created_at
       FROM fintrack.idempotency
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [user, limit]
    )
  ).rows;
}
