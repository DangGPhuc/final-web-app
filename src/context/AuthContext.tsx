'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  type AuthUser,
  performLogout,
  checkSessionMe,
} from './auth-actions';

export type { AuthUser };
export { performLogout, checkSessionMe };

export type AuthStatus = 'LOADING' | 'AUTHENTICATED' | 'UNAUTHENTICATED' | 'ERROR';

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
    setStatus('LOADING');
    setError(null);
    await checkSessionMe(fetch, {
      onAuthenticated: (u) => {
        setUser(u);
        setStatus('AUTHENTICATED');
      },
      onUnauthenticated: () => {
        setUser(null);
        setStatus('UNAUTHENTICATED');
      },
      onError: (err) => {
        setError(err);
        setStatus('ERROR');
      },
    });
  }, []);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  const loginWithGoogle = useCallback(() => {
    const returnPath = typeof window !== 'undefined' ? window.location.pathname : '/';
    window.location.href = `/api/v2/auth/google/start?redirect_path=${encodeURIComponent(returnPath)}`;
  }, []);

  const logout = useCallback(async () => {
    setError(null);
    await performLogout(fetch, {
      onSuccess: () => {
        setUser(null);
        setStatus('UNAUTHENTICATED');
      },
      onError: (err) => {
        setError(err);
      },
    });
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
