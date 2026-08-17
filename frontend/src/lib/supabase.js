import { createClient } from '@supabase/supabase-js';

let supabaseClient = null;

export function getSupabaseClient() {
  return supabaseClient;
}

export function initSupabaseClient(url, anonKey) {
  if (!url || !anonKey) {
    supabaseClient = null;
    return null;
  }

  if (
    supabaseClient &&
    supabaseClient.supabaseUrl === url &&
    supabaseClient.supabaseKey === anonKey
  ) {
    return supabaseClient;
  }

  supabaseClient = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
      storageKey: 'cpid-auth',
    },
  });

  return supabaseClient;
}

export async function getAccessToken() {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data } = await client.auth.getSession();
  return data.session?.access_token ?? null;
}
