'use client';

import {
  AUTH_SESSION_EXPIRED,
  AuthApi,
  extractAuthTokenFromBody,
  extractUserFromAuthBody,
  apiErrorMessage,
} from '@/lib/api';
import { clearStoredPurchaseData } from '@/lib/balance-poll';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';

interface User {
  id?: string | number;
  name?: string;
  email?: string;
  [key: string]: unknown;
}

interface AuthContextValue {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: Record<string, unknown>) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Dispatched when auth keys in localStorage change in the same tab. */
export const AUTH_STORAGE_SYNC = 'travela-auth-storage-sync';

function readStoredUser(): User | null {
  if (typeof window === 'undefined') return null;
  const storedUser = localStorage.getItem('user');
  if (!storedUser) return null;
  try {
    return JSON.parse(storedUser) as User;
  } catch {
    return null;
  }
}

// Simulated delay to mimic a real network request (register only)
const delay = (ms = 800) => new Promise((r) => setTimeout(r, ms));

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const clearSession = useCallback(() => {
    clearStoredPurchaseData();
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
    window.dispatchEvent(new Event(AUTH_STORAGE_SYNC));
  }, []);

  const persistSession = useCallback((authToken: string, authUser: User) => {
    localStorage.setItem('token', authToken);
    localStorage.setItem('user', JSON.stringify(authUser));
    setToken(authToken);
    setUser(authUser);
    window.dispatchEvent(new Event(AUTH_STORAGE_SYNC));
  }, []);

  const logout = useCallback(() => {
    clearSession();
  }, [clearSession]);

  useEffect(() => {
    let cancelled = false;

    const syncFromStorage = () => {
      if (cancelled) return;
      setToken(localStorage.getItem('token'));
      setUser(readStoredUser());
    };

    const onStorage = (e: StorageEvent) => {
      if (e.key === 'token' || e.key === 'user' || e.key === null) {
        syncFromStorage();
      }
    };
    const onAuthSync = () => syncFromStorage();
    const onSessionExpired = () => clearSession();

    window.addEventListener('storage', onStorage);
    window.addEventListener(AUTH_STORAGE_SYNC, onAuthSync);
    window.addEventListener(AUTH_SESSION_EXPIRED, onSessionExpired);

    async function bootstrapSession() {
      const storedToken = localStorage.getItem('token');

      if (!storedToken) {
        setToken(null);
        setUser(null);
        setIsLoading(false);
        return;
      }

      setToken(storedToken);
      setUser(readStoredUser());

      const result = await AuthApi.me();
      if (cancelled) return;

      if (result.ok) {
        const apiUser = extractUserFromAuthBody(result.body);
        const cached = readStoredUser();
        const merged: User = {
          ...cached,
          id: apiUser?.id ?? cached?.id,
          name: apiUser?.name ?? cached?.name,
          email: apiUser?.email ?? cached?.email,
          email_verified: apiUser?.email_verified ?? cached?.email_verified,
          role: apiUser?.role ?? cached?.role ?? 'user',
        };
        localStorage.setItem('user', JSON.stringify(merged));
        setUser(merged);
        setIsLoading(false);
        return;
      }

      if (result.status === 401) {
        clearSession();
      }

      setIsLoading(false);
    }

    void bootstrapSession();

    return () => {
      cancelled = true;
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(AUTH_STORAGE_SYNC, onAuthSync);
      window.removeEventListener(AUTH_SESSION_EXPIRED, onSessionExpired);
    };
  }, [clearSession]);

  const login = useCallback(
    async (email: string, password: string) => {
      const trimmedEmail = email.trim();
      const result = await AuthApi.login({
        email: trimmedEmail,
        password,
      });

      if (!result.ok) {
        throw new Error(
          apiErrorMessage(result.body, 'Invalid email or password.')
        );
      }

      const authToken = extractAuthTokenFromBody(result.body);
      if (!authToken) {
        throw new Error('Login succeeded but no access token was returned.');
      }

      const apiUser = extractUserFromAuthBody(result.body);
      const bodyRecord =
        result.body && typeof result.body === 'object'
          ? (result.body as Record<string, unknown>)
          : null;
      const emailVerified =
        apiUser?.email_verified === true || bodyRecord?.email_verified === true;
      const authUser: User = {
        id: apiUser?.id,
        name: apiUser?.name,
        email: apiUser?.email ?? trimmedEmail,
        email_verified: emailVerified,
        role: apiUser?.role ?? 'user',
      };

      clearStoredPurchaseData();
      persistSession(authToken, authUser);
    },
    [persistSession]
  );

  const register = useCallback(async (data: Record<string, unknown>) => {
    await delay();
    // Simulate successful registration — replace with real API when backend is ready
    clearStoredPurchaseData();
    const mockToken = `mock_token_${Date.now()}`;
    const mockUser: User = {
      id: 1,
      name: (data.name as string) ?? 'Traveller',
      email: (data.email as string) ?? '',
    };
    persistSession(mockToken, mockUser);
  }, [persistSession]);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!token,
        isLoading,
        login,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
