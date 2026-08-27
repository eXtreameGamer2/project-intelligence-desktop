import { Router } from 'express';
import { prisma, databaseMode } from '../db/client.js';
import { getAppVersion } from '../utils/appVersion.js';
import {
  formatAppUser,
  getSupabasePublicConfig,
  isSupabaseConfigured,
  upsertUserFromSupabase,
  verifySupabaseAccessToken,
} from '../services/supabaseAuth.js';
import { allowDevHeaderAuth, resolveRequestUser } from '../middleware/auth.js';

const router = Router();

router.get('/config', (_req, res) => {
  res.json({
    ...getSupabasePublicConfig(),
    databaseMode,
    appVersion: getAppVersion(),
    authMode: isSupabaseConfigured() ? 'supabase' : 'local-bootstrap',
  });
});

router.get('/me', async (req, res) => {
  try {
    const authUser = resolveRequestUser(req);
    if (authUser) {
      const dbUser = await prisma.user.findUnique({ where: { id: authUser.id } });
      if (dbUser) {
        return res.json({
          user: formatAppUser(dbUser),
          databaseMode,
          authMode: req.authUser ? 'supabase' : 'local-bootstrap',
        });
      }
    }

    const token = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7).trim()
      : null;

    if (token && isSupabaseConfigured()) {
      const supabaseUser = await verifySupabaseAccessToken(token);
      if (supabaseUser) {
        const user = await upsertUserFromSupabase(supabaseUser);
        return res.json({
          user,
          databaseMode,
          authMode: 'supabase',
        });
      }
    }

    return res.status(401).json({ error: 'Not authenticated.' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/bootstrap', async (_req, res) => {
  try {
    if (isSupabaseConfigured() || !allowDevHeaderAuth()) {
      return res.status(400).json({
        error: 'Sign in instead of using local bootstrap.',
        authMode: isSupabaseConfigured() ? 'supabase' : 'cloud',
      });
    }

    const user = await prisma.user.findFirst({
      orderBy: { createdAt: 'asc' },
    });

    if (!user) {
      return res.status(404).json({
        error: 'No user found. Run npm run db:seed first.',
      });
    }

    return res.json({
      user: formatAppUser(user),
      databaseMode,
      authMode: 'local-bootstrap',
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
