const UNIT_NAMES = {
  second: 'seconds',
  seconds: 'seconds',
  sec: 'seconds',
  secs: 'seconds',
  minute: 'minutes',
  minutes: 'minutes',
  min: 'minutes',
  mins: 'minutes',
  hour: 'hours',
  hours: 'hours',
  hr: 'hours',
  hrs: 'hours',
  day: 'days',
  days: 'days',
  week: 'weeks',
  weeks: 'weeks',
  month: 'months',
  months: 'months',
  year: 'years',
  years: 'years',
};

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function isValidTimeZone(timeZone) {
  if (!timeZone) return false;
  try {
    Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function readUserClock(input = {}) {
  const rawNow = String(input.now || input.nowIso || '').trim();
  const parsedNow = rawNow ? new Date(rawNow) : new Date();
  const now = Number.isNaN(parsedNow.getTime()) ? new Date() : parsedNow;
  const requestedZone = String(input.timeZone || input.timezone || '').trim();
  const timeZone = isValidTimeZone(requestedZone) ? requestedZone : '';
  const offset = Number(input.utcOffsetMinutes);
  return {
    now,
    timeZone: timeZone || 'UTC',
    utcOffsetMinutes: Number.isFinite(offset) ? offset : null,
    hasZone: Boolean(timeZone),
  };
}

function offsetParts(date, utcOffsetMinutes) {
  const shifted = new Date(date.getTime() + utcOffsetMinutes * 60000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    weekday: WEEKDAYS[shifted.getUTCDay()],
  };
}

export function partsInZone(date, clock = {}) {
  const zone = clock.timeZone;
  if (!clock.hasZone && Number.isFinite(clock.utcOffsetMinutes)) {
    return offsetParts(date, clock.utcOffsetMinutes);
  }
  if (!isValidTimeZone(zone)) {
    return offsetParts(date, -date.getTimezoneOffset());
  }
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: String(parts.weekday || '').toLowerCase(),
  };
}

export function zonedTimeToUtc(parts, clock = {}) {
  const desired = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour || 0,
    parts.minute || 0,
    parts.second || 0
  );
  if (!clock.hasZone && Number.isFinite(clock.utcOffsetMinutes)) {
    return new Date(desired - clock.utcOffsetMinutes * 60000);
  }
  let instant = new Date(desired);
  for (let index = 0; index < 4; index += 1) {
    const actual = partsInZone(instant, clock);
    const actualUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second
    );
    const diff = desired - actualUtc;
    if (diff === 0) return instant;
    instant = new Date(instant.getTime() + diff);
  }
  return instant;
}

export function formatInZone(date, clock = {}, options = {}) {
  const zone = clock.hasZone ? clock.timeZone : undefined;
  try {
    return new Date(date).toLocaleString('en-US', {
      timeZone: zone,
      ...options,
    });
  } catch {
    return new Date(date).toLocaleString('en-US', options);
  }
}

