import { randomUUID } from 'node:crypto';
import { resolveDatabaseConfig } from '../db/config.js';
import { prisma } from '../db/client.js';
import { resolveRequestUser } from '../middleware/auth.js';

const DEFAULT_LOCAL_CTX = 8192;
const DEFAULT_CLOUD_CTX = 128000;

let schemaReady = false;

export const PRELOADED_MODELS = [
  { modelId: 'llama3', nCtx: 8192 },
  { modelId: 'llama3.1', nCtx: 8192 },
  { modelId: 'llama3.2', nCtx: 8192 },
  { modelId: 'llama3.3', nCtx: 8192 },
  { modelId: 'qwen2.5', nCtx: 8192 },
  { modelId: 'qwen2', nCtx: 8192 },
  { modelId: 'mistral', nCtx: 8192 },
  { modelId: 'mixtral', nCtx: 8192 },
  { modelId: 'phi-4', nCtx: 4096 },
  { modelId: 'phi3', nCtx: 4096 },
  { modelId: 'gemma2', nCtx: 8192 },
  { modelId: 'deepseek-r1', nCtx: 8192 },
  { modelId: 'gpt-oss', nCtx: 8192 },
  { modelId: 'gpt-4o', nCtx: 128000, provider: 'byok-openai' },
  { modelId: 'gpt-4.1', nCtx: 128000, provider: 'byok-openai' },
  { modelId: 'claude-sonnet-4', nCtx: 200000, provider: 'byok-anthropic' },
];

const FAMILY_DEFAULTS = [
  { family: 'phi', pattern: /\bphi/i, nCtx: 4096, maxTokens: 768 },
  { family: 'llama', pattern: /\bllama/i, nCtx: 8192, maxTokens: 1024 },
  { family: 'qwen', pattern: /\bqwen/i, nCtx: 8192, maxTokens: 1024 },
  { family: 'mistral', pattern: /\b(mistral|mixtral)/i, nCtx: 8192, maxTokens: 1024 },
  { family: 'gemma', pattern: /\bgemma/i, nCtx: 8192, maxTokens: 1024 },
  { family: 'deepseek', pattern: /\bdeepseek/i, nCtx: 8192, maxTokens: 1024 },
  { family: 'gpt-oss', pattern: /\bgpt-oss/i, nCtx: 8192, maxTokens: 1024 },
  { family: 'openai', pattern: /\bgpt-|o[1-4][-.]|o3\b|o4\b/i, nCtx: 128000, maxTokens: 2048 },
  { family: 'claude', pattern: /\bclaude/i, nCtx: 200000, maxTokens: 2048 },
];

export function modelKey(id) {
  return String(id || '')
    .trim()
    .toLowerCase()
    .replace(/:latest$/, '');
}

export function modelBase(id) {
  return modelKey(id).split('/').pop();
}

export function inferModelFamily(id) {
  const value = modelBase(id);
  const found = FAMILY_DEFAULTS.find((row) => row.pattern.test(value));
  return found?.family || 'unknown';
}

function familyDefaults(id, provider = '') {
  const value = modelBase(id);
  const found = FAMILY_DEFAULTS.find((row) => row.pattern.test(value));
  const local = String(provider || '').toLowerCase() === 'localhost' || String(provider || '').toLowerCase() === 'custom-endpoint';
  if (found) {
    return {
      family: found.family,
      nCtx: local && found.nCtx > DEFAULT_LOCAL_CTX ? DEFAULT_LOCAL_CTX : found.nCtx,
      maxTokens: found.maxTokens,
    };
  }
  return {
    family: 'unknown',
    nCtx: local ? DEFAULT_LOCAL_CTX : DEFAULT_CLOUD_CTX,
    maxTokens: local ? 1024 : 2048,
  };
}

function clampNCtx(value) {
  const nCtx = Math.round(Number(value) || 0);
  if (!Number.isInteger(nCtx) || nCtx < 1024) return null;
  return Math.min(nCtx, 1_000_000);
}

