import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  priorityBadgeClass,
  priorityDisplayLabel,
  reportDisplayName,
  reportRefreshState,
} from '../lib/projectInsights';

function formatDate(value) {
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function sortApproaches(items) {
  return [...items].sort(
    (a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt)
  );
}

function FileRefreshButton({ canRefresh, expanding, onRefresh }) {
  const label = expanding
    ? 'Expanding findings…'
    : canRefresh
      ? 'Refresh findings'
      : 'Complete all approaches before refreshing findings';

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={!canRefresh || expanding}
      onClick={(event) => {
        event.stopPropagation();
        if (canRefresh && !expanding) onRefresh?.();
      }}
      className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition ${
        expanding
          ? 'border-sky-500/40 text-sky-300'
          : canRefresh
            ? 'border-sky-500/40 text-sky-300 hover:bg-sky-500/15 hover:text-sky-200'
            : 'cursor-not-allowed border-slate-800 text-slate-600'
      }`}
    >
      <svg
        viewBox="0 0 20 20"
        className={`h-3.5 w-3.5 ${expanding ? 'animate-spin' : ''}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 4.5v3.2h3.2" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.5 15.5v-3.2h-3.2" />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M5.2 14.2a6 6 0 0 0 9.6-2.7M14.8 5.8A6 6 0 0 0 5.2 8.5"
        />
      </svg>
    </button>
  );
}

function ApproachDeleteButton({ item, deleting, onDelete }) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div
        className="flex shrink-0 flex-col items-end gap-1"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="text-right text-[11px] text-rose-200/90">Delete this approach?</p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={deleting}
            onClick={async () => {
              try {
                await onDelete?.(item);
              } catch {
                // Keep the confirm so the approach can be retried or cancelled.
              }
            }}
            className="btn-primary px-2 py-1 text-xs"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={() => setConfirming(false)}
            className="btn-secondary px-2 py-1 text-xs"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-rose-300/80 transition hover:bg-rose-500/10 hover:text-rose-200"
      onClick={(event) => {
        event.stopPropagation();
        setConfirming(true);
      }}
    >
      Delete
    </button>
  );
}

