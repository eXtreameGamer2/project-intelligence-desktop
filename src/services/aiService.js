import { extractActionItems, extractSuggestions, extractOverviewChoicePayload, clampApproachPriority } from '../utils/jsonRepair.js';
import { correctionInstruction, formatTrainingPrompt, isLocalTrainingEnabled, loadJobTimingEstimate, recordJobTiming } from '../utils/aiTraining.js';
import { extractStreamParts, readProviderSse } from '../utils/aiProgress.js';
import { createJobProgress, estimateInputChars } from '../utils/jobProgress.js';
import { canceledError, clientAbortSignal, isCanceledError } from '../utils/requestAbort.js';
import { redactSecrets } from '../utils/secrets.js';
import {
  formatOverviewBriefing,
  formatOverviewChoiceBriefing,
  inferOverviewChoicePayload,
  sanitizeOverviewChoices,
} from '../utils/projectOverview.js';
import {
  extractCalendarProposals,
  formatAppliedConfirmation,
  formatPortfolioCalendarBriefing,
  formatProjectCalendarBriefing,
  formatProposalConfirmation,
  formatApproachesBriefing,
  calendarVocabularyPrompt,
  calendarProposalLimit,
  userAskedForCalendarChange,
} from '../utils/calendar.js';
import {
  approachDeletePrompt,
  extractApproachDeletes,
  formatApproachDeletedConfirmation,
  userAskedToDeleteApproach,
} from '../utils/approachActions.js';
import {
  discussScopePrompt,
  HANDOFF_TO_DASHBOARD_DELETE,
  resolveDiscussHandoff,
  withScopeNote,
} from '../utils/aiScope.js';
import {
  calendarClockPrompt,
  fallbackStartDate,
  formatLocalIso,
  readUserClock,
} from '../utils/userTime.js';
import {
  dumpRecoveryFallback,
  explainsHowToRespond,
  isResponseDump,
  looksLikeMachineReply,
  needsDiscussRetry,
  visibleAssistantReply,
} from '../utils/aiDisplay.js';
import {
  allowsEmptyApproaches,
  importFocusInstruction,
  resolveImportFocus,
} from '../utils/importFocus.js';
import { FILE_READ_PROMPT } from '../utils/fileReadGuide.js';
import { parseApproachesWithRetry } from '../utils/aiErrorHandler.js';
import { prisma } from '../db/client.js';
import { resolveRequestUser } from '../middleware/auth.js';
import {
  clipPlainContent,
  contextBudget,
  contextLengthFor,
  fitImportPrompt,
  parseContextLimitError,
  rememberContextLength,
  shrinkChatOptions,
} from '../utils/aiContext.js';
import {
  attachObservedModel,
  extractContextLength,
  modelJsonGuardrail,
} from '../utils/aiModelCatalog.js';

const PROVIDERS = {
  PAID_CLOUD: 'paid-cloud',
  BYOK_OPENAI: 'byok-openai',
  BYOK_ANTHROPIC: 'byok-anthropic',
  CUSTOM_ENDPOINT: 'custom-endpoint',
  LOCALHOST: 'localhost',
};

function buildAnalysisPrompt(focus) {
  return `You are a product intelligence assistant. Read the uploaded report and return ONLY a JSON array of approaches for work found IN THAT REPORT.

${FILE_READ_PROMPT}

Focus for this import:
${importFocusInstruction(focus)}

Rules:
- Output a JSON array, not an object.
- Do not wrap the array in markdown fences.
- Do not include reasoning, explanations, or trailing prose.
- Do not copy this prompt, these rules, or the example below.
- Do not return commentary, planning, or schema text as an approach.
- Every title must name work evidenced in the report content. If the report does not mention it, omit it.
- Keep every approach inside the requested focus. If an evidenced item does not match the focus, omit it.
- Each item must be an object with "title" (string), optional "description" (string), and "priority" (1, 2, or 3 only).
- priority is severity from the report, not a list index: 1 = high, 2 = medium, 3 = low.

Example shape only — invent new titles from the report, never reuse these strings:
[
  {"title": "Fix login timeout on mobile", "description": "Users report session expiry after 30s", "priority": 1},
  {"title": "Add CSV export for reports", "priority": 2}
]

Reply with the JSON array only. The first non-whitespace character must be [.`;
}

/**
 * Build AI client configuration from incoming request headers.
 * @param {import('express').Request} req
 */
export function resolveAiConfig(req) {
  const provider = (req.headers['x-ai-provider'] || PROVIDERS.CUSTOM_ENDPOINT).toLowerCase();
  const baseUrl = req.headers['x-ai-base-url'] || '';
  const headerModel = String(req.headers['x-ai-model-name'] || '').trim();
  const model =
    headerModel ||
    (provider === PROVIDERS.LOCALHOST || provider === PROVIDERS.CUSTOM_ENDPOINT ? '' : 'gpt-4o');
  const userApiKey = req.headers['x-user-api-key'] || '';
  if (Object.prototype.hasOwnProperty.call(req.headers, 'x-user-api-key')) {
    req.headers['x-user-api-key'] = userApiKey ? '[redacted]' : '';
  }

  return { provider, baseUrl, model, userApiKey };
}

const LOCALHOST_AI_HOST = '127.0.0.1';
const LOCALHOST_AI_PORT = 1234;

function normalizeLocalhostPort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return LOCALHOST_AI_PORT;
  }
  return port;
}