function maxTokensFor(nCtx) {
  const ctx = clampNCtx(nCtx) || DEFAULT_LOCAL_CTX;
  return Math.min(2048, Math.max(256, Math.floor(ctx * 0.16)));
}

function quote(value) {
  return String(value ?? '').replace(/'/g, "''");
}

function nowSql(provider) {
  return provider === 'postgresql' ? 'CURRENT_TIMESTAMP' : "datetime('now')";
}

export function extractContextLength(entry) {
  if (entry == null) return null;
  if (typeof entry === 'number' || typeof entry === 'string') return clampNCtx(entry);

  const direct =
    entry.max_model_len ||
    entry.context_length ||
    entry.n_ctx ||
    entry.ctx_size ||
    entry.meta?.n_ctx ||
    entry.meta?.max_model_len ||
    entry.details?.context_length ||
    entry.model_info?.['llama.context_length'];
  const fromDirect = clampNCtx(direct);
  if (fromDirect) return fromDirect;

  const stack = [entry];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    for (const [key, value] of Object.entries(current)) {
      if (/(context_length|n_ctx|max_model_len|ctx_size)$/i.test(key)) {
        const found = clampNCtx(value);
        if (found) return found;
      }
      if (value && typeof value === 'object') stack.push(value);
    }
  }
  return null;
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.userId ?? row.userid ?? null,
    provider: row.provider,
    modelId: row.modelId ?? row.modelid,
    modelKey: row.modelKey ?? row.modelkey,
    modelBase: row.modelBase ?? row.modelbase,
    family: row.family,
    nCtx: Number(row.nCtx ?? row.nctx) || DEFAULT_LOCAL_CTX,
    maxTokens: Number(row.maxTokens ?? row.maxtokens) || 1024,
    jsonOk: Number(row.jsonOk ?? row.jsonok) || 0,
    jsonFail: Number(row.jsonFail ?? row.jsonfail) || 0,
    dumpCount: Number(row.dumpCount ?? row.dumpcount) || 0,
    lastErrorClass: row.lastErrorClass ?? row.lasterrorclass ?? null,
    nCtxSource: row.nCtxSource ?? row.nctxsource ?? 'preload',
    source: row.source,
  };
}

async function queryProfiles(sql) {
  try {
    const rows = await prisma.$queryRawUnsafe(sql);
    return Array.isArray(rows) ? rows.map(mapRow) : [];
  } catch (error) {
    console.warn('[ai-model-catalog] query failed:', error.message);
    return [];
  }
}

export async function ensureModelCatalogSchema(client = prisma) {
  if (schemaReady || !client) return;
  const { provider } = resolveDatabaseConfig();

  try {
    if (provider === 'postgresql') {
      await client.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "AiModelProfile" (
          "id" TEXT NOT NULL,
          "userId" TEXT,
          "provider" TEXT NOT NULL DEFAULT 'localhost',
          "modelId" TEXT NOT NULL,
          "modelKey" TEXT NOT NULL,
          "modelBase" TEXT NOT NULL,
          "family" TEXT NOT NULL DEFAULT 'unknown',
          "nCtx" INTEGER NOT NULL DEFAULT 8192,
          "maxTokens" INTEGER NOT NULL DEFAULT 1024,
          "jsonOk" INTEGER NOT NULL DEFAULT 0,
          "jsonFail" INTEGER NOT NULL DEFAULT 0,
          "dumpCount" INTEGER NOT NULL DEFAULT 0,
          "lastErrorClass" TEXT,
          "nCtxSource" TEXT NOT NULL DEFAULT 'preload',
          "source" TEXT NOT NULL DEFAULT 'preload',
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "AiModelProfile_pkey" PRIMARY KEY ("id")
        )
      `);
      await client.$executeRawUnsafe(`
        DO $$ BEGIN
          ALTER TABLE "AiModelProfile"
            ADD CONSTRAINT "AiModelProfile_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$
      `);
    } else {
      await client.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "AiModelProfile" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "userId" TEXT,
          "provider" TEXT NOT NULL DEFAULT 'localhost',
          "modelId" TEXT NOT NULL,
          "modelKey" TEXT NOT NULL,
          "modelBase" TEXT NOT NULL,
          "family" TEXT NOT NULL DEFAULT 'unknown',
          "nCtx" INTEGER NOT NULL DEFAULT 8192,
          "maxTokens" INTEGER NOT NULL DEFAULT 1024,
          "jsonOk" INTEGER NOT NULL DEFAULT 0,
          "jsonFail" INTEGER NOT NULL DEFAULT 0,
          "dumpCount" INTEGER NOT NULL DEFAULT 0,
          "lastErrorClass" TEXT,
          "nCtxSource" TEXT NOT NULL DEFAULT 'preload',
          "source" TEXT NOT NULL DEFAULT 'preload',
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
        )
      `);
    }
    await client.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "AiModelProfile_userId_modelKey_idx" ON "AiModelProfile"("userId", "modelKey")`
    );
    await client.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "AiModelProfile_modelKey_idx" ON "AiModelProfile"("modelKey")`
    );
    await seedPreloadedModels(client, provider);
    schemaReady = true;
  } catch (error) {
    console.warn('[ai-model-catalog] schema ensure failed:', error.message);
  }
}

