/**
 * Extract and repair JSON task arrays from LLM responses.
 * Local models often wrap JSON in markdown fences, think tags, or truncated output.
 */

const JSON_FENCE_REGEX = /```(?:json)?\s*([\s\S]*?)```/i;

function tryParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function stripModelFiller(raw) {
  return String(raw || '')
    .replace(/^\uFEFF/, '')
    .replace(/<(?:think|thinking|reasoning|reflection|thought)\b[^>]*>[\s\S]*?<\/(?:think|thinking|reasoning|reflection|thought)>/gi, ' ')
    .replace(/<(?:think|thinking|reasoning|reflection|thought)\b[^>]*>[\s\S]*/gi, ' ')
    .replace(/<\/(?:think|thinking|reasoning|reflection|thought)>/gi, ' ')
    .replace(/<\|[^|\n]{1,48}\|>/g, ' ')
    .replace(/```(?:json)?/gi, ' ')
    .replace(/^\s*(?:json|output|response)\s*[:\n]/i, ' ')
    .trim();
}

function extractBalancedFrom(source, start, openChar, closeChar) {
  if (start < 0 || start >= source.length || source[start] !== openChar) return null;

  let depth = 0;
  let inString = false;
  let quote = '';
  let escape = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (char === '\\') {
        escape = true;
        continue;
      }
      if (char === quote) inString = false;
      continue;
    }
    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      continue;
    }
    if (char === openChar) depth += 1;
    if (char === closeChar) {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  return source.slice(start);
}

function extractBalanced(text, openChar, closeChar) {
  const source = String(text || '');
  return extractBalancedFrom(source, source.indexOf(openChar), openChar, closeChar);
}

function extractBalancedArray(text) {
  return extractBalanced(text, '[', ']');
}

function extractBalancedObject(text) {
  return extractBalanced(text, '{', '}');
}

function looksLikeArrayStart(source, index) {
  const slice = source.slice(index, index + 48);
  return /^\[\s*(?:\{|"|\[|(?:null|true|false)\b|-?\d)/i.test(slice);
}

function extractArrayCandidates(text) {
  const source = String(text || '');
  const candidates = [];
  let inString = false;
  let escape = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (char === '\\') {
        escape = true;
        continue;
      }
      if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '[' && looksLikeArrayStart(source, index)) {
      const slice = extractBalancedFrom(source, index, '[', ']');
      if (slice && slice.length > 2) candidates.push(slice);
    }
  }

  return candidates.sort((left, right) => right.length - left.length);
}

function closeTruncatedJson(text) {
  let next = String(text || '').trim();
  if (!next) return next;

  let inString = false;
  let escape = false;
  for (const char of next) {
    if (escape) {
      escape = false;
      continue;
    }
    if (char === '\\' && inString) {
      escape = true;
      continue;
    }
    if (char === '"') inString = !inString;
  }
  if (inString) next += '"';

  const stack = [];
  inString = false;
  escape = false;
  for (const char of next) {
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (char === '\\') {
        escape = true;
        continue;
      }
      if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{' || char === '[') stack.push(char);
    if (char === '}' || char === ']') {
      const expected = char === '}' ? '{' : '[';
      if (stack[stack.length - 1] === expected) stack.pop();
    }
  }
  while (stack.length) {
    next += stack.pop() === '{' ? '}' : ']';
  }
  return next;
}

export function repairJsonSyntax(jsonLike) {
  return String(jsonLike || '')
    .replace(/,\s*]/g, ']')
    .replace(/,\s*}/g, '}')
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3');
}

function quoteBareValues(text) {
  let out = '';
  let inString = false;
  let escape = false;
  const source = String(text || '');

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      out += char;
      if (escape) {
        escape = false;
        continue;
      }
      if (char === '\\') {
        escape = true;
        continue;
      }
      if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char !== ':') {
      out += char;
      continue;
    }

    out += char;
    let cursor = index + 1;
    while (cursor < source.length && /\s/.test(source[cursor])) {
      out += source[cursor];
      cursor += 1;
    }
    if (cursor >= source.length) {
      index = cursor - 1;
      continue;
    }

    const next = source[cursor];
    if (
      next === '"' ||
      next === '{' ||
      next === '[' ||
      next === '-' ||
      (next >= '0' && next <= '9') ||
      source.slice(cursor, cursor + 4) === 'true' ||
      source.slice(cursor, cursor + 5) === 'false' ||
      source.slice(cursor, cursor + 4) === 'null'
    ) {
      index = cursor - 1;
      continue;
    }

    let end = cursor;
    const stopAt = ',}]\n';
    while (end < source.length && !stopAt.includes(source[end])) end += 1;
    const raw = source.slice(cursor, end).trimEnd();
    out += `"${raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    index = end - 1;
  }

  return out;
}

