import { handle } from '@/server/http';
import { parseTransfer, uuid } from '@/server/domain';
import { createTransfer, idempotent } from '@/server/repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return handle(
    req,
    async (c, user, context) => {
      const key = uuid(req.headers.get('idempotency-key'));
      const input = parseTransfer(context.input!);
      return idempotent(c, user, key, 'transfer.create', input, () =>
        createTransfer(c, user, input, context.requestId)
      );
    },
    { rateLimitScope: 'transfer:create' }
  );
}
