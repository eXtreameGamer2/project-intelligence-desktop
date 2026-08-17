import { useEffect, useRef, useState } from 'react';
import {
  applyProgressHint,
  createProgressClock,
  estimateFileJobMs,
  formatRemaining,
  getOrCreateProgressClock,
  snapshotProgressClock,
  tickProgressClock,
} from '../lib/jobProgress';

export default function AiProgress({
  active,
  step = 'Working',
  percent = 0,
  remainingMs = null,
  remainingAt = null,
  startedAt = null,
  trained = false,
  compact = false,
  clockId = null,
}) {
  const clockRef = useRef(null);
  const [view, setView] = useState(
    () =>
      snapshotProgressClock(clockId) || {
        percent: Math.max(1, Math.round(percent || 1)),
        remainingMs,
      }
  );

  useEffect(() => {
    if (!active) {
      clockRef.current = null;
      setView({ percent: 1, remainingMs: null });
      return undefined;
    }

    clockRef.current = clockId
      ? getOrCreateProgressClock(clockId, {
          startedAt: startedAt || Date.now(),
          remainingMs: remainingMs ?? estimateFileJobMs(0),
          percent,
          trained,
        })
      : createProgressClock({
          startedAt: startedAt || Date.now(),
          remainingMs: remainingMs ?? estimateFileJobMs(0),
          percent,
          trained,
        });

    const timer = setInterval(() => {
      setView(tickProgressClock(clockRef.current, Date.now()));
    }, 250);
    setView(tickProgressClock(clockRef.current, Date.now()));

    return () => clearInterval(timer);
  }, [active, startedAt, clockId]);

  useEffect(() => {
    if (!active || remainingMs == null || !clockRef.current) return;
    const hintKey = `${remainingAt ?? ''}:${Math.round(Number(remainingMs))}`;
    if (hintKey === clockRef.current.lastHintKey) return;
    clockRef.current.lastHintKey = hintKey;
    applyProgressHint(clockRef.current, remainingMs, Date.now(), { trained });
  }, [active, remainingMs, remainingAt, trained]);

  if (!active) return null;

  const safePercent = Math.max(1, Math.min(96, view.percent || Math.round(percent || 1)));
  const remainingLabel = formatRemaining(view.remainingMs);

  return (
    <div
      className={compact ? 'mt-2' : 'space-y-2'}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={safePercent}
      aria-label={step}
    >
      <div className="flex items-center justify-between gap-3">
        <p className={`font-medium text-slate-300 ${compact ? 'text-[11px]' : 'text-sm'}`}>
          {step}…
        </p>
        <p className={`shrink-0 font-semibold tabular-nums text-accent-300 ${compact ? 'text-[11px]' : 'text-sm'}`}>
          {safePercent}%
        </p>
      </div>
      <div className={`overflow-hidden rounded-full bg-slate-800 ${compact ? 'h-1.5' : 'h-2'}`}>
        <div
          className="ai-progress-fill h-full rounded-full bg-accent-500"
          style={{ width: `${safePercent}%` }}
        />
      </div>
      {remainingLabel ? (
        <p className={`text-slate-400 ${compact ? 'text-[11px]' : 'text-xs'}`}>{remainingLabel}</p>
      ) : null}
    </div>
  );
}
