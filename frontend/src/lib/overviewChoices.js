export function applyOverviewChoices(overview, choices) {
  if (!overview || !choices) return overview;

  const actionById = new Map(
    (choices.nextActions || []).map((entry) => [entry.id, entry.nextAction])
  );
  const projects = (overview.projects || []).map((row) => {
    const nextAction = actionById.get(row.id);
    if (!nextAction) return row;
    return { ...row, nextAction, nextActionSource: 'ai' };
  });
  const byId = new Map(projects.map((row) => [row.id, row]));

  const withUpdatedActions = (rows) =>
    (rows || []).map((row) => byId.get(row.id) || row);

  const doNext = (choices.doNextIds || []).map((id) => byId.get(id)).filter(Boolean);
  const attention = {
    ...overview.attention,
    scheduleNow: doNext.length ? doNext : withUpdatedActions(overview.attention?.scheduleNow),
    backedUp: withUpdatedActions(overview.attention?.backedUp),
    stale: withUpdatedActions(overview.attention?.stale),
  };

  const headline = String(choices.headline || '').trim();
  const totals = headline
    ? { ...overview.totals, headline, headlineSource: 'ai' }
    : overview.totals;

  return {
    ...overview,
    totals,
    projects,
    attention,
    choices,
  };
}
