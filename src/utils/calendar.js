import { isolateJsonArray, repairJsonSyntax } from './jsonRepair.js';
import { visibleAssistantReply } from './aiDisplay.js';
import { resolveDatabaseConfig } from '../db/config.js';
import {
  fallbackStartDate,
  formatInZone,
  formatLocalIso,
  inferWhen,
  isPastZonedDay,
  parseZonedDate,
  readUserClock,
  resolveProposedStart,
} from './userTime.js';

let calendarSchemaReady = false;

export const CALENDAR_KINDS = ['event', 'task', 'meeting', 'unavailable'];
export const CALENDAR_STATUSES = ['scheduled', 'ontime', 'delayed', 'completed'];
export const CALENDAR_ACTIONS = ['create', 'update', 'delete'];

export const KIND_LABELS = {
  event: 'Event',
  task: 'Task',
  meeting: 'Meeting',
  unavailable: 'Unavailable',
};

export const STATUS_LABELS = {
  scheduled: 'Scheduled',
  ontime: 'On time',
  delayed: 'Delayed',
  completed: 'Completed',
};

export function inferCalendarAction(text) {
  const value = String(text || '').toLowerCase();
  if (!value) return '';
  if (
    /\b(delete|remove|cancel|unschedule|take\s+(it|this|that)?\s*off|drop off|clear off)\b/.test(value) ||
    /\b(get|take)\s+(it|this|that)\s+off\s+(the\s+)?calendar\b/.test(value)
  ) {
    return 'delete';
  }
  if (
    /\b(reschedule|move|rename|update|change|edit|push|mark|complete|completed|finish|finished)\b/.test(
      value
    )
  ) {
    return 'update';
  }
  if (/\b(schedule|add|book|create|put|block|plan|set up|pencil)\b/.test(value)) return 'create';
  return '';
}

export function inferCalendarKind(text, fallback = '') {
  const value = String(text || '').toLowerCase();
  if (
    /\b(unavailab\w*|out of office|\boo+\b|pto|time off|day off|vacation|blocked day|busy day|off day)\b/.test(
      value
    )
  ) {
    return 'unavailable';
  }
  if (/\b(meeting|call|standup|stand-up|sync|1:1|one[-\s]?on[-\s]?one|interview|huddle|zoom)\b/.test(value)) {
    return 'meeting';
  }
  if (/\b(event|launch|demo|presentation|webinar|kickoff|ceremony)\b/.test(value)) return 'event';
  if (/\b(task|to-?do|chore|action item|fix|ticket|work item)\b/.test(value)) return 'task';
  return fallback;
}

export function inferCalendarStatus(text, fallback = '') {
  const value = String(text || '').toLowerCase();
  if (/\b(complete|completed|done|finished|mark(?:ed)?\s+(it|this|that)?\s*(as\s+)?(complete|done))\b/.test(value)) {
    return 'completed';
  }
  if (/\b(on time|ontime|on-time|on track|on-track)\b/.test(value)) return 'ontime';
  if (/\b(delayed|late|overdue|behind|slipped)\b/.test(value)) return 'delayed';
  if (/\b(scheduled|planned|upcoming)\b/.test(value)) return 'scheduled';
  return fallback;
}

export function calendarProposalLimit(text, { max = 8 } = {}) {
  const value = String(text || '');
  const words = {
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };
  const counted = value.match(
    /\b(\d+|two|three|four|five|six|seven|eight|nine|ten)\s+(items?|tasks?|meetings?|events?|entries|things|schedules?)\b/i
  );
  if (counted) {
    const amount = words[counted[1].toLowerCase()] || Number(counted[1]);
    if (Number.isFinite(amount) && amount >= 2) return Math.min(max, Math.max(2, Math.floor(amount)));
  }
  if (
    /\b(all|each|every|these|them|both|several|multiple|a few|a couple)\b/i.test(value) ||
    /\b(schedule|book|add|create|put|delete|remove|cancel).{0,160}\band\b/i.test(value)
  ) {
    return max;
  }
  return 1;
}

