const CLUSTER_META = {
  now: {
    id: 'now',
    label: 'Schedule now',
    hint: 'High-priority work is still open',
  },
  'backed-up': {
    id: 'backed-up',
    label: 'Backed up',
    hint: 'A large queue is waiting without being the hottest fire',
  },
  queued: {
    id: 'queued',
    label: 'Queued',
    hint: 'Open work that can be scheduled after hotter items',
  },
  idle: {
    id: 'idle',
    label: 'Idle',
    hint: 'No open approaches or saved steps',
  },
};

const STALE_AFTER_DAYS = 7;

function daysBetween(from, to = new Date()) {
  if (!from) return null;
  const start = new Date(from);
  if (Number.isNaN(start.getTime())) return null;
  return Math.max(0, Math.floor((to.getTime() - start.getTime()) / 86_400_000));
}

function laterDate(...values) {
  const dates = values
    .map((value) => (value ? new Date(value) : null))
    .filter((date) => date && !Number.isNaN(date.getTime()));
  if (dates.length === 0) return null;
  return dates.reduce((latest, date) => (date > latest ? date : latest));
}

function percent(part, whole) {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
}

function nextAction(row) {
  if (row.openHigh > 0) {
    return row.openHigh === 1
      ? 'Clear the high-priority approach first'
      : `Clear ${row.openHigh} high-priority approaches first`;
  }
  if (row.stale && row.open > 0) {
    return 'Review stale open work before it ages further';
  }
  if (row.cluster === 'backed-up') {
    return row.nextOpen === 0
      ? 'Break the queue into saved next steps'
      : 'Work saved steps to drain the backlog';
  }
  if (row.unassigned > 0) {
    return 'Tie leftover approaches back to a source file';
  }
  if (row.open > 0) {
    return 'Schedule after hotter projects';
  }
  if (row.reports === 0) {
    return 'Upload a source file to start tracking work';
  }
  return 'Caught up — no open work';
}

function classifyCluster({ open, openHigh, nextOpen }) {
  if (openHigh > 0) return 'now';
  if (open >= 5 || nextOpen >= 3) return 'backed-up';
  if (open > 0 || nextOpen > 0) return 'queued';
  return 'idle';
}

function buildHeadline(totals) {
  if (totals.openHigh > 0) {
    return `${totals.openHigh} high-priority approach${totals.openHigh === 1 ? '' : 'es'} across ${
      totals.scheduleNow
    } project${totals.scheduleNow === 1 ? '' : 's'} should be scheduled now.`;
  }
  if (totals.backedUp > 0) {
    return `${totals.backedUp} project${totals.backedUp === 1 ? '' : 's'} ${
      totals.backedUp === 1 ? 'is' : 'are'
    } backed up and waiting.`;
  }
  if (totals.stale > 0) {
    return `${totals.stale} project${totals.stale === 1 ? '' : 's'} with open work ${
      totals.stale === 1 ? 'has' : 'have'
    } gone quiet.`;
  }
  if (totals.open > 0) {
    return `No high-priority fires. ${totals.open} approach${totals.open === 1 ? '' : 'es'} can be queued.`;
  }
  return 'All tracked work is clear.';
}

function takeTop(rows, count, predicate) {
  return rows.filter(predicate).slice(0, count);
}

