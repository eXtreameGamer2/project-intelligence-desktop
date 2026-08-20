import { applyProcedureKinds } from './jsonRepair.js';

export function parseSuggestions(raw) {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return applyProcedureKinds(
      parsed
        .map((item) => ({
          title: String(item.title || '').trim(),
          detail: String(item.detail || '').trim(),
          kind: item.kind || item.type || '',
          procedureIndex: item.procedureIndex ?? null,
        }))
        .filter((item) => item.title)
    );
  } catch {
    return [];
  }
}

const STEP_WORDS = ['First', 'Second', 'Third'];

export function serializeSavedSuggestion(entry) {
  return {
    id: entry.id,
    projectId: entry.projectId,
    itemId: entry.itemId,
    title: entry.title,
    detail: entry.detail || '',
    completed: Boolean(entry.completed),
    createdAt: entry.createdAt,
    itemTitle: entry.item?.title || null,
  };
}

export function formatApproachScreenBriefing(item) {
  const suggestions = parseSuggestions(item?.suggestionsJson);
  const saved = withSaveSteps((item?.savedSuggestions || []).map(serializeSavedSuggestion)).filter(
    (entry) => !entry.completed
  );
  const analyses = item?.suggestionAnalyses || [];
  const suggestionLines = suggestions.length
    ? suggestions.map((row, index) => {
        const n = row.procedureIndex || index + 1;
        const label = row.kind === 'step' ? `step ${n}` : row.kind === 'idea' ? 'idea' : `item ${n}`;
        const detail = String(row.detail || '').replace(/\s+/g, ' ').trim().slice(0, 160);
        return `- ${label}: ${row.title}${detail ? ` — ${detail}` : ''}`;
      })
    : ['- none listed'];
  const savedLines = saved.length
    ? saved.map((row) => {
        const label = row.stepLabel || row.stepWord || 'saved';
        const detail = String(row.detail || '').replace(/\s+/g, ' ').trim().slice(0, 120);
        return `- ${label}: ${row.title}${detail ? ` — ${detail}` : ''}`;
      })
    : ['- none saved'];
  const analysisLines = analyses.slice(0, 3).map((row) => {
    const summary = String(row.analysis || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180);
    return `- ${row.fileName || 'file'}${summary ? `: ${summary}` : ''}`;
  });

  return [
    'ON THIS APPROACH (what the user sees on this Dashboard thread):',
    `Title: ${item?.title || ''}`,
    `Details: ${item?.description || 'None'}`,
    'AI suggestions (procedure steps and ideas on screen):',
    ...suggestionLines,
    'Saved steps (Remembered next steps / Saved suggestions on this Dashboard):',
    ...savedLines,
    analyses.length ? 'File analyses on this approach:' : '',
    ...analysisLines,
  ]
    .filter(Boolean)
    .join('\n');
}

export function withSaveSteps(saved) {
  const entries = [...saved];
  const active = entries
    .filter((entry) => !entry.completed)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const useSteps = active.length > 1;
  const stepsById = new Map(
    active.map((entry, index) => [
      entry.id,
      {
        stepIndex: index + 1,
        stepWord: STEP_WORDS[index] || `Step ${index + 1}`,
        stepLabel: useSteps ? `${STEP_WORDS[index] || `Step ${index + 1}`} step` : null,
      },
    ])
  );

  return entries.map((entry) => ({
    ...entry,
    stepIndex: stepsById.get(entry.id)?.stepIndex || null,
    stepWord: stepsById.get(entry.id)?.stepWord || null,
    stepLabel: stepsById.get(entry.id)?.stepLabel || null,
  }));
}

export function serializeSuggestionAnalysis(entry) {
  let snapshot = [];
  try {
    const parsed = JSON.parse(entry.snapshotJson || '[]');
    snapshot = Array.isArray(parsed) ? parsed : [];
  } catch {
    snapshot = [];
  }

  return {
    id: entry.id,
    projectId: entry.projectId,
    itemId: entry.itemId,
    fileName: entry.fileName,
    fileType: entry.fileType,
    fileSize: entry.fileSize,
    analysis: entry.analysis,
    snapshot,
    createdAt: entry.createdAt,
  };
}

export function serializeActionItem(item) {
  const { suggestionsJson, discussion, savedSuggestions, suggestionAnalyses, ...rest } = item;
  const saved = withSaveSteps((savedSuggestions || []).map(serializeSavedSuggestion));
  const savedByTitle = new Map(
    saved.map((entry) => [entry.title.toLowerCase(), entry])
  );

  return {
    ...rest,
    threadLoaded: Array.isArray(discussion),
    suggestions: parseSuggestions(suggestionsJson).map((suggestion) => {
      const match = savedByTitle.get(suggestion.title.toLowerCase());
      return {
        ...suggestion,
        saved: Boolean(match) && !match.completed,
        completed: Boolean(match?.completed),
        savedId: match?.id || null,
        stepIndex: match?.stepIndex || suggestion.procedureIndex || null,
        stepWord: match?.stepWord || null,
        stepLabel: match?.stepLabel || null,
      };
    }),
    savedSuggestions: saved,
    suggestionAnalyses: (suggestionAnalyses || []).map(serializeSuggestionAnalysis),
    discussion: (discussion || []).map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
    })),
  };
}

export const ACTION_ITEM_LIST_INCLUDE = {
  savedSuggestions: {
    orderBy: { createdAt: 'asc' },
  },
};

export const ACTION_ITEM_DISCUSSION_INCLUDE = {
  discussion: {
    orderBy: { createdAt: 'asc' },
  },
  savedSuggestions: {
    orderBy: { createdAt: 'asc' },
  },
  suggestionAnalyses: {
    orderBy: { createdAt: 'desc' },
  },
};
