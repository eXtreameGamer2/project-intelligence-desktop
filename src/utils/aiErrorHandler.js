import { extractActionItems } from './jsonRepair.js';
import { FILE_READ_PROMPT } from './fileReadGuide.js';
import { importFocusInstruction } from './importFocus.js';
import { isResponseDump, looksLikeScratchpad } from './aiDisplay.js';
import { isLocalTrainingEnabled, recordTrainingExample } from './aiTraining.js';
import { contextLengthFor, shrinkChatOptions } from './aiContext.js';
import { resolveRequestUser } from '../middleware/auth.js';
import { recordModelReply } from './aiModelCatalog.js';

export const ERROR_MITIGATE_KIND = 'error-mitigate';

const INVALID_REPLY_CHARS = 1200;

function safeExtract(rawText, reportContent) {
  try {
    return extractActionItems(rawText, { reportContent });
  } catch {
    return [];
  }
}

function looksLikeJsonArray(text) {
  return /^\s*\[/.test(String(text || ''));
}

function looksLikeEmptyArray(text) {
  return /^\s*\[\s*\]\s*$/.test(String(text || ''));
}

/**
 * Decide whether a first-pass approach reply can be retried.
 * Connection and empty-provider failures are not retried here.
 */
export function classifyApproachError(rawText, items, { allowsEmpty = false } = {}) {
  if (Array.isArray(items) && items.length) {
    return { retry: false, errorClass: 'ok' };
  }

  const text = String(rawText || '').trim();
  if (!text) {
    return { retry: false, errorClass: 'empty-provider' };
  }

  if (allowsEmpty && looksLikeEmptyArray(text)) {
    return { retry: false, errorClass: 'ok' };
  }

  if (isResponseDump(text) || looksLikeScratchpad(text)) {
    return { retry: true, errorClass: 'dump' };
  }

  if (looksLikeJsonArray(text) && !looksLikeEmptyArray(text)) {
    return { retry: true, errorClass: 'unevidenced' };
  }

  return { retry: true, errorClass: 'parse' };
}

function errorClassInstruction(errorClass) {
  switch (errorClass) {
    case 'dump':
      return 'The previous reply was reasoning, commentary, or a dump — not a JSON array.';
    case 'unevidenced':
      return 'The previous JSON named work that was not evidenced in the labeled report, or copied instructions.';
    case 'parse':
      return 'The previous reply was not a usable JSON array of approaches.';
    default:
      return 'The previous reply was not a valid JSON array of approaches.';
  }
}

export function buildMitigationPrompt({ errorClass, focus, invalidReply, reportContent, extraRules = '' }) {
  const invalid = String(invalidReply || '').trim().slice(0, INVALID_REPLY_CHARS);
  return `The previous reply was invalid and must be discarded as a source of approaches.
${errorClassInstruction(errorClass)}

${FILE_READ_PROMPT}

Focus:
${importFocusInstruction(focus)}

Repair rules:
- Do not convert the invalid reply into approaches.
- Do not invent rows, quotes, titles, counts, or events.
- Read --- REPORT CONTENT --- only. Use labeled RECORD fields or HEADING/SUBHEADING/LIST ITEM/PARAGRAPH blocks as evidence.
- Return ONLY a JSON array. First character must be [.
- Each object has "title" (string), optional "description" (string), and "priority" (1, 2, or 3).
- If nothing in the report matches the focus, return [].
${extraRules ? `- ${extraRules}` : ''}

Invalid reply (do not copy titles from this):
${invalid || '(empty)'}

--- REPORT CONTENT ---
${String(reportContent || '')}
--- END REPORT ---
Return the JSON array now.`;
}

export async function rememberApproachError(req, { solved, errorClass, mistake, items, projectId }) {
  if (!isLocalTrainingEnabled(req)) return;
  const user = resolveRequestUser(req);
  if (!user?.id) return;

  const excerpt = String(mistake || '').trim();
  if (!excerpt) return;

  try {
    if (solved && Array.isArray(items) && items.length) {
      await recordTrainingExample(prisma, {
        userId: user.id,
        projectId: projectId || null,
        kind: ERROR_MITIGATE_KIND,
        input: excerpt,
        output: {
          type: 'solved-error',
          errorClass,
          mistake: excerpt.slice(0, INVALID_REPLY_CHARS),
          items,
        },
      });
      return;
    }

    if (!solved) {
      await recordTrainingExample(prisma, {
        userId: user.id,
        projectId: projectId || null,
        kind: ERROR_MITIGATE_KIND,
        input: excerpt,
        output: {
          type: 'unresolved-error',
          errorClass,
          mistake: excerpt.slice(0, INVALID_REPLY_CHARS),
        },
      });
    }
  } catch (error) {
    console.warn('[ai-error-handler] remember failed:', error.message);
  }
}

/**
 * If the first pass is unusable, retry once against the report — never against the bad reply.
 */
export async function parseApproachesWithRetry({
  req,
  rawText,
  reportContent,
  focus,
  completeChat,
  onProgress,
  step = 'Repairing',
  allowsEmpty = false,
  extraRules = '',
  projectId,
}) {
  let actionItems = safeExtract(rawText, reportContent);
  const classified = classifyApproachError(rawText, actionItems, { allowsEmpty });
  if (!classified.retry) {
    if (classified.errorClass !== 'empty-provider') {
      await recordModelReply(req, {
        ok: classified.errorClass === 'ok',
        errorClass: classified.errorClass,
      });
    }
    return { actionItems, retried: false, errorClass: classified.errorClass };
  }

  onProgress?.({ step });
  const retryText = await completeChat(
    req,
    shrinkChatOptions(
      {
        system:
          'Return only a JSON array of approaches evidenced in the report. First character must be [. No markdown, no extra keys, no explanation. Do not invent work. An empty array is allowed.',
        messages: [
          {
            role: 'user',
            content: buildMitigationPrompt({
              errorClass: classified.errorClass,
              focus,
              invalidReply: rawText,
              reportContent,
              extraRules,
            }),
          },
        ],
        maxTokens: 4096,
        stream: false,
      },
      contextLengthFor(req)
    ),
    onProgress
  );

  actionItems = safeExtract(retryText, reportContent);
  const solved = actionItems.length > 0;
  if (solved || !allowsEmpty) {
    await rememberApproachError(req, {
      solved,
      errorClass: classified.errorClass,
      mistake: rawText,
      items: actionItems,
      projectId,
    });
  }
  await recordModelReply(req, { ok: solved, errorClass: classified.errorClass });

  return {
    actionItems,
    retried: true,
    errorClass: classified.errorClass,
    solved,
  };
}
