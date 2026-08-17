export const KIND_LABELS = {
  event: 'Event',
  task: 'Task',
  meeting: 'Meeting',
  unavailable: 'Unavailable',
};

export const STATUS_LABELS = {
  scheduled: 'Scheduled',
  ontime: 'On time',
  delayed: 'Delayed',
  completed: 'Completed',
};

export const STATUS_STYLES = {
  scheduled: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  ontime: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  delayed: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  completed: 'border-slate-700 bg-slate-800 text-slate-400',
};

export const KIND_STYLES = {
  event: 'text-violet-300',
  task: 'text-sky-300',
  meeting: 'text-emerald-300',
  unavailable: 'text-rose-300',
};

export function startOfDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function sameDay(a, b) {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

export function toDateInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function toDateTimeInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export function formatWhen(entry) {
  const start = new Date(entry.startAt);
  if (Number.isNaN(start.getTime())) return 'No time set';
  if (entry.allDay || entry.kind === 'unavailable') {
    return start.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
  const time = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const day = start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  if (!entry.endAt) return `${day} · ${time}`;
  const end = new Date(entry.endAt);
  return `${day} · ${time}–${end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

export function formatQuickWhen(entry, now = new Date()) {
  const start = new Date(entry.startAt);
  if (Number.isNaN(start.getTime())) return 'No time set';
  const today = startOfDay(now);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const time = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const day = start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const allDay = Boolean(entry.allDay || entry.kind === 'unavailable');
  if (start < today && entry.kind !== 'unavailable') {
    return allDay ? `Late · ${day}` : `Late · ${day} ${time}`;
  }
  if (sameDay(start, today)) return allDay ? 'Today' : `Today · ${time}`;
  if (sameDay(start, tomorrow)) return allDay ? 'Tomorrow' : `Tomorrow · ${time}`;
  return allDay ? day : `${day} · ${time}`;
}

export function clientClock() {
  const now = new Date();
  return {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    now: now.toISOString(),
    utcOffsetMinutes: -now.getTimezoneOffset(),
  };
}

export function monthCells(year, month) {
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}
