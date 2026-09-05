import AlphaChip from './AlphaChip';

function aiSettingsLabel(settings, hasSaved, unreachable) {
  if (!hasSaved) return 'Not connected';
  if (unreachable) return 'Localhost · Error connecting';
  const model = String(settings?.modelName || '').trim();
  return model ? `Localhost · ${model}` : 'Localhost';
}

export default function TopBar({
  user,
  aiSettings,
  hasSavedAiSettings = false,
  aiUnreachable = false,
  appVersion,
  onOpenPatchNotes,
  updateAvailable = false,
  updateReady = false,
  activeView,
  onNavigate,
  onOpenUpdates,
  onShareRoadmap,
  onSignOut,
  isSharing,
  shareUrl,
}) {
  const openUpdates = onOpenUpdates || (() => onNavigate('settings'));

  return (
    <header className="panel mb-4 flex shrink-0 flex-wrap items-center justify-between gap-4 px-5 py-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
          Project Intelligence
        </p>
        <div className="mt-0.5 flex items-center gap-2">
          <h1 className="text-xl font-semibold text-white">Local</h1>
          <AlphaChip />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded-full border border-slate-700 bg-surface-950 px-3 py-1 text-xs text-slate-400">
          {user?.email || 'Local demo'}
        </span>
        {onOpenPatchNotes && (
          <button
            type="button"
            onClick={onOpenPatchNotes}
            className="rounded-full border border-slate-700 bg-surface-950 px-3 py-1 text-xs text-slate-400 transition hover:border-sky-500/40 hover:text-sky-200"
            title="Open patch notes"
          >
            v{appVersion || '1.0.28'}
          </button>
        )}
        <button
          type="button"
          onClick={() => onNavigate('settings')}
          className={`rounded-full border px-3 py-1 text-xs transition ${
            !hasSavedAiSettings || aiUnreachable
              ? 'border-rose-500/40 bg-rose-500/10 text-rose-300 hover:border-rose-400/50 hover:text-rose-200'
              : 'border-sky-500/30 bg-sky-500/10 text-sky-300 hover:border-sky-400/50 hover:text-sky-200'
          }`}
          title={
            !hasSavedAiSettings
              ? 'No local AI saved. Open settings to connect.'
              : aiUnreachable
                ? 'AI server is unreachable. Open settings to verify and test the connection.'
                : 'Open AI settings'
          }
        >
          {aiSettingsLabel(aiSettings, hasSavedAiSettings, aiUnreachable)}
        </button>

        <button
          type="button"
          onClick={() => onNavigate('dashboard')}
          className={`btn-secondary ${activeView === 'dashboard' ? 'border-accent-500/50 text-white' : ''}`}
        >
          Dashboard
        </button>
        <button
          type="button"
          onClick={() => onNavigate('overview')}
          className={`btn-secondary ${activeView === 'overview' ? 'border-accent-500/50 text-white' : ''}`}
        >
          Overview
        </button>
        {(updateAvailable || updateReady) && activeView !== 'settings' && (
          <button
            type="button"
            onClick={openUpdates}
            className="update-available-pulse inline-flex items-center gap-2 rounded-xl border border-amber-300/70 bg-amber-400 px-4 py-2.5 text-sm font-semibold text-amber-950 transition hover:bg-amber-300"
            title={
              updateReady
                ? 'Restart from Settings to install the update'
                : 'Open Settings to download the update'
            }
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full bg-amber-950"
              aria-hidden="true"
            />
            {updateReady ? 'Restart to update' : 'Update available'}
          </button>
        )}
        <button
          type="button"
          onClick={() => onNavigate('settings')}
          className={`btn-secondary ${activeView === 'settings' ? 'border-accent-500/50 text-white' : ''}`}
        >
          Settings
        </button>
        {(updateAvailable || updateReady) && activeView === 'settings' && (
          <button
            type="button"
            onClick={openUpdates}
            className="rounded-xl border border-amber-500/50 bg-amber-500/15 px-3 py-2 text-xs font-semibold text-amber-200 transition hover:border-amber-400/60 hover:bg-amber-500/25"
            title={
              updateReady
                ? 'Restart from Settings to install the update'
                : 'Jump to the Updates section'
            }
          >
            {updateReady ? 'Restart to update' : 'Update available'}
          </button>
        )}

        <button
          type="button"
          onClick={onShareRoadmap}
          disabled={isSharing}
          className="btn-primary bg-gradient-to-r from-accent-500 to-indigo-500 hover:from-accent-600 hover:to-indigo-600"
        >
          {isSharing ? 'Generating…' : 'Share Project Roadmap'}
        </button>

        {onSignOut && (
          <button type="button" onClick={onSignOut} className="btn-secondary">
            Sign Out
          </button>
        )}
      </div>

      {shareUrl && (
        <div className="w-full rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-2 text-sm text-emerald-300">
          Roadmap link ready: <span className="font-mono">{shareUrl}</span>
        </div>
      )}
    </header>
  );
}
