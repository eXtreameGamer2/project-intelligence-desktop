import { useState } from 'react';
import {
  KIND_LABELS,
  STATUS_LABELS,
  STATUS_STYLES,
  formatQuickWhen,
  startOfDay,
} from '../lib/calendar';

function statusOf(entry) {
  if (entry.status === 'completed') return 'completed';
  if (entry.kind === 'unavailable') return 'scheduled';
  const start = new Date(entry.startAt);
  if (!Number.isNaN(start.getTime()) && startOfDay(start) < startOfDay(new Date())) {
    return 'delayed';
  }
  if (entry.status === 'ontime') return 'ontime';
  return 'scheduled';
}

function groupUpcoming(entries, now = new Date()) {
  const today = startOfDay(now);
  const late = [];
  const current = [];
  const next = [];
  for (const entry of entries || []) {
    const start = new Date(entry.startAt);
    if (Number.isNaN(start.getTime())) continue;
    const startDay = startOfDay(start);
    if (entry.kind !== 'unavailable' && (statusOf(entry) === 'delayed' || startDay < today)) {
      late.push(entry);
    } else if (startDay.getTime() === today.getTime()) {
      current.push(entry);
    } else {
      next.push(entry);
    }
  }
  return [
    { id: 'late', label: 'Late', items: late },
    { id: 'today', label: 'Today', items: current },
    { id: 'next', label: 'Coming up', items: next },
  ].filter((group) => group.items.length > 0);
}

function UpcomingRow({ entry, onOpenEntry, onOpenApproach, onDelete, deleting }) {
  return (
    <li className="rounded-lg border border-slate-800 px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => onOpenEntry?.(entry)}
          className="min-w-0 text-left"
        >
          <p className="truncate text-sm font-medium text-slate-100">{entry.title}</p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {entry.projectName || 'Project'} · {KIND_LABELS[entry.kind] || entry.kind} ·{' '}
            {formatQuickWhen(entry)}
          </p>
          {entry.itemTitle ? (
            <p className="mt-0.5 truncate text-[11px] text-slate-500">
              Approach · {entry.itemTitle}
            </p>
          ) : null}
        </button>
        <div className="flex shrink-0 items-center gap-1">
          {entry.itemId && onOpenApproach ? (
            <button
              type="button"
              className="rounded-lg px-2 py-0.5 text-[10px] font-semibold text-accent-300 hover:bg-accent-500/10"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onOpenApproach(entry);
              }}
            >
              Open approach
            </button>
          ) : null}
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
              STATUS_STYLES[statusOf(entry)] || STATUS_STYLES.scheduled
            }`}
          >
            {STATUS_LABELS[statusOf(entry)] || statusOf(entry)}
          </span>
          {onDelete ? (
            <button
              type="button"
              className="rounded-lg px-2 py-0.5 text-[10px] font-semibold text-rose-300 hover:bg-rose-500/10"
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onDelete(entry);
              }}
            >
              {deleting ? '…' : 'Delete'}
            </button>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export default function OverviewUpcoming({ entries = [], onOpenEntry, onOpenApproach, onDelete }) {
  const [deletingId, setDeletingId] = useState('');
  const groups = groupUpcoming(entries);

  const handleDelete = async (entry) => {
    if (!onDelete || deletingId) return;
    setDeletingId(entry.id);
    try {
      await onDelete(entry);
    } finally {
      setDeletingId('');
    }
  };

  return (
    <section className="panel p-5">
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
          Schedule
        </p>
        <h3 className="mt-1 text-lg font-semibold text-white">Upcoming</h3>
        <p className="mt-1 text-sm text-slate-400">
          Quick details across projects. Click an item to open it on that project’s calendar.
        </p>
      </div>

      {groups.length === 0 ? (
        <p className="text-sm text-slate-500">
          Nothing upcoming. Schedule from a project, or ask Overview AI.
        </p>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group.id}>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                {group.label}
              </p>
              <ul className="space-y-2">
                {group.items.map((entry) => (
                  <UpcomingRow
                    key={entry.id}
                    entry={entry}
                    onOpenEntry={onOpenEntry}
                    onOpenApproach={onOpenApproach}
                    onDelete={onDelete ? handleDelete : undefined}
                    deleting={deletingId === entry.id}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