async function seedPreloadedModels(client, provider) {
  const existing = await queryProfiles(
    `SELECT "id" FROM "AiModelProfile" WHERE "source" = 'preload' LIMIT 1`
  );
  if (existing.length) return;

  for (const entry of PRELOADED_MODELS) {
    const defaults = familyDefaults(entry.modelId, entry.provider);
    const key = modelKey(entry.modelId);
    const nCtx = clampNCtx(entry.nCtx) || defaults.nCtx;
    await client.$executeRawUnsafe(`
      INSERT INTO "AiModelProfile"
        ("id", "userId", "provider", "modelId", "modelKey", "modelBase", "family", "nCtx", "maxTokens", "nCtxSource", "source", "createdAt", "updatedAt")
      VALUES (
        'preload-${quote(key)}',
        NULL,
        '${quote(entry.provider || 'localhost')}',
        '${quote(entry.modelId)}',
        '${quote(key)}',
        '${quote(modelBase(entry.modelId))}',
        '${quote(defaults.family)}',
        ${nCtx},
        ${maxTokensFor(nCtx)},
        'preload',
        'preload',
        ${nowSql(provider)},
        ${nowSql(provider)}
      )
    `);
  }
}

function scoreMatch(profile, wantedKey, wantedBase, provider) {
  let score = 0;
  if (profile.modelKey === wantedKey) score += 8;
  else if (profile.modelBase === wantedBase) score += 5;
  else if (profile.family !== 'unknown' && profile.family === inferModelFamily(wantedKey)) score += 2;
  else return 0;
  if (profile.provider === provider) score += 1;
  if (profile.userId) score += 3;
  return score;
}

export async function lookupModelProfile({ userId, provider = 'localhost', modelId } = {}) {
  if (!modelId) return null;
  await ensureModelCatalogSchema();
  const wantedKey = modelKey(modelId);
  const wantedBase = modelBase(modelId);
  if (!wantedKey) return null;

  const userClause = userId
    ? `"userId" = '${quote(userId)}' OR "userId" IS NULL`
    : `"userId" IS NULL`;
  const rows = await queryProfiles(`
    SELECT * FROM "AiModelProfile"
    WHERE (${userClause})
    ORDER BY "updatedAt" DESC
  `);

  let best = null;
  let bestScore = 0;
  for (const row of rows) {
    const score = scoreMatch(row, wantedKey, wantedBase, String(provider || '').toLowerCase());
    if (score > bestScore) {
      best = row;
      bestScore = score;
    }
  }
  return best;
}

function chooseNCtx(current, incoming, incomingSource) {
  const next = clampNCtx(incoming);
  if (!next) return { nCtx: current.nCtx, nCtxSource: current.nCtxSource };
  if (incomingSource === 'error') return { nCtx: next, nCtxSource: 'error' };
  if (current.nCtxSource === 'error') return { nCtx: current.nCtx, nCtxSource: 'error' };
  if (incomingSource === 'preload') return { nCtx: current.nCtx, nCtxSource: current.nCtxSource };
  return { nCtx: next, nCtxSource: incomingSource };
}

