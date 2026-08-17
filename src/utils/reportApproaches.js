import { clampApproachPriority } from './jsonRepair.js';

/** AI extraction cap per High/Med/Low. Not a user or billing limit. */
export const MAX_APPROACHES_PER_PRIORITY = 10;

const TITLE_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'for',
  'from',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

export function normalizeFileName(fileName) {
  return String(fileName || '')
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .toLowerCase();
}

export function fileNameStem(fileName) {
  return normalizeFileName(fileName)
    .replace(/\.[^.]+$/, '')
    .replace(/\s*\(\d+\)\s*$/, '')
    .replace(/\s*[-–—]\s*copy$/i, '')
    .replace(/\s+copy$/i, '')
    .trim();
}

export function normalizeReportContent(content) {
  return String(content || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 500_000);
}

export function contentFingerprint(content) {
  return normalizeReportContent(content)
    .replace(/^(FILE TYPE|HOW TO READ|COLUMNS|SHEET):.*$/gim, '')
    .replace(/\s*\([^)]*=[^)]*\)/g, '')
    .replace(/\s*\[(?:not calculated|text formula)\]/gi, '')
    .replace(/RECORD \d+/gi, 'RECORD')
    .replace(/[^a-z0-9\n]+/gi, ' ')
    .toLowerCase()
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

export function approachKey(item) {
  return String(item?.title || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function compactTitle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function approachTokens(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/s$/, ''))
    .filter((token) => token.length > 1 && !TITLE_STOP_WORDS.has(token));
}

export function approachesMatch(left, right) {
  const leftKey = approachKey(left);
  const rightKey = approachKey(right);
  if (!leftKey || !rightKey) return false;
  if (leftKey === rightKey) return true;

  const leftCompact = compactTitle(leftKey);
  const rightCompact = compactTitle(rightKey);
  if (leftCompact && leftCompact === rightCompact) return true;

  const leftTokens = approachTokens(leftKey);
  const rightTokens = approachTokens(rightKey);
  if (!leftTokens.length || !rightTokens.length) return false;
  if (leftTokens.join(' ') === rightTokens.join(' ')) return true;

  const rightSet = new Set(rightTokens);
  const overlap = leftTokens.filter((token) => rightSet.has(token)).length;
  if (!overlap) return false;

  const union = new Set([...leftTokens, ...rightTokens]).size;
  const jaccard = overlap / union;
  const containment = overlap / Math.min(leftTokens.length, rightTokens.length);
  const lengthGap = Math.abs(leftTokens.length - rightTokens.length);

  if (jaccard >= 0.78) return true;
  if (containment >= 0.86 && lengthGap <= 2 && overlap >= 2) return true;
  return false;
}

