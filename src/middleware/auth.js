import {
  formatAppUser,
  isSupabaseConfigured,
  upsertUserFromSupabase,
  verifySupabaseAccessToken,
} from '../services/supabaseAuth.js';
import { prisma } from '../db/client.js';

function readBearerToken(req) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return null;
  }
  return header.slice(7).trim();
}

/**
 * Attach authenticated user to the request when a valid Supabase JWT is present.
 * Falls through silently so local bootstrap headers still work in dev.
 */
export async function attachAuthUser(req, _res, next) {
  try {
    const token = readBearerToken(req);
    if (!token || !isSupabaseConfigured()) {
      return next();
    }

    const supabaseUser = await verifySupabaseAccessToken(token);
    if (!supabaseUser) {
      return next();
    }

    req.authUser = await upsertUserFromSupabase(supabaseUser);
    req.accessToken = token;
    return next();
  } catch (error) {
    return next(error);
  }
}

/**
 * Resolve the active user from Supabase JWT (preferred) or legacy dev headers.
 * @param {import('express').Request} req
 */
export function resolveRequestUser(req) {
  if (req.authUser) {
    return req.authUser;
  }

  if (isSupabaseConfigured()) {
    return null;
  }

  const userId = req.headers['x-user-id'];
  if (!userId) {
    return null;
  }

  if (process.env.CPID_DESKTOP === '1') {
    return { id: String(userId), tier: 'paid' };
  }

  const tier = (req.headers['x-user-tier'] || 'free').toLowerCase();
  return { id: String(userId), tier: tier === 'paid' ? 'paid' : 'free' };
}

/**
 * Require any authenticated user before proceeding.
 */
export function requireAuth(req, res, next) {
  const user = resolveRequestUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  req.user = user;
  return next();
}

/**
 * Load user record and merge tier from database (authoritative).
 * @param {string} userId
 */
export async function getUserWithTier(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return null;
  }
  return formatAppUser(user);
}

export { formatAppUser };
