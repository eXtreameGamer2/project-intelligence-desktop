import { memo } from 'react';
import EmptyProjectsState from './EmptyProjectsState';

const CLUSTER_STYLES = {
  now: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
  'backed-up': 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  queued: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  idle: 'border-slate-700 bg-surface-800 text-slate-400',
};

function daysLabel(days) {
  if (days == null) return '—';
  if (days === 0) return 'today';
  if (days === 1) return '1 day';
  return `${days} days`;
}

function StatCard({ label, value, hint }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-surface-950/50 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function WorkBar({ value, max }) {
  const width = max > 0 ? Math.max(6, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
      <div className="h-full rounded-full bg-accent-500" style={{ width: `${width}%` }} />
    </div>
  );
}

function AttentionCard({ title, empty, items, onSelectProject }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-surface-950/40 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</p>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {items.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => onSelectProject?.(row.id)}
                className="w-full text-left"
              >
                <span className="font-medium text-slate-100 hover:text-white">{row.name}</span>
                <p className="mt-0.5 text-xs leading-5 text-slate-400">
                  {row.nextAction}
                  {row.nextActionSource === 'ai' ? (
                    <span className="ml-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent-300">
                      AI
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {row.open} open
                  {row.openHigh ? ` · ${row.openHigh} high` : ''}
                  {row.staleDays != null ? ` · ${daysLabel(row.staleDays)} quiet` : ''}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ClusterGroup({ cluster, rows, activeProjectId, onSelectProject }) {
  if (rows.length === 0) return null;

  return (
    <div className="rounded-xl border border-slate-800 bg-surface-950/30 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span
          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
            CLUSTER_STYLES[cluster.id] || CLUSTER_STYLES.idle
          }`}
        >
          {cluster.label}
        </span>
        <span className="text-[11px] text-slate-500">
          {cluster.count} project{cluster.count === 1 ? '' : 's'} · {cluster.open} open
        </span>
      </div>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              onClick={() => onSelectProject?.(row.id)}
              className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                row.id === activeProjectId
                  ? 'border-accent-500/40 bg-accent-500/10'
                  : 'border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="font-medium text-slate-100">{row.name}</span>
                <span className="shrink-0 text-[11px] text-slate-500">{row.sharePct}% of open</span>
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-400">
                {row.nextAction}
                {row.nextActionSource === 'ai' ? (
                  <span className="ml-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent-300">
                    AI
                  </span>
                ) : null}
              </p>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProjectsOverview({
  overview,
  activeProjectId,
  onSelectProject,
  isChoosing,
  hasAiChoices,
  onChoose,
  onCreateProject,
  isCreating = false,
}) {
  const totals = overview?.totals;
  const clusters = overview?.clusters || [];
  const rows = overview?.projects || [];
  const attention = overview?.attention || { scheduleNow: [], backedUp: [], stale: [] };
  const choices = overview?.choices;
  const focus = rows.find((row) => row.id === choices?.focusProjectId) || null;

  if (!totals || totals.projects === 0) {
    return (
      <EmptyProjectsState
        eyebrow="Portfolio"
        title="No projects yet"
        description="Create a project and import a report to see workload, priority, and scheduling clusters across your portfolio."
        onCreateProject={onCreateProject}
        isCreating={isCreating}
      />
    );
  }

  const maxOpen = Math.max(1, ...rows.map((row) => row.open + row.nextOpen));

  return (
    <div className="flex flex-col gap-5">
      <section className="panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              Portfolio
            </p>
            <h2 className="mt-1 text-2xl font-semibold text-white">Overview of projects</h2>
            <p className="mt-2 text-sm text-slate-300">{totals.headline}</p>
            {totals.headlineSource === 'ai' && (
              <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-accent-300">
                AI call
              </p>
            )}
            {isChoosing && (
              <p className="mt-2 text-xs text-slate-500">Overview AI is choosing where to start…</p>
            )}
          </div>
          <button
            type="button"
            className="btn-secondary shrink-0 px-3 py-2 text-sm"
            disabled={isChoosing}
            onClick={() => onChoose?.()}
          >
            {isChoosing ? 'Choosing…' : hasAiChoices ? 'Refresh AI call' : 'Choose with AI'}
          </button>
        </div>
      </section>

      {focus && (
        <section className="rounded-2xl border border-accent-500/30 bg-accent-500/10 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent-300">
            Start here
          </p>
          <button
            type="button"
            onClick={() => onSelectProject?.(focus.id)}
            className="mt-1 text-left text-lg font-semibold text-white hover:text-accent-100"
          >
            {focus.name}
          </button>
          {choices?.focusWhy && (
            <p className="mt-1 text-sm leading-6 text-slate-300">{choices.focusWhy}</p>
          )}
        </section>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard
          label="Open work"
          value={totals.open}
          hint={`${totals.progressPct}% of approaches done`}
        />
        <StatCard
          label="High priority"
          value={totals.openHigh}
          hint={`${totals.openMedium} medium · ${totals.openLow} low`}
        />
        <StatCard
          label="Schedule now"
          value={totals.scheduleNow}
          hint="Projects with high-priority leftover"
        />
        <StatCard
          label="Backed up"
          value={totals.backedUp}
          hint={`${totals.nextOpen} saved steps still open`}
        />
        <StatCard
          label="Gone quiet"
          value={totals.stale}
          hint={
            totals.oldestOpenDays != null
              ? `Oldest open item is ${daysLabel(totals.oldestOpenDays)} old`
              : 'No aging open items'
          }
        />
        <StatCard
          label="Step coverage"
          value={`${totals.coveragePct}%`}
          hint={
            totals.unassigned
              ? `${totals.unassigned} open items have no source file`
              : 'Open approaches with a saved next step'
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <AttentionCard
          title="Do next"
          empty="Nothing chosen to start right now."
          items={attention.scheduleNow}
          onSelectProject={onSelectProject}
        />
        <AttentionCard
          title="Backed-up queues"
          empty="No large waiting queues."
          items={attention.backedUp}
          onSelectProject={onSelectProject}
        />
        <AttentionCard
          title="Going stale"
          empty="Open work is still being touched."
          items={attention.stale}
          onSelectProject={onSelectProject}
        />
      </div>

      <section className="panel p-5">
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            Clustered schedule
          </p>
          <h3 className="text-lg font-semibold text-white">What to work, and in what order</h3>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {clusters.map((cluster) => (
            <ClusterGroup
              key={cluster.id}
              cluster={cluster}
              rows={rows.filter((row) => row.cluster === cluster.id)}
              activeProjectId={activeProjectId}
              onSelectProject={onSelectProject}
            />
          ))}
        </div>
      </section>

      <section className="panel p-5">
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            Project load
          </p>
          <h3 className="text-lg font-semibold text-white">All projects</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
                <th className="pb-2 font-semibold">Project</th>
                <th className="pb-2 font-semibold">Next action</th>
                <th className="pb-2 font-semibold">Open</th>
                <th className="pb-2 font-semibold">High / Med / Low</th>
                <th className="pb-2 font-semibold">Steps</th>
                <th className="pb-2 font-semibold">Progress</th>
                <th className="pb-2 font-semibold">Age</th>
                <th className="pb-2 font-semibold">Load</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="py-3 pr-3">
                    <button
                      type="button"
                      onClick={() => onSelectProject?.(row.id)}
                      className={`text-left font-medium hover:text-white ${
                        row.id === activeProjectId ? 'text-accent-300' : 'text-slate-100'
                      }`}
                    >
                      {row.name}
                    </button>
                    <p className="text-[11px] text-slate-500">
                      {row.reports} file{row.reports === 1 ? '' : 's'}
                      {row.unassigned ? ` · ${row.unassigned} unassigned` : ''}
                    </p>
                  </td>
                  <td className="max-w-[16rem] py-3 pr-3 text-xs leading-5 text-slate-300">
                    {row.nextAction}
                    {row.nextActionSource === 'ai' ? (
                      <span className="ml-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent-300">
                        AI
                      </span>
                    ) : null}
                  </td>
                  <td className="py-3 pr-3 text-slate-200">{row.open}</td>
                  <td className="py-3 pr-3 text-slate-200">
                    {row.openHigh} / {row.openMedium} / {row.openLow}
                  </td>
                  <td className="py-3 pr-3 text-slate-200">{row.nextOpen}</td>
                  <td className="py-3 pr-3 text-slate-200">{row.progressPct}%</td>
                  <td className="py-3 pr-3 text-slate-400">
                    {row.stale ? `${daysLabel(row.staleDays)} quiet` : daysLabel(row.oldestOpenDays)}
                  </td>
                  <td className="min-w-[6rem] py-3">
                    <WorkBar value={row.open + row.nextOpen} max={maxOpen} />
                    <p className="mt-1 text-[11px] text-slate-500">{row.sharePct}% of open</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default memo(ProjectsOverview);
