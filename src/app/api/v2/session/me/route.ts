import { handle } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return handle(
    req,
    async (c, user) => {
      const res = await c.query<{
        user_id: string;
        display_name: string | null;
        avatar_url: string | null;
        email: string | null;
      }>(
        `SELECT user_id, display_name, avatar_url, email
         FROM fintrack.auth_identities
         WHERE user_id = fintrack.current_session_user_id()
         ORDER BY last_login_at DESC
         LIMIT 1`
      );

      const identity = res.rows[0];
      return {
        userId: user,
        displayName: identity?.display_name ?? null,
        avatarUrl: identity?.avatar_url ?? null,
        email: identity?.email ?? null,
      };
    },
    {
      rateLimitMode: 'none',
      bodyMode: 'none',
      successStatus: 200,
    }
  );
}
