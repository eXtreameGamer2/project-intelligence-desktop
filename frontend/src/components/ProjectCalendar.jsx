import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  KIND_LABELS,
  KIND_STYLES,
  STATUS_LABELS,
  STATUS_STYLES,
  formatWhen,
  monthCells,
  sameDay,
  startOfDay,
  toDateInput,
  toDateTimeInput,
} from '../lib/calendar';
import CalendarProposalCard from './CalendarProposalCard';
import { priorityDisplayLabel } from '../lib/projectInsights';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EMPTY_FORM = {
  kind: 'task',
  title: '',
  notes: '',
  startAt: '',
  endAt: '',
  allDay: false,
  status: 'scheduled',
  itemId: '',
};

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

function PopupSelect({ label, value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState({});
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.max(rect.width, 180);
      const left = Math.min(rect.left, window.innerWidth - width - 12);
      const below = rect.bottom + 8;
      const estimatedHeight = Math.min(options.length * 40 + 12, 320);
      const top =
        below + estimatedHeight > window.innerHeight - 12
          ? Math.max(12, rect.top - estimatedHeight - 8)
          : below;
      setMenuStyle({
        position: 'fixed',
        top,
        left: Math.max(12, left),
        width,
        zIndex: 120,
      });
    };
    place();
    const onPointer = (event) => {
      if (!buttonRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(false);
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, options.length]);

  return (
    <div className="block text-xs text-slate-400">
      {label}
      <button
        ref={buttonRef}
        type="button"
        className="input-field mt-1 flex w-full items-center justify-between text-left"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selected?.label || 'Choose'}</span>
        <span className="text-slate-500">{open ? '▴' : '▾'}</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            style={menuStyle}
            className="max-h-80 overflow-y-auto rounded-xl border border-slate-700 bg-surface-900 p-1 shadow-2xl"
          >
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={`flex w-full rounded-lg px-3 py-2 text-left text-sm ${
                  option.value === value
                    ? 'bg-accent-500/15 text-white'
                    : 'text-slate-200 hover:bg-surface-800'
                }`}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}