function resolveLocalhostPort(baseUrl) {
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

function openAiCompatibleTarget(baseUrl, model, userApiKey) {
  const normalized = String(baseUrl || '').replace(/\/$/, '');
  const chatUrl = normalized.endsWith('/chat/completions')
    ? normalized
    : `${normalized}/chat/completions`;
  const headers = { 'Content-Type': 'application/json' };
  if (userApiKey) {
    headers.Authorization = `Bearer ${userApiKey}`;
  }

  return {
    url: chatUrl,
    headers,
    body: {
      model,
      messages: [],
      temperature: 0.2,
    },
    responseParser: parseOpenAiResponse,
  };
}

/**
 * Resolve endpoint URL and auth headers for the selected provider.
 * @param {{ provider: string, baseUrl: string, model: string, userApiKey: string }} config
 */
function buildRequestTarget(config) {
  const { provider, baseUrl, model, userApiKey } = config;

  switch (provider) {
    case PROVIDERS.PAID_CLOUD: {
      const cloudKey = process.env.OPENAI_API_KEY;
      if (!cloudKey) {
        throw new Error('Cloud AI key is not configured on the server.');
      }
      return {
        url: 'https://api.openai.com/v1/chat/completions',
        headers: {
          Authorization: `Bearer ${cloudKey}`,
          'Content-Type': 'application/json',
        },
        body: {
          model: model || 'gpt-4o',
          messages: [],
          temperature: 0.2,
        },
        responseParser: parseOpenAiResponse,
      };
    }

    case PROVIDERS.BYOK_OPENAI: {
      if (!userApiKey) {
        throw new Error('x-user-api-key header is required for BYOK OpenAI.');
      }
      const openAiBase = baseUrl?.trim() || 'https://api.openai.com/v1';
      return {
        url: `${openAiBase.replace(/\/$/, '')}/chat/completions`,
        headers: {
          Authorization: `Bearer ${userApiKey}`,
          'Content-Type': 'application/json',
        },
        body: {
          model,
          messages: [],
          temperature: 0.2,
        },
        responseParser: parseOpenAiResponse,
      };
    }

    case PROVIDERS.BYOK_ANTHROPIC: {
      if (!userApiKey) {
        throw new Error('x-user-api-key header is required for BYOK Anthropic.');
      }
      return {
        url: 'https://api.anthropic.com/v1/messages',
        headers: {
          'x-api-key': userApiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: {
          model: model || 'claude-3-5-sonnet-20241022',
          max_tokens: 4096,
          messages: [],
        },
        responseParser: parseAnthropicResponse,
      };
    }

    case PROVIDERS.CUSTOM_ENDPOINT: {
      if (!baseUrl) {
        throw new Error('x-ai-base-url is required for custom-endpoint provider.');
      }
      return openAiCompatibleTarget(baseUrl, model, userApiKey);
    }

    case PROVIDERS.LOCALHOST:
      return openAiCompatibleTarget(
        `http://${LOCALHOST_AI_HOST}:${resolveLocalhostPort(baseUrl)}/v1`,
        model,
        userApiKey
      );

    default:
      throw new Error(`Unsupported AI provider: ${provider}`);
  }
}

function isUnreachableMessage(message) {
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
    text.includes('other side closed') ||
    text.includes('failed to fetch') ||
    text.includes('networkerror') ||
    text.includes('fetch failed') ||
    text.includes('network request failed') ||
    text.includes('terminated') ||
    text.includes('aborted') ||
    text.includes('und_err')
  );
}

function isEmptyProviderResponse(message) {
  const text = String(message || '').toLowerCase();
  return (
    text.includes('streamed ai response was empty') ||
    text.includes('did not include message content') ||
    text.includes('did not include text content') ||
    text.includes('did not return a readable stream') ||
    text.includes('unexpected end of json')
  );
}

function throwUnreachable(error, url = '') {
  const detail = redactSecrets(error?.message || String(error || 'Connection failed'));
  const next = new Error(
    url
      ? `Could not reach the AI server at ${url}. ${detail}`
      : detail.includes('could not reach')
        ? detail
        : `Could not reach the AI server. ${detail}`
  );
  next.code = 'AI_UNREACHABLE';
  next.statusCode = 503;
  throw next;
}

function rethrowIfUnreachable(error) {
  if (isCanceledError(error)) throw canceledError();
  if (
    error?.code === 'AI_UNREACHABLE' ||
    isUnreachableMessage(error?.message) ||
    isEmptyProviderResponse(error?.message)
  ) {
    if (error?.code === 'AI_UNREACHABLE') throw error;
    throwUnreachable(error);
  }
}

function collectVisibleText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === 'string') return part;
        const type = String(part?.type || '').toLowerCase();
        if (type.includes('reason') || type.includes('think')) return '';
        return part?.text || part?.content || '';
      })
      .join('');
  }
  return '';
}

function collectReasoningText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === 'string') return part;
        return part?.text || part?.content || '';
      })
      .join('');
  }
  if (value && typeof value === 'object') {
    return collectReasoningText(value.content || value.text || '');
  }
  return '';
}

function combineModelText(content, reasoning) {
  const visible = String(content || '').trim();
  const hidden = String(reasoning || '').trim();
  if (hidden && visible) return `<think>\n${hidden}\n</think>\n${visible}`;
  if (visible) return visible;
  return hidden;
}

function parseOpenAiResponse(payload) {
  const choice = payload?.choices?.[0];
  const message = choice?.message || {};
  const content =
    collectVisibleText(message.content) ||
    collectVisibleText(choice?.text) ||
    collectVisibleText(payload?.output_text);
  const reasoning =
    collectReasoningText(message.reasoning_content) ||
    collectReasoningText(message.reasoning) ||
    collectReasoningText(choice?.reasoning);
  const combined = combineModelText(content, reasoning);

  if (!combined) {
    throw new Error('OpenAI-compatible response did not include message content.');
  }
  return combined;
}

function parseAnthropicResponse(payload) {
  const textBlock = payload?.content?.find((block) => block.type === 'text');
  if (!textBlock?.text) {
    throw new Error('Anthropic response did not include text content.');
  }
  return textBlock.text;
}

/**
 * Send content to the configured AI provider and return normalized action items.
 * Provider connection and empty-response failures do not complete with a local substitute.
 * @param {import('express').Request} req
 * @param {string} reportContent
 */
export async function analyzeReportContent(req, reportContent, onProgress, examples = []) {
  try {
    onProgress?.({ step: 'Understanding' });
    const focus = resolveImportFocus(req);
    const analysisPrompt = buildAnalysisPrompt(focus);
    const trainingExamples = isLocalTrainingEnabled(req) ? examples : [];
    const system =
      'Return only a JSON array of prioritized action items. The first character must be [. No markdown, no extra keys, no explanation. An empty array is allowed when nothing matches the requested focus.';
    const prepared = importChatPayload(req, {
      system,
      preamble: `${analysisPrompt}${formatTrainingPrompt(trainingExamples, { kind: 'report-parse' })}`,
      reportContent,
    });
    const rawText = await completeChat(req, prepared.options, onProgress);

    const parsed = await parseApproachesWithRetry({
      req,
      rawText,
      reportContent: prepared.report,
      focus,
      completeChat,
      onProgress,
      step: 'Repairing',
      allowsEmpty: allowsEmptyApproaches(focus),
      projectId: req.params?.projectId,
    });
    const actionItems = parsed.actionItems;

    if (!actionItems.length && !allowsEmptyApproaches(focus)) {
      throw new Error('AI response did not include any action items.');
    }

    return { actionItems, analysisSource: 'ai' };
  } catch (error) {
    rethrowIfUnreachable(error);
    throw error;
  }
}

function importChatPayload(req, { system, preamble, reportContent, extra = '' }) {
  const config = resolveAiConfig(req);
  const guarded = `${system || ''}${modelJsonGuardrail(req._modelProfile)}`;
  const fitted = fitImportPrompt({
    system: guarded,
    preamble,
    report: reportContent,
    extra,
    nCtx: contextLengthFor(req, config.provider),
  });
  return {
    options: {
      system: guarded,
      messages: [{ role: 'user', content: fitted.userContent }],
      maxTokens: fitted.maxTokens,
    },
    report: fitted.report,
  };
}

function compactPromptItems(items = [], limit = 40) {
  return JSON.stringify(
    (Array.isArray(items) ? items : [])
      .slice(0, limit)
      .map((item) => ({
        title: String(item.title || '').trim(),
        description: item.description ? String(item.description).trim() : undefined,
        priority: clampApproachPriority(item.priority),
      }))
      .filter((item) => item.title)
  );
}

