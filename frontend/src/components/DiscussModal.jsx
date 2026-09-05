import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ChatMarkdown from './ChatMarkdown';
import AiProgress from './AiProgress';
import CalendarProposalCard from './CalendarProposalCard';
import { activeSaves, displayStepForSuggestion, withInferredProcedure } from '../lib/saveSteps';
import { displayAssistantContent } from '../lib/aiDisplay';
import { ACCEPTED_UPLOADS } from '../lib/uploadTypes';
import ReasoningToggle from './ReasoningToggle';

function latestAnalysis(analyses) {
  return [...analyses].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )[0] || null;
}

function linkedIdsFromAnalysis(analysis, savedSuggestions) {
  if (!analysis) return [];
  const savedIds = new Set(activeSaves(savedSuggestions).map((entry) => entry.id));
  return (analysis.snapshot || [])
    .map((saved) => saved.id)
    .filter((id) => savedIds.has(id));
}

function SuggestionCard({
  item,
  suggestion,
  savedSuggestions,
  savingKey,
  highlighted,
  scrollTarget,
  focusedSuggestionRef,
  onSaveSuggestion,
  onUnsaveSuggestion,
  onCompleteSuggestion,
}) {
  const suggestionKey = `${item.id}:${suggestion.title}`;
  const isSaving = savingKey === suggestionKey;
  const activeSaved = activeSaves(savedSuggestions);
  const saveLimitReached = activeSaved.length >= 3 && !suggestion.saved && !suggestion.completed;
  const displayStep = displayStepForSuggestion(suggestion, savedSuggestions);
  const done = Boolean(suggestion.completed);

  return (
    <div
      ref={scrollTarget ? focusedSuggestionRef : undefined}
      className={`rounded-lg border px-3 py-2 ${
        highlighted
          ? 'border-accent-500/70 bg-accent-500/10'
          : 'border-slate-800 bg-surface-950/70'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {displayStep?.stepLabel && (
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-accent-300">
              {displayStep.stepLabel}
            </p>
          )}
          <p
            className={`break-words text-sm font-medium ${
              done ? 'text-slate-500 line-through' : 'text-slate-100'
            }`}
          >
            {suggestion.title}
          </p>
        </div>
        {done ? (
          <span className="shrink-0 rounded-lg bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-slate-400">
            Completed
          </span>
        ) : (
          <button
            type="button"
            className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
              suggestion.saved
                ? 'bg-accent-500/15 text-accent-300 hover:bg-accent-500/25'
                : 'border border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white'
            }`}
            disabled={isSaving || saveLimitReached}
            onClick={() =>
              suggestion.saved
                ? onUnsaveSuggestion?.(item, suggestion)
                : onSaveSuggestion?.(item, suggestion)
            }
          >
            {isSaving
              ? 'Saving…'
              : suggestion.saved
                ? displayStep?.stepWord || 'Saved'
                : saveLimitReached
                  ? 'Limit'
                  : 'Save'}
          </button>
        )}
      </div>
      {suggestion.detail && (
        <p
          className={`mt-1 break-words text-xs leading-5 ${
            done ? 'text-slate-600 line-through' : 'text-slate-400'
          }`}
        >
          {suggestion.detail}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {done ? (
          <button
            type="button"
            className="btn-secondary px-2.5 py-1 text-[11px]"
            disabled={isSaving}
            onClick={() => onCompleteSuggestion?.(item, suggestion, false)}
          >
            {isSaving ? 'Undoing…' : 'Undo'}
          </button>
        ) : (
          <button
            type="button"
            className="btn-secondary px-2.5 py-1 text-[11px]"
            disabled={isSaving}
            onClick={() => onCompleteSuggestion?.(item, suggestion, true)}
          >
            {isSaving ? 'Completing…' : 'Mark as Complete'}
          </button>
        )}
      </div>
    </div>
  );
}

