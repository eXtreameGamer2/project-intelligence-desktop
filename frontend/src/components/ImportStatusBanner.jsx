import AiProgress from './AiProgress';
import { IMPORT_PROGRESS_CLOCK_ID } from '../lib/jobProgress';

export default function ImportStatusBanner({ job, progress, onOpenProject, onCancel }) {
  if (!job) return null;

  return (
    <div className="mb-4 rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-300">
            Importing in background
          </p>
          <p className="mt-1 text-sm text-slate-200">
            {job.fileName} → {job.projectName}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            You can keep using Overview and Settings while this finishes.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {onOpenProject ? (
            <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={onOpenProject}>
              Open project
            </button>
          ) : null}
          {onCancel ? (
            <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={onCancel}>
              Cancel import
            </button>
          ) : null}
        </div>
      </div>
      <AiProgress
        active
        compact
        clockId={IMPORT_PROGRESS_CLOCK_ID}
        step={progress?.step}
        percent={progress?.percent}
        remainingMs={progress?.remainingMs}
        remainingAt={progress?.remainingAt}
        startedAt={progress?.startedAt}
        trained={progress?.trained}
      />
      {progress?.notice ? (
        <p className="mt-2 text-xs text-amber-200/90">{progress.notice}</p>
      ) : null}
    </div>
  );
}