export function calendarVocabularyPrompt() {
  return [
    'CALENDAR LABELS — use only these fields. They match the calendar UI.',
    'Actions: create (schedule/add/book/put on the calendar), update (reschedule/change type or status/mark complete), delete (delete/remove/cancel/unschedule/take off).',
    'Types (kind):',
    '- task = Task. Work to do. Default. User may say task, to-do, fix, action, ticket.',
    '- meeting = Meeting. A call or sit-down. User may say meeting, call, standup, sync, 1:1.',
    '- event = Event. A dated occurrence. User may say event, launch, demo, presentation.',
    '- unavailable = Unavailable. Blocked time, usually all-day. User may say unavailable, OOO, PTO, off, vacation.',
    'Time status (status) chips:',
    '- scheduled = Scheduled. Planned, not done. Default for new items.',
    '- ontime = On time. Happening as planned / on track. User may say on time, on track.',
    '- delayed = Delayed. The start calendar day is before today. The app computes this for display. Do not set delayed on a new item. For an existing item, user may say delayed, late, overdue.',
    '- completed = Completed. Finished. User may say done, complete, finished.',
    'Never invent other kinds or statuses. Map the user\'s words onto these labels.',
    'If they name an existing calendar item, update or delete that item instead of creating a duplicate.',
    'If they ask for more than one item (all, these, both, several, multiple, a count, or a list joined by and), return one JSON object per item, up to 8. If they ask for one, return exactly one.',
    'Approach link (approach): optional number or title from APPROACHES. Puts the calendar item on that approach so the user can open it from the calendar.',
    'When scheduling work for an approach, set approach to that number (or omit it when discussing one approach — it links there). Use the approach title for the calendar title and its notes for calendar notes unless the user asked for different wording.',
  ].join('\n');
}

function tryParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseDate(value, clock) {
  return parseZonedDate(value, clock || readUserClock());
}

function isPastCalendarDay(value, clock) {
  return isPastZonedDay(value, clock || readUserClock());
}

export function isScheduleApprovalMessage(text) {
  return /^(y|yes|yeah|yep|ok|okay|sure|confirm|confirmed|looks good|please do|do it|go ahead|approve)[.!\s]*$/i.test(
    String(text || '').trim()
  );
}

export function userAskedForCalendarChange(text) {
  return /\b(schedule|reschedule|calendar|book|meeting|event|unavailable|ooo|pto|remind me|block time|pencil.{0,16}in|put (it|this|that) (on|in)|add (it|this|that)(\s+(to|on|at|for)\b)?|delete|remove|cancel|unschedule|take (it|this|that)? off|mark (it |this |that )?(complete|done|on time|delayed|late)|on time|delayed|completed)\b/i.test(
    String(text || '')
  );
}

export function isScheduleRejectionMessage(text) {
  return /^(n|no|nope|nah|no thanks|don't|dont|cancel|dismiss|never mind|nevermind)[.!\s]*$/i.test(
    String(text || '').trim()
  );
}

function pick(value, allowed, fallback) {
  const next = String(value || '').toLowerCase().trim();
  if (allowed.includes(next)) return next;
  const token = next.split(/[|,/\s]+/).find((part) => allowed.includes(part));
  return token || fallback;
}

export function displayStatus(entry, now = new Date()) {
  if (entry.status === 'completed') return 'completed';
  if (entry.kind === 'unavailable') return entry.status || 'scheduled';
  const start = new Date(entry.startAt);
  if (!Number.isNaN(start.getTime())) {
    const startDay = new Date(start);
    const today = new Date(now);
    startDay.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    if (startDay < today) return 'delayed';
  }
  if (entry.status === 'ontime') return 'ontime';
  return 'scheduled';
}

