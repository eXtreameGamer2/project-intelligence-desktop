import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { bootstrapSession, clearStoredAiSettings, fetchAuthConfig, fetchCurrentUser } from '../api/client';
import { getAccessToken, getSupabaseClient, initSupabaseClient } from '../lib/supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [databaseMode, setDatabaseMode] = useState('local');
  const [authMode, setAuthMode] = useState('local-bootstrap');
  const [authConfig, setAuthConfig] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const hydrateSession = useCallback(async () => {
    setError('');

    const config = await fetchAuthConfig();
    setAuthConfig(config);
    setDatabaseMode(config.databaseMode);

    if (config.enabled) {
      initSupabaseClient(config.url, config.anonKey);
      const token = await getAccessToken();

      if (token) {
        const session = await fetchCurrentUser(token);
        setUser(session.user);
        setAuthMode(session.authMode);
        setDatabaseMode(session.databaseMode);
        return;
      }

      setUser(null);
      clearStoredAiSettings();
      setAuthMode('supabase');
      return;
    }

    const session = await bootstrapSession();
    setUser(session.user);
    setAuthMode(session.authMode);
    setDatabaseMode(session.databaseMode);
  }, []);

  useEffect(() => {
    let unsubscribe = () => {};

    hydrateSession()
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false))
      .then(async () => {
        const client = getSupabaseClient();
        if (!client) return;

        const { data } = client.auth.onAuthStateChange(async (event) => {
          if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;
          try {
            await hydrateSession();
          } catch (err) {
            setError(err.message);
          }
        });

        unsubscribe = () => data.subscription.unsubscribe();
      });

    return () => unsubscribe();
  }, [hydrateSession]);

  const signOut = useCallback(async () => {
    clearStoredAiSettings(user?.id);
    const client = getSupabaseClient();
    if (client) {
      await client.auth.signOut();
    }
    setUser(null);
    if (authConfig?.enabled) {
      setAuthMode('supabase');
    } else {
      await hydrateSession();
    }
  }, [authConfig, hydrateSession, user?.id]);

  const value = useMemo(
    () => ({
      user,
      setUser,
      databaseMode,
      authMode,
      authConfig,
      isLoading,
      error,
      signOut,
      refreshSession: hydrateSession,
      requiresLogin: authConfig?.enabled && !user,
    }),
    [user, databaseMode, authMode, authConfig, isLoading, error, signOut, hydrateSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
