import { prisma } from '../db/client.js';
import { resolveRequestUser } from '../middleware/auth.js';
import { assertProjectOwnership } from '../middleware/tierGate.js';
import {
  sanitizeCalendarInput,
  serializeCalendarEntry,
  serializeCalendarProposal,
  selectUpcomingCalendar,
  jsonSafeCalendarPayload,
  calendarBodyFromPayload,
  calendarProposalKey,
} from '../utils/calendar.js';

const CALENDAR_ENTRY_INCLUDE = {
  project: { select: { name: true } },
  item: { select: { id: true, title: true, description: true, priority: true, completed: true } },
};

async function resolveOwnedItemId(projectId, itemId, { strict = false } = {}) {
  const id = String(itemId || '').trim();
  if (!id) return null;
  const found = await prisma.aIActionItem.findFirst({
    where: { id, projectId },
    select: { id: true },
  });
  if (found) return found.id;
  if (strict) {
    const error = new Error('Linked approach was not found on this project.');
    error.statusCode = 400;
    throw error;
  }
  return null;
}

async function loadOwnedProject(req) {
  const user = resolveRequestUser(req);
  if (!user) {
    const error = new Error('Authentication required.');
    error.statusCode = 401;
    throw error;
  }
  const project = await assertProjectOwnership(req.params.projectId, user.id);
  return { user, project };
}

export async function listCalendar(req, res) {
  try {
    const { user, project } = await loadOwnedProject(req);
    const [entries, proposals] = await Promise.all([
      prisma.calendarEntry.findMany({
        where: { projectId: project.id },
        orderBy: { startAt: 'asc' },
        include: CALENDAR_ENTRY_INCLUDE,
      }),
      prisma.calendarProposal.findMany({
        where: { userId: user.id, projectId: project.id, status: 'pending' },
        orderBy: { createdAt: 'desc' },
        include: { project: { select: { name: true } } },
      }),
    ]);
    return res.json({
      calendar: entries.map(serializeCalendarEntry),
      proposals: proposals.map(serializeCalendarProposal),
    });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({ error: error.message });
  }
}

export async function createCalendarEntry(req, res) {
  try {
    const { project } = await loadOwnedProject(req);
    const data = sanitizeCalendarInput(req.body, { source: 'user' });
    data.itemId = await resolveOwnedItemId(project.id, data.itemId, { strict: true });
    const entry = await prisma.calendarEntry.create({
      data: { ...data, projectId: project.id },
      include: CALENDAR_ENTRY_INCLUDE,
    });
    return res.status(201).json({ entry: serializeCalendarEntry(entry) });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({ error: error.message });
  }
}