function FileAnalysisMessage({ analysis }) {
  const sources = analysis.snapshot || [];
  const linked = sources.length > 1;

  return (
    <div className="mr-4 rounded-xl bg-surface-800 px-4 py-3">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        AI · File comparison
      </p>
      <p className="text-sm font-medium text-slate-100">{analysis.fileName}</p>
      {sources.length > 0 && (
        <div className="mt-2 rounded-lg border border-slate-700 bg-surface-950/70 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            {linked
              ? 'This comparison is based on these linked saved suggestions'
              : 'This comparison is based on'}
          </p>
          <ul className="mt-1 space-y-1">
            {sources.map((source, index) => (
              <li key={source.id || `${source.title}-${index}`} className="text-xs text-slate-300">
                {linked ? `${index + 1}. ` : ''}
                {source.title}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-3">
        <ChatMarkdown content={displayAssistantContent(analysis.analysis) || analysis.analysis} />
      </div>
    </div>
  );
}

export default function DiscussModal({
  item,
  proposals = [],
  onClose,
  onDiscuss,
  onLoadSuggestions,
  onSaveSuggestion,
  onUnsaveSuggestion,
  onCompleteSuggestion,
  onAnalyzeFile,
  onApplyProposal,
  onDismissProposal,
  onDeleteItem,
  isDeleting,
  proposalBusyId,
  proposalError,
  isSuggesting,
  isDiscussing,
  savingKey,
  analyzingSavedId,
  focusSavedId,
  aiProgress,
  reasoningEnabled = true,
  onReasoningChange,
  showReasoning = false,
}) {
  const [draft, setDraft] = useState('');
  const [pendingUpload, setPendingUpload] = useState(null);
  const [linkHighlight, setLinkHighlight] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputRef = useRef(null);
  const threadRef = useRef(null);
  const focusedSuggestionRef = useRef(null);
  const discussion = item.discussion || [];
  const suggestions = withInferredProcedure(item.suggestions || []);
  const analyses = item.suggestionAnalyses || [];
  const savedSuggestions = item.savedSuggestions || [];
  const activeSaved = activeSaves(savedSuggestions);
  const usingSaveOrder = activeSaved.length > 1;
  const latest = latestAnalysis(analyses);
  const latestAnalysisId = latest?.id || null;
  const savedIdKey = savedSuggestions.map((entry) => entry.id).sort().join(',');
  const highlightedSavedIds = new Set(
    (linkHighlight?.ids || (focusSavedId ? [focusSavedId] : [])).filter(Boolean)
  );
  const threadItems = [
    ...discussion.map((message) => ({
      type: 'message',
      at: message.createdAt,
      id: message.id,
      message,
    })),
    ...analyses.map((analysis) => ({
      type: 'analysis',
      at: analysis.createdAt,
      id: analysis.id,
      analysis,
    })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  useEffect(() => {
    if (!item.suggestions?.length && !isSuggesting) {
      onLoadSuggestions?.(item);
    }
  }, [item.id]);

  useEffect(() => {
    inputRef.current?.focus();

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [discussion.length, analyses.length, isDiscussing, analyzingSavedId]);

  useEffect(() => {
    if (focusSavedId && focusedSuggestionRef.current) {
      focusedSuggestionRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, [focusSavedId, suggestions.length]);

  useEffect(() => {
    const ids = linkedIdsFromAnalysis(latest, savedSuggestions);
    if (ids.length === 0) return;
    setLinkHighlight((prev) => ({
      sourceId: prev?.sourceId && ids.includes(prev.sourceId) ? prev.sourceId : ids[0],
      ids,
    }));
  }, [latestAnalysisId]);

  useEffect(() => {
    if (!linkHighlight) return;
    const currentIds = new Set(savedSuggestions.map((entry) => entry.id));
    const stillLinked = linkHighlight.ids.filter((id) => currentIds.has(id));
    const savedChanged =
      stillLinked.length !== linkHighlight.ids.length ||
      savedSuggestions.length !== linkHighlight.ids.length;
    if (!savedChanged) return;
    setLinkHighlight({
      sourceId: linkHighlight.sourceId,
      ids: currentIds.has(linkHighlight.sourceId) ? [linkHighlight.sourceId] : [],
    });
  }, [savedIdKey]);

  const otherSaved = pendingUpload
    ? activeSaved.filter((entry) => entry.id !== pendingUpload.suggestion.savedId)
    : [];

  const startUpload = (file, suggestion) => {
    if (!file || !suggestion?.savedId) return;
    const others = activeSaved.filter((entry) => entry.id !== suggestion.savedId);
    if (others.length > 0) {
      setPendingUpload({ file, suggestion });
      return;
    }
    setLinkHighlight({ sourceId: suggestion.savedId, ids: [suggestion.savedId] });
    onAnalyzeFile?.(item, file, suggestion, []);
  };

  const startApproachUpload = (file) => {
    if (!file || activeSaved.length === 0) return;
    const source = {
      savedId: activeSaved[0].id,
      title: activeSaved[0].title,
    };
    startUpload(file, source);
  };

  const confirmLinkedUpload = (linkOthers) => {
    if (!pendingUpload) return;
    const { file, suggestion } = pendingUpload;
    const ids = linkOthers
      ? activeSaved.map((entry) => entry.id)
      : [suggestion.savedId];
    setLinkHighlight({ sourceId: suggestion.savedId, ids });
    setPendingUpload(null);
    onAnalyzeFile?.(item, file, suggestion, linkOthers ? ids : []);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || isDiscussing) return;

    setDraft('');
    await onDiscuss(item, message);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center overflow-hidden bg-black/65 p-3 sm:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="discuss-modal-title"
        className="discuss-window panel flex max-h-full w-full max-w-xl min-h-0 min-w-0 flex-col overflow-hidden p-0 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-800 px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Discuss this approach
            </p>
            <h2
              id="discuss-modal-title"
              className="mt-1 max-h-[min(4.5rem,14dvh)] overflow-y-auto pr-1 text-lg font-semibold leading-6 text-white break-words"
            >
              {item.title}
            </h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              This thread is for this approach. Open Overview for portfolio clustering or
              cross-project scheduling.
            </p>
            {item.description && (
              <p className="mt-1 max-h-[min(7rem,18dvh)] overflow-y-auto pr-1 text-sm leading-5 text-slate-400 whitespace-pre-wrap">
                {item.description}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-start gap-2">
            {onDeleteItem ? (
              confirmDelete ? (
                <div className="flex flex-col items-end gap-1">
                  <p className="text-right text-[11px] text-rose-200/90">Delete this approach?</p>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={isDeleting || isDiscussing}
                      onClick={async () => {
                        try {
                          await onDeleteItem?.(item);
                        } catch {
                          // Keep the confirm so the approach can be retried or cancelled.
                        }
                      }}
                      className="btn-primary px-2 py-1 text-xs"
                    >
                      {isDeleting ? 'Deleting…' : 'Delete'}
                    </button>
                    <button
                      type="button"
                      disabled={isDeleting}
                      onClick={() => setConfirmDelete(false)}
                      className="btn-secondary px-2 py-1 text-xs"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={isDeleting || isDiscussing}
                  onClick={() => setConfirmDelete(true)}
                  className="rounded-xl border border-slate-700 px-3 py-2 text-xs font-medium text-rose-300/80 transition hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-200"
                >
                  Delete
                </button>
              )
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-700 text-lg leading-none text-slate-300 transition hover:border-slate-500 hover:bg-surface-800 hover:text-white"
              aria-label="Close discussion"
            >
              ×
            </button>
          </div>
        </div>

        {proposals.length > 0 && (
          <div className="max-h-[min(12rem,22dvh)] shrink-0 space-y-2 overflow-y-auto border-b border-slate-800 px-5 py-3">
            {proposals.map((proposal) => (
              <CalendarProposalCard
                key={proposal.id}
                proposal={proposal}
                busyId={proposalBusyId}
                onApply={onApplyProposal}
                onDismiss={onDismissProposal}
                error={proposalError?.id === proposal.id ? proposalError.message : ''}
              />
            ))}
          </div>
        )}

        {isSuggesting && suggestions.length === 0 && (
          <div className="shrink-0 border-b border-slate-800 px-5 py-3">
            <AiProgress
              active={isSuggesting}
              step={aiProgress?.step}
              percent={aiProgress?.percent}
              remainingMs={aiProgress?.remainingMs}
              remainingAt={aiProgress?.remainingAt}
              startedAt={aiProgress?.startedAt}
              trained={aiProgress?.trained}
            />
          </div>
        )}

        {suggestions.length > 0 && (
          <div className="flex min-h-0 max-h-[min(14rem,28dvh)] shrink flex-col overflow-hidden border-b border-slate-800 px-5 py-3">
            <div className="flex shrink-0 items-center justify-between gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                {usingSaveOrder
                  ? 'Your procedure'
                  : suggestions.some((entry) => entry.kind === 'step')
                    ? 'Procedure'
                    : 'AI suggestions'}
              </p>
              {activeSaved.length > 0 && (
                <label className="btn-secondary inline-flex cursor-pointer px-2.5 py-1 text-[11px]">
                  {analyzingSavedId ? 'Analyzing…' : 'Upload file'}
                  <input
                    type="file"
                    accept={ACCEPTED_UPLOADS}
                    className="hidden"
                    disabled={Boolean(analyzingSavedId)}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) startApproachUpload(file);
                      event.target.value = '';
                    }}
                  />
                </label>
              )}
            </div>
            {pendingUpload && otherSaved.length > 0 && (
              <div className="mt-2 shrink-0 rounded-xl border border-accent-500/40 bg-accent-500/10 px-3 py-3">
                <p className="text-sm font-medium text-slate-100">
                  Link {pendingUpload.file.name} to the other saved suggestions?
                </p>
                <p className="mt-1 text-xs leading-5 text-slate-400">
                  One comparison can include{' '}
                  {otherSaved
                    .map((entry) => entry.stepLabel || entry.title)
                    .join(', ')}{' '}
                  instead of uploading the same file again.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-primary px-3 py-1.5 text-xs"
                    onClick={() => confirmLinkedUpload(true)}
                  >
                    Link all saved steps
                  </button>
                  <button
                    type="button"
                    className="btn-secondary px-3 py-1.5 text-xs"
                    onClick={() => confirmLinkedUpload(false)}
                  >
                    Only this suggestion
                  </button>
                </div>
              </div>
            )}

            <div className="mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              {suggestions.map((suggestion, index) => (
                <SuggestionCard
                  key={`${item.id}-modal-s-${index}`}
                  item={item}
                  suggestion={suggestion}
                  savedSuggestions={savedSuggestions}
                  savingKey={savingKey}
                  highlighted={Boolean(suggestion.savedId) && highlightedSavedIds.has(suggestion.savedId)}
                  scrollTarget={Boolean(focusSavedId) && suggestion.savedId === focusSavedId}
                  focusedSuggestionRef={focusedSuggestionRef}
                  onSaveSuggestion={onSaveSuggestion}
                  onUnsaveSuggestion={onUnsaveSuggestion}
                  onCompleteSuggestion={onCompleteSuggestion}
                />
              ))}
            </div>
          </div>
        )}

        <div ref={threadRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {threadItems.length === 0 && !isDiscussing && !analyzingSavedId && (
            <p className="text-sm text-slate-500">
              {item.threadLoaded === false
                ? 'Loading conversation…'
                : 'Ask how to staff it, or upload a file to compare it against saved suggestions.'}
            </p>
          )}
          {threadItems.map((entry) => {
            if (entry.type === 'analysis') {
              return <FileAnalysisMessage key={entry.id} analysis={entry.analysis} />;
            }
            const content =
              entry.message.role === 'assistant'
                ? displayAssistantContent(entry.message.content, {
                    pendingCalendar: proposals.length > 0,
                  })
                : entry.message.content;
            if (entry.message.role === 'assistant' && !content) return null;
            return (
              <div
                key={entry.id}
                className={`rounded-xl px-4 py-3 ${
                  entry.message.role === 'user'
                    ? 'ml-8 bg-accent-500/10 text-slate-100'
                    : 'mr-8 bg-surface-800 text-slate-200'
                }`}
              >
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {entry.message.role === 'user' ? 'You' : 'AI'}
                </p>
                {entry.message.role === 'assistant' ? (
                  <ChatMarkdown content={content} />
                ) : (
                  <p className="whitespace-pre-wrap text-sm leading-6">{content}</p>
                )}
              </div>
            );
          })}
          {(isDiscussing || analyzingSavedId) && (
            <AiProgress
              active
              step={aiProgress?.step}
              percent={aiProgress?.percent}
              remainingMs={aiProgress?.remainingMs}
              remainingAt={aiProgress?.remainingAt}
              startedAt={aiProgress?.startedAt}
              trained={aiProgress?.trained}
            />
          )}
        </div>

        <form onSubmit={handleSubmit} className="shrink-0 border-t border-slate-800 px-5 py-4">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Continue this discussion…"
              className="input-field py-2.5 text-sm"
              disabled={isDiscussing}
            />
            <button
              type="submit"
              className="btn-primary shrink-0 px-4"
              disabled={isDiscussing}
            >
              {isDiscussing ? 'Sending…' : 'Send'}
            </button>
          </div>
          {showReasoning && (
            <div className="mt-2">
              <ReasoningToggle enabled={reasoningEnabled} onChange={onReasoningChange} />
            </div>
          )}
        </form>
      </div>
    </div>,
    document.body
  );
}
