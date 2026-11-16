import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, setToken, clearToken, getToken } from '../api/client';
import type { User } from '../types';
import { initNetlifyIdentity, logoutIdentity, openIdentityModal, type NetlifyUser } from './netlifyIdentity';

interface AuthState {
  user: User | null;
  loading: boolean;
  needsSetup: boolean;
  error: string | null;
}

interface AuthContextType extends AuthState {
  login: (email?: string, password?: string) => Promise<void>;
  openLoginModal: () => void;
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
      setState({ user: null, loading: false, needsSetup: false, error: null });
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
      setState({ user: null, loading: false, needsSetup: false, error: null });
    }
  }, []);

  // Initialize Netlify Identity widget and listen for login/logout/invite events
  useEffect(() => {
    initNetlifyIdentity(
      async (identityUser: NetlifyUser) => {
        try {
          const jwtToken = await identityUser.jwt();
          if (jwtToken) {
            setToken(jwtToken);
            await refreshUser();
          }
        } catch (err) {
          console.error('[IDENTITY] Error retrieving token from Netlify Identity:', err);
        }
      },
      () => {
        clearToken();
        setState({ user: null, loading: false, needsSetup: false, error: null });
      }
    );
  }, [refreshUser]);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const login = async (email?: string, password?: string) => {
    if (email && password) {
      const result = await api.login({ email, password });
      setToken(result.token);
      await refreshUser();
    } else {
      openIdentityModal('login');
    }
  };

  const openLoginModal = () => {
    openIdentityModal('login');
  };

  const logout = () => {
    logoutIdentity();
    api.logout().catch((err) => console.warn('Server logout error:', err));
    clearToken();
    setState({ user: null, loading: false, needsSetup: false, error: null });
  };

  return (
    <AuthContext.Provider value={{ ...state, login, openLoginModal, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
