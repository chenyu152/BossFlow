import { useEffect, useRef, useState } from 'react';
import { Copy, Trash2 } from 'lucide-react';
import { useAppTranslation } from '../i18n';
import type { ParsedLog, Status } from '../types';

const LOG_FILTERS = ['All', 'Info', 'Warn', 'Error'] as const;

export function Logs({ status, logs }: { status: Status; logs: ParsedLog[] }) {
  const { t } = useAppTranslation();
  const [levelFilter, setLevelFilter] = useState<string>('All');
  const [autoScroll, setAutoScroll] = useState(true);
  const [hiddenBefore, setHiddenBefore] = useState(0);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const visibleLogs = logs.slice(hiddenBefore).filter((log) => levelFilter === 'All' || log.level === levelFilter.toLowerCase());

  useEffect(() => {
    if (autoScroll) logEndRef.current?.scrollIntoView({ block: 'end' });
  }, [visibleLogs.length, autoScroll]);

  const copyLogs = () => {
    navigator.clipboard?.writeText(logs.map((log) => log.raw).join('\n'));
  };

  const getStatusLabel = (s: Status) => {
    const map: Record<Status, string> = {
      ready: t('status.ready'),
      crawling: t('status.crawling'),
      login: t('status.login'),
      'processing-partial': t('status.processingPartial'),
      'live-status': t('status.liveStatus'),
      stopping: t('status.stopping'),
      stopped: t('status.stopped'),
      failed: t('status.failed'),
    };
    return map[s] || s;
  };

  return (
    <div className="log-console h-full flex flex-col rounded-md overflow-hidden font-mono">
      <div className="log-console__toolbar h-10 flex items-center justify-between px-3 shrink-0">
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${status === 'crawling' ? 'bg-indigo-500 animate-pulse' : status === 'ready' || status === 'stopped' ? 'bg-zinc-500' : status === 'failed' ? 'bg-red-500' : 'bg-amber-500 animate-pulse'}`} />
            <span className="log-console__status capitalize">{getStatusLabel(status)}</span>
          </div>
          <div className="log-console__divider" />
          <div className="log-console__muted flex items-center gap-3">
            <span>{t('logs.title')}: {logs.length}</span>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <div className="log-console__filters flex rounded p-0.5">
            {LOG_FILTERS.map((level) => (
              <button key={level} onClick={() => setLevelFilter(level)} className={`px-2 py-0.5 rounded transition-colors ${levelFilter === level ? 'is-active' : ''}`}>
                {level}
              </button>
            ))}
          </div>
          <div className="log-console__divider" />
          <button onClick={() => setAutoScroll(!autoScroll)} className="log-console__control flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={autoScroll} readOnly className="accent-indigo-500" />
            {t('logs.autoScroll')}
          </button>
          <div className="log-console__divider" />
          <button onClick={copyLogs} className="log-console__control" title={t('logs.copyLogs')}><Copy size={14} /></button>
          <button onClick={() => setHiddenBefore(logs.length)} className="log-console__control" title={t('logs.clearDisplay')}><Trash2 size={14} /></button>
        </div>
      </div>

      <div className="log-console__viewport flex-1 overflow-auto p-4 text-[13px] leading-relaxed space-y-1">
        {visibleLogs.length === 0 && <div className="log-console__muted">{t('logs.noLogs')}</div>}
        {visibleLogs.map((log, index) => {
          const color = `log-console__message log-console__message--${log.level}${log.level === 'error' ? ' font-medium' : ''}`;
          return (
            <div key={`${log.time}-${index}-${log.msg}`} className="log-console__row flex gap-4 px-2 py-0.5 rounded -mx-2 transition-colors">
              <span className="log-console__time shrink-0 select-none">{log.time}</span>
              <span className={`log-console__level log-console__level--${log.level} shrink-0 uppercase w-10 text-[10px] flex items-center tracking-wider font-bold`}>
                {log.level}
              </span>
              <span className={`${color} break-all`}>{log.msg}</span>
            </div>
          );
        })}
        <div ref={logEndRef} />
      </div>
    </div>
  );
}
