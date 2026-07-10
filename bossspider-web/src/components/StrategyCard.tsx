import { Check } from 'lucide-react';

export function StrategyCard({
  title,
  desc,
  active = false,
  disabled = false,
  disabledReason,
  onClick,
}: {
  title: string;
  desc: string;
  active?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      aria-disabled={disabled}
      title={disabled ? disabledReason : undefined}
      className={`group relative text-left border p-3 rounded-md transition-colors ${
        disabled
          ? 'cursor-not-allowed border-zinc-900 bg-zinc-950/60 opacity-50'
          : active
            ? 'cursor-pointer border-indigo-500 bg-indigo-950/20'
            : 'cursor-pointer border-zinc-800 bg-zinc-900/20 hover:border-zinc-600'
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className={`text-sm font-medium ${active ? 'text-indigo-400' : 'text-zinc-200'}`}>{title}</span>
        {active && <Check size={14} className="text-indigo-400" />}
      </div>
      <div className="text-xs text-zinc-500">{desc}</div>
      {disabled && disabledReason && (
        <div className="pointer-events-none absolute left-3 right-3 top-full z-20 mt-2 rounded border border-amber-900/60 bg-zinc-950 px-2 py-1.5 text-[11px] leading-relaxed text-amber-300 opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
          {disabledReason}
        </div>
      )}
    </button>
  );
}