export async function expandReportApproaches(
  req,
  reportContent,
  existingItems,
  remaining,
  onProgress,
  examples = []
) {
  try {
    onProgress?.({ step: 'Expanding' });
    const focus = resolveImportFocus(req);
    const trainingExamples = isLocalTrainingEnabled(req) ? examples : [];
    const high = Number(remaining?.[1]) || 0;
    const medium = Number(remaining?.[2]) || 0;
    const low = Number(remaining?.[3]) || 0;
    const expandPrompt = `You already extracted approaches from this report. Return ONLY a JSON array of ADDITIONAL approaches that are not already listed.

${FILE_READ_PROMPT}

Focus for this expansion:
${importFocusInstruction(focus)}

Rules:
- Output a JSON array, not an object.
- Do not wrap the array in markdown fences.
- Do not include reasoning, explanations, or trailing prose.
- Do not repeat or rephrase existing approaches.
- Every title must name work evidenced in the report content. If the report does not mention it, omit it.
- Keep every additional approach inside the requested focus.
- Each item must be an object with "title" (string), optional "description" (string), and "priority" (1, 2, or 3 only).
- priority is severity from the report: 1 = high, 2 = medium, 3 = low.
- Add at most ${high} high, ${medium} medium, and ${low} low items.
- If a priority has 0 remaining slots, do not add items at that priority.
- If nothing new is evidenced, return [].

Existing approaches:
${compactPromptItems(existingItems, 120)}`;

    const system =
      'Return only a JSON array of additional prioritized action items. The first character must be [. No markdown, no extra keys, no explanation. An empty array is allowed.';
    const prepared = importChatPayload(req, {
      system,
      preamble: `${expandPrompt}${formatTrainingPrompt(trainingExamples, { kind: 'report-parse' })}`,
      reportContent,
    });
    const rawText = await completeChat(req, prepared.options, onProgress);

    const parsed = await parseApproachesWithRetry({
      req,
      rawText,
      reportContent: prepared.report,
      focus,
      completeChat,
      onProgress,
      step: 'Repairing',
      allowsEmpty: true,
      extraRules: 'Do not repeat existing approaches. If nothing new is evidenced, return [].',
      projectId: req.params?.projectId,
    });

    return { actionItems: parsed.actionItems, analysisSource: 'ai' };
  } catch (error) {
    rethrowIfUnreachable(error);
    throw error;
  }
}

export async function refineReportContent(
  req,
  reportContent,
  previousItems,
  onProgress,
  examples = [],
  { pass = 2, passCount = 2 } = {}
) {
  try {
    onProgress?.({ step: `Pass ${pass} of ${passCount}` });
    const focus = resolveImportFocus(req);
    const analysisPrompt = buildAnalysisPrompt(focus);
    const trainingExamples = isLocalTrainingEnabled(req) ? examples : [];
    const system =
      'Return only a JSON array of prioritized action items. The first character must be [. No markdown, no extra keys, no explanation. An empty array is allowed when nothing matches the requested focus.';
    const prepared = importChatPayload(req, {
      system,
      preamble: `${analysisPrompt}${formatTrainingPrompt(trainingExamples, { kind: 'report-parse' })}`,
      extra: `

This is review pass ${pass} of ${passCount}. Re-read the report that fits in context. Compare it to the previous extraction. Fix missed items, invented items, merged items, wrong titles, items outside the requested focus, and bad priorities. Return a complete replacement JSON array, not a diff. Do not invent omitted records.

--- PREVIOUS EXTRACTION ---
${compactPromptItems(previousItems)}
--- END PREVIOUS ---`,
      reportContent,
    });
    const rawText = await completeChat(req, prepared.options, onProgress);

    const parsed = await parseApproachesWithRetry({
      req,
      rawText,
      reportContent: prepared.report,
      focus,
      completeChat,
      onProgress,
      step: 'Repairing',
      allowsEmpty: true,
      extraRules: 'Return a complete replacement array from the report. Do not invent items to fill the list.',
      projectId: req.params?.projectId,
    });

    return parsed.actionItems.length ? parsed.actionItems : previousItems;
  } catch (error) {
    rethrowIfUnreachable(error);
    throw error;
  }
}

function modelsUrlForTarget(target) {
  const url = String(target.url || '');
  if (url.includes('/chat/completions')) {
    return url.replace(/\/chat\/completions\/?$/, '/models');
  }
  if (url.includes('/v1/messages')) {
    return url.replace(/\/v1\/messages\/?$/, '/v1/models');
  }
  return `${url.replace(/\/$/, '')}/models`;
}

function parseModelIds(payload) {
  return parseModelEntries(payload).map((row) => row.id);
}

function parseModelEntries(payload) {
  const rows = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.models)
      ? payload.models
      : [];

  const entries = [];
  for (const entry of rows) {
    if (typeof entry === 'string') {
      const id = entry.trim();
      if (id) entries.push({ id, nCtx: null });
      continue;
    }
    const id = String(entry?.id || entry?.name || entry?.model || '').trim();
    if (!id) continue;
    entries.push({ id, nCtx: extractContextLength(entry) });
  }

  const direct = String(payload?.model || payload?.id || '').trim();
  if (direct && !entries.some((row) => row.id === direct)) {
    entries.unshift({ id: direct, nCtx: extractContextLength(payload) });
  }

  const seen = new Set();
  return entries.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

function modelKey(id) {
  return String(id || '')
    .trim()
    .toLowerCase()
    .replace(/:latest$/, '');
}

function modelBase(id) {
  return modelKey(id).split('/').pop();
}

function matchProviderModel(requested, available = []) {
  const list = [...new Set((available || []).map((id) => String(id || '').trim()).filter(Boolean))];
  const wanted = String(requested || '').trim();
  if (!list.length) {
    return { model: wanted, updated: false, models: list };
  }
  if (wanted) {
    const exact = list.find((id) => id === wanted);
    if (exact) return { model: exact, updated: false, models: list };
    const wantedKey = modelKey(wanted);
    const wantedBase = modelBase(wanted);
    const close =
      list.find((id) => modelKey(id) === wantedKey) ||
      list.find((id) => modelBase(id) === wantedBase);
    if (close) return { model: close, updated: close !== wanted, models: list };
  }
  return { model: list[0], updated: list[0] !== wanted, models: list };
}

function isUnknownModelError(message) {
  return /model.+(not found|does not exist|unknown|invalid|not loaded)|unknown model|no model loaded/i.test(
    String(message || '')
  );
}

async function listRunningLocalModels(target) {
  try {
    const origin = new URL(target.url).origin;
    const headers = { ...target.headers };
    delete headers['Content-Type'];
    const response = await fetch(`${origin}/api/ps`, { method: 'GET', headers });
    if (!response.ok) return [];
    return parseModelIds(await response.json());
  } catch {
    return [];
  }
}

async function listedModelsFor(target) {
  const catalog = await listProviderModels(target);
  const running = await listRunningLocalModels(target);
  const byId = new Map(catalog.map((row) => [row.id, row]));
  for (const id of running) {
    if (!byId.has(id)) byId.set(id, { id, nCtx: null });
  }
  return [...byId.values()];
}

async function syncConfigModel(req, config, onProgress, requestedOverride) {
  const requested = String(requestedOverride || config.model || '').trim();
  if (req._resolvedAiModel && requestedOverride == null) {
    config.model = req._resolvedAiModel;
    return config.model;
  }

  try {
    const target = buildRequestTarget(config);
    const available = await listedModelsFor(target);
    const ids = available.map((row) => row.id);
    const picked = matchProviderModel(requested, ids);
    if (!picked.model) {
      throw new Error('No model is loaded on the AI server. Load a model, then Test Connection.');
    }
    config.model = picked.model;
    req._resolvedAiModel = picked.model;
    let nCtx = available.find((row) => row.id === picked.model)?.nCtx || null;
    if (!nCtx && (config.provider === PROVIDERS.LOCALHOST || config.provider === PROVIDERS.CUSTOM_ENDPOINT)) {
      nCtx = await probeLocalContext(target, picked.model);
    }
    await attachObservedModel(req, {
      provider: config.provider,
      modelId: picked.model,
      nCtx,
      nCtxSource: nCtx ? 'listed' : 'preload',
    });
    onProgress?.({ model: picked.model });
    return picked.model;
  } catch (error) {
    if (error?.code === 'AI_UNREACHABLE' || isUnreachableMessage(error?.message)) {
      rethrowIfUnreachable(error);
    }
    if (/no model is loaded/i.test(error?.message || '')) {
      throw error;
    }
    req._resolvedAiModel = requested;
    config.model = requested;
    return requested;
  }
}