export function serializeCalendarEntry(entry) {
  const item = entry.item || null;
  return {
    id: entry.id,
    projectId: entry.projectId,
    projectName: entry.project?.name || null,
    kind: entry.kind,
    title: entry.title,
    notes: entry.notes || '',
    startAt: entry.startAt instanceof Date ? entry.startAt.toISOString() : entry.startAt,
    endAt: entry.endAt instanceof Date ? entry.endAt.toISOString() : entry.endAt || null,
    allDay: Boolean(entry.allDay),
    status: entry.status,
    displayStatus: displayStatus(entry),
    source: entry.source,
    itemId: entry.itemId || item?.id || null,
    itemTitle: item?.title || null,
    itemNotes: item?.description || '',
    itemPriority: item?.priority ?? null,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

export function selectUpcomingCalendar(entries, { limit = 12, now = new Date() } = {}) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const open = (entries || []).filter((entry) => {
    if (entry.kind === 'unavailable') return new Date(entry.startAt) >= today;
    return (entry.displayStatus || entry.status) !== 'completed';
  });
  const late = [];
  const rest = [];
  for (const entry of open) {
    const start = new Date(entry.startAt);
    if (entry.kind !== 'unavailable' && (entry.displayStatus === 'delayed' || start < today)) {
      late.push(entry);
    } else if (start >= today) {
      rest.push(entry);
    }
  }
  const byStart = (a, b) => new Date(a.startAt) - new Date(b.startAt);
  return [...late.sort(byStart), ...rest.sort(byStart)].slice(0, limit);
}

export function sanitizeCalendarInput(body = {}, { source = 'user', clock, allowPast = false } = {}) {
  const userClock = clock || readUserClock(body.clock || {});
  const title = String(body.title || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  const kind = pick(body.kind, CALENDAR_KINDS, 'task');
  const startAt = parseDate(body.startAt || body.start || body.date || body.when, userClock);
  const endAt = parseDate(body.endAt || body.end, userClock);
  const allDay = Boolean(body.allDay) || kind === 'unavailable';
  const notes = String(body.notes || '').trim().slice(0, 500) || null;
  let status = pick(body.status, CALENDAR_STATUSES, 'scheduled');
  let nextStart = startAt;

  if (!title) {
    const error = new Error('Title is required.');
    error.statusCode = 400;
    throw error;
  }
  if (!nextStart) {
    const error = new Error('A start date is required.');
    error.statusCode = 400;
    throw error;
  }
  if (source === 'ai' && !allowPast) {
    if (status === 'delayed') status = 'scheduled';
    if (isPastCalendarDay(nextStart, userClock)) nextStart = fallbackStartDate(userClock);
  }

  const rawItemId = body.itemId ?? body.approachId ?? null;
  const itemId =
    rawItemId === undefined || rawItemId === null || rawItemId === ''
      ? null
      : String(rawItemId).trim() || null;

  return {
    kind,
    title,
    notes,
    startAt: nextStart,
    endAt: endAt && endAt >= nextStart ? endAt : null,
    allDay,
    status: kind === 'unavailable' ? 'scheduled' : status,
    source,
    itemId,
  };
}

export function jsonSafeCalendarPayload(payload = {}) {
  const startAt = parseDate(payload.startAt || payload.start || payload.date || payload.when);
  const endAt = parseDate(payload.endAt || payload.end);
  return {
    kind: payload.kind || 'task',
    title: payload.title || '',
    notes: payload.notes || null,
    startAt: startAt ? startAt.toISOString() : payload.startAt || payload.start || null,
    endAt: endAt ? endAt.toISOString() : payload.endAt || payload.end || null,
    allDay: Boolean(payload.allDay),
    status: payload.status || 'scheduled',
    itemId: payload.itemId || null,
    itemTitle: payload.itemTitle || null,
  };
}

export function calendarProposalKey(proposal = {}) {
  let payload = proposal.payload;
  if (!payload && proposal.payloadJson) {
    try {
      payload = JSON.parse(proposal.payloadJson);
    } catch {
      payload = {};
    }
  }
  payload = payload && typeof payload === 'object' ? payload : {};
  const title = String(payload.title || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const start = parseDate(payload.startAt || payload.start);
  const day = start ? start.toISOString().slice(0, 10) : '';
  return `${proposal.projectId || ''}|${proposal.action || ''}|${title}|${day}`;
}

export function calendarBodyFromPayload(payload = {}, existing = null) {
  return {
    kind: payload.kind || existing?.kind,
    title: payload.title || existing?.title,
    notes: payload.notes ?? existing?.notes,
    startAt: payload.startAt || payload.start || payload.date || payload.when || existing?.startAt,
    endAt: payload.endAt || payload.end || existing?.endAt,
    allDay: payload.allDay ?? existing?.allDay,
    status: payload.status || existing?.status,
    itemId: payload.itemId ?? existing?.itemId ?? null,
  };
}

function resolveProject(value, projects, fallbackId) {
  if (value && typeof value === 'object') {
    return resolveProject(value.n ?? value.id ?? value.name ?? value.project, projects, fallbackId);
  }
  const text = String(value ?? '').trim();
  if (text && projects.some((row) => row.id === text)) return text;
  const numbered = text.match(/^#?(\d+)$/);
  if (numbered) {
    const index = Number(numbered[1]) - 1;
    if (index >= 0 && index < projects.length) return projects[index].id;
  }
  const lower = text.toLowerCase();
  const named = projects.find((row) => row.name.toLowerCase() === lower);
  if (named) return named.id;
  return fallbackId || null;
}

function resolveEntry(value, entries, extras = '') {
  const text = String(value ?? '').trim();
  const hay = `${text} ${extras}`.replace(/\s+/g, ' ').trim().toLowerCase();
  if (text) {
    const exact = entries.find((row) => row.id === text);
    if (exact) return exact;
    const numbered = text.match(/^#?(\d+)$/);
    if (numbered) {
      const index = Number(numbered[1]) - 1;
      if (index >= 0 && index < entries.length) return entries[index];
    }
    const lower = text.toLowerCase();
    const named = entries.filter((row) => row.title.toLowerCase() === lower);
    if (named.length === 1) return named[0];
  }
  if (!hay) return null;
  const contained = entries.filter((row) => {
    const title = String(row.title || '').toLowerCase();
    return title.length >= 4 && hay.includes(title);
  });
  return contained.length === 1 ? contained[0] : null;
}

function approachPriorityLabel(priority) {
  const level = Number(priority);
  if (level === 1) return 'High';
  if (level === 2) return 'Medium';
  return 'Low';
}

export function resolveApproach(value, approaches, extras = '') {
  const list = approaches || [];
  if (value && typeof value === 'object') {
    return resolveApproach(value.id ?? value.title ?? value.approach ?? value.n, list, extras);
  }
  const text = String(value ?? '').trim();
  const cleared = /^(none|null|no|0|-)$/i.test(text);
  if (cleared) return null;
  const hay = `${text} ${extras}`.replace(/\s+/g, ' ').trim().toLowerCase();
  if (text) {
    const exact = list.find((row) => row.id === text);
    if (exact) return exact;
    const numbered = text.match(/^#?(\d+)$/);
    if (numbered) {
      const index = Number(numbered[1]) - 1;
      if (index >= 0 && index < list.length) return list[index];
    }
    const lower = text.toLowerCase();
    const named = list.filter((row) => String(row.title || '').toLowerCase() === lower);
    if (named.length === 1) return named[0];
  }
  if (!hay) return null;
  const contained = list.filter((row) => {
    const title = String(row.title || '').toLowerCase();
    return title.length >= 4 && hay.includes(title);
  });
  return contained.length === 1 ? contained[0] : null;
}

export function formatApproachesBriefing(approaches, projects = []) {
  const rows = (approaches || []).slice(0, 40);
  if (!rows.length) return 'APPROACHES: none listed.';
  const names = new Map((projects || []).map((row) => [row.id, row.name]));
  return [
    'APPROACHES — use these numbers in "approach":',
    ...rows.map((row, index) => {
      const project = names.get(row.projectId);
      const notes = String(row.description || '').replace(/\s+/g, ' ').trim().slice(0, 90);
      return `#${index + 1}${project ? ` [${project}]` : ''} [${approachPriorityLabel(row.priority)}] ${row.title}${
        notes ? ` — ${notes}` : ''
      }`;
    }),
  ].join('\n');
}

export function sanitizeCalendarProposal(
  raw,
  {
    projects = [],
    entries = [],
    approaches = [],
    defaultProjectId,
    defaultItemId = null,
    prose = '',
    userMessage = '',
    clock,
  } = {}
) {
  const userClock = clock || readUserClock();
  const userText = `${userMessage} ${prose} ${raw?.title || ''}`.trim();
  const actionText = String(raw?.action || '').toLowerCase();
  const action =
    inferCalendarAction(userMessage) ||
    pick(raw?.action, CALENDAR_ACTIONS, '') ||
    (/\b(add|schedule|new)\b/.test(actionText) ? 'create' : '') ||
    (/\b(change|reschedule|edit)\b/.test(actionText) ? 'update' : '') ||
    (/\b(remove|cancel|delete)\b/.test(actionText) ? 'delete' : '');
  if (!action) return null;

  const projectId = resolveProject(
    raw.project ?? raw.projectId ?? raw.n,
    projects,
    defaultProjectId
  );
  if (!projectId) return null;

  const scopedEntries = entries.filter((row) => row.projectId === projectId);
  const scopedApproaches = approaches.filter((row) => !row.projectId || row.projectId === projectId);
  const existing = resolveEntry(
    raw.entry ?? raw.entryId ?? raw.id ?? raw.title,
    scopedEntries,
    userText
  );
  if ((action === 'update' || action === 'delete') && !existing) return null;

  if (action === 'delete') {
    return {
      action,
      projectId,
      entryId: existing.id,
      payload: { title: existing.title, kind: existing.kind, status: existing.status },
    };
  }

  const approachHint = raw.approach ?? raw.item ?? raw.itemId ?? raw.approachId;
  const explicitClear = /^(none|null|no|0|-)$/i.test(String(approachHint ?? '').trim());
  const linked =
    explicitClear
      ? null
      : resolveApproach(approachHint, scopedApproaches.length ? scopedApproaches : approaches, userText) ||
        (defaultItemId
          ? (scopedApproaches.length ? scopedApproaches : approaches).find((row) => row.id === defaultItemId)
          : null);
  const startHint = resolveProposedStart({
    rawStart: raw.start || raw.startAt || raw.date || raw.when || existing?.startAt,
    userMessage,
    prose: `${raw.title || ''} ${prose}`,
    clock: userClock,
  });
  const title = String(raw.title || existing?.title || linked?.title || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!title || /^scheduled follow-?up$/i.test(title) || /^follow-?up$/i.test(title)) {
    return null;
  }
  const kind =
    pick(raw.kind, CALENDAR_KINDS, '') ||
    inferCalendarKind(`${raw.kind || ''} ${title} ${userMessage}`, existing?.kind || 'task');
  const status =
    inferCalendarStatus(userMessage) ||
    pick(raw.status, CALENDAR_STATUSES, '') ||
    existing?.status ||
    'scheduled';
  const notes = raw.notes ?? existing?.notes ?? linked?.description ?? null;
  const input = sanitizeCalendarInput(
    {
      kind,
      title,
      notes,
      startAt: startHint,
      endAt: raw.end || raw.endAt || existing?.endAt,
      allDay: raw.allDay ?? existing?.allDay ?? kind === 'unavailable',
      status,
      itemId: linked?.id || existing?.itemId || null,
    },
    { source: 'ai', clock: userClock, allowPast: action === 'update' }
  );

  return {
    action,
    projectId,
    entryId: existing?.id || null,
    payload: {
      ...input,
      itemTitle: linked?.title || null,
    },
  };
}

function repairCalendarJson(jsonLike) {
  return repairJsonSyntax(String(jsonLike || '')).replace(
    /:\s*(create|update|delete|event|task|meeting|unavailable|scheduled|ontime|delayed|completed)\b/gi,
    ':"$1"'
  );
}

function isCalendarProposalShape(parsed, context) {
  if (!parsed || typeof parsed !== 'object') return false;
  const action = String(parsed.action || '').toLowerCase();
  const allowed =
    pick(action, CALENDAR_ACTIONS, '') ||
    inferCalendarAction(action) ||
    inferCalendarAction(context?.userMessage);
  if (!allowed) return false;
  if (allowed === 'delete') {
    return Boolean(parsed.entry || parsed.entryId || parsed.id || parsed.title || context?.userMessage);
  }
  if (parsed.title && (parsed.start || parsed.startAt || parsed.date || parsed.when)) return true;
  if ((parsed.approach || parsed.item || parsed.itemId) && (parsed.start || parsed.startAt || parsed.date || parsed.when)) {
    return true;
  }
  return Boolean(parsed.title || parsed.approach || parsed.item) && Boolean(inferWhen(context?.userMessage, context?.clock)?.date);
}

function looksLikeCalendarJson(raw) {
  const text = String(raw || '');
  return (
    /"action"\s*:\s*"?(create|update|delete)\b/i.test(text) &&
    /"title"\s*:/i.test(text) &&
    (/("start"|"startAt")\s*:/i.test(text) || /"action"\s*:\s*"?delete\b/i.test(text))
  );
}

function extractActionObjects(text, context) {
  const source = String(text || '');
  const results = [];
  const seen = new Set();
  const re = /"action"\s*:/gi;
  let match = re.exec(source);
  while (match && results.length < 8) {
    const from = source.lastIndexOf('{', match.index);
    if (from >= 0) {
      let depth = 0;
      for (let index = from; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        else if (source[index] === '}') {
          depth -= 1;
          if (depth === 0) {
            const slice = source.slice(from, index + 1);
            if (!seen.has(slice)) {
              seen.add(slice);
              const parsed = tryParseJson(slice) || tryParseJson(repairCalendarJson(slice));
              if (isCalendarProposalShape(parsed, context)) results.push(parsed);
            }
            break;
          }
        }
      }
    }
    match = re.exec(source);
  }
  return results;
}

export function splitCalendarReply(raw) {
  const text = String(raw || '').trim();
  const marker = text.search(/(?:^|\n)\s*CALENDAR\b\s*:?/i);
  if (marker >= 0) {
    return {
      reply: text.slice(0, marker).trim(),
      json: text.slice(marker).replace(/^\s*CALENDAR\s*:?\s*/i, '').trim(),
    };
  }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    return { reply: text.replace(fenced[0], '').trim(), json: fenced[1] };
  }
  const trailing = text.match(/(\[[\s\S]*"action"\s*:\s*"?[\w|]+[\s\S]*\])/i);
  if (trailing) {
    return { reply: text.replace(trailing[1], '').trim(), json: trailing[1] };
  }
  return { reply: text, json: '' };
}

function formatProposalWhen(value, clock) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return formatInZone(date, clock || readUserClock(), {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatProposalLines(proposals, projects = [], clock) {
  const names = new Map((projects || []).map((row) => [row.id, row.name]));
  return proposals.map((proposal) => {
    const payload = proposal.payload || {};
    const title = payload.title || 'this item';
    const kind = KIND_LABELS[payload.kind] || payload.kind || 'item';
    const status = STATUS_LABELS[payload.status] || '';
    const project = names.get(proposal.projectId);
    const when = formatProposalWhen(payload.startAt || payload.start, clock);
    const where = project ? ` for **${project}**` : '';
    const linked = payload.itemTitle ? ` · approach **${payload.itemTitle}**` : '';
    if (proposal.action === 'delete') {
      return `- Remove **${title}**${where}.`;
    }
    if (proposal.action === 'update') {
      return `- Change **${title}** (${kind}${status ? `, ${status}` : ''}${linked})${where}${when ? ` to ${when}` : ''}.`;
    }
    return `- Add **${title}** (${kind}${status ? `, ${status}` : ''}${linked})${where}${when ? ` on ${when}` : ''}.`;
  });
}

export function formatProposalConfirmation(proposals, projects = [], clock) {
  if (!proposals?.length) return '';
  const intro =
    proposals.length === 1
      ? 'Reply **yes** to do that, or tell me a different title or time:'
      : 'Reply **yes** to do those, or tell me a different title or time:';
  return `${intro}\n\n${formatProposalLines(proposals, projects, clock).join('\n')}`;
}

export function formatAppliedConfirmation(proposals, projects = [], clock) {
  if (!proposals?.length) return '';
  const intro =
    proposals.length === 1
      ? "Done. That's on the calendar now:"
      : 'Done. Those are on the calendar now:';
  return `${intro}\n\n${formatProposalLines(proposals, projects, clock).join('\n')}`;
}

export function extractCalendarProposals(raw, context) {
  const { json, reply } = splitCalendarReply(raw);
  const cleanedReply = visibleAssistantReply(reply);
  const calendarSlice = json || (looksLikeCalendarJson(raw) ? String(raw || '') : '');
  const isolated = isolateJsonArray(calendarSlice);
  let parsed = isolated
    ? tryParseJson(isolated) || tryParseJson(repairCalendarJson(isolated))
    : tryParseJson(calendarSlice.trim()) || tryParseJson(repairCalendarJson(calendarSlice.trim()));
  if (parsed && !Array.isArray(parsed) && typeof parsed === 'object') {
    parsed = [parsed];
  }
  if (!Array.isArray(parsed) || !parsed.length) {
    parsed = extractActionObjects(calendarSlice, context);
  }
  parsed = (parsed || []).filter((entry) => isCalendarProposalShape(entry, context));

  const limit = calendarProposalLimit(context?.userMessage);
  const proposals = parsed
    .map((entry) => {
      try {
        return sanitizeCalendarProposal(entry, { ...context, prose: reply || raw });
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .slice(0, limit);

  const confirmation = formatProposalConfirmation(proposals, context?.projects, context?.clock);
  return {
    reply: cleanedReply,
    confirmation,
    proposals,
  };
}

function formatBriefingTime(value, clock) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return formatLocalIso(date, clock || readUserClock()).replace('T', ' ');
}

export function formatProjectCalendarBriefing(entries, clock) {
  const rows = (entries || []).slice(0, 24);
  if (!rows.length) return 'Calendar: empty.';
  return [
    'Calendar:',
    ...rows.map((entry, index) => {
      const start = formatBriefingTime(entry.startAt, clock);
      return `#${index + 1} [${KIND_LABELS[entry.kind] || entry.kind}] ${entry.title} ${start} ${
        STATUS_LABELS[entry.displayStatus || entry.status] || entry.status
      }${entry.allDay ? ' all-day' : ''}${entry.itemTitle ? ` → ${entry.itemTitle}` : ''}`;
    }),
  ].join('\n');
}

export function formatPortfolioCalendarBriefing(entries, projects, clock) {
  const rows = (entries || []).slice(0, 24);
  if (!rows.length) return 'Calendars: empty.';
  const names = new Map((projects || []).map((row) => [row.id, row.name]));
  return [
    'Calendars:',
    ...rows.map((entry, index) => {
      const start = formatBriefingTime(entry.startAt, clock);
      return `#${index + 1} ${names.get(entry.projectId) || 'Project'} [${
        KIND_LABELS[entry.kind] || entry.kind
      }] ${entry.title} ${start} ${STATUS_LABELS[entry.displayStatus || entry.status] || entry.status}${
        entry.itemTitle ? ` → ${entry.itemTitle}` : ''
      }`;
    }),
  ].join('\n');
}

export function serializeCalendarProposal(entry) {
  let payload = {};
  try {
    payload = JSON.parse(entry.payloadJson || '{}');
  } catch {
    payload = {};
  }
  return {
    id: entry.id,
    projectId: entry.projectId,
    projectName: entry.project?.name || null,
    entryId: entry.entryId,
    itemId: entry.itemId,
    source: entry.source,
    action: entry.action,
    payload,
    status: entry.status,
    createdAt: entry.createdAt,
  };
}

async function addCalendarColumn(client, sql) {
  try {
    await client.$executeRawUnsafe(sql);
  } catch (error) {
    const message = String(error?.message || '');
    if (/duplicate column|already exists/i.test(message)) return;
    throw error;
  }
}

export async function removeCalendarForApproaches(tx, { projectId, items = [] } = {}) {
  const itemIds = [
    ...new Set((items || []).map((row) => String(row?.id || '').trim()).filter(Boolean)),
  ];
  if (!tx || !projectId || !itemIds.length) return;
  const titles = [
    ...new Set((items || []).map((row) => String(row?.title || '').trim()).filter(Boolean)),
  ];

  await tx.calendarProposal.deleteMany({
    where: { projectId, itemId: { in: itemIds } },
  });
  await tx.calendarEntry.deleteMany({
    where: {
      projectId,
      OR: [
        { itemId: { in: itemIds } },
        ...(titles.length ? [{ itemId: null, title: { in: titles } }] : []),
      ],
    },
  });
}

export async function removeCalendarForProject(tx, projectId) {
  if (!tx || !projectId) return;
  await tx.calendarProposal.deleteMany({ where: { projectId } });
  await tx.calendarEntry.deleteMany({ where: { projectId } });
}

export async function ensureCalendarSchema(client) {
  if (calendarSchemaReady || !client) return;
  const { provider } = resolveDatabaseConfig();

  try {
    if (provider === 'postgresql') {
      await addCalendarColumn(
        client,
        `ALTER TABLE "CalendarEntry" ADD COLUMN IF NOT EXISTS "itemId" TEXT`
      );
      await client.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "CalendarEntry_itemId_idx" ON "CalendarEntry"("itemId")`
      );
      await client.$executeRawUnsafe(
        `ALTER TABLE "CalendarEntry" DROP CONSTRAINT IF EXISTS "CalendarEntry_itemId_fkey"`
      );
      try {
        await client.$executeRawUnsafe(`
          ALTER TABLE "CalendarEntry"
            ADD CONSTRAINT "CalendarEntry_itemId_fkey"
            FOREIGN KEY ("itemId") REFERENCES "AIActionItem"("id") ON DELETE CASCADE ON UPDATE CASCADE
        `);
      } catch (error) {
        if (!/already exists|duplicate/i.test(String(error?.message || ''))) throw error;
      }
    } else {
      await addCalendarColumn(client, `ALTER TABLE "CalendarEntry" ADD COLUMN "itemId" TEXT`);
      await client.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "CalendarEntry_itemId_idx" ON "CalendarEntry"("itemId")`
      );
    }
    calendarSchemaReady = true;
  } catch (error) {
    console.warn('[calendar] schema ensure failed:', error.message);
  }
}