export default function ProjectCalendar({
  projectName,
  entries = [],
  proposals = [],
  actionItems = [],
  onCreate,
  onUpdate,
  onDelete,
  onOpenApproach,
  focusEntryId,
  onFocusHandled,
  onApplyProposal,
  onDismissProposal,
  proposalBusyId,
  proposalError,
}) {
  const today = startOfDay(new Date());
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState(today);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const sectionRef = useRef(null);
  const onFocusHandledRef = useRef(onFocusHandled);
  onFocusHandledRef.current = onFocusHandled;

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const cells = useMemo(() => monthCells(year, month), [year, month]);
  const approachOptions = useMemo(() => {
    const sorted = [...(actionItems || [])].sort((left, right) => {
      const done = Number(Boolean(left.completed)) - Number(Boolean(right.completed));
      if (done) return done;
      const priority = Number(left.priority || 3) - Number(right.priority || 3);
      if (priority) return priority;
      return String(left.title || '').localeCompare(String(right.title || ''));
    });
    return [
      { value: '', label: 'None' },
      ...sorted.map((item) => ({
        value: item.id,
        label: `${priorityDisplayLabel(item.priority)} · ${item.title}${item.completed ? ' (done)' : ''}`,
      })),
    ];
  }, [actionItems]);

  const overdue = entries.filter(
    (entry) => statusOf(entry) === 'delayed' && entry.kind !== 'unavailable'
  );
  const todayItems = entries.filter((entry) => sameDay(entry.startAt, today));
  const nextUp = entries
    .filter((entry) => new Date(entry.startAt) >= today && statusOf(entry) !== 'completed')
    .slice(0, 3);
  const selectedItems = entries.filter((entry) => sameDay(entry.startAt, selected));
  const pendingItems = (proposals || [])
    .filter((proposal) => proposal.action !== 'delete')
    .map((proposal) => {
      const payload = proposal.payload || {};
      const startAt = payload.startAt || payload.start;
      if (!startAt) return null;
      return {
        id: `pending:${proposal.id}`,
        title: payload.title || 'Proposed item',
        kind: payload.kind || 'task',
        startAt,
        pending: true,
        proposal,
      };
    })
    .filter(Boolean);
  const selectedPending = pendingItems.filter((entry) => sameDay(entry.startAt, selected));

  const openCreate = (date) => {
    setSelected(date);
    setEditing('new');
    setForm({
      ...EMPTY_FORM,
      startAt: `${toDateInput(date)}T09:00`,
    });
  };

  const openEdit = (entry) => {
    const start = new Date(entry.startAt);
    if (!Number.isNaN(start.getTime())) {
      setSelected(startOfDay(start));
      setCursor(new Date(start.getFullYear(), start.getMonth(), 1));
    }
    setEditing(entry.id);
    setForm({
      kind: entry.kind,
      title: entry.title,
      notes: entry.notes || '',
      startAt: entry.allDay ? toDateInput(entry.startAt) : toDateTimeInput(entry.startAt),
      endAt: entry.endAt ? toDateTimeInput(entry.endAt) : '',
      allDay: Boolean(entry.allDay) || entry.kind === 'unavailable',
      status: entry.status || 'scheduled',
      itemId: entry.itemId || '',
    });
  };

  const applyApproach = (itemId) => {
    const item = (actionItems || []).find((row) => row.id === itemId);
    setForm((current) => {
      const next = { ...current, itemId: itemId || '' };
      if (!item) return next;
      if (!String(current.title || '').trim()) next.title = item.title || '';
      if (!String(current.notes || '').trim()) next.notes = item.description || '';
      return next;
    });
  };

  const openLinkedApproach = (itemId) => {
    if (!itemId || !onOpenApproach) return;
    closeEditor();
    onOpenApproach(itemId);
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!form.title.trim() || saving || deletingId) return;
    setSaving(true);
    const payload = {
      ...form,
      title: form.title.trim(),
      startAt: form.allDay && form.startAt.length === 10 ? `${form.startAt}T09:00` : form.startAt,
      endAt: form.endAt || null,
      itemId: form.itemId || null,
    };
    try {
      if (editing && editing !== 'new') {
        await onUpdate?.(editing, payload);
      } else {
        await onCreate?.(payload);
      }
      setEditing(null);
      setForm(EMPTY_FORM);
    } finally {
      setSaving(false);
    }
  };

  const closeEditor = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
  };

  const handleDelete = async (entryId) => {
    if (!onDelete || !entryId || saving || deletingId) return;
    setDeletingId(entryId);
    try {
      await onDelete(entryId);
      if (editing === entryId) closeEditor();
    } finally {
      setDeletingId('');
    }
  };

  useEffect(() => {
    if (!focusEntryId) return;
    const entry = entries.find((row) => row.id === focusEntryId);
    if (!entry) return;
    openEdit(entry);
    requestAnimationFrame(() => {
      sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    onFocusHandledRef.current?.();
  }, [focusEntryId, entries]);

  useEffect(() => {
    if (!editing) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') closeEditor();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [editing]);

  return (
    <section ref={sectionRef} id="project-calendar" className="panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            Project calendar
          </p>
          <h3 className="mt-1 text-lg font-semibold text-white">What happens next</h3>
          <p className="mt-1 text-sm text-slate-400">
            One schedule for {projectName}. Tasks, meetings, events, and unavailable days stay here so
            you can move under pressure.
          </p>
        </div>
        <button type="button" className="btn-primary px-3 py-2 text-sm" onClick={() => openCreate(selected)}>
          Add to calendar
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-300">Delayed</p>
          <p className="mt-1 text-2xl font-semibold text-white">{overdue.length}</p>
        </div>
        <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-300">Today</p>
          <p className="mt-1 text-2xl font-semibold text-white">{todayItems.length}</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-surface-950/50 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Next up</p>
          <p className="mt-1 text-sm text-slate-200">
            {nextUp[0]?.title || 'Nothing scheduled'}
          </p>
        </div>
      </div>

      {proposals.length > 0 && (
        <div className="mt-4 space-y-2">
          {proposals.map((proposal) => (
            <CalendarProposalCard
              key={proposal.id}
              proposal={proposal}
              busyId={proposalBusyId}
              onApply={onApplyProposal}
              onDismiss={onDismissProposal}
              error={proposalError?.id === proposal.id ? proposalError.message : ''}
            />
          ))}
        </div>
      )}

      <div className="mt-5 flex items-center justify-between gap-3">
        <button
          type="button"
          className="btn-secondary px-3 py-1.5 text-sm"
          onClick={() => setCursor(new Date(year, month - 1, 1))}
        >
          Prev
        </button>
        <p className="text-sm font-semibold text-white">
          {cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </p>
        <button
          type="button"
          className="btn-secondary px-3 py-1.5 text-sm"
          onClick={() => setCursor(new Date(year, month + 1, 1))}
        >
          Next
        </button>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        {WEEKDAYS.map((day) => (
          <div key={day} className="py-1">
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((date) => {
          const inMonth = date.getMonth() === month;
          const isToday = sameDay(date, today);
          const isSelected = sameDay(date, selected);
          const dayEntries = entries.filter((entry) => sameDay(entry.startAt, date));
          const dayPending = pendingItems.filter((entry) => sameDay(entry.startAt, date));
          return (
            <button
              key={date.toISOString()}
              type="button"
              onClick={() => setSelected(date)}
              onDoubleClick={() => openCreate(date)}
              className={`min-h-[4.5rem] rounded-lg border px-1.5 py-1 text-left ${
                isSelected
                  ? 'border-accent-500/50 bg-accent-500/10'
                  : isToday
                    ? 'border-sky-500/40 bg-sky-500/5'
                    : 'border-slate-800 bg-surface-950/40'
              } ${inMonth ? 'text-slate-200' : 'text-slate-600'}`}
            >
              <span className="text-[11px] font-semibold">{date.getDate()}</span>
              <div className="mt-1 space-y-0.5">
                {dayEntries.slice(0, 3).map((entry) => (
                  <p
                    key={entry.id}
                    className={`truncate text-[10px] ${KIND_STYLES[entry.kind] || 'text-slate-400'}`}
                  >
                    {entry.title}
                  </p>
                ))}
                {dayPending.slice(0, Math.max(0, 3 - dayEntries.length)).map((entry) => (
                  <p key={entry.id} className="truncate text-[10px] text-accent-300">
                    {entry.title}
                  </p>
                ))}
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-5 rounded-xl border border-slate-800 bg-surface-950/40 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-white">
            {selected.toLocaleDateString(undefined, {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
          </p>
          <button type="button" className="text-xs text-accent-300" onClick={() => openCreate(selected)}>
            Schedule this day
          </button>
        </div>
        {selectedItems.length === 0 && selectedPending.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Nothing on this day yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {selectedItems.map((entry) => (
              <li
                key={entry.id}
                className={`flex items-start justify-between gap-3 rounded-lg border px-3 py-2 ${
                  editing === entry.id
                    ? 'border-accent-500/50 bg-accent-500/10'
                    : 'border-slate-800'
                }`}
              >
                <button type="button" className="min-w-0 text-left" onClick={() => openEdit(entry)}>
                  <p className="text-sm font-medium text-slate-100">{entry.title}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {KIND_LABELS[entry.kind]} · {formatWhen(entry)}
                  </p>
                  {entry.itemId && entry.itemTitle ? (
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
                        openLinkedApproach(entry.itemId);
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
                      disabled={Boolean(deletingId) || saving}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        handleDelete(entry.id);
                      }}
                    >
                      {deletingId === entry.id ? '…' : 'Delete'}
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
            {selectedPending.map((entry) => (
              <li
                key={entry.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-accent-500/30 bg-accent-500/10 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">{entry.title}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {KIND_LABELS[entry.kind] || 'Item'} · {formatWhen(entry)} · Needs your OK
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1">
                  <button
                    type="button"
                    className="btn-primary px-2 py-1 text-[10px]"
                    disabled={proposalBusyId === entry.proposal.id}
                    onClick={() => onApplyProposal?.(entry.proposal)}
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    className="btn-secondary px-2 py-1 text-[10px]"
                    disabled={proposalBusyId === entry.proposal.id}
                    onClick={() => onDismissProposal?.(entry.proposal)}
                  >
                    No thanks
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing &&
        createPortal(
          <div
            className="fixed inset-0 z-[90] flex items-center justify-center overflow-hidden bg-black/65 p-6 md:p-12"
            onClick={closeEditor}
          >
            <form
              role="dialog"
              aria-modal="true"
              aria-labelledby="calendar-item-title"
              className="discuss-window panel flex w-full max-w-lg flex-col overflow-hidden p-0 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
              onSubmit={submit}
            >
              <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-800 px-5 py-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Calendar
                  </p>
                  <h2 id="calendar-item-title" className="mt-1 text-lg font-semibold text-white">
                    {editing === 'new' ? 'Add calendar item' : 'Edit calendar item'}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={closeEditor}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-700 text-lg leading-none text-slate-300 transition hover:border-slate-500 hover:bg-surface-800 hover:text-white"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              <div className="space-y-3 overflow-y-auto px-5 py-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <PopupSelect
                    label="Type"
                    value={form.kind}
                    options={Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label }))}
                    onChange={(kind) =>
                      setForm((current) => ({
                        ...current,
                        kind,
                        allDay: kind === 'unavailable' ? true : current.allDay,
                      }))
                    }
                  />
                  <PopupSelect
                    label="Status"
                    value={form.status}
                    options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))}
                    onChange={(status) => setForm((current) => ({ ...current, status }))}
                  />
                </div>
                {approachOptions.length > 1 ? (
                  <PopupSelect
                    label="Approach"
                    value={form.itemId || ''}
                    options={approachOptions}
                    onChange={applyApproach}
                  />
                ) : null}
                <input
                  className="input-field"
                  value={form.title}
                  onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                  placeholder="Title"
                  required
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs text-slate-400">
                    Starts
                    <input
                      type={form.allDay ? 'date' : 'datetime-local'}
                      className="input-field mt-1"
                      value={form.startAt}
                      onChange={(event) => setForm((current) => ({ ...current, startAt: event.target.value }))}
                      required
                    />
                  </label>
                  <label className="text-xs text-slate-400">
                    Ends
                    <input
                      type="datetime-local"
                      className="input-field mt-1"
                      value={form.endAt}
                      onChange={(event) => setForm((current) => ({ ...current, endAt: event.target.value }))}
                      disabled={form.allDay}
                    />
                  </label>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={form.allDay}
                    onChange={(event) => setForm((current) => ({ ...current, allDay: event.target.checked }))}
                  />
                  All day / unavailable day
                </label>
                <textarea
                  className="input-field min-h-[4rem]"
                  value={form.notes}
                  onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="Notes"
                />
              </div>
              <div className="flex flex-wrap gap-2 border-t border-slate-800 px-5 py-4">
                <button type="submit" className="btn-primary px-3 py-2 text-sm" disabled={saving || Boolean(deletingId)}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  className="btn-secondary px-3 py-2 text-sm"
                  onClick={closeEditor}
                >
                  Cancel
                </button>
                {form.itemId && onOpenApproach ? (
                  <button
                    type="button"
                    className="btn-secondary px-3 py-2 text-sm text-accent-300"
                    onClick={() => openLinkedApproach(form.itemId)}
                  >
                    Open approach
                  </button>
                ) : null}
                {editing !== 'new' && (
                  <button
                    type="button"
                    className="btn-secondary px-3 py-2 text-sm text-rose-300"
                    disabled={saving || Boolean(deletingId)}
                    onClick={() => handleDelete(editing)}
                  >
                    {deletingId === editing ? 'Deleting…' : 'Delete'}
                  </button>
                )}
              </div>
            </form>
          </div>,
          document.body
        )}
    </section>
  );
}
