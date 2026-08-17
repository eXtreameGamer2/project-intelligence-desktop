import { persistObservedContext } from './aiModelCatalog.js';

const CHARS_PER_TOKEN = 2;
const DEFAULT_LOCAL_CTX = 8192;
const DEFAULT_CLOUD_CTX = 128000;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text || '').length / CHARS_PER_TOKEN));
}

export function charsForTokens(tokens) {
  return Math.max(0, Math.floor(Number(tokens) * CHARS_PER_TOKEN));
}

export function parseContextLimitError(message) {
  const text = String(message || '');
  const ctx = text.match(/n_ctx:\s*(\d+)/i);
  const keep = text.match(/n_keep:\s*(\d+)/i);
  if (!ctx) {
    if (/context length|too many tokens|maximum context|n_keep/i.test(text)) {
      return { nCtx: DEFAULT_LOCAL_CTX, nKeep: keep ? Number(keep[1]) : null };
    }
    return null;
  }
  return { nCtx: Number(ctx[1]), nKeep: keep ? Number(keep[1]) : null };
}

export function isContextLengthError(message) {
  return Boolean(parseContextLimitError(message));
}

export function rememberContextLength(req, nCtx) {
  const value = Number(nCtx);
  if (!req || !Number.isInteger(value) || value < 1024) return;
  req._aiNCtx = clamp(value, 1024, 1_000_000);
  persistObservedContext(req, req._aiNCtx).catch(() => {});
}

export function contextLengthFor(req, provider) {
  if (Number.isInteger(req?._aiNCtx) && req._aiNCtx >= 1024) {
    return clamp(req._aiNCtx, 1024, 1_000_000);
  }
  const header = Number(req?.headers?.['x-ai-context-length']);
  if (Number.isInteger(header) && header >= 1024) {
    return clamp(header, 1024, 1_000_000);
  }
  const name = String(provider || req?.headers?.['x-ai-provider'] || '').toLowerCase();
  if (name === 'localhost' || name === 'custom-endpoint') return DEFAULT_LOCAL_CTX;
  return DEFAULT_CLOUD_CTX;
}

export function contextBudget(nCtx) {
  const ctx = clamp(Number(nCtx) || DEFAULT_LOCAL_CTX, 1024, 1_000_000);
  const maxTokens = clamp(Math.floor(ctx * 0.32), 1024, 4096);
  const promptTokens = ctx - maxTokens - 48;
  return { nCtx: ctx, maxTokens, promptTokens };
}

function omitNote(count, unit) {
  return `\n\n... ${count} more ${unit} omitted to fit the model context. Do not invent omitted ${unit}.`;
}

export function clipStructuredReport(text, maxChars) {
  const source = String(text || '').trim();
  if (!source) return { text: '', truncated: false };
  if (source.length <= maxChars) return { text: source, truncated: false };

  const records = source.split(/\n(?=RECORD \d+)/);
  if (records.length > 1) {
    let body = records[0];
    for (let index = 1; index < records.length; index += 1) {
      const leftover = records.length - index;
      const next = `${body}\n${records[index]}`;
      const note = omitNote(leftover, leftover === 1 ? 'record' : 'records');
      if (next.length + note.length > maxChars) {
        return {
          text: `${body}${omitNote(leftover, leftover === 1 ? 'record' : 'records')}`.slice(0, maxChars),
          truncated: true,
        };
      }
      body = next;
    }
    return { text: body.slice(0, maxChars), truncated: body.length > maxChars };
  }

  const lines = source.split('\n');
  let body = '';
  for (let index = 0; index < lines.length; index += 1) {
    const leftover = lines.length - index;
    const next = body ? `${body}\n${lines[index]}` : lines[index];
    const note = omitNote(leftover, leftover === 1 ? 'line' : 'lines');
    if (next.length + note.length > maxChars) {
      return {
        text: `${body}${omitNote(leftover, leftover === 1 ? 'line' : 'lines')}`.slice(0, maxChars),
        truncated: true,
      };
    }
    body = next;
  }
  return { text: body.slice(0, maxChars), truncated: true };
}

export function clipUserMessageToContext(content, nCtx) {
  const budget = contextBudget(nCtx);
  const source = String(content || '');
  const marker = '--- REPORT CONTENT ---';
  const endMarker = '--- END REPORT ---';
  const start = source.indexOf(marker);
  if (start < 0) {
    return clipStructuredReport(source, charsForTokens(budget.promptTokens)).text;
  }

  const prefix = source.slice(0, start + marker.length);
  const rest = source.slice(start + marker.length);
  const end = rest.indexOf(endMarker);
  const report = (end >= 0 ? rest.slice(0, end) : rest).trim();
  const suffix = end >= 0 ? rest.slice(end) : '\n--- END REPORT ---\nReturn the JSON array now.';
  const reserved = estimateTokens(prefix) + estimateTokens(suffix);
  const reportChars = charsForTokens(Math.max(600, budget.promptTokens - reserved));
  const clipped = clipStructuredReport(report, reportChars);
  return `${prefix}\n${clipped.text}\n${suffix.replace(/^\n*/, '\n')}`;
}

export function shrinkChatOptions(options, nCtx) {
  const budget = contextBudget(nCtx);
  const messages = (options.messages || []).map((entry, index, list) => {
    if (entry?.role !== 'user' || index !== list.length - 1) return entry;
    return { ...entry, content: clipUserMessageToContext(entry.content, nCtx) };
  });
  return {
    ...options,
    messages,
    maxTokens: Math.min(Number(options.maxTokens) || budget.maxTokens, budget.maxTokens),
  };
}

export function clipPlainContent(text, nCtx, reservedTokens = 800) {
  const budget = contextBudget(nCtx);
  return clipStructuredReport(text, charsForTokens(Math.max(600, budget.promptTokens - reservedTokens))).text;
}

export function fitImportPrompt({ system = '', preamble = '', report = '', extra = '', nCtx }) {
  const budget = contextBudget(nCtx);
  const systemTokens = estimateTokens(system);
  const omit = '\n\n(Additional examples omitted to fit the model context. Do not invent work.)';
  let head = String(preamble || '');
  let extraText = String(extra || '');
  const maxHead = charsForTokens(Math.floor(budget.promptTokens * 0.3));
  const maxExtra = charsForTokens(Math.floor(budget.promptTokens * 0.2));
  if (head.length > maxHead) head = `${head.slice(0, maxHead)}${omit}`;
  if (extraText.length > maxExtra) extraText = `${extraText.slice(0, maxExtra)}${omit}`;

  const wrapper = () => `${head}${extraText}\n\n--- REPORT CONTENT ---\n\n--- END REPORT ---\nReturn the JSON array now.`;
  while (systemTokens + estimateTokens(wrapper()) > budget.promptTokens - 400) {
    if (extraText.length > 200) {
      extraText = `${extraText.slice(0, Math.floor(extraText.length * 0.7))}${omit}`;
    } else if (head.length > 400) {
      head = `${head.slice(0, Math.floor(head.length * 0.7))}${omit}`;
    } else {
      break;
    }
  }

  const reserved = systemTokens + estimateTokens(wrapper());
  const reportChars = charsForTokens(Math.max(600, budget.promptTokens - reserved));
  const clipped = clipStructuredReport(report, reportChars);
  return {
    userContent: `${head}${extraText}\n\n--- REPORT CONTENT ---\n${clipped.text}\n--- END REPORT ---\nReturn the JSON array now.`,
    report: clipped.text,
    truncated: clipped.truncated,
    maxTokens: budget.maxTokens,
    nCtx: budget.nCtx,
  };
}