async function insertObserved({ userId, provider, modelId, nCtx, nCtxSource, family, maxTokens }) {
  const { provider: db } = resolveDatabaseConfig();
  const id = `obs-${randomUUID()}`;
  const key = modelKey(modelId);
  await prisma.$executeRawUnsafe(`
    INSERT INTO "AiModelProfile"
      ("id", "userId", "provider", "modelId", "modelKey", "modelBase", "family", "nCtx", "maxTokens", "nCtxSource", "source", "createdAt", "updatedAt")
    VALUES (
      '${quote(id)}',
      ${userId ? `'${quote(userId)}'` : 'NULL'},
      '${quote(provider || 'localhost')}',
      '${quote(modelId)}',
      '${quote(key)}',
      '${quote(modelBase(modelId))}',
      '${quote(family)}',
      ${nCtx},
      ${maxTokens},
      '${quote(nCtxSource)}',
      'observed',
      ${nowSql(db)},
      ${nowSql(db)}
    )
  `);
  return lookupModelProfile({ userId, provider, modelId });
}

async function updateProfile(id, fields) {
  const { provider: db } = resolveDatabaseConfig();
  const assignments = [`"updatedAt" = ${nowSql(db)}`];
  if (fields.modelId) assignments.push(`"modelId" = '${quote(fields.modelId)}'`);
  if (fields.nCtx) assignments.push(`"nCtx" = ${Number(fields.nCtx)}`);
  if (fields.maxTokens) assignments.push(`"maxTokens" = ${Number(fields.maxTokens)}`);
  if (fields.nCtxSource) assignments.push(`"nCtxSource" = '${quote(fields.nCtxSource)}'`);
  if (fields.lastErrorClass != null) {
    assignments.push(`"lastErrorClass" = '${quote(fields.lastErrorClass)}'`);
  }
  if (fields.jsonOkDelta) assignments.push(`"jsonOk" = "jsonOk" + ${Number(fields.jsonOkDelta)}`);
  if (fields.jsonFailDelta) assignments.push(`"jsonFail" = "jsonFail" + ${Number(fields.jsonFailDelta)}`);
  if (fields.dumpCountDelta) assignments.push(`"dumpCount" = "dumpCount" + ${Number(fields.dumpCountDelta)}`);
  await prisma.$executeRawUnsafe(
    `UPDATE "AiModelProfile" SET ${assignments.join(', ')} WHERE "id" = '${quote(id)}'`
  );
}

export async function observeConnectedModel({
  userId,
  provider = 'localhost',
  modelId,
  nCtx = null,
  nCtxSource = 'listed',
} = {}) {
  if (!modelId) return null;
  await ensureModelCatalogSchema();
  const defaults = familyDefaults(modelId, provider);
  const incoming = clampNCtx(nCtx) || defaults.nCtx;
  const existing = await lookupModelProfile({ userId, provider, modelId });

  if (!existing) {
    return insertObserved({
      userId,
      provider,
      modelId,
      nCtx: incoming,
      nCtxSource: clampNCtx(nCtx) ? nCtxSource : 'preload',
      family: defaults.family,
      maxTokens: maxTokensFor(incoming),
    });
  }

  if (existing.source === 'preload' && userId) {
    const chosen = chooseNCtx(existing, nCtx, nCtxSource);
    return insertObserved({
      userId,
      provider,
      modelId,
      nCtx: chosen.nCtx,
      nCtxSource: chosen.nCtxSource,
      family: existing.family || defaults.family,
      maxTokens: maxTokensFor(chosen.nCtx),
    });
  }

  if (existing.userId && existing.modelKey !== modelKey(modelId)) {
    const chosen = chooseNCtx(existing, nCtx, nCtxSource);
    return insertObserved({
      userId,
      provider,
      modelId,
      nCtx: chosen.nCtx,
      nCtxSource: chosen.nCtxSource,
      family: defaults.family,
      maxTokens: maxTokensFor(chosen.nCtx),
    });
  }

  const chosen = chooseNCtx(existing, nCtx, nCtxSource);
  await updateProfile(existing.id, {
    modelId,
    nCtx: chosen.nCtx,
    maxTokens: maxTokensFor(chosen.nCtx),
    nCtxSource: chosen.nCtxSource,
  });
  return {
    ...existing,
    modelId,
    nCtx: chosen.nCtx,
    maxTokens: maxTokensFor(chosen.nCtx),
    nCtxSource: chosen.nCtxSource,
  };
}

