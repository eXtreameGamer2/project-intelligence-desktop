import { getAccessToken, getSupabaseClient } from '../lib/supabase';
import { clientClock } from '../lib/calendar';
import {
  clearApiKeyMemory,
  decryptSecret,
  encryptSecret,
  getMemoryApiKey,
  memoryKeyUserId,
  setMemoryApiKey,
} from '../lib/secureVault';
import { normalizeImportFocus, withImportFocus } from '../lib/importFocus';

const AI_SETTINGS_KEY = 'cpid-ai-settings';

export const LOCALHOST_AI_HOST = '127.0.0.1';
export const LOCALHOST_AI_PORT = 1234;
export const OPENAI_DEFAULT_URL = 'https://api.openai.com/v1';

export function normalizeLocalhostPort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return LOCALHOST_AI_PORT;
  }
  return port;
}

export function localhostAiUrl(port = LOCALHOST_AI_PORT) {
  return `http://${LOCALHOST_AI_HOST}:${normalizeLocalhostPort(port)}`;
}

export function parseLocalhostPort(baseUrl) {
  try {
    const parsed = new URL(String(baseUrl || '').trim());
    if (parsed.hostname !== LOCALHOST_AI_HOST && parsed.hostname !== 'localhost') {
      return LOCALHOST_AI_PORT;
    }
    return normalizeLocalhostPort(parsed.port || LOCALHOST_AI_PORT);
  } catch {
    return LOCALHOST_AI_PORT;
  }
}

export function isLocalhostAiUrl(baseUrl) {
  try {
    const parsed = new URL(String(baseUrl || '').trim());
    return parsed.hostname === LOCALHOST_AI_HOST || parsed.hostname === 'localhost';
  } catch {
    return false;
  }
}

export const LOCALHOST_AI_URL = localhostAiUrl();

export { clearApiKeyMemory };

export const DEFAULT_MULTI_PASS_COUNT = 3;
export const MIN_MULTI_PASS_COUNT = 2;
export const MAX_MULTI_PASS_COUNT = 8;
export const MIN_STRUCTURED_MULTI_PASS_COUNT = 4;

export const DEFAULT_AI_SETTINGS = {
  provider: 'localhost',
  baseUrl: LOCALHOST_AI_URL,
  modelName: '',
  apiKey: '',
  hasApiKey: false,
  localTrainingEnabled: false,
  reasoningEnabled: true,
  multiPassImportEnabled: false,
  multiPassImportCount: DEFAULT_MULTI_PASS_COUNT,
};

function clampPassCount(value) {
  const count = Number(value);
  if (!Number.isInteger(count)) return DEFAULT_MULTI_PASS_COUNT;
  return Math.min(MAX_MULTI_PASS_COUNT, Math.max(MIN_MULTI_PASS_COUNT, count));
}

export function effectiveMultiPassCount(settings) {
  if (!settings?.localTrainingEnabled || !settings?.multiPassImportEnabled) return 1;
  return clampPassCount(settings.multiPassImportCount);
}

export function allowsStructuredImport(settings) {
  const passes = effectiveMultiPassCount(settings);
  return passes >= MIN_STRUCTURED_MULTI_PASS_COUNT && passes <= MAX_MULTI_PASS_COUNT;
}

function settingsStorageKey(userId) {
  return userId ? `${AI_SETTINGS_KEY}:${userId}` : AI_SETTINGS_KEY;
}

function normalizeAiSettings(settings) {
  const next = { ...settings };
  next.provider = 'localhost';
  next.baseUrl = localhostAiUrl(parseLocalhostPort(next.baseUrl));
  next.apiKey = typeof next.apiKey === 'string' ? next.apiKey : '';
  next.hasApiKey = Boolean(next.hasApiKey);
  next.localTrainingEnabled = Boolean(next.localTrainingEnabled);
  next.reasoningEnabled = next.reasoningEnabled !== false;
  next.multiPassImportCount = clampPassCount(next.multiPassImportCount);
  next.multiPassImportEnabled = Boolean(next.localTrainingEnabled && next.multiPassImportEnabled);
  return next;
}

function publicAiSettings(settings, hasApiKey) {
  const next = normalizeAiSettings({ ...DEFAULT_AI_SETTINGS, ...settings });
  next.apiKey = '';
  next.hasApiKey = Boolean(hasApiKey);
  delete next.clearApiKey;
  return next;
}

