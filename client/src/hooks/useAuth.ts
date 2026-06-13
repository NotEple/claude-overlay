import { useCallback, useEffect, useState } from 'react';

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';

export interface AuthUser {
  id: string;
  login: string;
  displayName: string;
  avatar: string;
  color: string;
  isOwner: boolean;
  isAdmin: boolean;
}

const TOKEN_KEY = 'auth_token';

export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function authHeaders(): Record<string, string> {
  const t = getAuthToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Pick up token from OAuth redirect
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
      window.history.replaceState({}, '', '/');
    }

    fetch(`${SERVER_URL}/auth/me`, {
      credentials: 'include',
      headers: authHeaders(),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = () => { window.location.href = `${SERVER_URL}/auth/twitch`; };

  const logout = async () => {
    localStorage.removeItem(TOKEN_KEY);
    await fetch(`${SERVER_URL}/auth/logout`, { method: 'POST', credentials: 'include', headers: authHeaders() });
    setUser(null);
  };

  const refreshUser = useCallback(async () => {
    const r = await fetch(`${SERVER_URL}/auth/refresh`, { credentials: 'include', headers: authHeaders() });
    if (r.ok) setUser(await r.json());
  }, []);

  return { user, loading, login, logout, refreshUser };
}
