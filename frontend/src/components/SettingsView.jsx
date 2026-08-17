import { useEffect, useRef, useState } from 'react';
import AiProgress from './AiProgress';
import UpdatePanel from './UpdatePanel';
import LegalNotice from './LegalNotice';
import {
  LOCALHOST_AI_HOST,
  LOCALHOST_AI_PORT,
  localhostAiUrl,
  parseLocalhostPort,
  MIN_MULTI_PASS_COUNT,
  MAX_MULTI_PASS_COUNT,
} from '../api/client';

const ENCRYPTION_TOOLTIP = 'Encrypted with AES-256-GCM';

function settingsDraftKey(settings = {}) {
  return JSON.stringify({
    provider: String(settings.provider || ''),
    baseUrl: String(settings.baseUrl || ''),
    modelName: String(settings.modelName || ''),
    apiKey: String(settings.apiKey || ''),
    clearApiKey: Boolean(settings.clearApiKey),
    localTrainingEnabled: Boolean(settings.localTrainingEnabled),
    multiPassImportEnabled: Boolean(settings.multiPassImportEnabled),
    multiPassImportCount: Number(settings.multiPassImportCount) || 0,
  });
}

export function settingsHaveUnsavedChanges(draft, saved) {
  return settingsDraftKey(draft) !== settingsDraftKey(saved);
}

function EncryptionLockIcon({ className = 'h-3.5 w-3.5' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="4" y="11" width="16" height="11" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      <circle cx="12" cy="16.5" r="1.25" fill="currentColor" stroke="none" />
    </svg>
  );
}

function EncryptionLockMark({ iconClassName = 'h-3.5 w-3.5', align = 'center' }) {
  const tooltipPosition =
    align === 'right' ? 'right-0' : 'left-1/2 -translate-x-1/2';

  return (
    <span className="group relative inline-flex items-center text-emerald-400">
      <EncryptionLockIcon className={iconClassName} />
      <span className="sr-only">{ENCRYPTION_TOOLTIP}</span>
      <span
        role="tooltip"
        className={`pointer-events-none absolute bottom-full z-20 mb-2 whitespace-nowrap rounded-md border border-slate-700 bg-surface-950 px-2 py-1 text-[11px] font-medium text-slate-200 opacity-0 shadow-lg transition group-hover:opacity-100 ${tooltipPosition}`}
      >
        {ENCRYPTION_TOOLTIP}
      </span>
    </span>
  );
}