function readStoredRecord(userId) {
  const key = settingsStorageKey(userId);
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return { parsed: JSON.parse(raw), storageKey: key };
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

function writeStoredRecord(userId, record) {
  const key = settingsStorageKey(userId);
  localStorage.setItem(key, JSON.stringify(record));
  if (userId && key !== AI_SETTINGS_KEY) {
    localStorage.removeItem(AI_SETTINGS_KEY);
  }
}

const UNREACHABLE_KEY = 'cpid-ai-unreachable';

function unreachableStorageKey(userId) {
  return userId ? `${UNREACHABLE_KEY}:${userId}` : UNREACHABLE_KEY;
}

/** Clear in-memory and persisted AI settings for this browser session / account. */
export function clearStoredAiSettings(userId) {
  clearApiKeyMemory();
  try {
    localStorage.removeItem(AI_SETTINGS_KEY);
    if (userId) localStorage.removeItem(settingsStorageKey(userId));
    localStorage.removeItem(unreachableStorageKey(userId));
    localStorage.removeItem(UNREACHABLE_KEY);
  } catch {
    // Private mode can block storage; memory clear still applies.
  }
}

export function hasSavedAiSettings(userId) {
  return Boolean(readStoredRecord(userId));
}

export function isAiConnectionError(message, code) {
  const text = String(message || '').toLowerCase();
  if (
    text.includes('did not include message content') ||
    text.includes('did not include text content') ||
    text.includes('streamed ai response was empty') ||
    text.includes('unable to locate overview choices')
  ) {
    return false;
  }
  return isAiUnreachableError(message, code);
}

export function isAiUnreachableError(message, code) {
  if (code === 'REQUEST_CANCELED') return false;
  if (code === 'AI_UNREACHABLE') return true;
  const text = String(message || '').toLowerCase();
  return (
    text.includes('could not reach') ||
    text.includes('econnrefused') ||
    text.includes('enotfound') ||
    text.includes('etimedout') ||
    text.includes('econnreset') ||
    text.includes('econnaborted') ||
    text.includes('epipe') ||
    text.includes('socket hang up') ||
    text.includes('failed to fetch') ||
    text.includes('networkerror') ||
    text.includes('fetch failed') ||
    text.includes('network request failed') ||
    text.includes('streamed ai response was empty') ||
    text.includes('did not include message content') ||
    text.includes('did not include text content') ||
    text.includes('unexpected end of json')
  );
}

export function loadAiUnreachable(userId) {
  try {
    return sessionStorage.getItem(unreachableStorageKey(userId)) === '1';
  } catch {
    return false;
  }
}

export function saveAiUnreachable(userId, unreachable) {
  try {
    const key = unreachableStorageKey(userId);
    if (unreachable) sessionStorage.setItem(key, '1');
    else sessionStorage.removeItem(key);
  } catch {
    // Ignore storage failures; in-memory state still applies.
  }
  return Boolean(unreachable);
}

export function loadAiSettings(userId) {
  try {
    const stored = readStoredRecord(userId);
    if (!stored) return { ...DEFAULT_AI_SETTINGS };
    const { apiKey, apiKeyEnc, ...rest } = stored.parsed;
    if (typeof apiKey === 'string' && apiKey) {
      setMemoryApiKey(apiKey, userId);
      const stripped = { ...rest };
      if (apiKeyEnc) stripped.apiKeyEnc = apiKeyEnc;
      writeStoredRecord(userId, stripped);
    }
    return publicAiSettings(rest, Boolean(apiKeyEnc || apiKey));
  } catch {
    return { ...DEFAULT_AI_SETTINGS };
  }
}

export async function hydrateAiSettings(userId) {
  const stored = readStoredRecord(userId);
  if (!stored) {
    clearApiKeyMemory();
    return { ...DEFAULT_AI_SETTINGS };
  }

  const { parsed, storageKey } = stored;
  const { apiKey: legacyKey, apiKeyEnc, ...rest } = parsed;
  let encrypted = apiKeyEnc || null;
  let secret = '';

  if (typeof legacyKey === 'string' && legacyKey) {
    secret = legacyKey;
  } else if (encrypted) {
    try {
      secret = await decryptSecret(encrypted, userId);
    } catch {
      secret = '';
      encrypted = null;
    }
  } else if (memoryKeyUserId() === String(userId || '')) {
    secret = getMemoryApiKey();
  }

  if (secret && !encrypted) {
    try {
      encrypted = await encryptSecret(secret, userId);
    } catch {
      encrypted = null;
    }
  }

  setMemoryApiKey(secret, userId);
  const safeRecord = {
    provider: 'localhost',
    baseUrl: rest.baseUrl,
    modelName: rest.modelName,
    localTrainingEnabled: Boolean(rest.localTrainingEnabled),
    reasoningEnabled: rest.reasoningEnabled !== false,
    multiPassImportEnabled: Boolean(rest.localTrainingEnabled && rest.multiPassImportEnabled),
    multiPassImportCount: clampPassCount(rest.multiPassImportCount),
  };
  if (encrypted) safeRecord.apiKeyEnc = encrypted;
  writeStoredRecord(userId, safeRecord);
  if (storageKey !== settingsStorageKey(userId)) {
    localStorage.removeItem(storageKey);
  }

  return publicAiSettings(rest, Boolean(secret || encrypted));
}

export async function saveAiSettings(settings, userId) {
  const next = normalizeAiSettings({ ...settings });
  const stored = readStoredRecord(userId);
  let encrypted = stored?.parsed?.apiKeyEnc || null;

  if (next.clearApiKey) {
    encrypted = null;
    setMemoryApiKey('', userId);
  } else if (next.apiKey) {
    encrypted = await encryptSecret(next.apiKey, userId);
    setMemoryApiKey(next.apiKey, userId);
  }

  const record = {
    provider: 'localhost',
    baseUrl: next.baseUrl,
    modelName: next.modelName,
    localTrainingEnabled: Boolean(next.localTrainingEnabled),
    reasoningEnabled: next.reasoningEnabled !== false,
    multiPassImportEnabled: Boolean(next.localTrainingEnabled && next.multiPassImportEnabled),
    multiPassImportCount: clampPassCount(next.multiPassImportCount),
  };
  if (encrypted) record.apiKeyEnc = encrypted;
  writeStoredRecord(userId, record);

  return publicAiSettings(next, Boolean(encrypted));
}

export function buildAiHeaders(settings, { chat = false } = {}) {
  return {
    'x-ai-provider': 'localhost',
    'x-ai-base-url': localhostAiUrl(parseLocalhostPort(settings.baseUrl)),
    'x-ai-model-name': settings.modelName || '',
    'x-ai-local-training': settings.localTrainingEnabled ? '1' : '0',
    'x-ai-reasoning': chat && settings.reasoningEnabled !== false ? '1' : '0',
    'x-ai-multi-pass': settings.localTrainingEnabled && settings.multiPassImportEnabled ? '1' : '0',
    'x-ai-multi-pass-count': String(
      settings.localTrainingEnabled && settings.multiPassImportEnabled
        ? clampPassCount(settings.multiPassImportCount)
        : 1
    ),
    'x-user-api-key': settings.apiKey || getMemoryApiKey() || '',
    ...(settings.importFocus
      ? { 'x-ai-import-focus': String(settings.importFocus) }
      : {}),
    ...(settings.importFocusNote
      ? { 'x-ai-import-focus-note': encodeURIComponent(String(settings.importFocusNote)) }
      : {}),
  };
}

export function isCanceledError(error) {
  if (!error) return false;
  if (error.name === 'AbortError' || error.code === 'ABORT_ERR' || error.code === 'REQUEST_CANCELED') {
    return true;
  }
  const text = String(error.message || '').toLowerCase();
  return (
    text.includes('the user aborted') ||
    text.includes('this operation was aborted') ||
    text.includes('import canceled')
  );
}

async function readSsePayload(response, onProgress) {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Progress stream was empty.');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let result = null;
  let streamError = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';

    for (const part of parts) {
      let eventName = 'message';
      const dataLines = [];

      for (const line of part.split('\n')) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }

      if (dataLines.length === 0) continue;

      let data = {};
      try {
        data = JSON.parse(dataLines.join('\n'));
      } catch {
        continue;
      }

      if (eventName === 'stage') {
        onProgress?.(data);
      } else if (eventName === 'done') {
        result = data;
      } else if (eventName === 'error') {
        streamError = data;
      }
    }
  }

  if (streamError) {
    const error = new Error(streamError.message || streamError.error || 'Request failed');
    error.status = streamError.status || 500;
    error.code = streamError.code;
    error.payload = streamError;
    throw error;
  }

  if (!result) {
    throw new Error('AI request finished without a result.');
  }

  return result;
}

