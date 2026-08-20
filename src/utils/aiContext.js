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
  const keep = text.match(/n_keep:\s*(\d+)/i);
  const ctx =
    text.match(/n_ctx:\s*(\d+)/i) ||
    text.match(
      /(?:maximum context length|max(?:imum)? context(?: length)?|context (?:window|length|size)|num_ctx|n_ctx is)\D{0,32}(\d{3,7})/i
    );
  if (ctx) {
    return { nCtx: Number(ctx[1]), nKeep: keep ? Number(keep[1]) : null };
  }
  if (/context length|too many tokens|maximum context|n_keep|prompt is too long|exceeds the context/i.test(text)) {
    return { nCtx: DEFAULT_LOCAL_CTX, nKeep: keep ? Number(keep[1]) : null };
  }
  return null;
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

export function importContextBudget(nCtx) {
  const ctx = clamp(Number(nCtx) || DEFAULT_LOCAL_CTX, 1024, 32768);
  const maxTokens = clamp(Math.max(1536, Math.floor(ctx * 0.28)), 1536, 4096);
  const promptTokens = Math.max(512, ctx - maxTokens - 48);
  return { nCtx: ctx, maxTokens, promptTokens };
}

function omitNote(count, unit) {
  return `\n\n... ${count} more ${unit} are in other windows. Use only the RECORD lines below. Do not invent omitted ${unit}.`;
}

function pickEven(items, count) {
  if (!items.length || count <= 0) return [];
  if (count >= items.length) return items.slice();
  if (count === 1) return [items[0]];
  const picked = [];
  const used = new Set();
  for (let step = 0; step < count; step += 1) {
    const index = Math.round((step * (items.length - 1)) / (count - 1));
    if (used.has(index)) continue;
    used.add(index);
    picked.push(items[index]);
  }
  return picked;
}

function pickRows(items, count, sample) {
  if (sample === 'prefix') return items.slice(0, Math.max(1, count));
  return pickEven(items, count);
}

function clipChunks(header, items, maxChars, unit, { sample = 'even' } = {}) {
  const note = (count) => (count > 0 ? omitNote(count, count === 1 ? unit : `${unit}s`) : '');
  const join = (rows, omitted) =>
    `${header}${header && rows.length ? '\n' : ''}${rows.join('\n')}${note(omitted)}`;
  const all = join(items, 0);
  if (all.length <= maxChars) return { text: all, truncated: false };

  const avg = Math.max(40, items.reduce((sum, row) => sum + String(row).length, 0) / Math.max(1, items.length));
  let count = Math.max(1, Math.min(items.length, Math.floor((maxChars - header.length - 80) / (avg + 1))));
  let rows = pickRows(items, count, sample);
  let text = join(rows, items.length - rows.length);
  while (text.length > maxChars && rows.length > 1) {
    count -= 1;
    rows = pickRows(items, count, sample);
    text = join(rows, items.length - rows.length);
  }
  if (text.length > maxChars) text = text.slice(0, maxChars);
  return { text, truncated: true };
}

export function clipStructuredReport(text, maxChars, { sample = 'even' } = {}) {
  const source = String(text || '').trim();
  if (!source) return { text: '', truncated: false };
  if (source.length <= maxChars) return { text: source, truncated: false };

  const records = source.split(/\n(?=RECORD \d+)/);
  if (records.length > 1) {
    return clipChunks(records[0], records.slice(1), maxChars, 'record', { sample });
  }

  const lines = source.split('\n');
  return clipChunks(lines[0] || '', lines.slice(1), maxChars, 'line', { sample });
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

function isWorkField(key) {
  const name = String(key || '').toLowerCase().trim();
  if (!name) return false;
  if (/^(assigned|status|priority|severity|platform|start|due|complete|completed|resource|column_\d+)$/i.test(name)) {
    return false;
  }
  if (/date$/.test(name)) return false;
  return /task|title|name|summary|bug|issue|desc|detail|feature|repro|request|feedback|suggest|note|comment|steps|expected|actual|problem/.test(
    name
  );
}

function isKeptImportField(key) {
  const name = String(key || '').toLowerCase().trim();
  if (/^(priority|severity|status|platform)$/i.test(name)) return true;
  return isWorkField(key);
}

function compactRecordLine(line) {
  const text = String(line || '');
  if (!/^RECORD \d+/i.test(text)) return text;
  const parts = text.split(' | ');
  const head = [];
  const fields = [];
  const extras = [];
  for (const part of parts) {
    const piece = part.trim();
    if (/^RECORD \d+/i.test(piece) || /^sheet=/i.test(piece)) {
      head.push(piece);
      continue;
    }
    const splitAt = piece.indexOf(': ');
    if (splitAt < 0) continue;
    const key = piece.slice(0, splitAt).trim();
    const value = piece
      .slice(splitAt + 2)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 140);
    if (!value) continue;
    if (isKeptImportField(key)) fields.push(`${key}: ${value}`);
    else extras.push(`${key}: ${value}`);
  }
  if (!fields.length) {
    fields.push(...extras.slice(0, 3));
  }
  return fields.length ? `${head.join(' | ')} | ${fields.join(' | ')}` : text;
}

function compactImportSource(text) {
  return String(text || '')
    .split('\n')
    .map((line) => compactRecordLine(line))
    .join('\n');
}

function joinWindow(header, rows) {
  const head = compactWindowHeader(header);
  return `${head}${head && rows.length ? '\n' : ''}${rows.join('\n')}`;
}

