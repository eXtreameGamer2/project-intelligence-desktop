import { useEffect, useRef } from 'react';

function statusMessage(status, currentVersion) {
  if (!status) return 'Check for a newer installer when you want one.';
  if (status.state === 'checking') return 'Checking for updates…';
  if (status.state === 'downloading') {
    const percent = Number(status.percent);
    return Number.isFinite(percent) ? `Downloading update… ${percent}%` : 'Downloading update…';
  }
  if (status.state === 'ready') {
    return `Version ${status.latest || ''} is downloaded. Restart to install it.`;
  }
  if (status.state === 'installing') return 'Restarting to install the update…';
  if (status.state === 'available') {
    return `Version ${status.latest} is available. You are on ${status.current || currentVersion}.`;
  }
  if (status.state === 'error') {
    return status.message || 'Could not check for updates.';
  }
  if (status.unpublished) {
    return `This app is version ${status.current || currentVersion}. No published release was found yet.`;
  }
  return `This app is version ${status.current || currentVersion}. You are up to date.`;
}

export default function UpdatePanel({
  appVersion,
  status,
  busy = false,
  onCheck,
  onDownload,
  onInstall,
  onOpenPatchNotes,
  highlighted = false,
}) {
  const panelRef = useRef(null);
  const ready = status?.state === 'ready';
  const downloading = status?.state === 'downloading';
  const checking = status?.state === 'checking' || busy;
  const available = status?.state === 'available';
  const error = status?.state === 'error';

  useEffect(() => {
    if (!highlighted || !panelRef.current) return undefined;
    panelRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const focusTarget =
      panelRef.current.querySelector('[data-update-action]') || panelRef.current;
    if (typeof focusTarget.focus === 'function') {
      focusTarget.focus({ preventScroll: true });
    }
    return undefined;
  }, [highlighted]);

  return (
    <div
      id="settings-updates"
      ref={panelRef}
      tabIndex={-1}
      className={`panel space-y-4 p-6 outline-none transition ${
        highlighted
          ? 'border-amber-400/70 ring-2 ring-amber-400/50 ring-offset-2 ring-offset-surface-950'
          : ''
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-white">Updates</h3>
          <p className="mt-1 text-sm text-slate-400">{statusMessage(status, appVersion)}</p>
        </div>
        <p className="rounded-full border border-slate-700 bg-surface-950 px-3 py-1 text-xs text-slate-400">
          v{appVersion || '—'}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" disabled={checking || downloading || ready} onClick={onCheck}>
          {checking ? 'Checking…' : 'Check for updates'}
        </button>
        {ready ? (
          <button
            type="button"
            className="btn-primary"
            data-update-action=""
            onClick={onInstall}
          >
            Restart and install
          </button>
        ) : available ? (
          <button
            type="button"
            className="btn-primary"
            data-update-action=""
            disabled={checking}
            onClick={onDownload}
          >
            Download update
          </button>
        ) : null}
        {onOpenPatchNotes ? (
          <button type="button" className="btn-secondary" onClick={onOpenPatchNotes}>
            View patch notes
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="text-sm text-rose-300">{status.message}</p>
      ) : null}

      <p className="text-xs leading-5 text-slate-500">
        Installed copies can download the next GitHub release and restart to apply it. A development
        window opens the installer download instead.
      </p>
    </div>
  );
}
