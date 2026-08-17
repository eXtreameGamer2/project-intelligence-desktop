import { estimateFileJobMs } from './jobProgress';

const TIMING_KEY = 'cpid-job-timing';
const MAX_SAMPLES = 24;

function storageKey(userId) {
  return userId ? `${TIMING_KEY}:${userId}` : TIMING_KEY;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function readSamples(userId) {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSamples(userId, samples) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(samples.slice(0, MAX_SAMPLES)));
  } catch {
    // Ignore quota failures.
  }
}

export function hasTrainedJobSamples(userId, job = 'import') {
  return readSamples(userId).some((row) => row.job === job && row.elapsedMs > 0);
}

export function recordLocalJobTiming(userId, sample) {
  const elapsedMs = Math.round(Number(sample?.elapsedMs) || 0);
  if (elapsedMs < 1500) return;
  const next = [
    {
      job: String(sample.job || 'import'),
      fileBytes: Math.max(0, Number(sample.fileBytes) || 0),
      passCount: Math.max(1, Number(sample.passCount) || 1),
      elapsedMs: Math.min(elapsedMs, 12 * 60 * 1000),
    },
    ...readSamples(userId),
  ].slice(0, MAX_SAMPLES);
  writeSamples(userId, next);
}

export function estimateTrainedFileJobMs(byteLength = 0, passCount = 1, { userId, trainingOn } = {}) {
  const fallback = estimateFileJobMs(byteLength, passCount);
  if (!trainingOn) return fallback;

  const targetBytes = Math.max(0, Number(byteLength) || 0);
  const targetPasses = Math.max(1, Number(passCount) || 1);
  const samples = readSamples(userId).filter((row) => row.job === 'import' && row.elapsedMs > 0);
  if (!samples.length) return fallback;

  let weight = 0;
  let total = 0;
  for (const sample of samples) {
    const sizeRatio = (targetBytes + 1) / (Math.max(0, sample.fileBytes) + 1);
    const passRatio = targetPasses / Math.max(1, sample.passCount || 1);
    const similarity = 1 / (1 + Math.abs(Math.log(Math.max(sizeRatio, 0.05))) * 0.9);
    if (similarity < 0.12) continue;
    weight += similarity;
    total += sample.elapsedMs * sizeRatio * passRatio * similarity;
  }
  if (weight <= 0) return fallback;
  const predicted = total / weight;
  return clamp(Math.round(fallback * 0.28 + predicted * 0.72), 8000, 180000 * targetPasses);
}
