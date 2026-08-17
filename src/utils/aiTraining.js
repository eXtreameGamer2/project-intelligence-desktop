import { resolveDatabaseConfig } from '../db/config.js';
import { clampApproachPriority } from './jsonRepair.js';

const MAX_STORED = 40;
const MAX_TIMING = 30;
const INPUT_CHARS = 2500;
const RECENT_WINDOW = 16;

export const JOB_TIMING_KIND = 'job-timing';

let schemaReady = false;

export const MIN_MULTI_PASS_COUNT = 2;
export const MAX_MULTI_PASS_COUNT = 8;
export const DEFAULT_MULTI_PASS_COUNT = 3;

export function isLocalTrainingEnabled(req) {
  const provider = String(req?.headers?.['x-ai-provider'] || '').toLowerCase();
  const flag = String(req?.headers?.['x-ai-local-training'] || '').trim().toLowerCase();
  return provider === 'localhost' && (flag === '1' || flag === 'true' || flag === 'yes');
}

function truthyHeader(value) {
  const flag = String(value || '').trim().toLowerCase();
  return flag === '1' || flag === 'true' || flag === 'yes';
}

export function isMultiPassImportEnabled(req) {
  return isLocalTrainingEnabled(req) && truthyHeader(req?.headers?.['x-ai-multi-pass']);
}

export function multiPassImportCount(req) {
  const raw = Number(req?.headers?.['x-ai-multi-pass-count']);
  if (!Number.isInteger(raw)) return DEFAULT_MULTI_PASS_COUNT;
  return Math.min(MAX_MULTI_PASS_COUNT, Math.max(MIN_MULTI_PASS_COUNT, raw));
}

export function looksLikeCorrection(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  return (
    /\b(you (got|have) (that|this|it) wrong|that('?s| is) (wrong|incorrect|not (right|what|accurate|true|correct|helpful|useful|preferable|preferred))|you (misunderstood|misread|misinterpreted|mixed up|confused)|not what i (meant|said|asked|wanted)|i (didn'?t|did not) (say|mean|ask|want)|incorrectly understood|you are wrong|you'?re wrong|wrong (project|item|approach|report|priority)|don'?t (do|say) that again|avoid that mistake)\b/i.test(
      value
    ) ||
    /\b(not (preferable|preferred|helpful|useful)|i don'?t (like|want) (that|this)|too (generic|vague|broad|fluffy|wordy)|be more (specific|concrete|direct)|that('?s| is) unhelpful|prefer .{0,60}(instead|instead of)|do( not|n'?t) (talk|sound) like (that|a coach))\b/i.test(
      value
    ) ||
    (/\b(misunderstood|misread|misinterpreted|mistake)\b/i.test(value) &&
      /\b(you|your)\b/i.test(value))
  );
}

export function lastAssistantContent(history = []) {
  for (let index = (history || []).length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (entry?.role === 'assistant' && String(entry.content || '').trim()) {
      return String(entry.content).trim();
    }
  }
  return '';
}

export function correctionInstruction(userMessage) {
  if (!looksLikeCorrection(userMessage)) return '';
  return `\n\nThe latest user message is a correction: a previous reply was incorrectly understood. Do not defend that reply. Name the mistake briefly, lock in their intended meaning, answer from that meaning, and do not repeat the error.`;
}

export function exampleBudgetForAccuracy(accuracy, { nCtx, dumpCount, kind } = {}) {
  let budget = 6;
  if (accuracy >= 0.85) budget = 1;
  else if (accuracy >= 0.6) budget = 3;

  if (kind === 'overview-feed') {
    budget = accuracy >= 0.85 ? 3 : Math.max(budget, 4);
  }

  const ctx = Number(nCtx);
  if (Number.isInteger(ctx) && ctx <= 4096) budget = Math.min(budget, kind === 'overview-feed' ? 2 : 1);
  else if (Number.isInteger(ctx) && ctx <= 8192) budget = Math.min(budget, accuracy >= 0.6 ? (kind === 'overview-feed' ? 3 : 1) : 3);

  if (Number(dumpCount) >= 2) budget = Math.min(3, Math.max(budget, 2));
  return budget;
}

function compactItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .slice(0, 10)
    .map((item) => ({
      title: String(item.title || '').trim(),
      description: item.description ? String(item.description).trim() : undefined,
      priority: clampApproachPriority(item.priority),
    }))
    .filter((item) => item.title);
}

function trainingDelegate(prisma) {
  return prisma?.aiTrainingExample || null;
}

