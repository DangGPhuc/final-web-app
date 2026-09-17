import { handle } from '@/server/http';
import { revokeCurrentSession, clearSessionCookieHeader } from '@/server/session';
import { logSecurityEvent } from '@/server/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return handle(
    req,
    async (c, user, context) => {
      await revokeCurrentSession(c);
      logSecurityEvent({
        event: 'SECURITY_SESSION_REVOKED',
        requestId: context.requestId,
        errorCode: 'OK',
        timestamp: new Date().toISOString(),
        userId: user,
      });
      return { revoked: true };
    },
    {
      customHeaders: {
        'Set-Cookie': clearSessionCookieHeader(),
      },
    }
  );
}