function SettingSwitch({ enabled, disabled = false, label, onToggle }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${
        disabled ? 'cursor-not-allowed opacity-50' : ''
      } ${enabled ? 'bg-accent-500' : 'bg-slate-700'}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
          enabled ? 'left-5' : 'left-0.5'
        }`}
      />
    </button>
  );
}

export default function SettingsView({
  settings,
  onChange,
  onSave,
  onRemoveKey,
  onTest,
  onDeleteTraining,
  isDeletingTraining = false,
  testResult,
  isTesting,
  aiProgress,
  serverUnreachable = false,
  unsaved = false,
  saveAttention = 0,
  saveNotice = null,
  appVersion,
  onOpenPatchNotes,
  updateStatus,
  updateBusy = false,
  onCheckUpdates,
  onDownloadUpdate,
  onInstallUpdate,
}) {
  const [confirmDeleteTraining, setConfirmDeleteTraining] = useState(false);
  const [trainingDeleteResult, setTrainingDeleteResult] = useState(null);
  const [savePulsing, setSavePulsing] = useState(false);
  const saveButtonRef = useRef(null);

  useEffect(() => {
    if (!saveAttention) return undefined;
    saveButtonRef.current?.focus();
    setSavePulsing(true);
    const timer = window.setTimeout(() => setSavePulsing(false), 1800);
    return () => window.clearTimeout(timer);
  }, [saveAttention]);
  const handleLocalPortChange = (event) => {
    const raw = event.target.value;
    if (raw === '') return;
    const port = Number(raw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return;
    onChange({ ...settings, provider: 'localhost', baseUrl: localhostAiUrl(port) });
  };

  return (
    <>
    <div className={`mx-auto max-w-3xl space-y-6 ${unsaved ? 'pb-28' : ''}`}>
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
          Configuration
        </p>
        <h2 className="mt-1 text-2xl font-semibold text-white">Local AI Settings</h2>
        <p className="mt-2 text-sm text-slate-400">
          This desktop app talks only to an AI running on this computer. Start LM Studio or
          Ollama, then set the port and test the connection.
        </p>
      </div>

      <div className="panel space-y-5 p-6">
        {serverUnreachable && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm">
            <p className="font-semibold text-rose-300">The local AI server is unreachable.</p>
            <p className="mt-1 text-rose-200/90">
              Confirm the app is running on this computer, check the port, then use Test
              Connection.
            </p>
          </div>
        )}

        <div>
          <div className="grid grid-cols-[1fr_7.5rem] gap-3">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-300">
                Host
              </label>
              <input
                type="text"
                value={LOCALHOST_AI_HOST}
                readOnly
                disabled
                className="input-field cursor-not-allowed opacity-70"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-300">
                Port
              </label>
              <input
                type="number"
                min={1}
                max={65535}
                step={1}
                value={parseLocalhostPort(settings.baseUrl)}
                onChange={handleLocalPortChange}
                placeholder={String(LOCALHOST_AI_PORT)}
                className="input-field"
              />
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            The IP is locked to this computer. Change the port if your local AI server is not
            on 1234.
          </p>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-slate-300">
            Model Name
          </label>
          <input
            type="text"
            value={settings.modelName}
            onChange={(event) => onChange({ ...settings, modelName: event.target.value })}
            placeholder="Detected when you test the connection"
            className="input-field"
          />
          <p className="mt-2 text-xs text-slate-500">
            This must match the model currently loaded on the local AI. Test Connection updates it
            if it does not.
          </p>
        </div>

        <div>
          <label className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-300">
            API Key (optional)
            <EncryptionLockMark />
          </label>
          <div className="relative">
            <input
              type="password"
              value={settings.apiKey}
              onChange={(event) =>
                onChange({ ...settings, apiKey: event.target.value, clearApiKey: false })
              }
              placeholder={
                settings.hasApiKey && !settings.apiKey
                  ? 'Encrypted key saved — paste a new key to replace it'
                  : 'Optional token'
              }
              autoComplete="new-password"
              spellCheck={false}
              className="input-field pr-10"
            />
            <span className="absolute inset-y-0 right-3 flex items-center">
              <EncryptionLockMark iconClassName="h-4 w-4" align="right" />
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Optional. Stored encrypted. Sent only to the local server.
          </p>
          {settings.hasApiKey && !settings.apiKey && (
            <button
              type="button"
              onClick={onRemoveKey}
              className="mt-2 text-xs font-medium text-rose-300 hover:text-rose-200"
            >
              Remove saved key
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-3 pt-2">
          <button
            type="button"
            onClick={onTest}
            disabled={isTesting}
            className="btn-secondary"
          >
            {isTesting ? 'Testing…' : 'Test Connection'}
          </button>
        </div>

        {isTesting && (
          <AiProgress
            active={isTesting}
            step={aiProgress?.step}
            percent={aiProgress?.percent}
            remainingMs={aiProgress?.remainingMs}
            remainingAt={aiProgress?.remainingAt}
            startedAt={aiProgress?.startedAt}
            trained={aiProgress?.trained}
          />
        )}

        {testResult && (
          <div
            className={`rounded-xl px-4 py-3 text-sm ${
              testResult.ok
                ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border border-rose-500/30 bg-rose-500/10 text-rose-300'
            }`}
          >
            {testResult.message}
          </div>
        )}
      </div>

      <div className="panel space-y-4 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-white">Improve from past jobs</h3>
            <p className="mt-1 text-sm text-slate-400">
              Highly recommended. Uses successful imports, chats, and your corrections to make
              later replies more accurate, and to improve remaining-time estimates.
            </p>
          </div>
          <SettingSwitch
            enabled={Boolean(settings.localTrainingEnabled)}
            label="Use past jobs to improve replies and timing"
            onToggle={() => {
              const nextEnabled = !settings.localTrainingEnabled;
              onChange({
                ...settings,
                localTrainingEnabled: nextEnabled,
                multiPassImportEnabled: nextEnabled ? settings.multiPassImportEnabled : false,
              });
            }}
          />
        </div>
        <div className="space-y-2 text-sm leading-6 text-slate-300">
          <p>
            This does <span className="font-semibold text-white">not train a hosted AI model</span>.
            Nothing here is sent to OpenAI, Anthropic, or any hosted provider. Saved examples stay
            private on this machine.
          </p>
          <p>
            When this is on, successful imports, Overview portfolio replies, and Dashboard
            discussions with the connected AI can be kept as a small example set. If you say a
            reply was wrong, not helpful, too generic, or not what you wanted, that correction is
            stored and the next clean answer becomes the preferred style.
          </p>
          <p>
            Messy dumps, dump rewrites, generic portfolio recaps, and page-handoff lines are not
            saved as preferred Overview replies. Specific answers that name real projects can be.
          </p>
          <p>
            Imported files are formatted into labeled text before the model reads them. Saved
            examples help later wording; they do not replace that formatting. As replies already
            match what you want, fewer examples are sent. Completed jobs also improve remaining-time
            estimates and this model's limits. Turning this off stops saving new examples and
            stops using saved ones. Save Settings to apply.
          </p>
        </div>
        <div className="border-t border-slate-800 pt-4">
          <p className="text-sm font-medium text-white">Delete saved examples</p>
          <p className="mt-1 text-sm leading-6 text-slate-400">
            Removes saved examples and corrections for this account. Imported files and approaches
            stay. New examples can be saved again if Improve from past jobs is on.
          </p>
          {confirmDeleteTraining ? (
            <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3">
              <p className="text-sm text-rose-100">
                Delete all saved examples? This cannot be undone.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={isDeletingTraining}
                  onClick={async () => {
                    try {
                      const result = await onDeleteTraining?.();
                      const deleted = Number(result?.deleted) || 0;
                      setTrainingDeleteResult({
                        ok: true,
                        message: deleted
                          ? `Deleted ${deleted} saved example${deleted === 1 ? '' : 's'}.`
                          : 'No saved examples to delete.',
                      });
                      setConfirmDeleteTraining(false);
                    } catch (err) {
                      setTrainingDeleteResult({
                        ok: false,
                        message: err.message || 'Could not delete saved examples.',
                      });
                    }
                  }}
                >
                  {isDeletingTraining ? 'Deleting…' : 'Delete saved examples'}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={isDeletingTraining}
                  onClick={() => setConfirmDeleteTraining(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="btn-secondary mt-3"
              onClick={() => {
                setTrainingDeleteResult(null);
                setConfirmDeleteTraining(true);
              }}
            >
              Delete saved examples
            </button>
          )}
          {trainingDeleteResult && (
            <div
              className={`mt-3 rounded-xl px-4 py-3 text-sm ${
                trainingDeleteResult.ok
                  ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border border-rose-500/30 bg-rose-500/10 text-rose-300'
              }`}
            >
              {trainingDeleteResult.message}
            </div>
          )}
        </div>
      </div>

      <div className="panel space-y-4 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-white">Multi-pass imports</h3>
            <p className="mt-1 text-sm text-slate-400">
              Save the file first, then let the connected AI re-read it several times before creating approaches.
            </p>
          </div>
          <SettingSwitch
            enabled={Boolean(settings.multiPassImportEnabled)}
            disabled={!settings.localTrainingEnabled}
            label="Enable multi-pass imports"
            onToggle={() => {
              if (!settings.localTrainingEnabled) return;
              onChange({
                ...settings,
                multiPassImportEnabled: !settings.multiPassImportEnabled,
              });
            }}
          />
        </div>
        <div className="space-y-3 text-sm leading-6 text-slate-300">
          <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-100">
            Multi-pass may be slower, but when Improve from past jobs is on it can help later
            imports understand your file better.
          </p>
          {!settings.localTrainingEnabled && (
            <p className="text-amber-300/90">
              Improve from past jobs must be on to enable multi-pass imports. If multi-pass is off,
              files use the standard one-pass import.
            </p>
          )}
          {settings.localTrainingEnabled && (
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-300">
                Passes per import
              </label>
              <select
                value={settings.multiPassImportCount || MIN_MULTI_PASS_COUNT}
                disabled={!settings.multiPassImportEnabled}
                onChange={(event) =>
                  onChange({
                    ...settings,
                    multiPassImportCount: Number(event.target.value),
                  })
                }
                className="input-field max-w-[8rem]"
              >
                {Array.from(
                  { length: MAX_MULTI_PASS_COUNT - MIN_MULTI_PASS_COUNT + 1 },
                  (_, index) => MIN_MULTI_PASS_COUNT + index
                ).map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs text-slate-500">
                Each pass re-reads the saved file and can correct missed or misread items. Save
                Settings to apply.
              </p>
            </div>
          )}
        </div>
      </div>

      <UpdatePanel
        appVersion={appVersion}
        status={updateStatus}
        busy={updateBusy}
        onCheck={onCheckUpdates}
        onDownload={onDownloadUpdate}
        onInstall={onInstallUpdate}
        onOpenPatchNotes={onOpenPatchNotes}
      />

      <LegalNotice />
    </div>
    {unsaved ? (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-800 bg-surface-950/92 px-4 py-3 backdrop-blur md:px-6">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
        <p
          className={`text-sm font-medium ${
            saveNotice?.ok === false ? 'text-rose-300' : 'text-amber-300'
          } ${savePulsing ? 'unsaved-flash' : ''}`}
          aria-live="polite"
        >
          {saveNotice?.ok === false ? saveNotice.message : 'Changes are unsaved.'}
        </p>
        <button
          ref={saveButtonRef}
          type="button"
          onClick={onSave}
          className={`btn-primary ring-2 ring-amber-400/80 ring-offset-2 ring-offset-surface-950 ${
            savePulsing ? 'save-attention' : ''
          }`}
        >
          Save Settings
        </button>
      </div>
    </div>
    ) : null}
    </>
  );
}