function parseTrainingOutput(raw) {
  try {
    const value = JSON.parse(String(raw || ''));
    if (Array.isArray(value)) return { type: 'accepted', items: value };
    if (value && typeof value === 'object') {
      return value.type ? value : { type: 'accepted', ...value };
    }
  } catch {
    // Plain text preferred replies from older rows.
  }
  const text = String(raw || '').trim();
  return text ? { type: 'preferred', reply: text } : null;
}

function scoreAccuracy(rows = []) {
  const usable = (rows || []).filter((row) => parseTrainingOutput(row.outputJson)?.type !== 'timing');
  if (!usable.length) return 0.5;
  const misses = usable.filter((row) => {
    const type = parseTrainingOutput(row.outputJson)?.type;
    return type === 'correction' || type === 'unresolved-error';
  }).length;
  return Math.max(0, Math.min(1, 1 - misses / usable.length));
}

function discussReplyText(parsed) {
  return String(parsed?.reply || '').trim();
}

export function isWeakOverviewReply(reply) {
  const value = String(reply || '').trim();
  if (!value) return true;
  if (value.length < 50 || value.length > 1600) return true;
  if (/I can'?t do that from (Overview|this approach thread)/i.test(value)) return true;
  if (/Confirmed\. Those schedule changes are on the calendar/i.test(value)) return true;
  if (/Okay — I left the calendar as it is/i.test(value)) return true;
  const named =
    /\*\*[^*]{2,80}\*\*/.test(value) ||
    /\bopen=\d+\b|\b\d+ open\b|\b\d+\s+high\b|\bstaleDays=\d+/i.test(value);
  const fluffy = /\b(portfolio operations coach|hottest queue|as a coach|I would recommend (focusing|starting|considering)|consider focusing on|leverage (the )?(portfolio|synerg))/i.test(
    value
  );
  if (fluffy && !named) return true;
  if (!named && !/\b(because|open|stale|backed|high|medium|low)\b/i.test(value)) return true;
  return false;
}

function scoreDiscussGuide(row, kind) {
  const parsed = row?.parsed;
  if (!parsed) return 0;
  if (parsed.afterCorrection) return 4;
  if (parsed.type === 'preferred') return 3;
  if (kind === 'overview-feed' && isWeakOverviewReply(discussReplyText(parsed))) return 0;
  if (parsed.type === 'accepted') return 2;
  return 1;
}

function pickExamples(rows, budget, kind = 'report-parse') {
  const parsed = rows.map((row) => ({
    ...row,
    parsed: parseTrainingOutput(row.outputJson),
  }));
  const corrections = parsed.filter((row) => row.parsed?.type === 'correction');
  const repairs = parsed.filter((row) => row.parsed?.type === 'solved-error');
  const unresolved = parsed.filter((row) => row.parsed?.type === 'unresolved-error');
  const rest = parsed
    .filter(
      (row) =>
        row.parsed?.type !== 'correction' &&
        row.parsed?.type !== 'solved-error' &&
        row.parsed?.type !== 'unresolved-error' &&
        row.parsed?.type !== 'timing'
    )
    .sort((left, right) => scoreDiscussGuide(right, kind) - scoreDiscussGuide(left, kind));
  return [...corrections, ...unresolved, ...repairs, ...rest].slice(0, budget);
}

async function createKindIndex(prisma) {
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "AiTrainingExample_userId_kind_idx" ON "AiTrainingExample"("userId", "kind")`
  );
}

export async function ensureTrainingSchema(prisma) {
  if (schemaReady || !prisma) return;
  const { provider } = resolveDatabaseConfig();

  try {
    if (provider === 'postgresql') {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "AiTrainingExample" (
          "id" TEXT NOT NULL,
          "userId" TEXT NOT NULL,
          "projectId" TEXT,
          "kind" TEXT NOT NULL DEFAULT 'report-parse',
          "inputExcerpt" TEXT NOT NULL,
          "outputJson" TEXT NOT NULL,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "AiTrainingExample_pkey" PRIMARY KEY ("id")
        )
      `);
      await prisma.$executeRawUnsafe(`
        DO $$ BEGIN
          ALTER TABLE "AiTrainingExample"
            ADD CONSTRAINT "AiTrainingExample_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$
      `);
      await prisma.$executeRawUnsafe(`
        DO $$ BEGIN
          ALTER TABLE "AiTrainingExample"
            ADD CONSTRAINT "AiTrainingExample_projectId_fkey"
            FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$
      `);
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "AiTrainingExample_userId_createdAt_idx" ON "AiTrainingExample"("userId", "createdAt")`
      );
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "AiTrainingExample_projectId_idx" ON "AiTrainingExample"("projectId")`
      );
      await createKindIndex(prisma);
    } else {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "AiTrainingExample" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "userId" TEXT NOT NULL,
          "projectId" TEXT,
          "kind" TEXT NOT NULL DEFAULT 'report-parse',
          "inputExcerpt" TEXT NOT NULL,
          "outputJson" TEXT NOT NULL,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
          FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
        )
      `);
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "AiTrainingExample_userId_createdAt_idx" ON "AiTrainingExample"("userId", "createdAt")`
      );
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "AiTrainingExample_projectId_idx" ON "AiTrainingExample"("projectId")`
      );
      await createKindIndex(prisma);
    }
    schemaReady = true;
  } catch (error) {
    console.warn('[ai-training] schema ensure failed:', error.message);
  }
}

export function formatTrainingPrompt(examples = [], { kind = 'report-parse' } = {}) {
  if (!examples.length) return '';

  const corrections = [];
  const repairs = [];
  const unresolved = [];
  const guides = [];

  for (const example of examples) {
    const parsed = parseTrainingOutput(example.outputJson);
    const input = String(example.inputExcerpt || '').trim().slice(0, INPUT_CHARS);
    if (parsed?.type === 'timing') {
      continue;
    } else if (parsed?.type === 'correction') {
      corrections.push(
        `MISTAKE:\n${String(parsed.mistake || input).slice(0, INPUT_CHARS)}\nUSER CORRECTION:\n${String(parsed.userCorrection || '').slice(0, 800)}`
      );
    } else if (parsed?.type === 'solved-error') {
      repairs.push(
        `INVALID REPLY CLASS: ${parsed.errorClass || 'parse'}\nINVALID REPLY:\n${String(parsed.mistake || input).slice(0, 800)}\nVALID REPAIR SHAPE:\n${JSON.stringify(parsed.items || [])}\nDo not copy those titles unless the new report actually contains that work.`
      );
    } else if (parsed?.type === 'unresolved-error') {
      const discuss = kind === 'project-discuss' || kind === 'overview-feed';
      unresolved.push(
        discuss
          ? `This reply class stayed invalid: ${parsed.errorClass || 'dump'}. Do not paste thinking, JSON schemas, PERMISSION lines, or CALENDAR/APPROACH dumps to the user. Write a short plain reply. If they asked for a calendar change, put real CALENDAR JSON after the reply. If they asked to delete an approach, put real APPROACH JSON after the reply.`
          : `This reply class stayed invalid after a repair attempt: ${parsed.errorClass || 'parse'}. Do not repeat that shape. Return a JSON array from the report only, or [].`
      );
    } else if (Array.isArray(parsed?.items) || kind === 'report-parse') {
      const output = parsed?.items
        ? JSON.stringify(parsed.items)
        : String(example.outputJson || '').trim();
      guides.push(`EXAMPLE INPUT:\n${input}\nEXAMPLE OUTPUT:\n${output}`);
    } else {
      const reply = String(parsed?.reply || example.outputJson || '').trim();
      if (reply) guides.push(`PREFERRED REPLY AFTER:\n${input}\nREPLY:\n${reply.slice(0, INPUT_CHARS)}`);
    }
  }

  const parts = [];
  if (corrections.length) {
    parts.push(
      `The user said these replies were incorrectly understood. Do not repeat them. Correct the same class of mistake if it appears again.\n\n${corrections.join('\n\n')}`
    );
  }
  if (unresolved.length) {
    parts.push(
      `These reply shapes could not be repaired. Do not produce them. Do not invent approaches to escape the error.\n\n${unresolved.join('\n\n')}`
    );
  }
  if (repairs.length) {
    parts.push(
      `These invalid replies were repaired by re-reading the report, not by inventing work. If the same class of error appears, discard the bad reply and extract only evidenced report work.\n\n${repairs.join('\n\n')}`
    );
  }
  if (guides.length) {
    const guideIntro =
      kind === 'report-parse'
        ? 'Use these accepted examples as style guides. Match their title wording and priority scale. The new report is labeled text (RECORD fields or HEADING/PARAGRAPH blocks). Do not copy an example unless the new report actually contains that work. Do not copy FILE TYPE or RECORD labels into titles.'
        : kind === 'overview-feed'
          ? 'Use these accepted portfolio-feed replies as the preferred style. Match how they name real projects, use briefing counts, and give a short ranked do-next. Do not copy a generic coach recap. Do not invent projects or work that is not in this visit\'s briefing.'
          : 'Use these accepted project replies as accuracy guides. Match how this user wants this approach discussed.';
    parts.push(`${guideIntro}\n\n${guides.join('\n\n')}`);
  }

  return parts.length ? `\n\n${parts.join('\n\n')}` : '';
}

export async function loadTrainingExamples(
  prisma,
  { userId, projectId, kind = 'report-parse', limit, nCtx, dumpCount } = {}
) {
  if (!userId) return [];

  try {
    await ensureTrainingSchema(prisma);
    const examples = trainingDelegate(prisma);
    let stored = [];

    if (examples) {
      stored = await examples.findMany({
        where: {
          userId,
          ...(kind === 'report-parse'
            ? { kind: { in: [kind, 'error-mitigate'] } }
            : { kind }),
          ...(kind === 'project-discuss' && projectId
            ? { OR: [{ projectId }, { projectId: null }] }
            : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: RECENT_WINDOW,
      });
    }

    const accuracy = scoreAccuracy(stored);
    const budget = Number.isInteger(limit)
      ? limit
      : exampleBudgetForAccuracy(accuracy, { nCtx, dumpCount, kind });
    return stored.length ? pickExamples(stored, budget, kind) : [];
  } catch (error) {
    console.warn('[ai-training] load failed:', error.message);
    return [];
  }
}

export async function deleteTrainingExamples(prisma, userId) {
  if (!userId) return { deleted: 0 };

  try {
    await ensureTrainingSchema(prisma);
    const examples = trainingDelegate(prisma);
    if (!examples) return { deleted: 0 };
    const result = await examples.deleteMany({ where: { userId } });
    return { deleted: Number(result?.count) || 0 };
  } catch (error) {
    console.warn('[ai-training] delete failed:', error.message);
    throw error;
  }
}

async function pruneTrainingExamples(prisma, userId, kind) {
  const examples = trainingDelegate(prisma);
  if (!examples) return;
  const cap = kind === JOB_TIMING_KIND ? MAX_TIMING : MAX_STORED;
  const extra = await examples.findMany({
    where: { userId, ...(kind ? { kind } : {}) },
    orderBy: { createdAt: 'desc' },
    skip: cap,
    select: { id: true },
  });
  if (extra.length) {
    await examples.deleteMany({
      where: { id: { in: extra.map((row) => row.id) } },
    });
  }
}

export async function recordTrainingExample(
  prisma,
  { userId, projectId, kind = 'report-parse', input, items, output } = {}
) {
  const excerpt = String(input || '').trim().slice(0, INPUT_CHARS);
  const outputJson = items
    ? JSON.stringify(compactItems(items))
    : typeof output === 'string'
      ? output
      : JSON.stringify(output || {});
  if (!userId || !excerpt || !String(outputJson || '').trim() || outputJson === '{}') {
    return null;
  }
  if (items && !compactItems(items).length) return null;

  try {
    await ensureTrainingSchema(prisma);
    const examples = trainingDelegate(prisma);
    if (!examples) return null;

    const created = await examples.create({
      data: {
        userId,
        projectId: projectId || null,
        kind,
        inputExcerpt: excerpt,
        outputJson,
      },
    });

    await pruneTrainingExamples(prisma, userId, kind);
    return created;
  } catch (error) {
    console.warn('[ai-training] record failed:', error.message);
    return null;
  }
}

function clampTimingMs(ms) {
  const value = Math.round(Number(ms) || 0);
  if (!Number.isFinite(value) || value < 1500) return 0;
  return Math.min(value, 12 * 60 * 1000);
}

function timingFeatures(value = {}) {
  return {
    job: String(value.job || 'chat').trim() || 'chat',
    inputChars: Math.max(0, Number(value.inputChars) || 0),
    fileBytes: Math.max(0, Number(value.fileBytes) || 0),
    passCount: Math.max(1, Number(value.passCount) || 1),
    elapsedMs: clampTimingMs(value.elapsedMs),
  };
}

export function predictJobMs(samples = [], features = {}) {
  const target = timingFeatures(features);
  const usable = (Array.isArray(samples) ? samples : [])
    .map((row) => {
      const parsed = row?.parsed || parseTrainingOutput(row?.outputJson || row);
      if (parsed?.type !== 'timing') return null;
      const sample = timingFeatures(parsed);
      if (!sample.elapsedMs) return null;
      const sameJob = sample.job === target.job ? 1 : 0.45;
      const sizeRatio =
        (target.inputChars + target.fileBytes / 8 + 1) /
        (sample.inputChars + sample.fileBytes / 8 + 1);
      const passRatio = target.passCount / sample.passCount;
      const similarity =
        sameJob / (1 + Math.abs(Math.log(Math.max(sizeRatio, 0.05))) * 0.85);
      if (similarity < 0.12) return null;
      return {
        predicted: sample.elapsedMs * sizeRatio * passRatio,
        similarity,
      };
    })
    .filter(Boolean);

  if (!usable.length) return null;
  const weight = usable.reduce((sum, row) => sum + row.similarity, 0);
  if (weight <= 0) return null;
  return Math.round(usable.reduce((sum, row) => sum + row.predicted * row.similarity, 0) / weight);
}

export async function loadJobTimingEstimate(prisma, userId, features = {}) {
  if (!userId) return null;
  try {
    await ensureTrainingSchema(prisma);
    const examples = trainingDelegate(prisma);
    if (!examples) return null;
    const stored = await examples.findMany({
      where: { userId, kind: JOB_TIMING_KIND },
      orderBy: { createdAt: 'desc' },
      take: MAX_TIMING,
    });
    return predictJobMs(stored, features);
  } catch (error) {
    console.warn('[ai-training] timing load failed:', error.message);
    return null;
  }
}

export async function recordJobTiming(prisma, { userId, ...features } = {}) {
  const sample = timingFeatures(features);
  if (!userId || !sample.elapsedMs) return null;
  return recordTrainingExample(prisma, {
    userId,
    kind: JOB_TIMING_KIND,
    input: `${sample.job}:${sample.fileBytes}:${sample.inputChars}:${sample.passCount}`,
    output: { type: 'timing', ...sample },
  });
}

export async function maybeRecordAccepted(
  prisma,
  { userId, projectId, kind = 'report-parse', input, items, output, force = false } = {}
) {
  if (force) {
    return recordTrainingExample(prisma, { userId, projectId, kind, input, items, output });
  }

  try {
    await ensureTrainingSchema(prisma);
    const examples = trainingDelegate(prisma);
    if (!examples) return null;
    const recent = await examples.findMany({
      where: { userId, kind },
      orderBy: { createdAt: 'desc' },
      take: RECENT_WINDOW,
    });
    const accuracy = scoreAccuracy(recent);
    if (kind === 'overview-feed') {
      const quality = recent.filter((row) => {
        const parsed = parseTrainingOutput(row.outputJson);
        const text = discussReplyText(parsed);
        return (
          (parsed?.type === 'preferred' || parsed?.type === 'accepted') &&
          text &&
          !isWeakOverviewReply(text)
        );
      });
      const corrected = recent.some((row) => parseTrainingOutput(row.outputJson)?.afterCorrection);
      if (accuracy >= 0.85 && quality.length >= 3 && corrected) return null;
    } else {
      const acceptedCount = recent.filter(
        (row) => parseTrainingOutput(row.outputJson)?.type !== 'correction'
      ).length;
      if (accuracy >= 0.85 && acceptedCount >= 2) return null;
    }
    return recordTrainingExample(prisma, { userId, projectId, kind, input, items, output });
  } catch (error) {
    console.warn('[ai-training] maybe-record failed:', error.message);
    return null;
  }
}

export async function captureDiscussTraining(
  prisma,
  { req, userId, projectId, kind, history, userMessage, reply, fromDump = false } = {}
) {
  if (!isLocalTrainingEnabled(req) || !userId || !userMessage) return;
  const corrected = looksLikeCorrection(userMessage);
  const lastAi = lastAssistantContent(history);

  if (corrected && lastAi) {
    await recordTrainingExample(prisma, {
      userId,
      projectId,
      kind,
      input: lastAi,
      output: {
        type: 'correction',
        mistake: lastAi.slice(0, INPUT_CHARS),
        userCorrection: String(userMessage).slice(0, 800),
      },
    });
  }

  if (fromDump) {
    await recordTrainingExample(prisma, {
      userId,
      projectId,
      kind,
      input: userMessage,
      output: {
        type: 'unresolved-error',
        errorClass: 'dump',
      },
    });
    return;
  }

  if (!reply) return;
  if (kind === 'overview-feed' && isWeakOverviewReply(reply) && !corrected) return;

  await maybeRecordAccepted(prisma, {
    userId,
    projectId,
    kind,
    input: userMessage,
    output: corrected
      ? { type: 'preferred', reply, afterCorrection: true }
      : { type: 'accepted', reply },
    force: corrected,
  });
}
