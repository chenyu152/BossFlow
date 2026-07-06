import { Check } from 'lucide-react';

export function StrategyCard({ title, desc, active = false, onClick }: { title: string; desc: string; active?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`text-left border p-3 rounded-md cursor-pointer transition-colors ${active ? 'border-indigo-500 bg-indigo-950/20' : 'border-zinc-800 bg-zinc-900/20 hover:border-zinc-600'}`}>
      <div className="flex items-center justify-between mb-1">
        <span className={`text-sm font-medium ${active ? 'text-indigo-400' : 'text-zinc-200'}`}>{title}</span>
        {active && <Check size={14} className="text-indigo-400" />}
      </div>
      <div className="text-xs text-zinc-500">{desc}</div>
    </button>
  );
}
