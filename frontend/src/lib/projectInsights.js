const PRIORITY_LABELS = {
  1: 'High',
  2: 'Medium',
  3: 'Low',
};

const PRIORITY_FILL = {
  High: '#f43f5e',
  Medium: '#f59e0b',
  Low: '#60a5fa',
  Unspecified: '#64748b',
};

const PRIORITY_BADGE = {
  1: 'bg-rose-500/15 text-rose-400',
  2: 'bg-amber-500/15 text-amber-400',
  3: 'bg-sky-500/15 text-sky-400',
};

export function priorityBadgeClass(priority) {
  const level = Number(priority);
  return PRIORITY_BADGE[level === 1 || level === 2 || level === 3 ? level : 3] || PRIORITY_BADGE[3];
}

export function priorityDisplayLabel(priority) {
  const level = Number(priority);
  if (level === 1) return 'High';
  if (level === 2) return 'Medium';
  return 'Low';
}

const SOURCE_PATTERN = /Reported from (.+?) \((.+)\)\./i;
const SOURCE_ONLY_PATTERN = /Reported from (.+?)\./i;

function priorityLabel(priority) {
  const level = Number(priority);
  if (level === 1) return 'High';
  if (level === 2) return 'Medium';
  if (level === 3 || Number.isFinite(level)) return 'Low';
  return 'Unspecified';
}

function parseSource(item) {
  const text = String(item.description || '');
  const withSeverity = text.match(SOURCE_PATTERN);
  if (withSeverity) return withSeverity[1].trim();
  const sourceOnly = text.match(SOURCE_ONLY_PATTERN);
  if (sourceOnly) return sourceOnly[1].trim();
  return null;
}

export function reportDisplayName(report) {
  return String(report?.nickname || '').trim() || report?.fileName || 'Untitled file';
}

/** AI extraction cap per High/Med/Low. Not a user or billing limit. */
export const MAX_APPROACHES_PER_PRIORITY = 10;

export function reportRefreshState(items = []) {
  const counts = { 1: 0, 2: 0, 3: 0 };
  let openCount = 0;
  for (const item of items) {
    const level = Number(item.priority);
    const priority = level === 1 || level === 2 ? level : 3;
    counts[priority] += 1;
    if (!item.completed) openCount += 1;
  }
  const atCap =
    counts[1] >= MAX_APPROACHES_PER_PRIORITY ||
    counts[2] >= MAX_APPROACHES_PER_PRIORITY ||
    counts[3] >= MAX_APPROACHES_PER_PRIORITY;
  const allComplete = items.length > 0 && openCount === 0;
  return {
    atCap,
    allComplete,
    showRefresh: atCap,
    canRefresh: atCap && allComplete,
  };
}

function shortName(name, max = 22) {
  const value = String(name || 'Untitled');
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function buildProjectInsights(actionItems = [], reports = []) {
  const items = Array.isArray(actionItems) ? actionItems : [];
  const files = Array.isArray(reports) ? reports : [];
  const openItems = items.filter((item) => !item.completed);
  const doneItems = items.filter((item) => item.completed);

  const remainingByPriority = ['High', 'Medium', 'Low', 'Unspecified']
    .map((name) => ({
      name,
      value: openItems.filter((item) => priorityLabel(item.priority) === name).length,
      fill: PRIORITY_FILL[name],
    }))
    .filter((row) => row.value > 0);

  const saved = items.flatMap((item) => item.savedSuggestions || []);
  const nextOpen = saved.filter((entry) => !entry.completed).length;
  const nextDone = saved.filter((entry) => entry.completed).length;
  const nextSteps = [
    { name: 'Still open', value: nextOpen, fill: '#60a5fa' },
    { name: 'Completed', value: nextDone, fill: '#34d399' },
  ].filter((row) => row.value > 0);

  const leftoverByFile = files
    .map((report) => {
      const leftover = openItems.filter((item) => item.reportId === report.id).length;
      return {
        name: shortName(reportDisplayName(report)),
        value: leftover,
      };
    })
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  const unassigned = openItems.filter((item) => !item.reportId).length;
  if (unassigned > 0) {
    leftoverByFile.push({ name: 'No source file', value: unassigned });
  }

  const sourceCounts = new Map();
  for (const item of openItems) {
    const source = parseSource(item);
    if (!source) continue;
    sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
  }
  const sources = [...sourceCounts.entries()]
    .map(([name, value]) => ({ name: shortName(name, 18), value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  const openHigh = remainingByPriority.find((row) => row.name === 'High')?.value || 0;
  const total = items.length;
  const open = openItems.length;
  const done = doneItems.length;

  let headline = 'Upload a file to see what still needs attention.';
  if (openHigh > 0) {
    headline = `${openHigh} high-priority approach${openHigh === 1 ? '' : 'es'} still open.`;
  } else if (nextOpen > 0) {
    headline = `${nextOpen} saved next step${nextOpen === 1 ? '' : 's'} still open.`;
  } else if (open > 0) {
    headline = `${open} approach${open === 1 ? '' : 'es'} still open.`;
  } else if (total > 0) {
    headline = 'All approaches are marked done.';
  }

  return {
    headline,
    open,
    done,
    total,
    openHigh,
    nextOpen,
    nextDone,
    remainingByPriority,
    nextSteps,
    leftoverByFile,
    sources,
    showSources: sources.length > 1,
    showNextSteps: saved.length > 0,
    showLeftoverByFile: leftoverByFile.length > 0,
  };
}
