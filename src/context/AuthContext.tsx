'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

export type AuthStatus = 'LOADING' | 'AUTHENTICATED' | 'UNAUTHENTICATED' | 'ERROR';

export interface AuthUser {
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  email: string | null;
}

interface AuthContextType {
  status: AuthStatus;
  user: AuthUser | null;
  error: string | null;
  loginWithGoogle: () => void;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<AuthStatus>('LOADING');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshSession = useCallback(async () => {
    try {
      setStatus('LOADING');
      setError(null);
      const res = await fetch('/api/v2/session/me', {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
      });

      if (res.ok) {
        const payload = await res.json();
        if (payload.success && payload.data) {
          setUser(payload.data);
          setStatus('AUTHENTICATED');
          return;
        }
      }

      if (res.status === 401) {
        setUser(null);
        setStatus('UNAUTHENTICATED');
        return;
      }

      // If non-200 / disabled backend, treat safely as unauthenticated
      setUser(null);
      setStatus('UNAUTHENTICATED');
    } catch (err: unknown) {
      setUser(null);
      setError(err instanceof Error ? err.message : 'SESSION_CHECK_FAILED');
      setStatus('ERROR');
    }
  }, []);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  const loginWithGoogle = useCallback(() => {
    // Browser navigation to server-side Google OIDC start flow
    const returnPath = typeof window !== 'undefined' ? window.location.pathname : '/';
    window.location.href = `/api/v2/auth/google/start?redirect_path=${encodeURIComponent(returnPath)}`;
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/v2/session/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
        },
      });
    } finally {
      setUser(null);
      setStatus('UNAUTHENTICATED');
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        status,
        user,
        error,
        loginWithGoogle,
        logout,
        refreshSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
