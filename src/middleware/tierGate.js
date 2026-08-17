import { prisma } from '../db/client.js';
import { resolveRequestUser, getUserWithTier } from './auth.js';

/**
 * Ensure the requesting user owns the target project.
 * @param {string} projectId
 * @param {string} userId
 */
export async function assertProjectOwnership(projectId, userId) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
  });

  if (!project) {
    const error = new Error('Project not found or access denied.');
    error.statusCode = 404;
    throw error;
  }

  return project;
}

/** Desktop has no report retention or billing caps. */
export async function assertReportRetentionLimit(userId) {
  const dbUser = await getUserWithTier(userId);
  if (!dbUser) {
    const error = new Error('User not found.');
    error.statusCode = 401;
    throw error;
  }

  return dbUser;
}

export async function enforceReportRetentionLimit(req, res, next) {
  try {
    const user = resolveRequestUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    const { projectId } = req.params;
    await assertProjectOwnership(projectId, user.id);
    await assertReportRetentionLimit(user.id);
    return next();
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({ error: error.message, code: error.code });
  }
}

/** Desktop allows roadmap sharing without a paid/cloud upgrade. */
export async function enforcePaidSharing(req, res, next) {
  try {
    const user = resolveRequestUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    const dbUser = await getUserWithTier(user.id);
    if (!dbUser) {
      return res.status(401).json({ error: 'User not found.' });
    }

    req.user = dbUser;
    return next();
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({ error: error.message });
  }
}

export default {
  assertProjectOwnership,
  assertReportRetentionLimit,
  enforceReportRetentionLimit,
  enforcePaidSharing,
};