function tokenList(text) {
  return String(text || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function jaccardFromSets(left, right) {
  if (!left.size && !right.size) return 1;
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  for (const item of small) {
    if (large.has(item)) overlap += 1;
  }
  return overlap / (left.size + right.size - overlap);
}

function shingleSet(tokens, size = 3) {
  const shingles = new Set();
  if (tokens.length < size) {
    if (tokens.length) shingles.add(tokens.join(' '));
    return shingles;
  }
  const step = tokens.length > 6000 ? Math.ceil(tokens.length / 3000) : 1;
  for (let index = 0; index <= tokens.length - size; index += step) {
    shingles.add(tokens.slice(index, index + size).join(' '));
  }
  return shingles;
}

function contentSimilarity(leftText, rightText) {
  const leftTokens = tokenList(leftText);
  const rightTokens = tokenList(rightText);
  const unigram = jaccardFromSets(new Set(leftTokens), new Set(rightTokens));
  const shingle = jaccardFromSets(shingleSet(leftTokens), shingleSet(rightTokens));
  return Math.max(unigram, shingle);
}

function sizeClose(left, right, ratio = 0.1) {
  const a = Number(left) || 0;
  const b = Number(right) || 0;
  if (a <= 0 || b <= 0) return false;
  return Math.abs(a - b) / Math.max(a, b) <= ratio;
}

function priorityOf(item, index = 0) {
  return clampApproachPriority(item?.priority, index);
}

export function remainingPrioritySlots(existingItems = [], { countCompleted = true } = {}) {
  const counts = { 1: 0, 2: 0, 3: 0 };
  for (const item of existingItems) {
    if (!countCompleted && item?.completed) continue;
    const priority = priorityOf(item);
    counts[priority] += 1;
  }
  return {
    1: Math.max(0, MAX_APPROACHES_PER_PRIORITY - counts[1]),
    2: Math.max(0, MAX_APPROACHES_PER_PRIORITY - counts[2]),
    3: Math.max(0, MAX_APPROACHES_PER_PRIORITY - counts[3]),
  };
}

export function totalRemainingSlots(remaining) {
  return (remaining?.[1] || 0) + (remaining?.[2] || 0) + (remaining?.[3] || 0);
}

export function atPriorityCap(existingItems = []) {
  const remaining = remainingPrioritySlots(existingItems, { countCompleted: true });
  return remaining[1] <= 0 || remaining[2] <= 0 || remaining[3] <= 0;
}

export function allApproachesComplete(existingItems = []) {
  return existingItems.length > 0 && existingItems.every((item) => item.completed);
}

export function selectNewApproaches(candidates, existingItems = [], { countCompleted = true } = {}) {
  const known = [...(existingItems || [])];
  const remaining = remainingPrioritySlots(existingItems, { countCompleted });
  const accepted = [];
  let truncated = false;

  for (const [index, item] of (Array.isArray(candidates) ? candidates : []).entries()) {
    const title = String(item?.title || '').trim();
    if (!title || known.some((row) => approachesMatch(item, row))) continue;
    const priority = priorityOf(item, index);
    if (remaining[priority] <= 0) {
      truncated = true;
      continue;
    }
    remaining[priority] -= 1;
    const next = {
      title,
      description: item.description ? String(item.description).trim() : undefined,
      priority,
    };
    known.push(next);
    accepted.push(next);
  }

  return { accepted, truncated, remaining };
}

export async function findMatchingReport(prisma, projectId, fileName, content, options = {}) {
  const reports = await prisma.uploadedReport.findMany({
    where: { projectId },
    include: { actionItems: true },
    orderBy: { createdAt: 'desc' },
  });
  const name = normalizeFileName(fileName);
  const stem = fileNameStem(fileName);
  const incomingSize = Number(options.fileSize) || 0;
  const incomingNormalized = normalizeReportContent(content);
  const incomingFingerprint = contentFingerprint(content);

  for (const report of reports) {
    const reportName = normalizeFileName(report.fileName);
    const sameName = reportName === name;
    const sameStem = fileNameStem(report.fileName) === stem && Boolean(stem);
    const sameSize = incomingSize > 0 && Number(report.fileSize) === incomingSize;
    const storedNormalized = normalizeReportContent(report.rawContent);
    const storedFingerprint = contentFingerprint(report.rawContent);

    if (sameName && storedNormalized === incomingNormalized) return report;
    if ((sameName || sameStem) && storedFingerprint && storedFingerprint === incomingFingerprint) {
      return report;
    }
    if (sameName && sameSize) {
      if (!incomingFingerprint || !storedFingerprint) return report;
      const sizeScore = contentSimilarity(incomingFingerprint, storedFingerprint);
      if (sizeScore >= 0.42) return report;
    }

    const score = contentSimilarity(incomingFingerprint, storedFingerprint);
    const closeSize = sizeClose(incomingSize, report.fileSize);

    if (sameName && score >= 0.8) return report;
    if (sameStem && (sameSize || score >= 0.9)) return report;
    if (score >= 0.97 && closeSize) return report;
  }

  return null;
}
