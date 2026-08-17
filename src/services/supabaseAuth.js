import { createClient } from '@supabase/supabase-js';
import { prisma } from '../db/client.js';
import { databaseMode } from '../db/client.js';

const supabaseUrl = process.env.SUPABASE_URL?.trim();
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY?.trim();
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

export function isSupabaseConfigured() {
  return false;
}

export function getSupabasePublicConfig() {
  return {
    enabled: isSupabaseConfigured(),
    url: supabaseUrl || null,
    anonKey: supabaseAnonKey || null,
  };
}

function createAuthClient(accessToken) {
  if (!isSupabaseConfigured()) {
    return null;
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Verify a Supabase access token and return the auth user payload.
 * @param {string} accessToken
 */
export async function verifySupabaseAccessToken(accessToken) {
  const client = createAuthClient(accessToken);
  if (!client) {
    return null;
  }

  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data.user) {
    return null;
  }

  return data.user;
}

/**
 * Upsert an application User row from a Supabase auth identity.
 * Desktop has no usage/billing tiers; cloud database mode maps to paid.
 * @param {import('@supabase/supabase-js').User} supabaseUser
 */
export async function upsertUserFromSupabase(supabaseUser) {
  const email = supabaseUser.email;
  if (!email) {
    throw new Error('Supabase user is missing an email address.');
  }

  const tier = process.env.CPID_DESKTOP === '1' || databaseMode === 'cloud' ? 'paid' : 'free';

  const existing = await prisma.user.findFirst({
    where: {
      OR: [{ supabaseId: supabaseUser.id }, { email }],
    },
  });

  if (existing) {
    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: {
        email,
        supabaseId: supabaseUser.id,
        tier,
      },
    });

    return formatAppUser(updated);
  }

  const created = await prisma.user.create({
    data: {
      email,
      supabaseId: supabaseUser.id,
      tier,
    },
  });

  return formatAppUser(created);
}

export function formatAppUser(user) {
  return {
    id: user.id,
    email: user.email,
    tier: process.env.CPID_DESKTOP === '1' || user.tier === 'paid' ? 'paid' : 'free',
    supabaseId: user.supabaseId,
  };
}

export function getSupabaseAdminClient() {
  if (!isSupabaseConfigured() || !supabaseServiceKey) {
    return null;
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