function ApproachRow({ item, isLast, onToggle, onOpenItem, onDelete, isUpdatingId, deleting }) {
  return (
    <li className="relative pl-8">
      <span className="absolute left-[0.7rem] top-0 h-5 w-4 border-b border-l border-slate-700" />
      {!isLast && (
        <span className="absolute bottom-0 left-[0.7rem] top-5 border-l border-slate-700" />
      )}
      <div className="flex items-start gap-3 rounded-xl border border-slate-800 bg-surface-950/50 px-4 py-3 transition hover:border-slate-700">
        <input
          type="checkbox"
          checked={item.completed}
          disabled={isUpdatingId === item.id || deleting}
          onChange={() => onToggle(item)}
          onClick={(event) => event.stopPropagation()}
          className="mt-1 h-4 w-4 rounded border-slate-600 bg-surface-900 text-accent-500 focus:ring-accent-500/30"
        />
        <button
          type="button"
          onClick={() => onOpenItem?.(item.id)}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${priorityBadgeClass(item.priority)}`}>
              {priorityDisplayLabel(item.priority)}
            </span>
            <span
              className={`font-medium ${
                item.completed ? 'text-slate-500 line-through' : 'text-slate-100'
              }`}
            >
              {item.title}
            </span>
            {item.savedSuggestions?.length > 0 && (
              <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                {item.savedSuggestions.length > 1
                  ? `${item.savedSuggestions.length} steps`
                  : '1 saved'}
              </span>
            )}
          </div>
          {item.description && (
            <p className="mt-1 text-sm text-slate-400">{item.description}</p>
          )}
        </button>
        {onDelete ? (
          <ApproachDeleteButton item={item} deleting={deleting} onDelete={onDelete} />
        ) : null}
      </div>
    </li>
  );
}

function FileNicknameEditor({ report, onRename }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(report?.nickname || '');
  const inputRef = useRef(null);
  const nickname = String(report?.nickname || '').trim();

  useEffect(() => {
    if (editing) {
      setDraft(report?.nickname || '');
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing, report?.nickname]);

  const save = () => {
    const next = draft.trim();
    setEditing(false);
    if (next !== nickname) {
      onRename?.(report, next);
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={save}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            save();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            setEditing(false);
          }
        }}
        placeholder="Add a nickname"
        className="input-field max-w-[10rem] py-1 text-xs"
      />
    );
  }

  return (
    <button
      type="button"
      className="shrink-0 rounded-md px-2 py-1 text-[11px] text-slate-400 transition hover:bg-surface-800 hover:text-slate-200"
      onClick={(event) => {
        event.stopPropagation();
        setEditing(true);
      }}
    >
      {nickname ? 'Edit nickname' : 'Add nickname'}
    </button>
  );
}

function FileDeleteButton({ report, deleting, onDelete }) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div
        className="flex max-w-[14rem] shrink-0 flex-col items-end gap-1"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="text-right text-[11px] text-rose-200/90">
          Deletes this file and its approaches.
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={deleting}
            onClick={async () => {
              try {
                await onDelete?.(report);
              } catch {
                // Keep the confirm so the file can be retried or cancelled.
              }
            }}
            className="btn-primary px-2 py-1 text-xs"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={() => setConfirming(false)}
            className="btn-secondary px-2 py-1 text-xs"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-rose-300/80 transition hover:bg-rose-500/10 hover:text-rose-200"
      onClick={(event) => {
        event.stopPropagation();
        setConfirming(true);
      }}
    >
      Delete
    </button>
  );
}

function ReportApproachTree({
  reports,
  items,
  onToggle,
  onOpenItem,
  onRenameReport,
  onExpandReport,
  onDeleteReport,
  onDeleteItem,
  expandingReportId,
  isUpdatingId,
}) {
  const [deletingReportId, setDeletingReportId] = useState(null);
  const [deletingItemId, setDeletingItemId] = useState(null);
  const groups = useMemo(() => {
    const byReport = new Map((reports || []).map((report) => [report.id, []]));
    const unlinked = [];

    for (const item of items || []) {
      if (item.reportId && byReport.has(item.reportId)) {
        byReport.get(item.reportId).push(item);
      } else if (item.reportId) {
        unlinked.push(item);
      } else {
        unlinked.push(item);
      }
    }

    const fileGroups = (reports || []).map((report) => ({
      id: report.id,
      report,
      items: sortApproaches(byReport.get(report.id) || []),
    }));

    if (unlinked.length > 0) {
      fileGroups.push({
        id: 'unlinked',
        report: null,
        items: sortApproaches(unlinked),
      });
    }

    return fileGroups;
  }, [reports, items]);

  const [expandedIds, setExpandedIds] = useState(() =>
    new Set(groups.filter((group) => group.items.length > 0).map((group) => group.id))
  );
  const seenGroupIds = useRef(new Set(expandedIds));

  useEffect(() => {
    setExpandedIds((current) => {
      const next = new Set(current);
      for (const group of groups) {
        if (!seenGroupIds.current.has(group.id)) {
          seenGroupIds.current.add(group.id);
          if (group.items.length > 0) next.add(group.id);
        }
      }
      return next;
    });
  }, [groups]);

  const toggleGroup = (id) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <section className="panel p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            Source files
          </p>
          <h3 className="text-lg font-semibold text-white">Uploads and approaches</h3>
          <p className="mt-1 text-xs text-slate-500">
            Each uploaded file is the parent. Open it to see the AI approaches generated from it.
          </p>
        </div>
        <span className="rounded-full bg-surface-800 px-3 py-1 text-xs text-slate-400">
          {reports.length} file{reports.length === 1 ? '' : 's'}
        </span>
      </div>

      {groups.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-700 px-4 py-8 text-center text-sm text-slate-500">
          Upload a report to generate prioritized approaches.
        </p>
      ) : (
        <ol className="space-y-3">
          {groups.map((group) => {
            const expanded = expandedIds.has(group.id);
            const doneCount = group.items.filter((item) => item.completed).length;
            const fileComplete = group.items.length > 0 && doneCount === group.items.length;
            const refreshState = reportRefreshState(group.items);
            const fileTone = fileComplete
              ? 'border-emerald-500/40 bg-emerald-500/5'
              : 'border-sky-500/40 bg-sky-500/5';
            const fileNameTone = fileComplete ? 'text-emerald-400' : 'text-sky-400';
            const fileBadge = fileComplete
              ? 'bg-emerald-500/15 text-emerald-400'
              : 'bg-sky-500/15 text-sky-400';

            return (
              <li key={group.id} className={`rounded-2xl border ${fileTone}`}>
                <div className="flex w-full items-start gap-3 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.id)}
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-xs ${
                      fileComplete
                        ? 'border-emerald-500/40 text-emerald-400'
                        : 'border-sky-500/40 text-sky-400'
                    } ${expanded ? 'bg-surface-800/80' : ''}`}
                    aria-expanded={expanded}
                    aria-label={expanded ? 'Collapse file' : 'Expand file'}
                  >
                    {expanded ? '▾' : '▸'}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.id)}
                    className="min-w-0 flex-1 text-left"
                    aria-expanded={expanded}
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className={`font-medium ${fileNameTone}`}>
                        {group.report ? reportDisplayName(group.report) : 'Approaches without a source file'}
                      </span>
                      <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${fileBadge}`}>
                        {fileComplete ? 'Completed' : 'Open'}
                      </span>
                      {group.report && (
                        <span className="rounded-md bg-surface-800 px-2 py-0.5 text-[11px] uppercase text-slate-400">
                          {group.report.fileType}
                        </span>
                      )}
                    </span>
                    {group.report?.nickname && (
                      <span className="mt-0.5 block text-xs text-slate-500">{group.report.fileName}</span>
                    )}
                    <span className="mt-1 flex flex-wrap gap-3 text-xs text-slate-500">
                      {group.report && <span>{formatDate(group.report.createdAt)}</span>}
                      {group.report && <span>{formatSize(group.report.fileSize)}</span>}
                      <span>
                        {group.items.length} approach{group.items.length === 1 ? '' : 'es'}
                        {group.items.length > 0 ? ` · ${doneCount} done` : ''}
                      </span>
                    </span>
                  </button>
                  {group.report && refreshState.showRefresh && (
                    <FileRefreshButton
                      canRefresh={refreshState.canRefresh}
                      expanding={expandingReportId === group.report.id}
                      onRefresh={() => onExpandReport?.(group.report)}
                    />
                  )}
                  {group.report && deletingReportId !== group.report.id && (
                    <FileNicknameEditor report={group.report} onRename={onRenameReport} />
                  )}
                  {group.report && (
                    <FileDeleteButton
                      report={group.report}
                      deleting={deletingReportId === group.report.id}
                      onDelete={async (report) => {
                        if (!onDeleteReport) return;
                        setDeletingReportId(report.id);
                        try {
                          await onDeleteReport(report);
                        } finally {
                          setDeletingReportId((current) =>
                            current === report.id ? null : current
                          );
                        }
                      }}
                    />
                  )}
                </div>

                {expanded && (
                  <div className="border-t border-slate-800 px-3 pb-3 pt-2">
                    {group.items.length === 0 ? (
                      <p className="pl-8 text-sm text-slate-500">
                        No approaches were generated from this file.
                      </p>
                    ) : (
                      <ul className="relative space-y-2">
                        <span className="absolute bottom-4 left-[0.7rem] top-0 border-l border-slate-700" />
                        {group.items.map((item, index) => (
                          <ApproachRow
                            key={item.id}
                            item={item}
                            isLast={index === group.items.length - 1}
                            onToggle={onToggle}
                            onOpenItem={onOpenItem}
                            onDelete={
                              onDeleteItem
                                ? async (row) => {
                                    setDeletingItemId(row.id);
                                    try {
                                      await onDeleteItem(row);
                                    } finally {
                                      setDeletingItemId((current) =>
                                        current === row.id ? null : current
                                      );
                                    }
                                  }
                                : undefined
                            }
                            isUpdatingId={isUpdatingId}
                            deleting={deletingItemId === item.id}
                          />
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export default memo(ReportApproachTree);
