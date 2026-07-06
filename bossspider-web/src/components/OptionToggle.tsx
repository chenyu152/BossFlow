import { Check } from 'lucide-react';

export function OptionToggle({ label, active, onToggle }: { label: string; active: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} className="flex items-center gap-2 cursor-pointer group">
      <div className={`w-4 h-4 rounded-sm border flex items-center justify-center transition-colors ${active ? 'bg-indigo-600 border-indigo-600' : 'border-zinc-700 group-hover:border-zinc-500'}`}>
        {active && <Check size={12} className="text-white" />}
      </div>
      <span className="text-sm text-zinc-300">{label}</span>
    </button>
  );
}
