export const IMPORT_FOCUS_IDS = [
  'general',
  'bugs',
  'community-feedback',
  'community-suggestions',
  'other',
];

const INSTRUCTIONS = {
  general:
    'Take a general overall view of the report. Extract the main approaches for work found in it. Include bugs, feedback, suggestions, and other evidenced work. Do not over-focus on a single theme.',
  bugs:
    'ONLY extract approaches for bugs, defects, errors, regressions, crashes, and broken behavior evidenced in the report. Omit feature requests, praise, and general suggestions unless they describe a defect.',
  'community-feedback':
    'ONLY extract approaches from community, player, or user feedback: sentiment, complaints, praise, pain points, and lived experience. Omit internal engineering tasks that are not grounded in that feedback.',
  'community-suggestions':
    'ONLY extract approaches for community, player, or user suggestions and feature requests. Omit bug-fix work unless the community asked for it as a change.',
};

function headerValue(req, name) {
  const value = req?.headers?.[name];
  if (Array.isArray(value)) return String(value[0] || '');
  return String(value || '');
}

function decodeHeader(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function normalizeImportFocusId(value) {
  const id = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  if (IMPORT_FOCUS_IDS.includes(id)) return id;
  if (id === 'overall' || id === 'general-overview') return 'general';
  if (id === 'bug' || id === 'defect') return 'bugs';
  if (id === 'feedback') return 'community-feedback';
  if (id === 'suggestions' || id === 'suggestion') return 'community-suggestions';
  return 'general';
}

export function resolveImportFocus(req) {
  const body = req?.body && typeof req.body === 'object' ? req.body : {};
  const id = normalizeImportFocusId(
    body.importFocus || headerValue(req, 'x-ai-import-focus')
  );
  const note = String(
    body.importFocusNote || decodeHeader(headerValue(req, 'x-ai-import-focus-note'))
  )
    .trim()
    .slice(0, 200);
  return { id, note };
}

export function importFocusInstruction(focus) {
  const id = normalizeImportFocusId(focus?.id);
  const note = String(focus?.note || '').trim();
  if (id === 'other') {
    if (!note) return INSTRUCTIONS.general;
    return `ONLY extract approaches that match this user-specified focus: "${note}". Ignore work in the report that is unrelated to that focus.`;
  }
  return INSTRUCTIONS[id] || INSTRUCTIONS.general;
}

export function allowsEmptyApproaches(focus) {
  return normalizeImportFocusId(focus?.id) !== 'general';
}
