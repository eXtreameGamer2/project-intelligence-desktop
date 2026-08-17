export default function CalendarProposalCard({
  proposal,
  onApply,
  onDismiss,
  busyId,
  error,
}) {
  const payload = proposal.payload || {};
  const actionLabel =
    proposal.action === 'delete'
      ? 'Remove'
      : proposal.action === 'update'
        ? 'Change'
        : 'Add';
  const when = payload.startAt || payload.start;
  const busy = busyId === proposal.id;

  return (
    <div className="rounded-xl border border-accent-500/30 bg-accent-500/10 px-3 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-accent-300">
        Confirm to add · {actionLabel} {payload.kind || 'item'}
      </p>
      <p className="mt-1 text-sm font-medium text-white">{payload.title || 'Calendar change'}</p>
      {payload.itemTitle ? (
        <p className="mt-0.5 text-xs text-accent-300">Approach · {payload.itemTitle}</p>
      ) : null}
      <p className="mt-0.5 text-xs text-slate-400">
        {proposal.projectName ? `${proposal.projectName} · ` : ''}
        {when ? new Date(when).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Time to confirm'}
      </p>
      {error ? <p className="mt-2 text-xs text-rose-300">{error}</p> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary px-2.5 py-1 text-[11px]"
          disabled={busy}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!busy) onApply?.(proposal);
          }}
        >
          {busy ? 'Saving…' : 'Confirm'}
        </button>
        <button
          type="button"
          className="btn-secondary px-2.5 py-1 text-[11px]"
          disabled={busy}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!busy) onDismiss?.(proposal);
          }}
        >
          No thanks
        </button>
      </div>
    </div>
  );
}
