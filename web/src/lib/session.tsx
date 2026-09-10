import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';
import type { Meta, User } from './types';

interface SessionValue {
  user: User | null;
  meta: Meta | null;
  needsSetup: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  setUser: (user: User | null) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [me, state, metaResponse] = await Promise.all([
        api.me(),
        api.authState(),
        api.meta().catch(() => null),
      ]);
      setUser(me.user);
      setNeedsSetup(state.needsSetup);
      if (metaResponse) setMeta(metaResponse);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<SessionValue>(
    () => ({ user, meta, needsSetup, loading, refresh, setUser }),
    [user, meta, needsSetup, loading, refresh],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession muss innerhalb von SessionProvider genutzt werden.');
  return value;
}
