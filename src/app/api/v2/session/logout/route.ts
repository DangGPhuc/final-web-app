import { handle } from '@/server/http';
import { revokeCurrentSession, clearSessionCookieHeader } from '@/server/session';
import { logSecurityEvent } from '@/server/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return handle(
    req,
    async (c) => {
      await revokeCurrentSession(c);
      return { revoked: true };
    },
    {
      rateLimitMode: 'none',
      successStatus: 200,
      successOnlyHeaders: {
        'Set-Cookie': clearSessionCookieHeader(),
      },
      afterCommit: (_result, meta) => {
        logSecurityEvent({
          event: 'SECURITY_SESSION_REVOKED',
          requestId: meta.requestId,
          errorCode: 'OK',
          timestamp: meta.timestamp,
          userId: meta.userId,
        });
      },
    }
  );
}