export async function apiRequest(
  path,
  { method = 'GET', body, user, aiSettings, formData, accessToken, onProgress, signal, chatReasoning = false } = {}
) {
  const headers = {};

  const token = accessToken ?? (await getAccessToken());
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else if (user && !getSupabaseClient()) {
    headers['x-user-id'] = user.id;
    headers['x-user-tier'] = user.tier;
  }

  if (aiSettings) {
    Object.assign(headers, buildAiHeaders(aiSettings, { chat: Boolean(chatReasoning) }));
  }

  if (onProgress) {
    headers.Accept = 'text/event-stream';
    headers['x-ai-progress'] = '1';
  }

  let requestBody = body;
  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    requestBody = JSON.stringify(body);
  }

  if (formData) {
    requestBody = formData;
  }

  const response = await fetch(`/api${path}`, {
    method,
    headers,
    body: requestBody,
    signal,
  });

  const contentType = response.headers.get('content-type') || '';
  if (onProgress && contentType.includes('text/event-stream')) {
    return readSsePayload(response, onProgress);
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(payload.message || payload.error || 'Request failed');
    error.status = response.status;
    error.code = payload.code;
    error.payload = payload;
    throw error;
  }

  return payload;
}

export async function fetchAuthConfig() {
  return apiRequest('/auth/config');
}

