import AiProgress from './AiProgress';
import {
  IMPORT_FOCUS_OPTIONS,
  importFocusHint,
  importFocusReady,
} from '../lib/importFocus';
import { IMPORT_PROGRESS_CLOCK_ID } from '../lib/jobProgress';
import { acceptedUploads } from '../lib/uploadTypes';

export default function FileDropZone({
  onUpload,
  isUploading,
  aiProgress,
  disabled,
  multiPass = false,
  passCount = 1,
  importFocus,
  onImportFocusChange,
  onCancel,
}) {
  const focusReady = importFocusReady(importFocus);
  const blocked = disabled || isUploading || !focusReady;
  const allowStructured = Boolean(multiPass) && Number(passCount) >= 4 && Number(passCount) <= 8;

  const handleFiles = (files) => {
    const file = files?.[0];
    if (file && !blocked) onUpload(file);
  };

  const pickFiles = (event) => {
    handleFiles(event.target.files);
    event.target.value = '';
  };

  return (
    <div
      className={`panel relative border-dashed p-8 text-center transition ${
        disabled
          ? 'cursor-not-allowed opacity-50'
          : 'hover:border-accent-500/40 hover:bg-surface-800/40'
      }`}
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        if (!blocked) handleFiles(event.dataTransfer.files);
      }}
    >
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-500/10 text-2xl">
        📄
      </div>
      <h3 className="text-lg font-semibold text-white">Import Feedback Reports</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
        Supported: Word, PDF, PowerPoint, or text.
        <br />
        Note: CSV, Excel, ODS, JSON, and HTML needs multi-pass enabled with 4 to 8
        passes in Settings.
      </p>

      <div className="mx-auto mt-5 max-w-lg">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          Import target
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {IMPORT_FOCUS_OPTIONS.map((option) => {
            const selected = importFocus?.id === option.id;
            return (
              <button
                key={option.id}
                type="button"
                disabled={disabled || isUploading}
                onClick={(event) => {
                  event.stopPropagation();
                  onImportFocusChange?.({
                    id: option.id,
                    note: option.id === 'other' ? importFocus?.note || '' : '',
                  });
                }}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  selected
                    ? 'border-accent-500 bg-accent-500/15 text-accent-200'
                    : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-slate-500">{importFocusHint(importFocus)}</p>
        {importFocus?.id === 'other' && (
          <input
            type="text"
            value={importFocus.note || ''}
            disabled={disabled || isUploading}
            maxLength={200}
            placeholder="e.g. performance, onboarding, economy balance"
            onClick={(event) => event.stopPropagation()}
            onChange={(event) =>
              onImportFocusChange?.({ id: 'other', note: event.target.value })
            }
            className="input-field mx-auto mt-3 max-w-md text-sm"
          />
        )}
      </div>

      {multiPass && (
        <p className="mx-auto mt-3 max-w-md text-xs text-amber-200/90">
          Multi-pass import is on ({passCount} {passCount === 1 ? 'pass' : 'passes'}). The file is
          saved first, then re-read in the background. This may take longer.
        </p>
      )}

      <label className={`btn-primary mx-auto mt-5 inline-flex ${blocked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
        {isUploading ? 'Processing…' : 'Choose File'}
        <input
          type="file"
          accept={acceptedUploads({ structured: allowStructured })}
          className="hidden"
          disabled={blocked}
          onChange={pickFiles}
        />
      </label>
      {importFocus?.id === 'other' && !focusReady && (
        <p className="mt-2 text-xs text-amber-200/90">Enter a custom focus before importing.</p>
      )}

      {isUploading && (
        <div className="mx-auto mt-5 max-w-md text-left">
          <p className="mb-2 text-xs text-slate-500">
            This import keeps running if you switch to Overview or Settings.
          </p>
          <AiProgress
            active={isUploading}
            clockId={IMPORT_PROGRESS_CLOCK_ID}
            step={aiProgress?.step}
            percent={aiProgress?.percent}
            remainingMs={aiProgress?.remainingMs}
            remainingAt={aiProgress?.remainingAt}
            startedAt={aiProgress?.startedAt}
            trained={aiProgress?.trained}
          />
          {aiProgress?.notice ? (
            <p className="mt-2 text-xs text-amber-200/90">{aiProgress.notice}</p>
          ) : null}
          {onCancel ? (
            <button
              type="button"
              className="btn-secondary mt-3 px-3 py-1.5 text-xs"
              onClick={(event) => {
                event.stopPropagation();
                onCancel();
              }}
            >
              Cancel import
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
