import { handle } from '@/server/http';
import { parseWallet, uuid } from '@/server/domain';
import { createWallet, idempotent, listWallets } from '@/server/repository';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  return handle(req, async (c,user) => {
    const after = new URL(req.url).searchParams.get('after');
    const rows = await listWallets(c,user,after ? uuid(after) : undefined);
    return {wallets:rows.slice(0,100),nextCursor:rows.length>100 ? rows[99].id : null};
  });
}
export async function POST(req: Request) {
  return handle(req, async (c,user, payload) => {
    const key = uuid(req.headers.get('idempotency-key'));
    const input = parseWallet(payload!);
    return idempotent(c,user,key,'wallet.create',input,() => createWallet(c,user,input));
  });
}
