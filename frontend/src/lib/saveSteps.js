const STEP_WORDS = ['First', 'Second', 'Third'];

function stepFromIndex(index) {
  const word = STEP_WORDS[index] || `Step ${index + 1}`;
  return {
    stepIndex: index + 1,
    stepWord: word,
    stepLabel: `${word} step`,
  };
}

export function activeSaves(saved = []) {
  return saved.filter((entry) => !entry.completed);
}

export function stepMetaForSaves(saved = []) {
  const ordered = [...activeSaves(saved)].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  const useSteps = ordered.length > 1;
  const byId = new Map();

  ordered.forEach((entry, index) => {
    const step = useSteps ? stepFromIndex(index) : null;
    byId.set(entry.id, {
      ...entry,
      stepIndex: step?.stepIndex || null,
      stepWord: step?.stepWord || null,
      stepLabel: step?.stepLabel || null,
    });
  });

  return byId;
}

export function labeledSaves(saved = []) {
  return [...stepMetaForSaves(saved).values()].sort(
    (a, b) => (a.stepIndex || 0) - (b.stepIndex || 0)
  );
}

export function withInferredProcedure(suggestions = []) {
  if (suggestions.some((item) => item.kind === 'step' || item.kind === 'idea')) {
    return suggestions;
  }

  if (suggestions.length === 3) {
    return suggestions.map((item, index) => ({
      ...item,
      kind: 'step',
      procedureIndex: index + 1,
    }));
  }

  return suggestions.map((item) => ({
    ...item,
    kind: item.kind || 'idea',
    procedureIndex: item.procedureIndex || null,
  }));
}

export function linkedAnalysisGroups(suggestions = [], analyses = []) {
  const savedIds = new Set(
    suggestions.map((entry) => entry.savedId).filter(Boolean)
  );
  const shared = [...analyses]
    .filter((entry) => (entry.snapshot || []).filter((saved) => savedIds.has(saved.id)).length > 1)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const used = new Set();
  const groups = [];

  for (const analysis of shared) {
    const ids = (analysis.snapshot || [])
      .map((saved) => saved.id)
      .filter((id) => savedIds.has(id) && !used.has(id));
    if (ids.length < 2) continue;
    ids.forEach((id) => used.add(id));
    groups.push({ analysis, savedIds: ids });
  }

  return { groups, used };
}

export function displayStepForSuggestion(suggestion, saved = []) {
  if (suggestion.completed) return null;
  const saveSteps = stepMetaForSaves(saved);
  const active = activeSaves(saved);

  if (active.length > 1) {
    if (!suggestion.savedId) return null;
    return saveSteps.get(suggestion.savedId) || null;
  }

  if (suggestion.kind === 'step' && suggestion.procedureIndex) {
    return stepFromIndex(suggestion.procedureIndex - 1);
  }

  return null;
}