function repairLooseJson(text) {
  let next = String(text || '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\bNone\b/g, 'null')
    .replace(/\bTrue\b/g, 'true')
    .replace(/\bFalse\b/g, 'false')
    .replace(/\bundefined\b/g, 'null')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/}\s*{/g, '},{')
    .replace(/]\s*\[/g, '],[')
    .replace(/,\s*,+/g, ',')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ');
  if (!next.includes('"') && next.includes("'")) {
    next = next.replace(/'/g, '"');
  }
  next = repairJsonSyntax(next);
  next = quoteBareValues(next);
  return next;
}

function parseJsonCandidate(text) {
  if (!text) return null;
  const attempts = [text, repairLooseJson(text), closeTruncatedJson(repairLooseJson(text))];
  for (const attempt of attempts) {
    const parsed = tryParseJson(attempt);
    if (parsed) return parsed;
  }
  return null;
}

function looksLikeApproachArray(array) {
  if (!Array.isArray(array) || !array.length) return false;
  const objects = array.filter((item) => item && typeof item === 'object' && !Array.isArray(item));
  if (!objects.length) return false;
  if (objects.length < Math.max(1, Math.ceil(array.length * 0.5))) return false;
  return objects.some(
    (item) => item.title || item.task || item.name || item.summary || item.approach || item.action
  );
}

function unwrapTaskArray(parsed) {
  if (looksLikeApproachArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const nestedKeys = [
    'actionItems',
    'action_items',
    'tasks',
    'items',
    'approaches',
    'data',
    'result',
    'results',
    'output',
  ];
  for (const key of nestedKeys) {
    if (looksLikeApproachArray(parsed[key])) return parsed[key];
  }

  if (parsed.title || parsed.task || parsed.name || parsed.summary || parsed.approach) {
    return [parsed];
  }

  const nested = Object.values(parsed).find((value) => looksLikeApproachArray(value));
  return Array.isArray(nested) ? nested : null;
}

function thinkBlocks(raw) {
  const matches = String(raw || '').match(
    /<(?:think|thinking|reasoning|reflection|thought)\b[^>]*>[\s\S]*?<\/(?:think|thinking|reasoning|reflection|thought)>/gi
  );
  return matches || [];
}

function extractJsonLines(text) {
  const rows = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim().replace(/,$/, '');
    if (!trimmed.startsWith('{') || !trimmed.includes(':')) continue;
    const parsed = parseJsonCandidate(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) rows.push(parsed);
  }
  return rows.length ? rows : null;
}

const EXAMPLE_APPROACH_TITLES = new Set([
  'fix login timeout on mobile',
  'add csv export for reports',
  'connection ok',
]);

const APPROACH_STOP_TOKENS = new Set([
  'json',
  'array',
  'title',
  'priority',
  'description',
  'report',
  'item',
  'items',
  'action',
  'optional',
  'object',
  'objects',
  'output',
  'response',
  'markdown',
  'example',
  'examples',
  'content',
  'please',
  'should',
  'would',
  'could',
  'must',
  'with',
  'from',
  'this',
  'that',
  'have',
  'will',
]);

function isExampleApproachItem(item) {
  const title = String(item?.title ?? item?.task ?? item?.name ?? item ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return EXAMPLE_APPROACH_TITLES.has(title);
}

function isExampleOnlyArray(array) {
  if (!Array.isArray(array) || !array.length) return false;
  return array.every((item) => isExampleApproachItem(item));
}

function tokenizeApproach(text) {
  return (String(text || '').toLowerCase().match(/[a-z0-9]{5,}/g) || []).filter(
    (token) => !APPROACH_STOP_TOKENS.has(token)
  );
}

function isMetaApproachTitle(title) {
  const value = String(title || '').replace(/\s+/g, ' ').trim();
  if (!value) return true;
  if (value.length > 180) return true;
  if (EXAMPLE_APPROACH_TITLES.has(value.toLowerCase())) return true;
  if (
    /^(return only|output a json|do not\b|each item must|analyze the uploaded|reply with|example\b|json array|no markdown|first character|convert the previous|rewrite this as|keep the same work|product intelligence|prioritized action|here (is|are)|the (json|array|report)|i (will|need to|should|must)|let me|okay[,.]?|sure[,.]?)/i.test(
      value
    )
  ) {
    return true;
  }
  if (/"title"\s*:|"priority"\s*:|\bCALENDAR\b|\bPERMISSION:/i.test(value)) return true;
  if (
    /\b(I need to|Let me think|The user (asked|wants|said)|chain of thought|I'll produce JSON|as requested|following the rules|here is the json)\b/i.test(
      value
    )
  ) {
    return true;
  }
  return false;
}

function extractTaskList(text) {
  const items = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:\d+[.)]\s+|[-*•]\s+)(.{8,220})\s*$/);
    if (!match) continue;
    const title = match[1].replace(/^[*_]+|[*_]+$/g, '').trim();
    if (!title || isMetaApproachTitle(title)) continue;
    items.push({ title, priority: items.length < 1 ? 1 : items.length === 1 ? 2 : 3 });
  }
  return items.length >= 2 ? items : null;
}

