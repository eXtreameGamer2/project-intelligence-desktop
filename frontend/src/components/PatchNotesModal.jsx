import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { CURRENT_APP_VERSION, sortedPatchNotes } from '../lib/patchNotes';

function VersionBlock({ entry, currentVersion, emphasize }) {
  return (
    <article
      className={`rounded-xl border px-4 py-3 ${
        emphasize
          ? 'border-sky-500/30 bg-sky-500/10'
          : 'border-slate-800 bg-surface-950/70'
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">
          {entry.version}
          {entry.version === currentVersion ? (
            <span className="ml-2 text-[11px] font-medium uppercase tracking-wide text-sky-300">
              Current
            </span>
          ) : null}
        </h3>
        {entry.date ? <p className="text-xs text-slate-500">{entry.date}</p> : null}
      </div>
      <p className="mt-1 text-sm text-slate-300">{entry.title}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-400">
        {entry.changes.map((change) => (
          <li key={change}>{change}</li>
        ))}
      </ul>
    </article>
  );
}

export default function PatchNotesModal({
  isOpen,
  onClose,
  currentVersion = CURRENT_APP_VERSION,
  newEntries = [],
  showHistory = false,
}) {
  const [historyOpen, setHistoryOpen] = useState(showHistory);
  const allNotes = useMemo(() => sortedPatchNotes(), []);
  const latest = showHistory
    ? allNotes
    : newEntries.length
      ? newEntries
      : allNotes.slice(0, 1);
  const older = showHistory
    ? []
    : allNotes.filter((entry) => !latest.some((item) => item.version === entry.version));
  const isUpdate = newEntries.length > 0 && !showHistory;

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[180] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close patch notes backdrop"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="panel relative z-10 flex max-h-[calc(100dvh-3rem)] w-full max-w-lg flex-col overflow-hidden p-0">
        <div className="px-6 pb-2 pt-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            Patch notes
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-white">
            {isUpdate ? `Updated to ${currentVersion}` : `Version ${currentVersion}`}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            {isUpdate
              ? 'Here is what changed since the last version you ran.'
              : 'Progression of desktop app updates on this machine.'}
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
          {latest.map((entry) => (
            <VersionBlock
              key={entry.version}
              entry={entry}
              currentVersion={currentVersion}
              emphasize={entry.version === currentVersion}
            />
          ))}

          {older.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setHistoryOpen((open) => !open)}
                className="text-xs font-medium text-sky-300 hover:text-sky-200"
              >
                {historyOpen ? 'Hide earlier versions' : `Earlier versions (${older.length})`}
              </button>
              {historyOpen && (
                <div className="mt-3 space-y-3">
                  {older.map((entry) => (
                    <VersionBlock
                      key={entry.version}
                      entry={entry}
                      currentVersion={currentVersion}
                      emphasize={false}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-5">
          <button type="button" onClick={onClose} className="btn-primary w-full">
            Got it
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