export function buildProjectsOverview(projects, extras = {}) {
  const rows = Array.isArray(projects) ? projects : [];
  const {
    itemGroups = [],
    savedGroups = [],
    openAgeGroups = [],
    unassignedGroups = [],
    reportAgeGroups = [],
  } = extras;

  const stats = new Map(
    rows.map((project) => [
      project.id,
      {
        id: project.id,
        name: project.name,
        reports: project._count?.uploadedReports ?? 0,
        updatedAt: project.updatedAt,
        lastActivityAt: project.updatedAt,
        oldestOpenAt: null,
        open: 0,
        done: 0,
        openHigh: 0,
        openMedium: 0,
        openLow: 0,
        nextOpen: 0,
        nextDone: 0,
        unassigned: 0,
      },
    ])
  );

  for (const group of itemGroups) {
    const row = stats.get(group.projectId);
    if (!row) continue;
    const count = group._count?._all || 0;
    if (group.completed) {
      row.done += count;
      continue;
    }
    row.open += count;
    const priority = Number(group.priority);
    if (priority === 1) row.openHigh += count;
    else if (priority === 2) row.openMedium += count;
    else if (priority === 3) row.openLow += count;
  }

  for (const group of savedGroups) {
    const row = stats.get(group.projectId);
    if (!row) continue;
    const count = group._count?._all || 0;
    if (group.completed) row.nextDone += count;
    else row.nextOpen += count;
  }

  for (const group of openAgeGroups) {
    const row = stats.get(group.projectId);
    if (!row) continue;
    row.oldestOpenAt = group._min?.createdAt || null;
    row.lastActivityAt = laterDate(row.lastActivityAt, group._max?.updatedAt);
  }

  for (const group of unassignedGroups) {
    const row = stats.get(group.projectId);
    if (!row) continue;
    row.unassigned += group._count?._all || 0;
  }

  for (const group of reportAgeGroups) {
    const row = stats.get(group.projectId);
    if (!row) continue;
    row.lastActivityAt = laterDate(row.lastActivityAt, group._max?.createdAt);
  }

  const totalOpen = [...stats.values()].reduce((sum, row) => sum + row.open, 0);

  const projectsOverview = [...stats.values()].map((row) => {
    const cluster = classifyCluster(row);
    const pressure = row.openHigh * 4 + row.nextOpen * 2 + row.open;
    const staleDays = daysBetween(row.lastActivityAt);
    const oldestOpenDays = daysBetween(row.oldestOpenAt);
    const stale = staleDays != null && staleDays >= STALE_AFTER_DAYS && (row.open > 0 || row.nextOpen > 0);
    const total = row.open + row.done;
    const next = {
      ...row,
      cluster,
      pressure,
      staleDays,
      oldestOpenDays,
      stale,
      progressPct: percent(row.done, total),
      coveragePct: percent(Math.min(row.nextOpen, row.open), row.open),
      sharePct: percent(row.open, totalOpen),
    };
    next.nextAction = nextAction(next);
    return next;
  });

  projectsOverview.sort((a, b) => {
    const order = { now: 0, 'backed-up': 1, queued: 2, idle: 3 };
    return (order[a.cluster] ?? 9) - (order[b.cluster] ?? 9) || b.pressure - a.pressure;
  });

  const totals = {
    projects: projectsOverview.length,
    reports: 0,
    open: 0,
    done: 0,
    openHigh: 0,
    openMedium: 0,
    openLow: 0,
    nextOpen: 0,
    nextDone: 0,
    unassigned: 0,
    backedUp: 0,
    scheduleNow: 0,
    stale: 0,
    progressPct: 0,
    coveragePct: 0,
    oldestOpenDays: null,
  };

  for (const row of projectsOverview) {
    totals.reports += row.reports;
    totals.open += row.open;
    totals.done += row.done;
    totals.openHigh += row.openHigh;
    totals.openMedium += row.openMedium;
    totals.openLow += row.openLow;
    totals.nextOpen += row.nextOpen;
    totals.nextDone += row.nextDone;
    totals.unassigned += row.unassigned;
    if (row.cluster === 'backed-up') totals.backedUp += 1;
    if (row.cluster === 'now') totals.scheduleNow += 1;
    if (row.stale) totals.stale += 1;
    if (row.oldestOpenDays != null) {
      totals.oldestOpenDays =
        totals.oldestOpenDays == null
          ? row.oldestOpenDays
          : Math.max(totals.oldestOpenDays, row.oldestOpenDays);
    }
  }

  totals.progressPct = percent(totals.done, totals.open + totals.done);
  totals.coveragePct = percent(Math.min(totals.nextOpen, totals.open), totals.open);
  totals.headline = buildHeadline(totals);

  const clusters = Object.values(CLUSTER_META).map((meta) => {
    const members = projectsOverview.filter((row) => row.cluster === meta.id);
    return {
      ...meta,
      count: members.length,
      open: members.reduce((sum, row) => sum + row.open, 0),
      openHigh: members.reduce((sum, row) => sum + row.openHigh, 0),
    };
  });

  const attention = {
    scheduleNow: takeTop(projectsOverview, 3, (row) => row.cluster === 'now'),
    backedUp: takeTop(projectsOverview, 3, (row) => row.cluster === 'backed-up'),
    stale: takeTop(
      [...projectsOverview].sort((a, b) => (b.staleDays || 0) - (a.staleDays || 0)),
      3,
      (row) => row.stale
    ),
  };

  return { totals, clusters, attention, projects: projectsOverview };
}

