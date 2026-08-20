function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

const MAX_JOB_MS = 20 * 60 * 1000;
const IMPORT_WINDOW_MS = 56000;

export function estimateInputChars(payload) {
  try {
    return JSON.stringify(payload || '').length;
  } catch {
    return 0;
  }
}

export function expectedOutputChars(inputChars = 0) {
  return clamp(Math.round(Number(inputChars) * 0.1) || 2400, 1800, 14000);
}

export function estimateJobMs(inputChars = 0, expectedMs = null) {
  const trained = Number(expectedMs);
  if (Number.isFinite(trained) && trained > 0) {
    return clamp(trained, 3000, MAX_JOB_MS);
  }
  const writeMs = (expectedOutputChars(inputChars) / 36) * 1000;
  return clamp(4500 + writeMs + 2000, 14000, MAX_JOB_MS);
}

export function estimateImportWindowCount(byteLength = 0) {
  const bytes = Math.max(0, Number(byteLength) || 0);
  if (bytes < 24000) return 1;
  return clamp(Math.ceil(bytes / 40000), 2, 8);
}

export function estimateFileJobMs(byteLength = 0, passCount = 1, windowCount = 0) {
  const passes = Math.max(1, Number(passCount) || 1);
  const windows = Math.max(1, Number(windowCount) || estimateImportWindowCount(byteLength));
  if (windows <= 1) {
    const kb = Math.max(0, Number(byteLength) || 0) / 1024;
    return clamp((16000 + kb * 220) * passes, 18000 * passes, MAX_JOB_MS);
  }
  return clamp(IMPORT_WINDOW_MS * windows * passes, 20000, MAX_JOB_MS);
}

export function percentFromTiming(elapsedMs, remainingMs) {
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  const remaining = Math.max(0, Number(remainingMs) || 0);
  const total = elapsed + remaining;
  if (total <= 0) return 1;
  return clamp(Math.round((elapsed / total) * 100), 1, 96);
}

export function estimateRemainingMs({
  elapsedMs = 0,
  chars = 0,
  inputChars = 0,
  streaming = false,
  expectedMs = null,
} = {}) {
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  const outputChars = Math.max(0, Number(chars) || 0);
  const expectedChars = expectedOutputChars(inputChars);
  const plannedMs = estimateJobMs(inputChars, expectedMs);
  const writeMs = Math.max(8000, plannedMs - 6500);
  const harmonicLeft = plannedMs / (1 + elapsed / Math.max(plannedMs, 1));

  if (!streaming || outputChars < 40) {
    return Math.round(Math.max(harmonicLeft, writeMs * 0.7));
  }

  const fraction = Math.min(outputChars / expectedChars, 0.8);
  const outputLeftMs = (1 - fraction) * writeMs;
  return Math.round(Math.max(outputLeftMs * 0.55 + harmonicLeft * 0.45, harmonicLeft * 0.8));
}

export function createJobProgress({ inputChars = 0, step = 'Working', expectedMs = null } = {}) {
  const startedAt = Date.now();
  let chars = 0;
  let streaming = false;
  let currentStep = step;
  let lastEmitAt = 0;
  const trained = Number.isFinite(Number(expectedMs)) && Number(expectedMs) > 0;
  let remainingMs = estimateJobMs(inputChars, expectedMs);
  let sampledAt = startedAt;
  let lastPercent = 1;

  const snapshot = (done = false) => {
    const now = Date.now();
    const elapsedMs = now - startedAt;
    if (done) {
      return {
        step: 'Done',
        percent: 100,
        remainingMs: 0,
        elapsedMs,
      };
    }

    const dt = Math.max(0, now - sampledAt);
    remainingMs = Math.max(0, remainingMs - dt);
    const hint = estimateRemainingMs({
      elapsedMs,
      chars,
      inputChars,
      streaming,
      expectedMs,
    });

    if (hint > remainingMs + 2500) {
      remainingMs = hint;
    } else if (!trained && remainingMs < 8000) {
      remainingMs = Math.max(remainingMs + 14000, 22000);
    }

    sampledAt = now;
    lastPercent = Math.max(lastPercent, percentFromTiming(elapsedMs, remainingMs));
    lastPercent = Math.min(96, lastPercent);

    return {
      step: currentStep,
      percent: Math.floor(lastPercent),
      remainingMs: Math.round(remainingMs),
      elapsedMs,
      trained,
    };
  };

  return {
    setStep(nextStep) {
      if (nextStep) currentStep = nextStep;
      return snapshot();
    },
    markStreaming(nextChars = chars) {
      streaming = true;
      chars = Math.max(chars, nextChars);
      return snapshot();
    },
    snapshot,
    shouldEmit(force = false) {
      const now = Date.now();
      if (!force && now - lastEmitAt < 320) return false;
      lastEmitAt = now;
      return true;
    },
  };
}

export function formatRemaining(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return '';
  const seconds = Math.max(0, Math.round(Number(ms) / 1000));
  if (seconds <= 0) return 'Finishing…';
  if (seconds < 8) return 'A few seconds left';
  if (seconds < 55) return `About ${seconds}s left`;
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes === 1) return 'About 1 min left';
  return `About ${minutes} min left`;
}
