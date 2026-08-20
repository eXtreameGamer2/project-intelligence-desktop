function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

const MAX_JOB_MS = 20 * 60 * 1000;
const IMPORT_WINDOW_MS = 56000;

export function estimateImportWindowCount(byteLength = 0) {
  const bytes = Math.max(0, Number(byteLength) || 0);
  if (bytes < 24000) return 1;
  return clamp(Math.ceil(bytes / 40000), 2, 8);
}

export function estimateFileJobMs(byteLength = 0, passCount = 1, windowCount = 0) {
  const kb = Math.max(0, Number(byteLength) || 0) / 1024;
  const passes = Math.max(1, Number(passCount) || 1);
  const windows = Math.max(1, Number(windowCount) || estimateImportWindowCount(byteLength));
  if (windows <= 1) {
    return clamp((16000 + kb * 220) * passes, 18000 * passes, MAX_JOB_MS);
  }
  return clamp(IMPORT_WINDOW_MS * windows * passes, 20000, MAX_JOB_MS);
}

export function percentFromTiming(elapsedMs, remainingMs) {
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  const remaining = Math.max(0, Number(remainingMs) || 0);
  const total = elapsed + remaining;
  if (total <= 0) return 1;
  return clamp((elapsed / total) * 100, 1, 96);
}

const MIN_REMAINING_MS = 8000;
const TOP_UP_MS = 22000;
const ADD_THRESHOLD_MS = 2500;
const FAST_DRAIN = 1.28;
const NORMAL_DRAIN = 1;

export function createProgressClock({
  startedAt = Date.now(),
  remainingMs = estimateFileJobMs(0),
  percent,
  trained = false,
} = {}) {
  const now = Date.now();
  const trusted = Boolean(trained);
  const remaining = trusted
    ? Math.max(0, Number(remainingMs) || estimateFileJobMs(0))
    : Math.max(MIN_REMAINING_MS, Number(remainingMs) || estimateFileJobMs(0));
  const elapsed = Math.max(0, now - startedAt);
  const fromTiming = percentFromTiming(elapsed, remaining);
  const seeded = Math.max(Number(percent) || 1, fromTiming);
  return {
    startedAt,
    remainingMs: remaining,
    sampledAt: now,
    percent: clamp(seeded, 1, 96),
    drainRate: NORMAL_DRAIN,
    lastHintKey: '',
    trained: trusted,
  };
}

const progressClocks = new Map();

export const IMPORT_PROGRESS_CLOCK_ID = 'import';

export function getOrCreateProgressClock(id, init) {
  if (!id) return createProgressClock(init);
  const existing = progressClocks.get(id);
  if (existing) {
    if (init?.trained) existing.trained = true;
    return existing;
  }
  const clock = createProgressClock(init);
  progressClocks.set(id, clock);
  return clock;
}

export function snapshotProgressClock(id, now = Date.now()) {
  const clock = id ? progressClocks.get(id) : null;
  if (!clock) return null;
  const remaining = liveRemaining(clock, now);
  return {
    percent: Math.floor(clock.percent),
    remainingMs: remaining,
    elapsedMs: Math.max(0, now - clock.startedAt),
  };
}

export function clearProgressClock(id) {
  if (id) progressClocks.delete(id);
}

function liveRemaining(clock, now) {
  const elapsedSinceSample = Math.max(0, now - clock.sampledAt);
  return Math.max(0, clock.remainingMs - elapsedSinceSample * (clock.drainRate || NORMAL_DRAIN));
}

function topUpIfStruggling(remaining, hintMs, trained = false) {
  if (trained) return remaining;
  const almostDone = hintMs != null && hintMs < 4000;
  if (almostDone) return remaining;
  if (remaining < MIN_REMAINING_MS) return Math.max(remaining + 14000, TOP_UP_MS);
  return remaining;
}

export function applyProgressHint(clock, hintMs, now = Date.now(), { trained } = {}) {
  if (!clock || hintMs == null || !Number.isFinite(Number(hintMs))) return clock;
  if (trained) clock.trained = true;
  const hint = Math.max(0, Number(hintMs));
  let remaining = liveRemaining(clock, now);

  if (hint > remaining + ADD_THRESHOLD_MS) {
    remaining = hint;
    clock.drainRate = NORMAL_DRAIN;
  } else if (hint < remaining * 0.55 && remaining > 12000) {
    clock.drainRate = FAST_DRAIN;
  } else if (hint >= remaining * 0.8) {
    clock.drainRate = NORMAL_DRAIN;
  }

  remaining = topUpIfStruggling(remaining, hint, clock.trained);
  clock.remainingMs = remaining;
  clock.sampledAt = now;
  return clock;
}

export function tickProgressClock(clock, now = Date.now()) {
  if (!clock) {
    return { percent: 1, remainingMs: null };
  }

  let remaining = liveRemaining(clock, now);
  remaining = topUpIfStruggling(remaining, null, clock.trained);
  clock.remainingMs = remaining;
  clock.sampledAt = now;

  const elapsed = Math.max(0, now - clock.startedAt);
  const target = percentFromTiming(elapsed, remaining);
  const dt = Math.max(16, now - (clock.lastTickAt || now - 250));
  clock.lastTickAt = now;

  if (target > clock.percent) {
    const maxStep = Math.max(0.3, (dt / 250) * 0.7);
    clock.percent = Math.min(96, clock.percent + Math.min(target - clock.percent, maxStep));
  }

  return {
    percent: Math.floor(clock.percent),
    remainingMs: remaining,
    elapsedMs: elapsed,
  };
}

export function formatRemaining(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return '';
  const seconds = Math.max(0, Math.ceil(Number(ms) / 1000));
  if (seconds <= 0) return 'Finishing…';
  if (seconds < 10) return 'A few seconds left';
  if (seconds < 90) return `About ${seconds}s left`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes === 1) return 'About 1 min left';
  return `About ${minutes} min left`;
}