async function listProviderModels(target) {
  const url = modelsUrlForTarget(target);
  const headers = { ...target.headers };
  delete headers['Content-Type'];

  let response;
  try {
    response = await fetch(url, { method: 'GET', headers });
  } catch (error) {
    throwUnreachable(error, url);
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Could not read AI models (${response.status}): ${redactSecrets(errorText.slice(0, 300))}`
    );
  }

  const payload = await response.json();
  return parseModelEntries(payload);
}

async function probeLocalContext(target, model) {
  try {
    const origin = new URL(target.url).origin;
    const headers = { ...target.headers, 'Content-Type': 'application/json' };
    const response = await fetch(`${origin}/api/show`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: model, model }),
    });
    if (!response.ok) return null;
    return extractContextLength(await response.json());
  } catch {
    return null;
  }
}

/**
 * Lightweight connectivity check for the Settings "Test Connection" flow.
 * @param {import('express').Request} req
 */
export async function testAiConnection(req, onProgress) {
  onProgress?.({ step: 'Connecting', percent: 18 });
  const config = resolveAiConfig(req);
  const requested = config.model;
  const model = await syncConfigModel(req, config, onProgress);
  if (!model) {
    throw new Error('The AI server did not report a model name.');
  }

  onProgress?.({ step: 'Connecting', percent: 32, model });

  let sampleItem = model;
  try {
    onProgress?.({ step: 'Generating', percent: 48, model });
    const rawText = await completeChat(
      req,
      {
        messages: [
          {
            role: 'user',
            content: 'Reply with the JSON array: [{"title":"Connection OK","priority":1}]',
          },
        ],
        maxTokens: 256,
      },
      onProgress
    );
    sampleItem = extractActionItems(rawText)[0]?.title ?? model;
  } catch (error) {
    console.warn('[aiService] Model listed; chat probe skipped:', redactSecrets(error.message));
  }

  return {
    ok: true,
    provider: config.provider,
    model,
    requested,
    updated: model !== requested,
    sampleItem,
  };
}

/**
 * @param {import('express').Request} req
 * @param {{ system?: string, messages: Array<{ role: string, content: string }>, maxTokens?: number }} options
 */
function modelUsesThinking(model) {
  return /\b(gemma|qwen|qwq|deepseek|r1|gpt-oss|magistral)\b/i.test(String(model || ''));
}

function applyLocalThinkingOff(body, config) {
  if (config._skipThinkingOff) return;
  if (config.provider !== PROVIDERS.LOCALHOST && config.provider !== PROVIDERS.CUSTOM_ENDPOINT) {
    return;
  }
  if (!modelUsesThinking(config.model || body.model)) return;
  body.reasoning_effort = 'none';
  body.enable_thinking = false;
  body.chat_template_kwargs = { ...(body.chat_template_kwargs || {}), enable_thinking: false };
}

function isThinkingParamError(message) {
  return /reasoning_effort|enable_thinking|chat_template_kwargs|unknown (field|parameter)|unrecognized/i.test(
    String(message || '')
  );
}

function applyChatMessages(target, config, { system, messages, maxTokens }) {
  if (config.provider === PROVIDERS.BYOK_ANTHROPIC) {
    const prompt = [system, ...messages.map((entry) => `${entry.role}: ${entry.content}`)]
      .filter(Boolean)
      .join('\n\n');
    target.body.messages = [{ role: 'user', content: prompt }];
    if (maxTokens) {
      target.body.max_tokens = maxTokens;
    }
  } else {
    target.body.messages = [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...messages,
    ];
    if (maxTokens) {
      target.body.max_tokens = maxTokens;
    }
    applyLocalThinkingOff(target.body, config);
  }
}

async function requestChat(target, stream, onProgress, expectedMs = null, signal = null) {
  const body = { ...target.body, stream };
  const job = createJobProgress({
    inputChars: estimateInputChars(body.messages || body),
    step: 'Generating',
    expectedMs,
  });
  const emit = (force = false) => {
    if (!onProgress || !job.shouldEmit(force)) return;
    onProgress(job.snapshot());
  };

  emit(true);
  const ticker = setInterval(() => emit(), 400);

  try {
    if (signal?.aborted) throw canceledError();

    let response;
    try {
      response = await fetch(target.url, {
        method: 'POST',
        headers: target.headers,
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (isCanceledError(error) || signal?.aborted) throw canceledError();
      throwUnreachable(error, target.url);
    }

    if (!response.ok) {
      const errorText = await response.text();
      const detail = `AI request failed (${response.status}): ${redactSecrets(errorText.slice(0, 500))}`;
      if (response.status >= 500 || response.status === 404) {
        const error = new Error(detail);
        throwUnreachable(error, target.url);
      }
      throw new Error(detail);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!stream || contentType.includes('application/json')) {
      job.setStep('Generating');
      emit(true);
      const payload = await response.json();
      job.setStep('Writing');
      emit(true);
      return target.responseParser(payload);
    }

    let text = '';
    let reasoning = '';
    try {
      await readProviderSse(response, (payload) => {
        if (signal?.aborted) throw canceledError();
        const chunk = extractStreamParts(payload);
        if (!chunk.content && !chunk.reasoning) return;
        if (chunk.content) text += chunk.content;
        if (chunk.reasoning) reasoning += chunk.reasoning;
        const visibleChars = text.length + Math.round(reasoning.length * 0.25);
        job.setStep('Writing');
        job.markStreaming(visibleChars);
        emit();
      });
    } catch (error) {
      if (isCanceledError(error) || signal?.aborted) throw canceledError();
      throw error;
    }

    const combined = combineModelText(text, reasoning);
    if (!combined) {
      throw new Error('Streamed AI response was empty.');
    }

    return combined;
  } finally {
    clearInterval(ticker);
  }
}

function remainingExpectedMs(req) {
  const expected = Number(req?._expectedJobMs);
  if (!Number.isFinite(expected) || expected <= 0) return null;
  const started = Number(req._jobStartedAt) || Date.now();
  return Math.max(3000, Math.round(expected - (Date.now() - started)));
}

async function prepareJobTiming(req, inputChars) {
  if (!isLocalTrainingEnabled(req)) return;
  const user = resolveRequestUser(req);
  if (!user?.id) return;
  if (req._jobStartedAt == null) req._jobStartedAt = Date.now();
  if (req._expectedJobMs == null) {
    req._expectedJobMs = await loadJobTimingEstimate(prisma, user.id, {
      job: req._jobKind || 'chat',
      inputChars,
      fileBytes: Number(req._jobFileBytes) || 0,
      passCount: Number(req._jobPassCount) || 1,
    });
  }
}

function rememberSuccessfulChat(req, { inputChars, elapsedMs }) {
  if (!isLocalTrainingEnabled(req)) return;
  if (req._jobKind && req._jobKind !== 'chat') return;
  const user = resolveRequestUser(req);
  if (!user?.id) return;
  recordJobTiming(prisma, {
    userId: user.id,
    job: 'chat',
    inputChars,
    fileBytes: Number(req._jobFileBytes) || 0,
    passCount: 1,
    elapsedMs,
  }).catch(() => {});
}

async function completeChat(req, options, onProgress) {
  const config = resolveAiConfig(req);
  await syncConfigModel(req, config, onProgress, options?.model);
  const chatStarted = Date.now();
  const inputChars = estimateInputChars(options?.messages || []);
  await prepareJobTiming(req, inputChars);
  const budget = contextBudget(contextLengthFor(req, config.provider));
  const chatOptions = {
    ...options,
    maxTokens: Math.min(Number(options?.maxTokens) || budget.maxTokens, budget.maxTokens),
  };

  const send = async (opts, stream) => {
    const target = buildRequestTarget(config);
    applyChatMessages(target, config, opts);
    return requestChat(
      target,
      stream,
      onProgress,
      remainingExpectedMs(req),
      clientAbortSignal(req)
    );
  };

  const retryIfUnknownModel = async (error, opts) => {
    if (opts.modelRetried || !isUnknownModelError(error?.message)) return null;
    req._resolvedAiModel = '';
    await syncConfigModel(req, config, onProgress);
    if (!config.model) return null;
    onProgress?.({ step: 'Generating', model: config.model });
    const retried = { ...opts, modelRetried: true };
    try {
      return await send(retried, opts.stream !== false);
    } catch (retryError) {
      if (retryError?.code === 'AI_UNREACHABLE' || isUnreachableMessage(retryError?.message)) {
        rethrowIfUnreachable(retryError);
      }
      throw retryError;
    }
  };

  const retryIfThinkingParam = async (error, opts) => {
    if (config._skipThinkingOff || !isThinkingParamError(error?.message)) return null;
    config._skipThinkingOff = true;
    onProgress?.({ step: 'Generating' });
    try {
      return await send(opts, opts.stream !== false);
    } catch (retryError) {
      if (retryError?.code === 'AI_UNREACHABLE' || isUnreachableMessage(retryError?.message)) {
        rethrowIfUnreachable(retryError);
      }
      return null;
    }
  };

  const retryIfContext = async (error, opts) => {
    const limit = parseContextLimitError(error?.message);
    if (!limit || opts.contextRetried) return null;
    rememberContextLength(req, limit.nCtx);
    onProgress?.({ step: 'Generating' });
    const shrunk = {
      ...shrinkChatOptions(opts, Math.max(1024, Math.floor(limit.nCtx * 0.72))),
      contextRetried: true,
      stream: opts.stream,
    };
    try {
      return await send(shrunk, opts.stream !== false);
    } catch (retryError) {
      if (retryError?.code === 'AI_UNREACHABLE' || isUnreachableMessage(retryError?.message)) {
        rethrowIfUnreachable(retryError);
      }
      if (opts.stream === false) throw retryError;
      try {
        return await send(shrunk, false);
      } catch (finalError) {
        rethrowIfUnreachable(finalError);
        throw finalError;
      }
    }
  };

  onProgress?.({ step: 'Generating' });

  const done = (text) => {
    if (text) {
      rememberSuccessfulChat(req, { inputChars, elapsedMs: Date.now() - chatStarted });
    }
    return text;
  };

  if (chatOptions?.stream === false) {
    try {
      return done(await send(chatOptions, false));
    } catch (error) {
      if (isCanceledError(error)) throw canceledError();
      if (error?.code === 'AI_UNREACHABLE' || isUnreachableMessage(error?.message)) {
        rethrowIfUnreachable(error);
      }
      const modelRecovered = await retryIfUnknownModel(error, chatOptions);
      if (modelRecovered != null) return done(modelRecovered);
      const thinkingRecovered = await retryIfThinkingParam(error, chatOptions);
      if (thinkingRecovered != null) return done(thinkingRecovered);
      const recovered = await retryIfContext(error, chatOptions);
      if (recovered != null) return done(recovered);
      throw error;
    }
  }

  try {
    return done(await send(chatOptions, true));
  } catch (error) {
    if (isCanceledError(error)) throw canceledError();
    if (error?.code === 'AI_UNREACHABLE' || isUnreachableMessage(error?.message)) {
      rethrowIfUnreachable(error);
    }
    const modelRecovered = await retryIfUnknownModel(error, chatOptions);
    if (modelRecovered != null) return done(modelRecovered);
    const thinkingRecovered = await retryIfThinkingParam(error, chatOptions);
    if (thinkingRecovered != null) return done(thinkingRecovered);
    const recovered = await retryIfContext(error, chatOptions);
    if (recovered != null) return done(recovered);
    console.warn('[aiService] Stream unavailable, retrying without stream:', redactSecrets(error.message));
    onProgress?.({ step: 'Generating' });
    try {
      return done(await send(chatOptions, false));
    } catch (retryError) {
      if (isCanceledError(retryError)) throw canceledError();
      if (retryError?.code === 'AI_UNREACHABLE' || isUnreachableMessage(retryError?.message)) {
        rethrowIfUnreachable(retryError);
      }
      const recoveredModel = await retryIfUnknownModel(retryError, chatOptions);
      if (recoveredModel != null) return done(recoveredModel);
      const thinkingRecovered = await retryIfThinkingParam(retryError, chatOptions);
      if (thinkingRecovered != null) return done(thinkingRecovered);
      const recoveredNonStream = await retryIfContext(retryError, chatOptions);
      if (recoveredNonStream != null) return done(recoveredNonStream);
      throw retryError;
    }
  }
}

export async function generateApproachSuggestions(req, item, onProgress) {
  try {
    onProgress?.({ step: 'Understanding', percent: 22 });
    const raw = await completeChat(req, {
      system:
        'You help project and community managers on the Dashboard for this one approach. Do not discuss portfolio clustering or cross-project scheduling. Return ONLY a JSON array of 2-3 objects. Each object must have "title", "detail", and "kind". Use kind "step" when the item is one to-do in an ordered procedure of up to 3 steps. Use kind "idea" when it is a standalone suggestion, not part of a sequence. If you return a procedure, return exactly 3 steps in order. No markdown.',
      messages: [
        {
          role: 'user',
          content: `Approach: ${item.title}\nPriority: ${item.priority}\nDetails: ${item.description || 'None'}\n\nIf this should be done as a short procedure, return 3 ordered steps. If the advice is not a sequence, return standalone ideas marked kind "idea".`,
        },
      ],
      maxTokens: 800,
    },
    onProgress
    );

    return {
      suggestions: extractSuggestions(raw),
      source: 'ai',
    };
  } catch (error) {
    rethrowIfUnreachable(error);
    throw error;
  }
}

function comparisonBasis(suggestions) {
  if (suggestions.length > 1) {
    const list = suggestions
      .map((entry, index) => `${index + 1}. ${entry.title}`)
      .join('\n');
    return `This file comparison is based on these linked saved suggestions:\n${list}`;
  }

  return `This file comparison is based on the saved suggestion: ${
    suggestions[0]?.title || 'this suggestion'
  }.`;
}

export async function analyzeAgainstSavedSuggestions(req, suggestions, fileName, content, onProgress) {
  const snapshot = suggestions.map((entry) => ({
    title: entry.title,
    detail: entry.detail || '',
  }));
  const listed = snapshot
    .map((entry, index) => `${index + 1}. ${entry.title}${entry.detail ? ` — ${entry.detail}` : ''}`)
    .join('\n');
  const linked = snapshot.length > 1;
  const fileBody = clipPlainContent(content, contextLengthFor(req, resolveAiConfig(req).provider));

  try {
    onProgress?.({ step: 'Comparing', percent: 32 });
    const text = await completeChat(req, {
      system: linked
        ? 'You help project and community managers review one file against multiple linked saved suggestions. Return concise Markdown only. First restate that this file comparison is based on those linked saved suggestions and list them. Then, for EACH listed suggestion, say what the file supports, contradicts, or leaves missing. End with 2-4 next actions. Do not invent facts that are not in the file.'
        : 'You help project and community managers review a file against a saved AI suggestion. Return concise Markdown only. For that saved suggestion, say what the file supports, contradicts, or leaves missing. End with 2-4 next actions. Do not invent facts that are not in the file.',
      messages: [
        {
          role: 'user',
          content: linked
            ? `The user linked this file to every saved suggestion below. Compare the file against all of them.\n\nLinked saved suggestions:\n${listed}\n\nFile name: ${fileName}\n\nFile content:\n${fileBody}`
            : `Saved suggestion:\n${listed}\n\nFile name: ${fileName}\n\nFile content:\n${fileBody}`,
        },
      ],
      maxTokens: 900,
    }, onProgress);

    return {
      analysis: `${comparisonBasis(snapshot)}\n\n${String(text).trim()}`,
      source: 'ai',
    };
  } catch (error) {
    rethrowIfUnreachable(error);
    throw error;
  }
}

function overviewFeedStylePrompt() {
  return `Preferred Overview replies:
Start with a project name or heading. Never write The user is asking, This falls under the rule, Thinking Process, Analyze the Request, or Rule Check. Never quote these rules.
Answer the user's question first. Do not recap every project.
Name real project names from OVERVIEW BRIEFING and use their open/high/stale numbers when that is why you ranked them.
Give at most 3 ranked next actions as **Project name** — one concrete move from the briefing (cluster, next= field, or a numbered approach). Do not invent steps, files, meetings, or approaches.
If they asked where work is, which approaches are open, or which project they belong to, list every open approach from the briefing, grouped by project and priority. Finish every title. Never stop mid-item.
If they asked what to start or prioritize, pick one focus project and say why in one sentence using the numbers.
If they asked about clustering, name the cluster labels and which listed projects sit in each.
If they asked about the calendar, use Calendars: as the source of truth.
Keep advice short. Inventories may be a complete list. No pep talk, no thinking process, no "as a coach", and do not say "hottest queue" unless you also name the project.
Implementation steps, file analysis, and saved suggestions belong on the Dashboard.`;
}

async function completeDiscussChat(req, options, onProgress) {
  const text = await completeChat(req, options, onProgress);
  if (!needsDiscussRetry(text)) return text;
  onProgress?.({ step: 'Writing', percent: 70 });
  const retry = await completeChat(
    req,
    {
      ...options,
      messages: [
        ...(options.messages || []),
        { role: 'assistant', content: String(text || '').slice(0, 1500) },
        {
          role: 'user',
          content:
            'Stop. That draft was internal reasoning and it was cut off. Answer the user now. Do not narrate the request or quote rules. Start with a project name or heading. If they asked where work is, list every open approach grouped by project and priority. Finish every title.',
        },
      ],
      maxTokens: Math.max(Number(options.maxTokens) || 1600, 2000),
    },
    onProgress
  );
  return retry || text;
}

function discussActionInstructions({ userMessage, exampleStart, overview = false }) {
  const askedDelete = userAskedToDeleteApproach(userMessage);
  const askedCalendar = userAskedForCalendarChange(userMessage) && !askedDelete;
  const rules = [
    'Never ask for permission, confirmation, or approval.',
    'Never write PERMISSION, JSON schemas, hidden reasoning, think tags, or chain of thought.',
    'Never paste dumps or raw JSON into the user-facing sentences.',
  ].join(' ');

  const calendar = askedCalendar
    ? [
        'The user asked for a calendar change and already approved it.',
        'After the reply write CALENDAR and a JSON array of real values only — never copy this schema.',
        overview
          ? `Example:\nCALENDAR\n[{"action":"create","project":1,"kind":"task","title":"Clear the hottest queue","start":"${exampleStart}","end":null,"allDay":false,"status":"scheduled","approach":1}]`
          : `Example:\nCALENDAR\n[{"action":"create","kind":"meeting","title":"Staff the login fix","start":"${exampleStart}","end":null,"allDay":false,"status":"scheduled","approach":1}]`,
        overview
          ? 'project is the numbered project. approach is the numbered approach. If they asked for several items, include each one (up to 8). Do not put every high-priority approach on the calendar unless they asked for those. When scheduling an approach, set "approach" to its number and use that approach\'s title and notes unless the user asked for different wording.'
          : 'Link calendar items to this approach with "approach" (or omit it — it links here). Use the approach title and notes unless the user asked for different wording. If they asked for several items, include each one in that array.',
        'The app saves it immediately. Say it is on the calendar. Do not ask them to confirm.',
      ].join('\n')
    : 'They did not ask for a calendar change. Do not write CALENDAR. Do not invent schedule JSON.';

  const approach = askedDelete
    ? approachDeletePrompt()
    : 'They did not ask to delete an approach. Do not write APPROACH.';

  return `${rules}\n${discussScopePrompt({ overview })}\n${calendar}\n${approach}`;
}

function sanitizeSummaryBody(raw) {
  return String(raw || '')
    .replace(/^\s*PERMISSION:\s*(yes|no)\b.*$/gim, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\bCALENDAR\b[\s\S]*$/i, '')
    .replace(/\bAPPROACH\b[\s\S]*$/i, '')
    .trim();
}

function parseDumpSummary(raw) {
  const body = sanitizeSummaryBody(raw);
  const reply = visibleAssistantReply(body) || body;
  return { reply };
}

async function summarizeDump(req, raw, context, onProgress) {
  onProgress?.({ step: 'Summarizing', percent: 82 });
  const askedDelete = userAskedToDeleteApproach(context?.userMessage);
  const askedCalendar = userAskedForCalendarChange(context?.userMessage) && !askedDelete;
  const handoff = resolveDiscussHandoff({
    surface: context?.surface,
    userMessage: context?.userMessage,
  });
  const draft = String(raw || '').trim().slice(0, 5000);
  const text = await completeChat(
    req,
    {
      system: `Rewrite a messy model dump into a short message the user can answer.
Never mention dumps, JSON, schemas, PERMISSION, hidden reasoning, or that you are summarizing.
Never write PERMISSION, CALENDAR, or APPROACH.

User already asked for a calendar change: ${askedCalendar ? 'yes' : 'no'}
User already asked to delete an approach: ${askedDelete ? 'yes' : 'no'}
This chat is: ${context?.surface === 'overview' ? 'Overview (portfolio only)' : 'Dashboard (one approach only)'}
User message: ${String(context?.userMessage || '').slice(0, 500)}

Rules:
- If this request belongs on the other page, say you cannot do it here and tell them where to go. Overview: prioritize, cluster, and schedule across projects. Dashboard: steps, file analysis, saved suggestions, and one approach.
- If they already asked for a change that belongs here, describe it in 1-2 sentences as something you will do. Do not ask them to confirm.
- If they did not ask, and the dump is proposing a calendar or delete that belongs here, ask one simple question: what you would do, then how to reply. Example: "I can add Staff standup Tuesday at 9:00 AM. Reply **yes** to add it, or tell me a different title or time."
- If the dump is only advice that belongs here, give that advice in 2-4 short sentences and one simple follow-up if needed.
- If they asked where work is or which approaches are open, list every approach from the dump, grouped by project and priority. Finish every title.
- Never write Thinking Process, Analyze the Request, Rule Check, The user is asking, or This falls under the rule.
- Start with a project name or heading.
- Use simple Markdown. Advice: 2-5 sentences. Inventories: complete list.`,
      messages: [{ role: 'user', content: `Dump:\n${draft}` }],
      maxTokens: context?.surface === 'overview' ? 1600 : 350,
      stream: false,
    },
    onProgress
  );
  const parsed = parseDumpSummary(text);
  if (handoff && (!parsed.reply || looksLikeMachineReply(parsed.reply))) {
    return { reply: handoff };
  }
  return parsed;
}

async function materializeCalendarProposals(req, raw, context, onProgress) {
  const projects = context?.projects || [];
  if (!projects.length) return [];
  onProgress?.({ step: 'Scheduling', percent: 88 });
  const listing = projects
    .slice(0, 12)
    .map((row, index) => `${index + 1}. ${row.name}`)
    .join('\n');
  const batchLimit = calendarProposalLimit(context?.userMessage);
  const limit = batchLimit > 1 ? `up to ${batchLimit}` : 'exactly 1';
  const clock = context?.clock || readUserClock();
  const exampleStart = formatLocalIso(fallbackStartDate(clock), clock);
  const text = await completeChat(
    req,
    {
      system: `Extract the calendar change the user asked for this turn (create, update, or delete). Reply with a JSON array only. Examples: [{"action":"create","project":1,"kind":"meeting","title":"Staff standup","start":"${exampleStart}","end":null,"allDay":false,"status":"scheduled","approach":1}] or [{"action":"delete","project":1,"title":"Staff standup"}]. Use numbered projects, numbered approaches, and the calendar labels (kind: task|meeting|event|unavailable, status: scheduled|ontime|delayed|completed). When the item is for an approach, set approach to that number and use the approach title and notes unless the user asked for different wording. Return ${limit} item(s). If the user listed several titles or said all/these/both/multiple, include each requested item. Do not schedule every high-priority approach unless they asked for those. Do not title items follow-up unless the user used that word. If the dump is only discussing the backlog, reply [].\n\n${calendarVocabularyPrompt()}\n\n${calendarClockPrompt(clock)}`,
      messages: [
        {
          role: 'user',
          content: `User request:\n${context?.userMessage || ''}\n\nProjects:\n${listing}\n\n${formatApproachesBriefing(
            context?.approaches || [],
            projects
          )}\n\nDump:\n${String(raw || '').trim().slice(0, 4000)}`,
        },
      ],
      maxTokens: batchLimit > 1 ? 900 : 400,
      stream: false,
    },
    onProgress
  );
  const proposals = extractCalendarProposals(text, context).proposals || [];
  return proposals.slice(0, batchLimit);
}

async function finalizeDiscussReply(req, raw, split, context, onProgress) {
  const askedDelete = userAskedToDeleteApproach(context?.userMessage);
  const askedCalendar = userAskedForCalendarChange(context?.userMessage) && !askedDelete;
  const handoff = resolveDiscussHandoff({
    surface: context?.surface,
    userMessage: context?.userMessage,
  });
  if (handoff) {
    return {
      reply: handoff,
      proposals: [],
      applyImmediately: false,
      dumpRecovered: false,
      source: 'ai',
    };
  }

  const dump =
    isResponseDump(raw) ||
    isResponseDump(split.reply) ||
    looksLikeMachineReply(split.reply) ||
    (!split.reply && Boolean(String(raw || '').trim()));
  let reply = split.reply || '';
  let proposals = split.proposals || [];
  let dumpRecovered = false;

  if (dump) {
    dumpRecovered = true;
    try {
      const summarized = await summarizeDump(req, raw, context, onProgress);
      if (summarized.reply) reply = summarized.reply;
    } catch (error) {
      console.warn('[aiService] Dump summary skipped:', error?.message || error);
    }
    if (!reply || looksLikeMachineReply(reply) || isResponseDump(reply)) {
      reply = dumpRecoveryFallback({ askedCalendar, askedDelete, handoff });
    }
  }

  if (!proposals.length && askedCalendar) {
    try {
      proposals = await materializeCalendarProposals(req, raw, context, onProgress);
    } catch (error) {
      console.warn('[aiService] Calendar extract skipped:', error?.message || error);
    }
  }
  if (proposals.length) {
    proposals = proposals.slice(0, calendarProposalLimit(context?.userMessage));
  }

  const applyImmediately = Boolean(proposals.length) && askedCalendar;
  if (proposals.length) {
    const confirmation = applyImmediately
      ? formatAppliedConfirmation(proposals, context?.projects, context?.clock)
      : split.confirmation || formatProposalConfirmation(proposals, context?.projects, context?.clock);
    if (applyImmediately) {
      reply =
        reply && !looksLikeMachineReply(reply) && !explainsHowToRespond(reply)
          ? `${reply}\n\n${confirmation}`
          : confirmation;
    } else if (!explainsHowToRespond(reply) || looksLikeMachineReply(reply)) {
      reply =
        reply && !looksLikeMachineReply(reply) ? `${reply}\n\n${confirmation}` : confirmation;
    }
  } else if (dump && askedCalendar) {
    if (!explainsHowToRespond(reply)) {
      reply = [reply, dumpRecoveryFallback({ askedCalendar: true })].filter(Boolean).join('\n\n');
    }
  }

  return { reply: reply || '', proposals, applyImmediately, dumpRecovered, source: 'ai' };
}

function attachApproachDeletes(finalized, text, context) {
  const asked = userAskedToDeleteApproach(context?.userMessage);
  let items = asked ? extractApproachDeletes(text, context) : [];
  if (asked && !items.length && context?.defaultItemId) {
    const found = (context.approaches || []).find((row) => row.id === context.defaultItemId);
    items = found
      ? [{ id: found.id, title: found.title, projectId: found.projectId }]
      : [{ id: context.defaultItemId, title: 'this approach' }];
  }
  if (asked && !items.length) {
    items = extractApproachDeletes(
      `APPROACH\n[{"action":"delete","title":${JSON.stringify(context?.userMessage || '')}}]`,
      context
    );
  }
  if (!asked) items = [];
  let reply = finalized.reply || '';
  if (items.length) {
    const confirmation = formatApproachDeletedConfirmation(items);
    reply =
      reply && !looksLikeMachineReply(reply) && !explainsHowToRespond(reply)
        ? `${reply}\n\n${confirmation}`
        : confirmation;
  } else if (asked && !context?.defaultItemId) {
    reply = HANDOFF_TO_DASHBOARD_DELETE;
  }
  return { ...finalized, reply, deleteApproaches: items };
}

function emptyHandoffResult(reply) {
  return {
    reply,
    proposals: [],
    applyImmediately: false,
    dumpRecovered: false,
    source: 'ai',
    deleteApproaches: [],
  };
}

export async function discussApproach(req, item, history, userMessage, onProgress, calendar = [], clock, examples = [], approaches = []) {
  const handoff = resolveDiscussHandoff({ surface: 'dashboard', userMessage });
  if (handoff) return emptyHandoffResult(handoff);

  const recent = (history || [])
    .slice(-12)
    .map((entry) => ({
      role: entry.role === 'assistant' ? 'assistant' : 'user',
      content:
        entry.role === 'assistant' ? visibleAssistantReply(entry.content) : entry.content,
    }))
    .filter((entry) => String(entry.content || '').trim());
  const userClock = clock || readUserClock();
  const briefing = formatProjectCalendarBriefing(calendar, userClock);
  const listedApproaches = approaches?.length ? approaches : [item];
  const approachBriefing = formatApproachesBriefing(listedApproaches);
  const exampleStart = formatLocalIso(fallbackStartDate(userClock), userClock);

  try {
    onProgress?.({ step: 'Understanding', percent: 24 });
    const text = await completeDiscussChat(req, {
      system: `You are a concise project-management coach for the Dashboard. Discuss only this one approach. Do not discuss the portfolio overview, clustering, or cross-project scheduling; that belongs on the Overview page. Give practical advice. Use simple Markdown: **bold**, lists, and short headings. Do not use tables, HTML, or hidden reasoning. Never write The user is asking or Thinking Process.\n\n${discussActionInstructions({ userMessage, exampleStart, overview: false })}\n\n${calendarVocabularyPrompt()}\n\n${calendarClockPrompt(userClock)}\nApproach: ${item.title}\nDetails: ${item.description || 'None'}\n${approachBriefing}\n${briefing}${formatTrainingPrompt(examples, { kind: 'project-discuss' })}${correctionInstruction(userMessage)}`,
      messages: [...recent, { role: 'user', content: userMessage }],
      maxTokens: 1600,
    }, onProgress);

    const context = {
      projects: [{ id: item.projectId, name: '' }],
      entries: calendar,
      approaches: listedApproaches,
      defaultProjectId: item.projectId,
      defaultItemId: item.id,
      userMessage,
      clock: userClock,
      surface: 'dashboard',
    };
    const split = extractCalendarProposals(text, context);
    return withScopeNote(
      attachApproachDeletes(
        await finalizeDiscussReply(req, text, split, context, onProgress),
        text,
        context
      ),
      { surface: 'dashboard', userMessage }
    );
  } catch (error) {
    rethrowIfUnreachable(error);
    throw error;
  }
}

export async function discussOverview(req, overview, history, userMessage, onProgress, choices, calendar = [], clock, examples = [], approaches = []) {
  const handoff = resolveDiscussHandoff({ surface: 'overview', userMessage });
  if (handoff) return emptyHandoffResult(handoff);

  const userClock = clock || readUserClock();
  const briefing = formatOverviewBriefing(overview, choices);
  const calendarBriefing = formatPortfolioCalendarBriefing(calendar, overview?.projects || [], userClock);
  const approachBriefing = formatApproachesBriefing(approaches, overview?.projects || []);
  const exampleStart = formatLocalIso(fallbackStartDate(userClock), userClock);
  const recent = (history || [])
    .slice(-12)
    .map((entry) => ({
      role: entry.role === 'assistant' ? 'assistant' : 'user',
      content:
        entry.role === 'assistant' ? visibleAssistantReply(entry.content) : entry.content,
    }))
    .filter((entry) => String(entry.content || '').trim());

  try {
    onProgress?.({ step: 'Understanding', percent: 24 });
    const text = await completeDiscussChat(
      req,
      {
        system: `You answer Overview portfolio questions from the briefing for this visit only. Be specific and short. Do not assume earlier sessions. Treat the calendar briefing as the source of truth for what is already scheduled. Do not invent projects or counts. When the user asks to schedule, reschedule, or delete something, use the USER LOCAL CLOCK and the CALENDAR LABELS. Use simple Markdown: **bold**, lists, and short headings. No tables, HTML, or hidden reasoning.\n\n${overviewFeedStylePrompt()}\n\n${discussActionInstructions({ userMessage, exampleStart, overview: true })}\n\n${calendarVocabularyPrompt()}\n\n${calendarClockPrompt(userClock)}\n\nOVERVIEW BRIEFING\n${briefing}\n\n${calendarBriefing}\n\n${approachBriefing}${formatTrainingPrompt(examples, { kind: 'overview-feed' })}${correctionInstruction(userMessage)}`,
        messages: [...recent, { role: 'user', content: userMessage }],
        maxTokens: 2400,
      },
      onProgress
    );

    const projects = overview?.projects || [];
    const context = {
      projects,
      entries: calendar,
      approaches,
      defaultProjectId: choices?.focusProjectId || projects[0]?.id,
      userMessage,
      clock: userClock,
      surface: 'overview',
    };
    const split = extractCalendarProposals(text, context);
    return withScopeNote(
      attachApproachDeletes(
        await finalizeDiscussReply(req, text, split, context, onProgress),
        text,
        context
      ),
      { surface: 'overview', userMessage }
    );
  } catch (error) {
    rethrowIfUnreachable(error);
    throw error;
  }
}

export async function recommendOverviewChoices(req, overview, onProgress) {
  const briefing = formatOverviewChoiceBriefing(overview);

  try {
    onProgress?.({ step: 'Choosing', percent: 28 });
    const raw = await completeChat(
      req,
      {
        system:
          `Overview decision engine. Projects are numbered. Reply with JSON only, starting with {. Example: {"headline":"Start with the hottest queue","focus":1,"why":"It still has high-priority work","doNext":[1,2],"actions":[{"n":1,"next":"Clear the high-priority approaches first"}]}. Use only those numbers. Do not invent projects. No markdown.`,
        messages: [
          {
            role: 'user',
            content: `Choose focus, do-next order, and next actions.\n${briefing}`,
          },
        ],
        maxTokens: 700,
        stream: false,
      },
      onProgress
    );

    const parsed =
      extractOverviewChoicePayload(raw) || inferOverviewChoicePayload(raw, overview);
    if (!parsed) {
      console.warn(
        '[recommendOverviewChoices] Unparsed reply:',
        redactSecrets(String(raw || '').slice(0, 280))
      );
      throw new Error('Unable to locate overview choices in the AI response.');
    }

    return {
      choices: sanitizeOverviewChoices(overview, parsed),
      source: 'ai',
    };
  } catch (error) {
    if (error?.code === 'AI_UNREACHABLE' || isUnreachableMessage(error?.message)) {
      rethrowIfUnreachable(error);
    }
    throw error;
  }
}

export { PROVIDERS };
export default {
  analyzeReportContent,
  testAiConnection,
  resolveAiConfig,
  generateApproachSuggestions,
  discussApproach,
  discussOverview,
  recommendOverviewChoices,
  analyzeAgainstSavedSuggestions,
  PROVIDERS,
};
