export default function AlphaChip({ className = '' }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border border-amber-400/45 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-200 ${className}`}
      title="This program is new and still in progress"
    >
      Alpha
    </span>
  );
}
