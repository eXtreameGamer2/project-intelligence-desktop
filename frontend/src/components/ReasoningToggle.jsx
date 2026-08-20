export default function ReasoningToggle({ enabled = true, onChange, disabled = false }) {
  const on = enabled !== false;
  const hint =
    'Applies to Dashboard and Overview chats only. Import and other AI jobs never use reasoning, even if the connected model prefers it.';

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Use model reasoning in chats"
        disabled={disabled}
        onClick={() => onChange?.(!on)}
        className={`inline-flex items-center gap-2 rounded-lg px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] transition ${
          disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-surface-800'
        } ${on ? 'text-accent-300' : 'text-slate-500'}`}
      >
        <span className={`relative h-4 w-7 shrink-0 rounded-full ${on ? 'bg-accent-500' : 'bg-slate-700'}`}>
          <span
            className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition ${
              on ? 'left-3.5' : 'left-0.5'
            }`}
          />
        </span>
        Reasoning
      </button>
      <span className="group relative inline-flex">
        <span
          tabIndex={0}
          aria-label={hint}
          className="flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-slate-500 text-[9px] font-semibold leading-none text-slate-400 group-hover:border-slate-300 group-hover:text-slate-200 group-focus-within:border-slate-300 group-focus-within:text-slate-200"
        >
          ?
        </span>
        <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-56 -translate-x-1/2 rounded-lg border border-slate-700 bg-surface-900 px-3 py-2 text-left text-[11px] font-medium leading-4 text-slate-200 shadow-lg group-hover:block group-focus-within:block">
          {hint}
        </span>
      </span>
    </span>
  );
}
