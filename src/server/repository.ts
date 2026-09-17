import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ApiError } from './errors';
import { transferBalances } from './domain';
import type { parseWallet, parseTransfer } from './domain';
export async function listWallets(c: PoolClient, user: string, after?: string) {
  return (await c.query(`SELECT id,name,type,currency,balance::text,opening_balance::text,created_at
    FROM fintrack.wallets WHERE user_id=$1 AND ($2::uuid IS NULL OR id>$2::uuid) ORDER BY id LIMIT 101`, [user, after ?? null])).rows;
}
export async function createWallet(c: PoolClient, user: string, input: ReturnType<typeof parseWallet>) {
  const row = (await c.query(`INSERT INTO fintrack.wallets(user_id,name,type,opening_balance,balance) VALUES($1,$2,$3,$4,$4)
    RETURNING id,name,type,currency,balance::text,opening_balance::text`, [user,input.name,input.type,input.openingBalance])).rows[0];
  await c.query("INSERT INTO fintrack.audit_events(user_id,action,resource_id) VALUES($1,'WALLET_CREATED',$2)", [user,row.id]);
  return row;
}
export async function createTransfer(c: PoolClient, user: string, input: ReturnType<typeof parseTransfer>) {
  // Lock in stable UUID order to avoid opposite-direction transfer deadlocks.
  const rows = (await c.query(`SELECT id,balance::text FROM fintrack.wallets WHERE user_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE`, [user,[input.fromWalletId,input.toWalletId]])).rows;
  if (rows.length !== 2) throw new ApiError(404, 'WALLET_NOT_FOUND');
  const balances = transferBalances(rows.find(r=>r.id===input.fromWalletId).balance, rows.find(r=>r.id===input.toWalletId).balance, input.amount,input.fee);
  await c.query('UPDATE fintrack.wallets SET balance=$3 WHERE user_id=$1 AND id=$2', [user,input.fromWalletId,balances.from]);
  await c.query('UPDATE fintrack.wallets SET balance=$3 WHERE user_id=$1 AND id=$2', [user,input.toWalletId,balances.to]);
  const row = (await c.query(`INSERT INTO fintrack.transfers(user_id,from_wallet_id,to_wallet_id,amount,fee) VALUES($1,$2,$3,$4,$5) RETURNING id,from_wallet_id,to_wallet_id,amount::text,fee::text`, [user,input.fromWalletId,input.toWalletId,input.amount,input.fee])).rows[0];
  await c.query("INSERT INTO fintrack.audit_events(user_id,action,resource_id) VALUES($1,'TRANSFER_CREATED',$2)", [user,row.id]);
  return row;
}
export async function idempotent(c: PoolClient, user: string, key: string, operation: string, input: unknown, run: () => Promise<unknown>) {
  const fingerprint = createHash('sha256').update(JSON.stringify({operation,input})).digest('hex');
  // Cross-instance serialization; transaction-scoped lock also covers absent keys.
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [user + ':' + key]);
  const prior = (await c.query('SELECT fingerprint,response FROM fintrack.idempotency WHERE user_id=$1 AND key=$2', [user,key])).rows[0];
  if (prior) {
    if (prior.fingerprint !== fingerprint) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT');
    return prior.response;
  }
  const response = await run();
  await c.query('INSERT INTO fintrack.idempotency(user_id,key,fingerprint,response) VALUES($1,$2,$3,$4)', [user,key,fingerprint,JSON.stringify(response)]);
  return response;
}
export async function rateLimit(c: PoolClient, user: string) {
  // Committed separately from business mutations, including rejected requests.
  const result = await c.query(`INSERT INTO fintrack.rate_limits(user_id,bucket,hits)
    VALUES($1,floor(extract(epoch from now())/60)::bigint,1)
    ON CONFLICT(user_id,bucket) DO UPDATE SET hits=fintrack.rate_limits.hits+1 WHERE fintrack.rate_limits.hits<60 RETURNING hits`, [user]);
  return result.rows.length === 1;
}
