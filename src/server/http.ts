import 'server-only';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { transaction } from './database';
import { authenticate, checkMutationOrigin, sessionHash } from './session';
import { rateLimit } from './repository';
import { ApiError } from './errors';
import { readBoundedJsonBody } from '@/lib/api-guard';
export async function body(req: Request) {
  const result = await readBoundedJsonBody(req, 4096);
  if (!result.ok) throw new ApiError(result.status, 'INVALID_BODY');
  return result.data;
}
export async function handle(req: Request, run: (c: PoolClient, user: string, input?: Record<string, unknown>) => Promise<unknown>) {
  const requestId = randomUUID();
  const headers = { 'Cache-Control': 'no-store', 'X-Request-Id': requestId, 'Vary': 'Cookie' };
  try {
    if (process.env.ENABLE_BACKEND_API !== 'true') throw new ApiError(503, 'BACKEND_DISABLED');
    if (!['GET','HEAD'].includes(req.method)) checkMutationOrigin(req);
    const hash = sessionHash(req);
    const allowed = await transaction(async c => rateLimit(c, await authenticate(c,hash)));
    if (!allowed) throw new ApiError(429, 'RATE_LIMITED');
    // Read bounded input outside a DB transaction so a slow sender cannot pin a pool slot.
    const input = req.method === 'POST' ? await body(req) : undefined;
    const result = await transaction(async c => run(c, await authenticate(c,hash), input));
    return Response.json({success:true,data:result}, {status:req.method === 'POST' ? 201 : 200,headers});
  } catch (error) {
    const known = error instanceof ApiError;
    if (!known) console.error(JSON.stringify({event:'BACKEND_REQUEST_FAILED',requestId}));
    const status = known ? error.status : 503;
    return Response.json({success:false,code:known ? error.code : 'SERVICE_UNAVAILABLE',requestId}, {status,headers:{...headers,...(status===429 ? {'Retry-After':'60'} : {})}});
  }
}
