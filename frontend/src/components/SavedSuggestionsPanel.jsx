import { memo, useState } from 'react';
import { labeledSaves } from '../lib/saveSteps';

function SavedSuggestionsPanel({
  items,
  onOpenSuggestion,
  onCompleteSuggestion,
  completingKey,
}) {
  const [expanded, setExpanded] = useState(true);
  const groups = items
    .map((item) => ({
      itemId: item.id,
      itemTitle: item.title,
      item,
      saved: labeledSaves(item.savedSuggestions),
    }))
    .filter((group) => group.saved.length > 0);
  const activeCount = groups.reduce((sum, group) => sum + group.saved.length, 0);

  if (groups.length === 0) {
    return null;
  }

  return (
    <section className="panel p-5">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-start gap-3 text-left"
        aria-expanded={expanded}
      >
        <span
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-slate-700 text-xs text-slate-300 ${
            expanded ? 'bg-surface-800' : ''
          }`}
        >
          {expanded ? '▾' : '▸'}
        </span>
        <span className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            Saved suggestions
          </p>
          <span className="mt-1 flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-white">Remembered next steps</h3>
            {!expanded && (
              <span className="rounded-md bg-sky-500/15 px-2 py-0.5 text-[11px] font-semibold text-sky-400">
                {activeCount} active suggestion{activeCount === 1 ? '' : 's'}
              </span>
            )}
          </span>
          {expanded && (
            <p className="mt-1 text-xs text-slate-500">
              Click a saved suggestion to open its original approach. Ordered to-dos show as
              First, Second, and Third. Saving in your own order overrides that procedure.
            </p>
          )}
        </span>
      </button>

      {expanded && (
      <div className="mt-4 space-y-4">
        {groups.map((group) => (
          <div key={group.itemId}>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              {group.itemTitle}
            </p>
            <ul className="space-y-2">
              {group.saved.map((suggestion) => {
                const suggestionKey = `${group.itemId}:${suggestion.title}`;
                const isCompleting = completingKey === suggestionKey;

                return (
                  <li
                    key={suggestion.id}
                    className="flex items-start gap-2 rounded-xl border border-slate-800 bg-surface-950/50 px-4 py-3"
                  >
                    <button
                      type="button"
                      onClick={() => onOpenSuggestion?.(suggestion.itemId, suggestion.id)}
                      className="min-w-0 flex-1 text-left transition hover:text-white"
                    >
                      {suggestion.stepLabel && (
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent-300">
                          {suggestion.stepLabel}
                        </p>
                      )}
                      <p className={`${suggestion.stepLabel ? 'mt-1' : ''} text-sm font-medium text-slate-100`}>
                        {suggestion.title}
                      </p>
                      {suggestion.detail && (
                        <p className="mt-1 text-xs leading-5 text-slate-400">{suggestion.detail}</p>
                      )}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary shrink-0 px-2.5 py-1 text-[11px]"
                      disabled={isCompleting}
                      onClick={() => onCompleteSuggestion?.(group.item, suggestion)}
                    >
                      {isCompleting ? 'Completing…' : 'Mark as Complete'}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      )}
    </section>
  );
}

export default memo(SavedSuggestionsPanel);
