import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { refreshSession, tokenStore } from '../api/client';
import { authApi } from '../api/endpoints';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  const clear = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  // Sayfa yenilendiğinde cookie'deki refresh token ile oturumu geri yükle
  useEffect(() => {
    tokenStore.onExpired(clear);
    refreshSession()
      .then((d) => setUser(d.user))
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, [clear]);

  const handleSession = useCallback((d) => {
    tokenStore.set(d.accessToken);
    setUser(d.user);
  }, []);

  const value = useMemo(
    () => ({
      user,
      ready,
      login: async (body) => handleSession(await authApi.login(body)),
      register: async (body) => handleSession(await authApi.register(body)),
      logout: async () => {
        await authApi.logout().catch(() => {});
        clear();
      },
      clear,
    }),
    [user, ready, handleSession, clear],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