export async function updateCalendarEntry(req, res) {
  try {
    const { project } = await loadOwnedProject(req);
    const existing = await prisma.calendarEntry.findFirst({
      where: { id: req.params.entryId, projectId: project.id },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Calendar item not found.' });
    }
    const data = sanitizeCalendarInput(
      { ...existing, ...req.body, startAt: req.body.startAt || req.body.start || existing.startAt },
      { source: 'user' }
    );
    data.itemId = await resolveOwnedItemId(
      project.id,
      Object.prototype.hasOwnProperty.call(req.body || {}, 'itemId') ? req.body.itemId : existing.itemId,
      { strict: true }
    );
    const entry = await prisma.calendarEntry.update({
      where: { id: existing.id },
      data,
      include: CALENDAR_ENTRY_INCLUDE,
    });
    return res.json({ entry: serializeCalendarEntry(entry) });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({ error: error.message });
  }
}

export async function deleteCalendarEntry(req, res) {
  try {
    const { project } = await loadOwnedProject(req);
    const existing = await prisma.calendarEntry.findFirst({
      where: { id: req.params.entryId, projectId: project.id },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Calendar item not found.' });
    }
    await prisma.calendarEntry.delete({ where: { id: existing.id } });
    return res.json({ ok: true, id: existing.id });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({ error: error.message });
  }
}

export async function listCalendarProposals(req, res) {
  try {
    const user = resolveRequestUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    const proposals = await prisma.calendarProposal.findMany({
      where: { userId: user.id, status: 'pending' },
      orderBy: { createdAt: 'desc' },
      include: { project: { select: { name: true } } },
      take: 20,
    });
    return res.json({ proposals: proposals.map(serializeCalendarProposal) });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

function parseProposalPayload(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function applyStoredProposal(proposal) {
  const payload = parseProposalPayload(proposal.payloadJson);
  let entry = null;

  if (proposal.action === 'create') {
    const data = sanitizeCalendarInput(calendarBodyFromPayload(payload), { source: 'ai' });
    data.itemId = await resolveOwnedItemId(proposal.projectId, data.itemId || proposal.itemId);
    entry = await prisma.calendarEntry.create({
      data: { ...data, projectId: proposal.projectId },
      include: CALENDAR_ENTRY_INCLUDE,
    });
  } else if (proposal.action === 'update' && proposal.entryId) {
    const existing = await prisma.calendarEntry.findFirst({
      where: { id: proposal.entryId, projectId: proposal.projectId },
    });
    if (!existing) {
      const error = new Error('Calendar item not found.');
      error.statusCode = 404;
      throw error;
    }
    const data = sanitizeCalendarInput(calendarBodyFromPayload(payload, existing), {
      source: 'ai',
      allowPast: true,
    });
    data.itemId = await resolveOwnedItemId(
      proposal.projectId,
      data.itemId || proposal.itemId || existing.itemId
    );
    entry = await prisma.calendarEntry.update({
      where: { id: existing.id },
      data,
      include: CALENDAR_ENTRY_INCLUDE,
    });
  } else if (proposal.action === 'delete' && proposal.entryId) {
    await prisma.calendarEntry.deleteMany({
      where: { id: proposal.entryId, projectId: proposal.projectId },
    });
  } else {
    const error = new Error('This schedule change cannot be applied.');
    error.statusCode = 400;
    throw error;
  }

  await prisma.calendarProposal.update({
    where: { id: proposal.id },
    data: { status: 'applied', ...(entry ? { entryId: entry.id } : {}) },
  });

  const fingerprint = calendarProposalKey(proposal);
  const siblings = await prisma.calendarProposal.findMany({
    where: {
      userId: proposal.userId,
      status: 'pending',
      projectId: proposal.projectId,
      action: proposal.action,
      id: { not: proposal.id },
    },
  });
  const duplicateIds = siblings
    .filter((row) => calendarProposalKey(row) === fingerprint)
    .map((row) => row.id);
  if (duplicateIds.length) {
    await prisma.calendarProposal.updateMany({
      where: { id: { in: duplicateIds } },
      data: { status: 'applied' },
    });
  }

  return {
    proposal: { ...serializeCalendarProposal(proposal), status: 'applied', entryId: entry?.id || proposal.entryId },
    entry: entry ? serializeCalendarEntry(entry) : null,
  };
}

export async function applyPendingCalendarProposals({ userId, source, itemId, projectId } = {}) {
  const pending = await prisma.calendarProposal.findMany({
    where: {
      userId,
      status: 'pending',
      ...(source ? { source } : {}),
      ...(itemId ? { itemId } : {}),
      ...(projectId ? { projectId } : {}),
    },
    include: { project: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const applied = [];
  for (const row of pending) {
    applied.push(await applyStoredProposal(row));
  }
  return applied;
}

export async function dismissPendingCalendarProposals({ userId, source, itemId, projectId } = {}) {
  const result = await prisma.calendarProposal.updateMany({
    where: {
      userId,
      status: 'pending',
      ...(source ? { source } : {}),
      ...(itemId ? { itemId } : {}),
      ...(projectId ? { projectId } : {}),
    },
    data: { status: 'dismissed' },
  });
  return result.count;
}

async function upcomingForUser(userId) {
  const projects = await prisma.project.findMany({
    where: { userId },
    select: { id: true },
  });
  return loadUpcomingCalendarForUser(userId, projects.map((row) => row.id));
}

export async function applyCalendarProposal(req, res) {
  try {
    const user = resolveRequestUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    const proposal = await prisma.calendarProposal.findFirst({
      where: { id: req.params.proposalId, userId: user.id },
      include: { project: { select: { name: true } } },
    });
    if (!proposal) {
      return res.status(404).json({ error: 'Schedule change not found.' });
    }
    await assertProjectOwnership(proposal.projectId, user.id);

    let result;
    if (proposal.status === 'pending') {
      result = await applyStoredProposal(proposal);
    } else {
      let entry = null;
      if (proposal.entryId) {
        const existing = await prisma.calendarEntry.findFirst({
          where: { id: proposal.entryId, projectId: proposal.projectId },
          include: CALENDAR_ENTRY_INCLUDE,
        });
        entry = existing ? serializeCalendarEntry(existing) : null;
      }
      result = {
        proposal: serializeCalendarProposal(proposal),
        entry,
      };
    }

    let upcomingCalendar = await upcomingForUser(user.id);
    if (result.entry) {
      upcomingCalendar = [
        result.entry,
        ...upcomingCalendar.filter((row) => row.id !== result.entry.id),
      ].slice(0, 12);
    }
    return res.json({ ...result, upcomingCalendar });
  } catch (error) {
    console.error('[applyCalendarProposal]', error);
    const status = error.statusCode || 500;
    return res.status(status).json({ error: error.message });
  }
}

export async function dismissCalendarProposal(req, res) {
  try {
    const user = resolveRequestUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    const proposal = await prisma.calendarProposal.findFirst({
      where: { id: req.params.proposalId, userId: user.id, status: 'pending' },
    });
    if (!proposal) {
      return res.status(404).json({ error: 'Schedule change not found.' });
    }
    await prisma.calendarProposal.update({
      where: { id: proposal.id },
      data: { status: 'dismissed' },
    });
    return res.json({ ok: true, id: proposal.id });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

export async function persistCalendarProposals({
  userId,
  proposals,
  source,
  itemId = null,
  applyImmediately = false,
}) {
  if (!proposals?.length) return { proposals: [], entries: [] };
  const existing = await prisma.calendarProposal.findMany({
    where: { userId, status: 'pending' },
  });
  const seen = new Set(existing.map((row) => calendarProposalKey(row)));
  const created = [];
  for (const proposal of proposals) {
    const key = calendarProposalKey(proposal);
    if (seen.has(key)) continue;
    seen.add(key);
    created.push(
      await prisma.calendarProposal.create({
        data: {
          userId,
          projectId: proposal.projectId,
          entryId: proposal.entryId || null,
          itemId: proposal.payload?.itemId || itemId || null,
          source,
          action: proposal.action,
          payloadJson: JSON.stringify(jsonSafeCalendarPayload(proposal.payload || {})),
        },
        include: { project: { select: { name: true } } },
      })
    );
  }
  if (!applyImmediately) {
    return { proposals: created.map(serializeCalendarProposal), entries: [] };
  }

  const leftover = [];
  const entries = [];
  for (const row of created) {
    try {
      const applied = await applyStoredProposal(row);
      if (applied.entry) entries.push(applied.entry);
    } catch (error) {
      console.error('[persistCalendarProposals] apply failed:', error?.message || error);
      leftover.push(row);
    }
  }
  return { proposals: leftover.map(serializeCalendarProposal), entries };
}

export async function loadUpcomingCalendarForUser(userId, projectIds, limit = 12) {
  if (!projectIds?.length) return [];
  const from = new Date();
  from.setDate(from.getDate() - 21);
  from.setHours(0, 0, 0, 0);
  const to = new Date();
  to.setDate(to.getDate() + 180);
  const recent = new Date();
  recent.setDate(recent.getDate() - 2);
  const entries = await prisma.calendarEntry.findMany({
    where: {
      projectId: { in: projectIds },
      OR: [
        { startAt: { gte: from, lte: to } },
        { createdAt: { gte: recent } },
      ],
    },
    orderBy: { startAt: 'asc' },
    take: 80,
    include: CALENDAR_ENTRY_INCLUDE,
  });
  return selectUpcomingCalendar(entries.map(serializeCalendarEntry), { limit });
}
