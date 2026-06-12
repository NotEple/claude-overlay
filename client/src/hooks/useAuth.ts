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

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${SERVER_URL}/auth/me`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = () => { window.location.href = `${SERVER_URL}/auth/twitch`; };

  const logout = async () => {
    await fetch(`${SERVER_URL}/auth/logout`, { method: 'POST', credentials: 'include' });
    setUser(null);
  };

  const refreshUser = useCallback(async () => {
    const r = await fetch(`${SERVER_URL}/auth/refresh`, { credentials: 'include' });
    if (r.ok) setUser(await r.json());
  }, []);

  return { user, loading, login, logout, refreshUser };
}