function briefProject(row) {
  return `${row.name} [${row.cluster}] open=${row.open} high/med/low=${row.openHigh}/${row.openMedium}/${row.openLow} steps=${row.nextOpen} progress=${row.progressPct}% share=${row.sharePct}% staleDays=${row.staleDays ?? 'n/a'} unassigned=${row.unassigned} next=${row.nextAction}`;
}

function asList(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  return [value];
}

function resolveProjectRef(value, projects) {
  if (value && typeof value === 'object') {
    return resolveProjectRef(
      value.n ?? value.focus ?? value.id ?? value.name ?? value.project,
      projects
    );
  }

  const text = String(value ?? '').trim();
  if (!text) return null;

  const exactId = projects.find((row) => row.id === text);
  if (exactId) return exactId.id;

  const numbered = text.match(/^#?(\d+)$/);
  if (numbered) {
    const index = Number(numbered[1]) - 1;
    if (index >= 0 && index < projects.length) return projects[index].id;
  }

  const lower = text.toLowerCase();
  const exactName = projects.find((row) => row.name.toLowerCase() === lower);
  if (exactName) return exactName.id;

  const partial = projects.filter(
    (row) => lower.includes(row.name.toLowerCase()) || row.name.toLowerCase().includes(lower)
  );
  return partial.length === 1 ? partial[0].id : null;
}

export function sanitizeOverviewChoices(overview, raw) {
  const projects = overview?.projects || [];
  const listed = projects.slice(0, 16);
  const headline = String(raw?.headline || raw?.summary || raw?.call || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
  const focusProjectId = resolveProjectRef(
    raw?.focusProjectId ?? raw?.focus_project_id ?? raw?.focusId ?? raw?.focus,
    listed
  );
  const focusWhy = String(raw?.focusWhy || raw?.focus_why || raw?.why || raw?.reason || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
  const doNextIds = [
    ...new Set(
      asList(raw?.doNextIds ?? raw?.do_next_ids ?? raw?.doNext ?? raw?.next)
        .map((entry) => resolveProjectRef(entry, listed))
        .filter(Boolean)
    ),
  ].slice(0, 3);
  if (focusProjectId && !doNextIds.includes(focusProjectId)) {
    doNextIds.unshift(focusProjectId);
    if (doNextIds.length > 3) doNextIds.pop();
  }

  const nextActions = asList(raw?.nextActions ?? raw?.next_actions ?? raw?.actions)
    .map((entry) => {
      if (typeof entry === 'string') {
        return {
          id: focusProjectId,
          nextAction: entry.replace(/\s+/g, ' ').trim().slice(0, 140),
        };
      }
      return {
        id: resolveProjectRef(entry, listed),
        nextAction: String(
          entry?.nextAction || entry?.next || entry?.action || entry?.instruction || ''
        )
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 140),
      };
    })
    .filter((entry) => entry.id && entry.nextAction.length >= 8);

  return {
    source: 'ai',
    headline: headline.length >= 12 ? headline : '',
    focusProjectId,
    focusWhy: focusProjectId ? focusWhy : '',
    doNextIds,
    nextActions,
  };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function inferOverviewChoicePayload(text, overview) {
  const projects = (overview?.projects || []).slice(0, 16);
  if (!projects.length) return null;

  const body = String(text || '');
  const focusMatch =
    body.match(/\bfocus\b[^#\d]{0,24}#?\s*(\d+)/i) ||
    body.match(/\bstart(?: here)?\b[^#\d]{0,24}#?\s*(\d+)/i);
  let focus = focusMatch ? Number(focusMatch[1]) : 0;
  if (!focus) {
    const named = projects.find((row) =>
      new RegExp(`\\b${escapeRegex(row.name)}\\b`, 'i').test(body)
    );
    if (named) focus = projects.indexOf(named) + 1;
  }
  if (!focus || focus < 1 || focus > projects.length) return null;

  const whyMatch = body.match(/\b(?:why|because)[:\s]+([^\n]+)/i);
  const headlineMatch = body.match(/\bheadline[:\s]+([^\n]+)/i);
  const doNext = [...body.matchAll(/#(\d+)/g)]
    .map((match) => Number(match[1]))
    .filter((value) => value >= 1 && value <= projects.length);

  return {
    headline: headlineMatch?.[1] || '',
    focus,
    why: whyMatch?.[1] || '',
    doNext: [...new Set([focus, ...doNext])].slice(0, 3),
    actions: [],
  };
}

export function formatOverviewChoiceBriefing(overview) {
  const totals = overview?.totals || {};
  const projects = overview?.projects || [];
  const lines = [
    `open=${totals.open || 0} high=${totals.openHigh || 0} med=${totals.openMedium || 0} low=${totals.openLow || 0} backedUp=${totals.backedUp || 0} stale=${totals.stale || 0}`,
    ...projects.slice(0, 16).map(
      (row, index) =>
        `#${index + 1} ${row.name} [${row.cluster}] open=${row.open} h/m/l=${row.openHigh}/${row.openMedium}/${row.openLow} steps=${row.nextOpen} stale=${row.staleDays ?? '-'}`
    ),
  ];
  return lines.join('\n').slice(0, 2800);
}

export function formatOverviewBriefing(overview, choices) {
  const totals = overview?.totals || {};
  const clusters = overview?.clusters || [];
  const attention = overview?.attention || {};
  const projects = overview?.projects || [];

  const lines = [
    `Headline: ${totals.headline || 'No headline.'}`,
    `Totals: projects=${totals.projects || 0}, files=${totals.reports || 0}, open=${totals.open || 0}, done=${totals.done || 0}, high=${totals.openHigh || 0}, medium=${totals.openMedium || 0}, low=${totals.openLow || 0}, savedStepsOpen=${totals.nextOpen || 0}, backedUpProjects=${totals.backedUp || 0}, staleProjects=${totals.stale || 0}, unassigned=${totals.unassigned || 0}, progress=${totals.progressPct || 0}%, coverage=${totals.coveragePct || 0}%, oldestOpenDays=${totals.oldestOpenDays ?? 'n/a'}.`,
    `Clusters: ${clusters.map((cluster) => `${cluster.label} (${cluster.count} projects, ${cluster.open} open)`).join('; ') || 'none'}.`,
    `Do next: ${(attention.scheduleNow || []).map(briefProject).join(' | ') || 'none'}.`,
    `Backed up: ${(attention.backedUp || []).map(briefProject).join(' | ') || 'none'}.`,
    `Going stale: ${(attention.stale || []).map(briefProject).join(' | ') || 'none'}.`,
    'Projects:',
    ...projects.slice(0, 24).map((row) => `- ${briefProject(row)} id=${row.id}`),
  ];

  if (choices?.source === 'ai') {
    const focus = projects.find((row) => row.id === choices.focusProjectId);
    lines.push(
      `AI page choices: focus=${focus ? `${focus.name} (${focus.id})` : 'none'}${
        choices.focusWhy ? ` because ${choices.focusWhy}` : ''
      }; doNextIds=${(choices.doNextIds || []).join(',') || 'none'}; nextActions=${
        (choices.nextActions || [])
          .map((entry) => `${entry.id}:${entry.nextAction}`)
          .join(' | ') || 'none'
      }.`
    );
  }

  return lines.join('\n').slice(0, 8000);
}

export async function loadProjectsOverview(prisma, projects) {
  if (!projects.length) {
    return buildProjectsOverview([]);
  }

  const projectIds = projects.map((project) => project.id);
  const whereIn = { projectId: { in: projectIds } };
  const [itemGroups, savedGroups, openAgeGroups, unassignedGroups, reportAgeGroups] =
    await Promise.all([
      prisma.aIActionItem.groupBy({
        by: ['projectId', 'completed', 'priority'],
        where: whereIn,
        _count: { _all: true },
      }),
      prisma.savedSuggestion.groupBy({
        by: ['projectId', 'completed'],
        where: whereIn,
        _count: { _all: true },
      }),
      prisma.aIActionItem.groupBy({
        by: ['projectId'],
        where: { ...whereIn, completed: false },
        _min: { createdAt: true },
        _max: { updatedAt: true },
      }),
      prisma.aIActionItem.groupBy({
        by: ['projectId'],
        where: { ...whereIn, completed: false, reportId: null },
        _count: { _all: true },
      }),
      prisma.uploadedReport.groupBy({
        by: ['projectId'],
        where: whereIn,
        _max: { createdAt: true },
      }),
    ]);

  return buildProjectsOverview(projects, {
    itemGroups,
    savedGroups,
    openAgeGroups,
    unassignedGroups,
    reportAgeGroups,
  });
}