function applyProfile(req, profile) {
  if (!req || !profile) return profile;
  req._modelProfile = profile;
  const nCtx = clampNCtx(profile.nCtx);
  if (nCtx) req._aiNCtx = nCtx;
  return profile;
}

export async function attachKnownModelLimits(req, { userId, provider, modelId } = {}) {
  const profile = await lookupModelProfile({
    userId: userId || resolveRequestUser(req)?.id,
    provider: provider || req?.headers?.['x-ai-provider'] || 'localhost',
    modelId: modelId || req?._resolvedAiModel || req?.headers?.['x-ai-model-name'],
  });
  return applyProfile(req, profile);
}

export async function attachObservedModel(req, { provider, modelId, nCtx, nCtxSource } = {}) {
  const user = resolveRequestUser(req);
  const profile = await observeConnectedModel({
    userId: user?.id,
    provider: provider || req?.headers?.['x-ai-provider'] || 'localhost',
    modelId: modelId || req?._resolvedAiModel || req?.headers?.['x-ai-model-name'],
    nCtx,
    nCtxSource,
  });
  return applyProfile(req, profile);
}

export async function persistObservedContext(req, nCtx) {
  const value = clampNCtx(nCtx);
  if (!req || !value) return;
  try {
    await attachObservedModel(req, {
      modelId: req._resolvedAiModel || req.headers?.['x-ai-model-name'],
      provider: req.headers?.['x-ai-provider'],
      nCtx: value,
      nCtxSource: 'error',
    });
  } catch (error) {
    console.warn('[ai-model-catalog] persist context failed:', error.message);
  }
}

export async function recordModelReply(req, { errorClass, ok = false } = {}) {
  const profile = req?._modelProfile;
  if (!profile?.id || profile.source === 'preload') return;
  try {
    await ensureModelCatalogSchema();
    await updateProfile(profile.id, {
      lastErrorClass: errorClass || (ok ? 'ok' : profile.lastErrorClass),
      jsonOkDelta: ok ? 1 : 0,
      jsonFailDelta: !ok && errorClass && errorClass !== 'ok' ? 1 : 0,
      dumpCountDelta: errorClass === 'dump' ? 1 : 0,
    });
    if (ok) profile.jsonOk += 1;
    else if (errorClass && errorClass !== 'ok') profile.jsonFail += 1;
    if (errorClass === 'dump') profile.dumpCount += 1;
  } catch (error) {
    console.warn('[ai-model-catalog] reply record failed:', error.message);
  }
}

export function modelJsonGuardrail(profile) {
  if (!profile) return '';
  const attempts = (profile.jsonOk || 0) + (profile.jsonFail || 0);
  const failRate = attempts ? profile.jsonFail / attempts : 0;
  const lines = [];
  if ((profile.dumpCount || 0) >= 2 || failRate >= 0.4) {
    lines.push(
      'This connected model has returned invalid or scratchpad replies. First character must be [. No reasoning. No markdown. Do not invent omitted report work.'
    );
  }
  if (profile.nCtx && profile.nCtx <= 8192) {
    lines.push('Keep the JSON array short. Do not restate the report.');
  }
  return lines.length ? `\n${lines.join(' ')}` : '';
}

export function trainingLimitOptions(req) {
  const profile = req?._modelProfile;
  return {
    nCtx: Number(req?._aiNCtx) || Number(profile?.nCtx) || undefined,
    dumpCount: Number(profile?.dumpCount) || 0,
  };
}