/**
 * Strip common LLM artifacts and isolate a JSON array substring.
 * @param {string} raw
 * @returns {string | null}
 */
export function isolateJsonArray(raw) {
  if (!raw || typeof raw !== 'string') {
    return null;
  }

  const sources = [stripModelFiller(raw), String(raw).trim(), ...thinkBlocks(raw)];

  for (const source of sources) {
    if (!source) continue;
    const candidates = [];
    const fenced = source.match(JSON_FENCE_REGEX);
    if (fenced?.[1]) candidates.push(fenced[1].trim());
    candidates.push(source.trim());
    candidates.push(...extractArrayCandidates(source));
    const balancedArr = extractBalancedArray(source);
    if (balancedArr) candidates.push(balancedArr);
    const balancedObj = extractBalancedObject(source);
    if (balancedObj) candidates.push(balancedObj);

    const jsonLines = extractJsonLines(source);
    if (jsonLines?.length > 1) return JSON.stringify(jsonLines);

    for (const candidate of candidates) {
      const parsed = parseJsonCandidate(candidate);
      const array = unwrapTaskArray(parsed);
      if (array) return JSON.stringify(array);
    }
  }

  return null;
}

export function clampApproachPriority(value, index = 0) {
  const numeric = Number(value);
  if (numeric === 1 || numeric === 2 || numeric === 3) return numeric;
  if (Number.isFinite(numeric) && numeric > 3) return 3;
  if (Number.isFinite(numeric) && numeric < 1) return 1;
  const label = String(value || '').toLowerCase();
  if (/\b(critical|high|blocker|p1|severe)\b/.test(label)) return 1;
  if (/\b(medium|normal|p2|moderate)\b/.test(label)) return 2;
  if (/\b(low|minor|p3|trivial)\b/.test(label)) return 3;
  if (index <= 0) return 1;
  if (index === 1) return 2;
  return 3;
}

function normalizePriority(value, index) {
  return clampApproachPriority(value, index);
}