export async function fetchCurrentUser(accessToken) {
  return apiRequest('/auth/me', { accessToken });
}

export async function bootstrapSession() {
  return apiRequest('/auth/bootstrap');
}

export async function fetchProjects(user) {
  return apiRequest('/projects', { user });
}

export async function fetchDashboard(user, projectId) {
  const query = new URLSearchParams({ include: 'active' });
  if (projectId) query.set('projectId', projectId);
  return apiRequest(`/projects?${query}`, { user });
}

const ACTIVE_PROJECT_KEY = 'cpid-active-project';

function activeProjectStorageKey(userId) {
  return userId ? `${ACTIVE_PROJECT_KEY}:${userId}` : ACTIVE_PROJECT_KEY;
}

export function loadActiveProjectId(userId) {
  try {
    return localStorage.getItem(activeProjectStorageKey(userId)) || '';
  } catch {
    return '';
  }
}

export function saveActiveProjectId(userId, projectId) {
  try {
    const key = activeProjectStorageKey(userId);
    if (projectId) localStorage.setItem(key, projectId);
    else localStorage.removeItem(key);
  } catch {
    // Ignore storage failures.
  }
}

export async function createProject(user, name) {
  return apiRequest('/projects', {
    method: 'POST',
    user,
    body: { name },
  });
}

export async function renameProject(user, projectId, name) {
  return apiRequest(`/projects/${projectId}`, {
    method: 'PATCH',
    user,
    body: { name },
  });
}

export async function deleteProject(user, projectId) {
  return apiRequest(`/projects/${projectId}`, {
    method: 'DELETE',
    user,
  });
}

export async function fetchProject(user, projectId) {
  return apiRequest(`/projects/${projectId}`, { user });
}

export async function fetchActionItem(user, projectId, itemId) {
  return apiRequest(`/projects/${projectId}/action-items/${itemId}`, { user });
}

export async function updateReportNickname(user, projectId, reportId, nickname) {
  return apiRequest(`/projects/${projectId}/reports/${reportId}`, {
    method: 'PATCH',
    user,
    body: { nickname },
  });
}

export async function deleteReport(user, projectId, reportId) {
  return apiRequest(`/projects/${projectId}/reports/${reportId}`, {
    method: 'DELETE',
    user,
  });
}

export async function expandReport(user, projectId, reportId, aiSettings, onProgress, importFocus, signal) {
  const focus = normalizeImportFocus(importFocus);
  return apiRequest(`/projects/${projectId}/reports/${reportId}/expand`, {
    method: 'POST',
    user,
    aiSettings: withImportFocus(aiSettings, focus),
    body: {
      importFocus: focus.id,
      importFocusNote: focus.note,
    },
    onProgress,
    signal,
  });
}

export async function uploadReport(user, projectId, file, aiSettings, onProgress, importFocus, signal) {
  const focus = normalizeImportFocus(importFocus);
  const formData = new FormData();
  formData.append('file', file);
  formData.append('importFocus', focus.id);
  if (focus.note) formData.append('importFocusNote', focus.note);

  return apiRequest(`/projects/${projectId}/reports/upload`, {
    method: 'POST',
    user,
    aiSettings: withImportFocus(aiSettings, focus),
    formData,
    onProgress,
    signal,
  });
}

export async function toggleActionItem(user, projectId, itemId, completed) {
  return apiRequest(`/projects/${projectId}/action-items/${itemId}`, {
    method: 'PATCH',
    user,
    body: { completed },
  });
}

export async function deleteActionItem(user, projectId, itemId) {
  return apiRequest(`/projects/${projectId}/action-items/${itemId}`, {
    method: 'DELETE',
    user,
  });
}

export async function generateItemSuggestions(user, projectId, itemId, aiSettings, onProgress) {
  return apiRequest(`/projects/${projectId}/action-items/${itemId}/suggestions`, {
    method: 'POST',
    user,
    aiSettings,
    onProgress,
  });
}