function compactWindowHeader(header) {
  return String(header || '')
    .split('\n')
    .filter((line) => line && !/^HOW TO READ:/i.test(line))
    .map((line) => {
      if (!/^COLUMNS:/i.test(line)) return line;
      const cols = line
        .replace(/^COLUMNS:\s*/i, '')
        .split(',')
        .map((col) => col.trim())
        .filter((col) => isKeptImportField(col));
      return cols.length ? `COLUMNS: ${cols.join(', ')}` : line;
    })
    .join('\n');
}

function packConsecutiveWindows(header, items, maxChars) {
  const bins = [];
  let current = [];
  const fits = (rows) => rows.length > 0 && joinWindow(header, rows).length <= maxChars;

  for (const item of items) {
    const next = [...current, item];
    if (current.length && !fits(next)) {
      bins.push(joinWindow(header, current));
      if (fits([item])) {
        current = [item];
      } else {
        const clipped = clipChunks(header, [item], maxChars, 'record', { sample: 'prefix' });
        if (clipped.text) bins.push(clipped.text.replace(/\n\n\.\.\. \d+ more records are in other windows\./i, ''));
        current = [];
      }
    } else {
      current = next;
    }
  }
  if (current.length) bins.push(joinWindow(header, current));
  return bins.filter(Boolean);
}

function sheetOfRecord(row) {
  return String((String(row || '').match(/sheet=([^|]+)/i) || [])[1] || '').trim() || 'file';
}

function pickSpread(items, count) {
  if (!items.length || count <= 0) return [];
  if (count >= items.length) return items.slice();
  if (count === 1) return [items[Math.floor((items.length - 1) / 2)]];
  return pickEven(items, count);
}

function allocateSheetSlots(names, sizes, maxWindows) {
  if (!names.length) return [];
  if (names.length >= maxWindows) {
    return pickSpread(names, maxWindows).map((name) => ({ name, slots: 1 }));
  }
  const total = sizes.reduce((sum, size) => sum + size, 0) || 1;
  const alloc = names.map((name, index) => ({
    name,
    slots: 1,
    weight: sizes[index] / total,
  }));
  let left = maxWindows - names.length;
  while (left > 0) {
    alloc.sort((leftRow, rightRow) => rightRow.weight / leftRow.slots - leftRow.weight / rightRow.slots);
    alloc[0].slots += 1;
    left -= 1;
  }
  return alloc;
}

function splitDocumentItems(source) {
  const pageParts = String(source || '').split(/\n(?=HEADING:\s*(?:Page|Slide) )/i);
  if (pageParts.length > 1) {
    const first = pageParts[0].trim();
    if (/^HEADING:/i.test(first)) {
      return { header: '', items: pageParts };
    }
    return { header: pageParts[0].replace(/\n+$/, ''), items: pageParts.slice(1) };
  }
  const lines = String(source || '').split('\n');
  return { header: lines[0] || '', items: lines.slice(1) };
}

export function planImportWindows(text, nCtx, { maxWindows = 8 } = {}) {
  const source = compactImportSource(String(text || '').trim());
  if (!source) return [];
  const budget = importContextBudget(nCtx);
  const maxChars = charsForTokens(Math.max(600, Math.floor(budget.promptTokens * 0.72)));
  if (source.length <= maxChars) return [source];

  const records = source.split(/\n(?=RECORD \d+)/);
  if (records.length > 1) {
    const header = records[0];
    const items = records.slice(1);
    const groups = new Map();
    for (const item of items) {
      const name = sheetOfRecord(item);
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(item);
    }
    const names = [...groups.keys()];
    const sizes = names.map((name) => groups.get(name).length);
    const windows = [];
    for (const { name, slots } of allocateSheetSlots(names, sizes, maxWindows)) {
      const packed = packConsecutiveWindows(header, groups.get(name) || [], maxChars);
      windows.push(...pickSpread(packed, slots));
    }
    const limited = windows.length > maxWindows ? pickSpread(windows, maxWindows) : windows;
    return limited.length ? limited : [clipStructuredReport(source, maxChars, { sample: 'prefix' }).text];
  }

  const { header, items } = splitDocumentItems(source);
  if (!items.length) {
    return [clipStructuredReport(source, maxChars, { sample: 'prefix' }).text];
  }
  const packed = packConsecutiveWindows(header || 'FILE TYPE: document', items, maxChars);
  const limited = packed.length > maxWindows ? packed.slice(0, maxWindows) : packed;
  return limited.length ? limited : [clipStructuredReport(source, maxChars, { sample: 'prefix' }).text];
}

export function fitImportPrompt({ system = '', preamble = '', report = '', extra = '', nCtx, sample = 'prefix' }) {
  const budget = importContextBudget(nCtx);
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
  const clipped = clipStructuredReport(report, reportChars, { sample });
  return {
    userContent: `${head}${extraText}\n\n--- REPORT CONTENT ---\n${clipped.text}\n--- END REPORT ---\nReturn the JSON array now.`,
    report: clipped.text,
    truncated: clipped.truncated,
    maxTokens: budget.maxTokens,
    nCtx: budget.nCtx,
  };
}

export function overflowImportNotice({ nCtx, windowCount } = {}) {
  const windows = Number(windowCount) || 0;
  const ctx = Number(nCtx) || 0;
  if (windows <= 1) return '';
  const ctxLabel = ctx >= 10000 ? `${ctx.toLocaleString()} tokens` : '10,000 tokens';
  return `This file is larger than ${ctxLabel} of context. Import will read it in ${windows} parts and may take a long time. Loading a larger context on the server usually makes this faster and more complete.`;
}
