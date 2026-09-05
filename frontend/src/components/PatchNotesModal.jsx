import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CURRENT_APP_VERSION,
  formatPatchNoteDate,
  partitionPatchNotesForDisplay,
  sortedPatchNotes,
} from '../lib/patchNotes';

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

function DayGroup({ group, currentVersion, emphasizeCurrent }) {
  const versionCount = group.entries.length;
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-800 pb-2">
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
          {formatPatchNoteDate(group.date)}
        </h3>
        <p className="text-[11px] text-slate-500">
          {versionCount === 1 ? '1 version' : `${versionCount} versions`}
        </p>
      </div>
      <div className="space-y-2">
        {group.entries.map((entry) => (
          <VersionBlock
            key={entry.version}
            entry={entry}
            currentVersion={currentVersion}
            emphasize={emphasizeCurrent && entry.version === currentVersion}
          />
        ))}
      </div>
    </section>
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
  const primaryEntries = useMemo(() => {
    if (showHistory) return allNotes;
    if (newEntries.length) return newEntries;
    return allNotes.slice(0, 1);
  }, [showHistory, newEntries, allNotes]);
  const { mainGroups, olderGroups, olderVersionCount } = useMemo(
    () => partitionPatchNotesForDisplay(allNotes, primaryEntries),
    [allNotes, primaryEntries]
  );
  const isUpdate = newEntries.length > 0 && !showHistory;
  const olderDayCount = olderGroups.length;

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
              ? 'Here is what changed since the last version you ran. Same-day releases are grouped together.'
              : 'Progression of desktop app updates on this machine, grouped by day.'}
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-4">
          {mainGroups.map((group) => (
            <DayGroup
              key={group.date}
              group={group}
              currentVersion={currentVersion}
              emphasizeCurrent
            />
          ))}

          {olderVersionCount > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setHistoryOpen((open) => !open)}
                className="text-xs font-medium text-sky-300 hover:text-sky-200"
              >
                {historyOpen
                  ? 'Hide earlier days'
                  : `Earlier days (${olderDayCount}, ${olderVersionCount} versions)`}
              </button>
              {historyOpen && (
                <div className="mt-3 space-y-5">
                  {olderGroups.map((group) => (
                    <DayGroup
                      key={group.date}
                      group={group}
                      currentVersion={currentVersion}
                      emphasizeCurrent={false}
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
