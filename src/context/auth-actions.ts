export interface AuthUser {
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  email: string | null;
}

export async function performLogout(
  fetchFn: typeof fetch,
  callbacks: {
    onSuccess: () => void;
    onError: (err: string) => void;
  }
): Promise<void> {
  try {
    const res = await fetchFn('/api/v2/session/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (res.ok) {
      callbacks.onSuccess();
      return;
    }

    // Server returned non-200 (403, 500, 503, etc.): retain auth state, report error
    callbacks.onError('LOGOUT_FAILED');
  } catch (err: unknown) {
    callbacks.onError(err instanceof Error ? err.message : 'LOGOUT_FAILED');
  }
}

export async function checkSessionMe(
  fetchFn: typeof fetch,
  callbacks: {
    onAuthenticated: (user: AuthUser) => void;
    onUnauthenticated: () => void;
    onError: (err: string) => void;
  }
): Promise<void> {
  try {
    const res = await fetchFn('/api/v2/session/me', {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
    });

    if (res.ok) {
      const payload = await res.json();
      if (payload.success && payload.data) {
        callbacks.onAuthenticated(payload.data);
        return;
      }
    }

    if (res.status === 401) {
      callbacks.onUnauthenticated();
      return;
    }

    // Non-401 non-200 (500, 502, 503): Backend unavailable/error -> status must be ERROR, not UNAUTHENTICATED
    callbacks.onError('AUTH_BACKEND_ERROR');
  } catch (err: unknown) {
    callbacks.onError(err instanceof Error ? err.message : 'SESSION_CHECK_FAILED');
  }
}
