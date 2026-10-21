import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, setToken, clearToken, getToken } from '../api/client';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  loading: boolean;
  needsSetup: boolean;
  error: string | null;
}

interface AuthContextType extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: true,
    needsSetup: false,
    error: null,
  });

  const refreshUser = useCallback(async () => {
    const token = getToken();
    if (!token) {
      // Check if first-time setup is needed
      try {
        const result = await api.checkSetup();
        setState({ user: null, loading: false, needsSetup: result.needs_setup, error: null });
      } catch {
        setState({ user: null, loading: false, needsSetup: false, error: null });
      }
      return;
    }

    try {
      const result = await api.me();
      setState({
        user: result.user as unknown as User,
        loading: false,
        needsSetup: false,
        error: null,
      });
    } catch {
      clearToken();
      try {
        const setupResult = await api.checkSetup();
        setState({ user: null, loading: false, needsSetup: setupResult.needs_setup, error: null });
      } catch {
        setState({ user: null, loading: false, needsSetup: false, error: null });
      }
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const login = async (email: string, password: string) => {
    const result = await api.login({ email, password });
    setToken(result.token);
    setState({
      user: result.user as unknown as User,
      loading: false,
      needsSetup: false,
      error: null,
    });
  };

  const logout = () => {
    // Attempt server-side token revocation
    api.logout().catch((err) => console.warn('Server logout error:', err));
    clearToken();
    setState({ user: null, loading: false, needsSetup: false, error: null });
  };

  return (
    <AuthContext.Provider value={{ ...state, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
