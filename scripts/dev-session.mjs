// Local operator fixture, NOT a public login endpoint or production auth provider.
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import pg from 'pg';
const url=process.env.DATABASE_MIGRATION_URL;
const output=process.argv[2];
if (process.env.ALLOW_DEV_SESSION !== 'true' || process.env.NODE_ENV === 'production' || !url || !output || !['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname)) {
  throw new Error('Requires ALLOW_DEV_SESSION=true, local DATABASE_MIGRATION_URL, non-production and an output filename');
}
const token=randomBytes(32).toString('base64url');
const userId=randomUUID();
const hash=createHash('sha256').update(token).digest('hex');
// Exclusive creation prevents overwriting an existing secret or following a symlink.
await writeFile(output,`__Host-fintrack_session=${token}`,{flag:'wx',mode:0o600});
const c=new pg.Client({connectionString:url});
try {
  await c.connect();
  await c.query('BEGIN');
  await c.query('INSERT INTO fintrack.users(id) VALUES($1)',[userId]);
  await c.query("INSERT INTO fintrack.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[hash,userId]);
  await c.query('COMMIT');
  console.log(`Local test user created: ${userId}. Cookie saved to the requested private file (expires in one hour).`);
} catch(e) {
  await unlink(output).catch(()=>{});
  throw e;
} finally {await c.end();}
