const STORAGE_KEY = 'cpid-import-focus';

export const IMPORT_FOCUS_OPTIONS = [
  {
    id: 'general',
    label: 'Overall',
    hint: 'Read the whole file and extract the main approaches.',
  },
  {
    id: 'bugs',
    label: 'Bugs',
    hint: 'Only extract defects, errors, crashes, and broken behavior.',
  },
  {
    id: 'community-feedback',
    label: 'Community feedback',
    hint: 'Only extract player or user sentiment, complaints, and praise.',
  },
  {
    id: 'community-suggestions',
    label: 'Community suggestions',
    hint: 'Only extract community feature requests and suggested changes.',
  },
  {
    id: 'other',
    label: 'Other',
    hint: 'Describe a custom focus. The AI will ignore unrelated work.',
  },
];

const VALID_IDS = new Set(IMPORT_FOCUS_OPTIONS.map((option) => option.id));

function storageKey(userId) {
  return userId ? `${STORAGE_KEY}:${userId}` : STORAGE_KEY;
}

export function normalizeImportFocus(value) {
  const id = VALID_IDS.has(value?.id) ? value.id : 'general';
  const note = String(value?.note || '').trim().slice(0, 200);
  return { id, note: id === 'other' ? note : '' };
}

export function loadImportFocus(userId) {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return { id: 'general', note: '' };
    return normalizeImportFocus(JSON.parse(raw));
  } catch {
    return { id: 'general', note: '' };
  }
}

export function saveImportFocus(userId, value) {
  const next = normalizeImportFocus(value);
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
  return next;
}

export function importFocusHint(focus) {
  const current = normalizeImportFocus(focus);
  return IMPORT_FOCUS_OPTIONS.find((option) => option.id === current.id)?.hint || '';
}

export function importFocusReady(focus) {
  const current = normalizeImportFocus(focus);
  return current.id !== 'other' || Boolean(current.note);
}

export function withImportFocus(aiSettings, focus) {
  const current = normalizeImportFocus(focus);
  return {
    ...aiSettings,
    importFocus: current.id,
    importFocusNote: current.note,
  };
}
