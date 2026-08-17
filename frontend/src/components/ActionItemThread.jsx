import { useEffect, useState } from 'react';
import ChatMarkdown from './ChatMarkdown';

export default function ActionItemThread({
  item,
  onLoadSuggestions,
  onDiscuss,
  onOpenModal,
  isSuggesting,
  isDiscussing,
}) {
  const [draft, setDraft] = useState('');
  const suggestions = item.suggestions || [];
  const discussion = item.discussion || [];

  useEffect(() => {
    if (suggestions.length === 0 && !isSuggesting) {
      onLoadSuggestions(item);
    }
  }, [item.id]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || isDiscussing) return;

    setDraft('');
    onOpenModal();
    await onDiscuss(item, message);
  };

  return (
    <div className="mt-3 space-y-3 border-t border-slate-800 pt-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          AI suggestions
        </p>
        {isSuggesting && suggestions.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Thinking through next steps…</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {suggestions.map((suggestion, index) => (
              <li
                key={`${item.id}-s-${index}`}
                className="rounded-lg border border-slate-800 bg-surface-900/70 px-3 py-2"
              >
                <p className="text-sm font-medium text-slate-100">{suggestion.title}</p>
                {suggestion.detail && (
                  <p className="mt-1 text-xs leading-5 text-slate-400">{suggestion.detail}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          Discuss this approach
        </p>
        <div className="mt-2 max-h-48 space-y-2 overflow-y-auto pr-1">
          {discussion.length === 0 && (
            <p className="text-xs text-slate-500">
              Ask how to staff it, what “done” looks like, or what to do first.
            </p>
          )}
          {discussion.map((message) => (
            <div
              key={message.id}
              className={`rounded-lg px-3 py-2 text-sm ${
                message.role === 'user'
                  ? 'ml-6 bg-accent-500/10 text-slate-100'
                  : 'mr-6 bg-surface-800 text-slate-200'
              }`}
            >
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {message.role === 'user' ? 'You' : 'AI'}
              </p>
              {message.role === 'assistant' ? (
                <ChatMarkdown content={message.content} />
              ) : (
                <p className="whitespace-pre-wrap leading-5">{message.content}</p>
              )}
            </div>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="mt-2 flex gap-2">
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask about this approach…"
            className="input-field py-2 text-sm"
            disabled={isDiscussing}
          />
          <button type="submit" className="btn-secondary shrink-0 px-3 py-2 text-sm" disabled={isDiscussing}>
            {isDiscussing ? '…' : 'Send'}
          </button>
        </form>
      </div>
    </div>
  );
}
