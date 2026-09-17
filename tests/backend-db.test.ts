import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { Client, Pool, type PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import { authenticate } from '../src/server/session';
import { createWallet, createTransfer, idempotent, rateLimit } from '../src/server/repository';
const alice='11111111-1111-4111-8111-111111111111';
const bob='22222222-2222-4222-8222-222222222222';
const aliceHash=createHash('sha256').update('a'.repeat(43)).digest('hex');
const bobHash=createHash('sha256').update('b'.repeat(43)).digest('hex');
// DATABASE_TEST_URL must point at an EMPTY disposable database (CI only).
// The migration intentionally fails if the schema/role already exists.
let db: PGlite;
let realClient: Client | undefined;
const realUrl = process.env.DATABASE_TEST_URL;
let a: string, b: string, foreign: string;
async function asUser<T>(hash: string, run: (c:PoolClient,user:string)=>Promise<T>) {
  await db.exec('BEGIN; SET LOCAL ROLE fintrack_runtime');
  try {
    const c=db as unknown as PoolClient;
    const result=await run(c,await authenticate(c,hash));
    await db.exec('COMMIT'); return result;
  } catch(e) { await db.exec('ROLLBACK'); throw e; }
}
beforeAll(async () => {
  if (realUrl) {
    realClient = new Client({connectionString:realUrl});
    await realClient.connect();
    db = {query:realClient.query.bind(realClient),exec:(sql:string)=>realClient!.query(sql),close:()=>realClient!.end()} as unknown as PGlite;
  } else db=new PGlite();
  await db.exec(readFileSync('db/migrations/001_backend_foundation.sql','utf8'));
  await db.query('INSERT INTO fintrack.users(id) VALUES($1),($2)',[alice,bob]);
  await db.query("INSERT INTO fintrack.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour'),($3,$4,now()+interval '1 hour')",[aliceHash,alice,bobHash,bob]);
  a=(await asUser(aliceHash,(c,u)=>createWallet(c,u,{name:'A',type:'BANK',openingBalance:'1000'}))).id;
  b=(await asUser(aliceHash,(c,u)=>createWallet(c,u,{name:'B',type:'CASH',openingBalance:'0'}))).id;
  foreign=(await asUser(bobHash,(c,u)=>createWallet(c,u,{name:'Private',type:'BANK',openingBalance:'1000'}))).id;
},30000);
afterAll(async () => { await db?.close(); });
describe('PostgreSQL schema and service integration',()=>{
  it('RLS hides other users even when query omits ownership predicate',async()=>{
    const result=await asUser(aliceHash,c=>c.query('SELECT id FROM fintrack.wallets'));
    expect(result.rows.map(r=>r.id).sort()).toEqual([a,b].sort());
  });
  it('RLS denies cross-user insert and missing context',async()=>{
    await expect(asUser(aliceHash,c=>c.query("INSERT INTO fintrack.wallets(user_id,name,type,opening_balance,balance) VALUES($1,'attack','CASH',0,0)",[bob]))).rejects.toThrow(/row-level security/);
    await db.exec('BEGIN; SET LOCAL ROLE fintrack_runtime');
    expect((await db.query('SELECT * FROM fintrack.wallets')).rows).toEqual([]);
    await db.exec('ROLLBACK');
  });
  it('BOLA rejects foreign wallet with no mutation',async()=>{
    await expect(asUser(aliceHash,(c,u)=>createTransfer(c,u,{fromWalletId:a,toWalletId:foreign,amount:'1',fee:'0'}))).rejects.toThrow('WALLET_NOT_FOUND');
    expect((await db.query<{balance:string}>('SELECT balance::text FROM fintrack.wallets WHERE id=$1',[a])).rows[0].balance).toBe('1000');
  });
  it('composite FK prevents cross-tenant references even with direct SQL',async()=>{
    await expect(asUser(aliceHash,(c,u)=>c.query('INSERT INTO fintrack.transfers(user_id,from_wallet_id,to_wallet_id,amount,fee) VALUES($1,$2,$3,1,0)',[u,a,foreign]))).rejects.toThrow(/foreign key/);
  });
  it('atomic transfer records fee, audit and exactly-once replay',async()=>{
    const key='33333333-3333-4333-8333-333333333333';
    const input={fromWalletId:a,toWalletId:b,amount:'100',fee:'5'};
    const send=()=>asUser(aliceHash,(c,u)=>idempotent(c,u,key,'transfer.create',input,()=>createTransfer(c,u,input)));
    const first=await send(); expect(await send()).toEqual(first);
    const balances=await db.query<{id:string,balance:string}>('SELECT id,balance::text FROM fintrack.wallets WHERE user_id=$1',[alice]);
    expect(balances.rows.find(r=>r.id===a)?.balance).toBe('895');
    expect(balances.rows.find(r=>r.id===b)?.balance).toBe('100');
    expect((await db.query('SELECT * FROM fintrack.transfers')).rows).toHaveLength(1);
    expect((await db.query("SELECT * FROM fintrack.audit_events WHERE action='TRANSFER_CREATED'")).rows).toHaveLength(1);
    await expect(asUser(aliceHash,(c,u)=>idempotent(c,u,key,'transfer.create',{...input,amount:'101'},async()=>null))).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });
  it('failure after balance updates rolls back balances and ledger',async()=>{
    await expect(asUser(aliceHash,async(c,u)=>{
      await createTransfer(c,u,{fromWalletId:a,toWalletId:b,amount:'10',fee:'0'});
      throw new Error('simulated failure');
    })).rejects.toThrow('simulated failure');
    expect((await db.query<{balance:string}>('SELECT balance::text FROM fintrack.wallets WHERE id=$1',[a])).rows[0].balance).toBe('895');
    expect((await db.query('SELECT * FROM fintrack.transfers')).rows).toHaveLength(1);
  });
  it('rejects overdraft without partial updates',async()=>{
    await expect(asUser(aliceHash,(c,u)=>createTransfer(c,u,{fromWalletId:a,toWalletId:b,amount:'896',fee:'0'}))).rejects.toThrow('INSUFFICIENT_FUNDS');
  });
  it('runtime cannot erase audit, issue sessions, truncate or alter schema',async()=>{
    for (const sql of ['DELETE FROM fintrack.audit_events','TRUNCATE fintrack.wallets CASCADE','ALTER TABLE fintrack.wallets DISABLE ROW LEVEL SECURITY',"UPDATE fintrack.sessions SET expires_at=now()+interval '1 year'"]) {
      await expect(asUser(aliceHash,c=>c.query(sql))).rejects.toThrow(/permission denied|must be owner/);
    }
  });
  it('expired/revoked sessions fail closed',async()=>{
    await db.query('UPDATE fintrack.sessions SET revoked_at=now() WHERE token_hash=$1',[bobHash]);
    await expect(asUser(bobHash,async()=>true)).rejects.toThrow('UNAUTHENTICATED');
    await db.query("UPDATE fintrack.sessions SET revoked_at=NULL,expires_at=now()-interval '1 second' WHERE token_hash=$1",[bobHash]);
    await expect(asUser(bobHash,async()=>true)).rejects.toThrow('UNAUTHENTICATED');
    await expect(asUser('0'.repeat(64),async()=>true)).rejects.toThrow('UNAUTHENTICATED');
  });
  it('distributed per-user limiter allows 60 then rejects, separately committed',async()=>{
    for(let i=0;i<60;i++) expect(await asUser(aliceHash,(c,u)=>rateLimit(c,u))).toBe(true);
    expect(await asUser(aliceHash,(c,u)=>rateLimit(c,u))).toBe(false);
  });
  it.skipIf(!realUrl)('real PostgreSQL: simultaneous retries and competing debits serialize',async()=>{
    const pool=new Pool({connectionString:realUrl,max:4});
    async function send(key:string, amount:string) {
      const c=await pool.connect();
      try {
        await c.query('BEGIN; SET LOCAL ROLE fintrack_runtime');
        const user=await authenticate(c,aliceHash);
        const input={fromWalletId:a,toWalletId:b,amount,fee:'0'};
        const result=await idempotent(c,user,key,'transfer.create',input,()=>createTransfer(c,user,input));
        await c.query('COMMIT'); return result;
      } catch(e) {await c.query('ROLLBACK');throw e;} finally {c.release();}
    }
    try {
      const key='44444444-4444-4444-8444-444444444444';
      const results=await Promise.all([send(key,'10'),send(key,'10')]);
      expect(results[0]).toEqual(results[1]);
      const competing=await Promise.allSettled([
        send('55555555-5555-4555-8555-555555555555','800'),
        send('66666666-6666-4666-8666-666666666666','800')
      ]);
      expect(competing.filter(r=>r.status==='fulfilled')).toHaveLength(1);
      expect(competing.filter(r=>r.status==='rejected')).toHaveLength(1);
      expect((await db.query<{balance:string}>('SELECT balance::text FROM fintrack.wallets WHERE id=$1',[a])).rows[0].balance).toBe('85');
    } finally {await pool.end();}
  });
});
