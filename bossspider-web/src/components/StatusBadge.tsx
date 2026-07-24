import { useAppTranslation } from '../i18n';
import type { Status } from '../types';

export function StatusBadge({ status }: { status: Status }) {
  const { t } = useAppTranslation();
  const config: Record<Status, { color: string; bg: string; dot: string; labelKey: string }> = {
    ready: { color: 'text-zinc-400', bg: 'bg-zinc-800', dot: 'bg-zinc-500', labelKey: 'status.ready' },
    crawling: { color: 'text-indigo-400', bg: 'bg-indigo-950', dot: 'bg-indigo-500 animate-pulse', labelKey: 'status.crawling' },
    login: { color: 'text-amber-400', bg: 'bg-amber-950', dot: 'bg-amber-500 animate-pulse', labelKey: 'status.login' },
    'processing-partial': { color: 'text-blue-400', bg: 'bg-blue-950', dot: 'bg-blue-500 animate-pulse', labelKey: 'status.processingPartial' },
    'live-status': { color: 'text-cyan-300', bg: 'bg-cyan-950', dot: 'bg-cyan-400 animate-pulse', labelKey: 'status.liveStatus' },
    stopping: { color: 'text-orange-400', bg: 'bg-orange-950', dot: 'bg-orange-500 animate-pulse', labelKey: 'status.stopping' },
    stopped: { color: 'text-zinc-400', bg: 'bg-zinc-800', dot: 'bg-zinc-500', labelKey: 'status.stopped' },
    failed: { color: 'text-red-400', bg: 'bg-red-950', dot: 'bg-red-500', labelKey: 'status.failed' },
  };
  const item = config[status] || config.ready;

  return (
    <div className={`app-status-badge app-status-badge--${status} flex items-center gap-2 px-2 py-1 rounded text-xs font-mono uppercase tracking-wider ${item.bg} ${item.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${item.dot}`} />
      {t(item.labelKey)}
    </div>
  );
}
