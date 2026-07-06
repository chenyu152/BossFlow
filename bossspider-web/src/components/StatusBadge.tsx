import type { Status } from '../types';

export function StatusBadge({ status }: { status: Status }) {
  const config: Record<Status, { color: string; bg: string; dot: string }> = {
    ready: { color: 'text-zinc-400', bg: 'bg-zinc-800', dot: 'bg-zinc-500' },
    crawling: { color: 'text-indigo-400', bg: 'bg-indigo-950', dot: 'bg-indigo-500 animate-pulse' },
    login: { color: 'text-amber-400', bg: 'bg-amber-950', dot: 'bg-amber-500 animate-pulse' },
    'processing-partial': { color: 'text-blue-400', bg: 'bg-blue-950', dot: 'bg-blue-500 animate-pulse' },
    stopping: { color: 'text-orange-400', bg: 'bg-orange-950', dot: 'bg-orange-500 animate-pulse' },
    failed: { color: 'text-red-400', bg: 'bg-red-950', dot: 'bg-red-500' },
  };
  const item = config[status] || config.ready;

  return (
    <div className={`flex items-center gap-2 px-2 py-1 rounded text-xs font-mono uppercase tracking-wider ${item.bg} ${item.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${item.dot}`} />
      {status}
    </div>
  );
}