function normalizeActionItem(item, index) {
  if (typeof item === 'string') {
    const title = item.trim();
    if (!title || isMetaApproachTitle(title)) return null;
    return { title, priority: normalizePriority(null, index) };
  }

  if (item && typeof item === 'object') {
    const title =
      item.title ??
      item.task ??
      item.name ??
      item.summary ??
      item.approach ??
      item.action ??
      '';

    const description = item.description ?? item.detail ?? item.notes ?? item.why ?? '';
    const normalized = {
      title: String(title).trim(),
      description: description ? String(description).trim() : undefined,
      priority: normalizePriority(item.priority ?? item.rank ?? item.severity, index),
    };
    if (!normalized.title || isMetaApproachTitle(normalized.title)) return null;
    if (normalized.description && isMetaApproachTitle(normalized.description) && normalized.description.length > 80) {
      delete normalized.description;
    }
    return normalized;
  }

  return null;
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

function recordWorkTexts(reportContent) {
  const rows = [];
  for (const line of String(reportContent || '').split('\n')) {
    if (!/^RECORD \d+/i.test(line)) continue;
    const values = [];
    for (const part of line.split(' | ')) {
      const piece = part.trim();
      const splitAt = piece.indexOf(': ');
      if (splitAt < 0) continue;
      if (!isWorkField(piece.slice(0, splitAt).trim())) continue;
      values.push(piece.slice(splitAt + 2).toLowerCase());
    }
    const text = values.join(' ').replace(/\s+/g, ' ').trim();
    if (text) rows.push(text);
  }
  return rows;
}

function itemMentionsReport(item, reportContent) {
  const rows = recordWorkTexts(reportContent);
  const title = String(item?.title || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (!title) return false;
  if (!rows.length) {
    const labelText = (pattern) =>
      String(reportContent || '')
        .split('\n')
        .filter((line) => pattern.test(line))
        .map((line) => line.replace(/^[A-Z ]+:\s*/i, '').toLowerCase().replace(/\s+/g, ' ').trim())
        .filter(Boolean);
    const headings = labelText(/^(HEADING|SUBHEADING):/i);
    const blocks = labelText(/^(PARAGRAPH|LIST ITEM):/i);
    const isCaption = (block) => {
      if (!block || block.length > 72) return false;
      if (/^(page|slide)\s+\d+$/i.test(block)) return true;
      const words = block.split(/\s+/).filter(Boolean);
      return words.length <= 8 && /\b(list|table|overview|index|contents)$/i.test(block);
    };
    const workBlocks = blocks.filter((block) => !isCaption(block));
    const headingOnly =
      headings.some((heading) => {
        if (!heading || heading.length < 6) return false;
        if (heading === title) return true;
        if (title.length >= 8 && heading.includes(title)) return true;
        return heading.length >= 10 && title.includes(heading);
      }) && !workBlocks.some((block) => block.includes(title));
    if (headingOnly) return false;
    if (blocks.length) {
      return title.length >= 4 && workBlocks.some((block) => block.includes(title));
    }
    const fallback = String(reportContent || '').toLowerCase();
    if (fallback.length < 80) return true;
    return fallback.includes(title) || tokenizeApproach(title).filter((token) => fallback.includes(token)).length >= 2;
  }
  if (title.length >= 6 && rows.some((row) => row.includes(title))) return true;
  const tokens = tokenizeApproach(`${title} ${item.description || ''}`);
  if (!tokens.length) return false;
  const needed = Math.max(1, Math.ceil(Math.min(tokens.length, 5) * 0.6));
  return rows.some((row) => {
    const hits = tokens.filter((token) => row.includes(token));
    return hits.length >= needed;
  });
}

function filterApproaches(items, reportContent) {
  const usable = (Array.isArray(items) ? items : [])
    .map((item, index) => normalizeActionItem(item, index))
    .filter(Boolean);
  if (!usable.length) return [];

  const report = String(reportContent || '');
  if (report.length < 80) return usable.slice(0, 40);

  return usable.filter((item) => itemMentionsReport(item, report)).slice(0, 40);
}

function scoreApproachArray(rawItems, reportContent) {
  const items = Array.isArray(rawItems) ? rawItems : [];
  if (!items.length) return -1;
  let score = looksLikeApproachArray(items) ? 8 : -8;
  const priorities = [];
  for (const item of items) {
    if (item && typeof item === 'object' && !Array.isArray(item) && (item.title || item.task || item.name)) {
      score += 4;
    } else {
      score -= 3;
    }
    const priority = Number(item?.priority ?? item?.rank ?? item?.severity);
    if (priority === 1 || priority === 2 || priority === 3) score += 3;
    if (Number.isFinite(priority) && priority > 3) score -= 6;
    priorities.push(priority);
    if (EXAMPLE_APPROACH_TITLES.has(String(item?.title || '').toLowerCase())) score -= 12;
    if (itemMentionsReport(item, reportContent)) score += 2;
  }
  const sequential =
    priorities.length >= 4 &&
    priorities.every((value, index) => Number(value) === index + 1);
  if (sequential) score -= 24;
  if (items.length > 12) score -= items.length;
  const report = String(reportContent || '');
  if (report.length >= 80 && items.every((item) => !itemMentionsReport(item, reportContent))) {
    score -= 20;
  }
  return score;
}

function sliceFromJsonish(raw) {
  const source = String(raw || '');
  const matches = [...source.matchAll(/"(?:title|task|name|summary|approach)"\s*:/g)];
  if (!matches.length) return '';
  const titleAt = matches[matches.length - 1].index;
  const fromArr = source.lastIndexOf('[', titleAt);
  const fromObj = source.lastIndexOf('{', titleAt);
  const start = Math.max(fromArr, fromObj);
  return start >= 0 ? source.slice(start) : '';
}

function extractArrayNearTitle(raw) {
  const source = String(raw || '');
  const matches = [...source.matchAll(/"(?:title|task|name|summary|approach)"\s*:/g)];
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const titleAt = matches[index].index;
    for (let start = source.lastIndexOf('[', titleAt); start >= 0; start = source.lastIndexOf('[', start - 1)) {
      if (!looksLikeArrayStart(source, start)) continue;
      const parsed = parseJsonCandidate(extractBalancedFrom(source, start, '[', ']'));
      const array = unwrapTaskArray(parsed);
      if (array?.length && !isExampleOnlyArray(array)) return array;
    }
    const objStart = source.lastIndexOf('{', titleAt);
    if (objStart >= 0) {
      const parsed = parseJsonCandidate(extractBalancedFrom(source, objStart, '{', '}'));
      const array = unwrapTaskArray(parsed);
      if (array?.length && !isExampleOnlyArray(array)) return array;
    }
  }
  return null;
}

function collectTaskArrays(raw) {
  const arrays = [];
  const seen = new Set();
  const push = (value) => {
    const array = unwrapTaskArray(value);
    if (!Array.isArray(array) || !array.length || isExampleOnlyArray(array)) return;
    const key = JSON.stringify(array).slice(0, 800);
    if (seen.has(key)) return;
    seen.add(key);
    arrays.push(array);
  };

  const sources = [
    sliceFromJsonish(stripModelFiller(raw)),
    sliceFromJsonish(raw),
    stripModelFiller(raw),
    String(raw || '').trim(),
    ...thinkBlocks(raw).map((block) =>
      String(block)
        .replace(/^<(?:think|thinking|reasoning|reflection|thought)\b[^>]*>/i, ' ')
        .replace(/<\/(?:think|thinking|reasoning|reflection|thought)>$/i, ' ')
    ),
  ];
  for (const source of sources) {
    if (!source) continue;
    const candidates = [];
    const fenced = source.match(JSON_FENCE_REGEX);
    if (fenced?.[1]) candidates.push(fenced[1].trim());
    candidates.push(source.trim());
    candidates.push(...extractArrayCandidates(source));
    const balancedArr = extractBalancedArray(source);
    if (balancedArr) candidates.push(balancedArr);
    const balancedObj = extractBalancedObject(source);
    if (balancedObj) candidates.push(balancedObj);
    const jsonLines = extractJsonLines(source);
    if (jsonLines?.length) push(jsonLines);
    for (const candidate of candidates) {
      push(parseJsonCandidate(candidate));
    }
  }
  return arrays;
}

/**
 * Normalize a raw LLM response into an array of action item objects.
 * @param {string} rawResponse
 * @param {{ reportContent?: string }} [options]
 * @returns {Array<{ title: string, description?: string, priority?: number }>}
 */
export function extractActionItems(rawResponse, options = {}) {
  const reportContent = options.reportContent || '';
  const ranked = collectTaskArrays(rawResponse)
    .map((array) => ({
      raw: array,
      items: filterApproaches(array, reportContent),
    }))
    .filter((entry) => entry.items.length)
    .sort(
      (left, right) =>
        scoreApproachArray(right.raw, reportContent) - scoreApproachArray(left.raw, reportContent)
    );

  let parsed = ranked[0]?.items || null;
  const nearTitle = extractArrayNearTitle(rawResponse) || [];
  if (!parsed?.length) {
    parsed = filterApproaches(nearTitle, reportContent);
  }
  if (!parsed?.length && !reportContent) {
    parsed = filterApproaches(extractTaskList(stripModelFiller(rawResponse)) || [], reportContent);
  }

  if (!parsed?.length) {
    throw new Error('AI response did not contain a valid JSON array of tasks.');
  }

  return parsed.map((item, index) => ({
    ...item,
    priority: clampApproachPriority(item.priority, index),
  }));
}

function normalizeSuggestionKind(value) {
  const kind = String(value || '').toLowerCase();
  if (kind === 'step' || kind === 'procedure' || kind === 'todo') return 'step';
  if (kind === 'idea' || kind === 'standalone' || kind === 'suggestion') return 'idea';
  return '';
}

/**
 * Mark ordered to-do items as procedure steps. Standalone ideas stay unlabeled.
 * @param {Array<{ title: string, detail: string, kind?: string }>} items
 */
export function applyProcedureKinds(items) {
  const normalized = items.map((item) => ({
    ...item,
    kind: normalizeSuggestionKind(item.kind),
  }));
  const stepCount = normalized.filter((item) => item.kind === 'step').length;
  const ideaCount = normalized.filter((item) => item.kind === 'idea').length;

  if (stepCount >= 2) {
    let procedureIndex = 0;
    return normalized.map((item) => {
      if (item.kind !== 'step') {
        return { ...item, kind: 'idea', procedureIndex: null };
      }
      procedureIndex += 1;
      return { ...item, kind: 'step', procedureIndex };
    });
  }

  if (ideaCount === normalized.length && ideaCount > 0) {
    return normalized.map((item) => ({ ...item, kind: 'idea', procedureIndex: null }));
  }

  if (normalized.length === 3) {
    return normalized.map((item, index) => ({
      ...item,
      kind: 'step',
      procedureIndex: index + 1,
    }));
  }

  return normalized.map((item) => ({
    ...item,
    kind: item.kind || 'idea',
    procedureIndex: null,
  }));
}

/**
 * Normalize a raw LLM response into suggestion objects for one approach.
 * @param {string} rawResponse
 * @returns {Array<{ title: string, detail: string, kind: string, procedureIndex: number|null }>}
 */
export function extractSuggestions(rawResponse) {
  const isolated = isolateJsonArray(rawResponse);
  const parsed = isolated
    ? tryParseJson(isolated) || tryParseJson(repairJsonSyntax(isolated))
    : null;

  if (!Array.isArray(parsed)) {
    throw new Error('Unable to locate a JSON suggestion array in the AI response.');
  }

  const items = parsed
    .map((item) => {
      if (typeof item === 'string') {
        return { title: item.trim(), detail: '', kind: '' };
      }

      if (item && typeof item === 'object') {
        const title = item.title ?? item.suggestion ?? item.name ?? '';
        const detail = item.description ?? item.detail ?? item.why ?? '';
        return {
          title: String(title).trim(),
          detail: String(detail).trim(),
          kind: item.kind ?? item.type ?? item.role ?? '',
        };
      }

      return null;
    })
    .filter((item) => item && item.title.length > 0)
    .slice(0, 4);

  return applyProcedureKinds(items);
}

export function isolateJsonObject(raw) {
  const parsed = extractOverviewChoicePayload(raw);
  return parsed;
}

export function extractOverviewChoicePayload(raw) {
  const cleaned = stripModelFiller(raw);
  const fenced = String(raw || '').match(JSON_FENCE_REGEX);
  const candidates = [];
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  candidates.push(cleaned);
  const balanced = extractBalancedObject(cleaned);
  if (balanced) candidates.push(balanced);

  for (const candidate of candidates) {
    const parsed = parseJsonCandidate(candidate);
    if (!parsed) continue;
    if (Array.isArray(parsed)) {
      const object = parsed.find((entry) => entry && typeof entry === 'object' && !Array.isArray(entry));
      if (object) return object;
      continue;
    }
    if (typeof parsed === 'object') return parsed;
  }

  return null;
}

export default {
  isolateJsonArray,
  isolateJsonObject,
  extractOverviewChoicePayload,
  repairJsonSyntax,
  extractActionItems,
  extractSuggestions,
  clampApproachPriority,
};
