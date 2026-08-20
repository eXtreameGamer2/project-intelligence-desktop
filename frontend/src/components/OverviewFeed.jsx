import { useEffect, useRef, useState } from 'react';
import ChatMarkdown from './ChatMarkdown';
import AiProgress from './AiProgress';
import CalendarProposalCard from './CalendarProposalCard';
import { displayAssistantContent } from '../lib/aiDisplay';
import ReasoningToggle from './ReasoningToggle';

export default function OverviewFeed({
  messages = [],
  proposals = [],
  isDiscussing = false,
  aiProgress,
  onDiscuss,
  onNewChat,
  onApplyProposal,
  onDismissProposal,
  proposalBusyId,
  proposalError,
  reasoningEnabled = true,
  onReasoningChange,
  showReasoning = false,
}) {
  const [draft, setDraft] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, isDiscussing]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || isDiscussing) return;

    setDraft('');
    await onDiscuss?.(message);
  };

  return (
    <section className="panel flex h-[min(36rem,70dvh)] flex-col overflow-hidden xl:h-[calc(100dvh-8.5rem)]">
      <div className="shrink-0 border-b border-slate-800 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Overview AI
            </p>
            <h2 className="mt-1 text-base font-semibold text-white">Portfolio feed</h2>
          </div>
          <button
            type="button"
            className="btn-secondary shrink-0 px-2.5 py-1 text-[11px]"
            disabled={(!messages.length && !isDiscussing) || !onNewChat}
            onClick={() => {
              setDraft('');
              onNewChat();
            }}
          >
            New chat
          </button>
        </div>
        <p className="mt-1 text-xs leading-5 text-slate-400">
          Chat for this visit only. New chat starts a fresh conversation. Use this feed to
          prioritize, cluster, and schedule across projects. File analysis, steps, and one
          approach stay on the Dashboard.
        </p>
      </div>

      {proposals.length > 0 && (
        <div className="shrink-0 space-y-2 border-b border-slate-800 px-4 py-3">
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

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {messages.length === 0 && !isDiscussing && (
          <p className="text-sm leading-6 text-slate-500">
            Ask what to schedule first, which backlog to drain, or why a project is clustered the way
            it is.
          </p>
        )}
        {messages.map((message) => {
          const content =
            message.role === 'assistant'
              ? displayAssistantContent(message.content, { pendingCalendar: proposals.length > 0 })
              : message.content;
          if (message.role === 'assistant' && !content) return null;
          return (
            <div
              key={message.id}
              className={`rounded-lg px-3 py-2 text-sm ${
                message.role === 'user'
                  ? 'ml-6 bg-accent-500/10 text-slate-100'
                  : 'mr-6 bg-surface-800 text-slate-200'
              }`}
            >
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {message.role === 'user' ? 'You' : 'Overview AI'}
              </p>
              {message.role === 'assistant' ? (
                <ChatMarkdown content={content} />
              ) : (
                <p className="whitespace-pre-wrap leading-5">{content}</p>
              )}
            </div>
          );
        })}
        <AiProgress
          compact
          active={isDiscussing && aiProgress?.active}
          step={aiProgress?.step}
          percent={aiProgress?.percent}
          remainingMs={aiProgress?.remainingMs}
          remainingAt={aiProgress?.remainingAt}
          startedAt={aiProgress?.startedAt}
          trained={aiProgress?.trained}
        />
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSubmit} className="shrink-0 border-t border-slate-800 p-3">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          rows={2}
          placeholder="Ask about priorities, queues, or scheduling…"
          className="input-field resize-none py-2 text-sm"
          disabled={isDiscussing}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          {showReasoning ? (
            <ReasoningToggle enabled={reasoningEnabled} onChange={onReasoningChange} />
          ) : (
            <span />
          )}
          <button type="submit" className="btn-secondary px-3 py-2 text-sm" disabled={isDiscussing}>
            {isDiscussing ? 'Thinking…' : 'Send'}
          </button>
        </div>
      </form>
    </section>
  );
}