export function formatLocalIso(date, clock = {}, { seconds = false } = {}) {
  const parts = partsInZone(date, clock);
  const pad = (value) => String(value).padStart(2, '0');
  const base = `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
  return seconds ? `${base}:${pad(parts.second)}` : base;
}

function addCivilParts(parts, { years = 0, months = 0, days = 0 } = {}) {
  const probe = new Date(
    Date.UTC(parts.year + years, parts.month - 1 + months, parts.day + days, parts.hour, parts.minute, parts.second)
  );
  return {
    year: probe.getUTCFullYear(),
    month: probe.getUTCMonth() + 1,
    day: probe.getUTCDate(),
    hour: probe.getUTCHours(),
    minute: probe.getUTCMinutes(),
    second: probe.getUTCSeconds(),
  };
}

export function addDuration(date, amount = {}, clock = {}) {
  let instant = new Date(date.getTime());
  const ms =
    (Number(amount.seconds) || 0) * 1000 +
    (Number(amount.minutes) || 0) * 60 * 1000 +
    (Number(amount.hours) || 0) * 3600 * 1000;
  if (ms) instant = new Date(instant.getTime() + ms);
  const days = (Number(amount.days) || 0) + (Number(amount.weeks) || 0) * 7;
  const months = Number(amount.months) || 0;
  const years = Number(amount.years) || 0;
  if (days || months || years) {
    instant = zonedTimeToUtc(addCivilParts(partsInZone(instant, clock), { days, months, years }), clock);
  }
  return instant;
}

export function applyClockTime(date, time, clock = {}) {
  const parts = partsInZone(date, clock);
  return zonedTimeToUtc(
    {
      ...parts,
      hour: time.hour,
      minute: time.minute || 0,
      second: time.second || 0,
    },
    clock
  );
}

export function startOfZonedDay(date, clock = {}) {
  const parts = partsInZone(date, clock);
  return zonedTimeToUtc({ ...parts, hour: 0, minute: 0, second: 0 }, clock);
}

export function isPastZonedDay(value, clock = {}) {
  const start = new Date(value);
  if (Number.isNaN(start.getTime())) return false;
  const now = clock.now || new Date();
  return startOfZonedDay(start, clock).getTime() < startOfZonedDay(now, clock).getTime();
}

function parseAmount(token) {
  const text = String(token || '').toLowerCase();
  if (text === 'a' || text === 'an' || text === 'one') return 1;
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parseClockTime(text) {
  const value = String(text || '');
  const meridian = value.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (meridian) {
    let hour = Number(meridian[1]);
    const minute = Number(meridian[2] || 0);
    const suffix = String(meridian[3] || '').toLowerCase();
    if (suffix === 'pm' && hour < 12) hour += 12;
    if (suffix === 'am' && hour === 12) hour = 0;
    return { hour, minute, second: 0 };
  }
  return null;
}

function parseDurations(text) {
  const value = String(text || '');
  const amount = { seconds: 0, minutes: 0, hours: 0, days: 0, weeks: 0, months: 0, years: 0 };
  let found = false;
  const patterns = [
    /\b(?:in|after|within)\s+(\d+(?:\.\d+)?|an?|one)\s+(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?)\b/gi,
    /\b(?<!in\s)(?<!after\s)(?<!within\s)(\d+(?:\.\d+)?|an?|one)\s+(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?)\s+from\s+now\b/gi,
  ];
  for (const pattern of patterns) {
    let match = pattern.exec(value);
    while (match) {
      const qty = parseAmount(match[1]);
      const unit = UNIT_NAMES[String(match[2] || '').toLowerCase()];
      if (qty && unit) {
        amount[unit] += qty;
        found = true;
      }
      match = pattern.exec(value);
    }
  }
  const nextUnit = value.match(/\bnext\s+(week|month|year)\b/i);
  if (nextUnit) {
    amount[UNIT_NAMES[nextUnit[1].toLowerCase()]] += 1;
    found = true;
  }
  return found ? amount : null;
}

function parseNamedDay(text, clock) {
  const value = String(text || '').toLowerCase();
  const now = clock.now || new Date();
  if (/\btoday\b/.test(value)) return { date: now, precision: 'date' };
  if (/\btomorrow\b/.test(value)) {
    return { date: addDuration(now, { days: 1 }, clock), precision: 'date' };
  }
  const named = value.match(/\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (!named) return null;
  const parts = partsInZone(now, clock);
  const current = WEEKDAYS.indexOf(parts.weekday);
  const target = WEEKDAYS.indexOf(named[2]);
  let delta = (target - current + 7) % 7;
  if (delta === 0 || named[1]) delta = delta === 0 ? 7 : delta;
  return { date: addDuration(now, { days: delta }, clock), precision: 'date' };
}

export function inferWhen(text, clock = readUserClock()) {
  const value = String(text || '').trim();
  if (!value) return null;
  const iso = [...value.matchAll(/\b(20\d{2}-\d{2}-\d{2})(?:[T ](\d{1,2}:\d{2})(?::(\d{2}))?)?/g)];
  for (const match of iso) {
    const candidate = match[2]
      ? `${match[1]}T${String(match[2]).padStart(5, '0')}${match[3] ? `:${match[3]}` : ''}`
      : match[1];
    const date = parseZonedDate(candidate, clock);
    if (date) {
      return { date, precision: match[2] ? 'datetime' : 'date' };
    }
  }
  const monthName = value.match(
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:,)?\s+(20\d{2})(?:\s+(\d{1,2}):(\d{2})(?:\s*([ap]m))?)?/i
  );
  if (monthName) {
    const months = {
      jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
      may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
      september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
    };
    const month = months[monthName[1].toLowerCase()];
    let hour = 9;
    let minute = 0;
    if (monthName[4]) {
      hour = Number(monthName[4]);
      minute = Number(monthName[5] || 0);
      const suffix = String(monthName[6] || '').toLowerCase();
      if (suffix === 'pm' && hour < 12) hour += 12;
      if (suffix === 'am' && hour === 12) hour = 0;
    }
    return {
      date: zonedTimeToUtc(
        {
          year: Number(monthName[3]),
          month,
          day: Number(monthName[2]),
          hour,
          minute,
          second: 0,
        },
        clock
      ),
      precision: monthName[4] ? 'datetime' : 'date',
    };
  }

  const duration = parseDurations(value);
  const clockTime = parseClockTime(value);
  if (duration) {
    let date = addDuration(clock.now || new Date(), duration, clock);
    const exact =
      duration.seconds || duration.minutes || duration.hours || duration.days || duration.weeks || duration.months || duration.years;
    const civilOnly = !duration.seconds && !duration.minutes && !duration.hours;
    if (clockTime && civilOnly) date = applyClockTime(date, clockTime, clock);
    return { date, precision: civilOnly && !clockTime ? 'date' : exact ? 'datetime' : 'date' };
  }

  const day = parseNamedDay(value, clock);
  if (day) {
    const date = clockTime ? applyClockTime(day.date, clockTime, clock) : applyClockTime(day.date, { hour: 9, minute: 0 }, clock);
    return { date, precision: clockTime ? 'datetime' : 'date' };
  }
  if (clockTime && /\b(at|@)\b/.test(value)) {
    return { date: applyClockTime(clock.now || new Date(), clockTime, clock), precision: 'datetime' };
  }
  return null;
}

export function parseZonedDate(value, clock = readUserClock()) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  if (!text || /YYYY|MM-DD|HH:mm/i.test(text)) return null;
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(text)) {
    const next = new Date(text);
    return Number.isNaN(next.getTime()) ? null : next;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [year, month, day] = text.split('-').map(Number);
    return zonedTimeToUtc({ year, month, day, hour: 9, minute: 0, second: 0 }, clock);
  }
  const localDateTime = text.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (localDateTime) {
    const [, day, hour, minute, second = '0'] = localDateTime;
    const [year, month, date] = day.split('-').map(Number);
    return zonedTimeToUtc(
      {
        year,
        month,
        day: date,
        hour: Number(hour),
        minute: Number(minute),
        second: Number(second),
      },
      clock
    );
  }
  const next = new Date(text);
  return Number.isNaN(next.getTime()) ? null : next;
}

export function fallbackStartDate(clock = readUserClock(), { hour = 9, minute = 0 } = {}) {
  const tomorrow = addDuration(clock.now || new Date(), { days: 1 }, clock);
  return applyClockTime(tomorrow, { hour, minute, second: 0 }, clock);
}

export function resolveProposedStart({ rawStart, userMessage, prose, clock }) {
  const userWhen = inferWhen(userMessage, clock);
  const aiDate = parseZonedDate(rawStart, clock) || inferWhen(String(rawStart || ''), clock)?.date;
  if (userWhen?.precision === 'datetime') return userWhen.date;
  if (userWhen && aiDate) {
    const sameDay =
      startOfZonedDay(userWhen.date, clock).getTime() === startOfZonedDay(aiDate, clock).getTime();
    if (userWhen.precision === 'date' && sameDay) return aiDate;
    return userWhen.date;
  }
  if (userWhen) return userWhen.date;
  if (aiDate) return aiDate;
  const fromProse = inferWhen(prose, clock);
  if (fromProse) return fromProse.date;
  return fallbackStartDate(clock);
}

export function calendarClockPrompt(clock = readUserClock()) {
  const now = clock.now || new Date();
  const examples = [
    ['in 30 seconds', addDuration(now, { seconds: 30 }, clock)],
    ['in 5 minutes', addDuration(now, { minutes: 5 }, clock)],
    ['in 2 hours', addDuration(now, { hours: 2 }, clock)],
    ['in 1 day', addDuration(now, { days: 1 }, clock)],
    ['in 1 week', addDuration(now, { weeks: 1 }, clock)],
    ['in 1 month', addDuration(now, { months: 1 }, clock)],
    ['in 1 year', addDuration(now, { years: 1 }, clock)],
    ['no date (task default)', fallbackStartDate(clock)],
    ['no date (meeting default)', addDuration(now, { hours: 1 }, clock)],
  ];
  return [
    'USER LOCAL CLOCK',
    `Timezone: ${clock.timeZone}`,
    `Local now: ${formatInZone(now, clock, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    })}`,
    `Local now ISO: ${formatLocalIso(now, clock, { seconds: true })}`,
    'Use this clock for every date. Never use UTC or the server timezone.',
    'If the user gives relative time (seconds, minutes, hours, days, weeks, months, years), add it to local now.',
    'Examples from this clock:',
    ...examples.map(([label, date]) => `- "${label}" -> ${formatLocalIso(date, clock, { seconds: true })}`),
    'If they give no date, still emit a concrete local start using those units: tasks tomorrow 09:00 local, meetings 1 hour from now.',
    'Write start as local YYYY-MM-DDTHH:mm with no Z. Never pick a time already in the past.',
  ].join('\n');
}
