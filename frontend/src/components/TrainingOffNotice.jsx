const NOTICE_KEY = 'pi-training-off-notice-dismissed';

function storageKey(userId) {
  return `${NOTICE_KEY}:${userId || 'anon'}`;
}

export function isTrainingOffNoticeDismissed(userId) {
  try {
    return sessionStorage.getItem(storageKey(userId)) === '1';
  } catch {
    return false;
  }
}

export function dismissTrainingOffNotice(userId) {
  try {
    sessionStorage.setItem(storageKey(userId), '1');
  } catch {
    // Private mode can block sessionStorage; in-memory dismiss still applies.
  }
}

export default function TrainingOffNotice({ onOpenSettings, onDismiss }) {
  return (
    <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-300">
            Improve from past jobs is off
          </p>
          <p className="mt-1 text-sm leading-6 text-amber-50/95">
            Turning this on in Settings is highly recommended. The app can then use successful
            jobs and your corrections to improve later replies. This stays private and does not
            train a hosted AI model.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {onOpenSettings ? (
            <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={onOpenSettings}>
              Open Settings
            </button>
          ) : null}
          <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