export async function saveItemSuggestion(user, projectId, itemId, suggestion) {
  return apiRequest(`/projects/${projectId}/action-items/${itemId}/suggestions/save`, {
    method: 'POST',
    user,
    body: {
      title: suggestion.title,
      detail: suggestion.detail || '',
    },
  });
}

export async function completeItemSuggestion(user, projectId, itemId, suggestion, completed = true) {
  return apiRequest(`/projects/${projectId}/action-items/${itemId}/suggestions/complete`, {
    method: 'POST',
    user,
    body: {
      savedId: suggestion.savedId || suggestion.id || '',
      title: suggestion.title,
      detail: suggestion.detail || '',
      completed,
    },
  });
}

export async function unsaveItemSuggestion(user, projectId, itemId, savedId) {
  return apiRequest(`/projects/${projectId}/action-items/${itemId}/suggestions/${savedId}`, {
    method: 'DELETE',
    user,
  });
}

export async function analyzeSavedSuggestions(
  user,
  projectId,
  file,
  aiSettings,
  itemId,
  savedId,
  onProgress,
  linkedSavedIds = []
) {
  const formData = new FormData();
  const allSavedIds = [...new Set([savedId, ...linkedSavedIds].filter(Boolean))];
  const linkAll = allSavedIds.length > 1 ? '1' : '0';
  formData.append('file', file);
  formData.append('itemId', itemId);
  formData.append('savedId', savedId);
  formData.append('savedIds', allSavedIds.join(','));
  formData.append('linkAll', linkAll);

  const query = new URLSearchParams({
    savedId,
    savedIds: allSavedIds.join(','),
    linkAll,
  });

  return apiRequest(`/projects/${projectId}/action-items/${itemId}/suggestion-analyses?${query}`, {
    method: 'POST',
    user,
    aiSettings,
    formData,
    onProgress,
  });
}

export async function discussActionItem(user, projectId, itemId, message, aiSettings, onProgress) {
  return apiRequest(`/projects/${projectId}/action-items/${itemId}/discuss`, {
    method: 'POST',
    user,
    aiSettings,
    chatReasoning: true,
    body: { message, clock: clientClock() },
    onProgress,
  });
}

export async function createCalendarEntry(user, projectId, entry) {
  return apiRequest(`/projects/${projectId}/calendar`, {
    method: 'POST',
    user,
    body: { ...entry, clock: clientClock() },
  });
}

export async function updateCalendarEntry(user, projectId, entryId, entry) {
  return apiRequest(`/projects/${projectId}/calendar/${entryId}`, {
    method: 'PATCH',
    user,
    body: { ...entry, clock: clientClock() },
  });
}

export async function deleteCalendarEntry(user, projectId, entryId) {
  return apiRequest(`/projects/${projectId}/calendar/${entryId}`, {
    method: 'DELETE',
    user,
  });
}

export async function applyCalendarProposal(user, proposalId) {
  return apiRequest(`/overview/calendar-proposals/${proposalId}/apply`, {
    method: 'POST',
    user,
  });
}

export async function dismissCalendarProposal(user, proposalId) {
  return apiRequest(`/overview/calendar-proposals/${proposalId}/dismiss`, {
    method: 'POST',
    user,
  });
}

export async function fetchOverviewFeed(user) {
  return apiRequest('/overview/feed', { user });
}

export async function discussOverviewFeed(user, message, aiSettings, onProgress, choices, history) {
  return apiRequest('/overview/feed', {
    method: 'POST',
    user,
    aiSettings,
    chatReasoning: true,
    body: {
      message,
      choices: choices || undefined,
      clock: clientClock(),
      history: Array.isArray(history) ? history.slice(-12) : undefined,
    },
    onProgress,
  });
}

export async function recommendOverviewChoices(user, aiSettings, onProgress) {
  return apiRequest('/overview/choices', {
    method: 'POST',
    user,
    aiSettings,
    onProgress,
  });
}

export async function shareRoadmap(user, projectId) {
  return apiRequest(`/projects/${projectId}/share-roadmap`, {
    method: 'POST',
    user,
  });
}

export async function testAiConnection(user, aiSettings, onProgress) {
  return apiRequest('/ai/test-connection', {
    method: 'POST',
    user,
    aiSettings,
    onProgress,
  });
}

export async function deleteAiTraining(user) {
  return apiRequest('/ai/training', {
    method: 'DELETE',
    user,
  });
}

export async function fetchPublicRoadmap(token) {
  return apiRequest(`/roadmap/${token}`);
}
