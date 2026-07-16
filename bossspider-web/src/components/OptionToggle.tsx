import { Check } from 'lucide-react';

export function OptionToggle({ label, active, onToggle }: { label: string; active: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} aria-pressed={active} className="option-toggle flex items-center gap-2 cursor-pointer group rounded px-1 py-0.5">
      <div className={`option-toggle__box w-4 h-4 rounded-sm border flex items-center justify-center transition-colors ${active ? 'bg-indigo-600 border-indigo-600' : 'border-zinc-700 group-hover:border-zinc-500'}`}>
        {active && <Check size={12} className="text-white" />}
      </div>
      <span className="option-toggle__label text-sm text-zinc-300">{label}</span>
    </button>
  );
}
