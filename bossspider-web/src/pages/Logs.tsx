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
      stopping: t('status.stopping'),
      failed: t('status.failed'),
    };
    return map[s] || s;
  };

  return (
    <div className="h-full flex flex-col bg-[#0d0d0d] rounded-md border border-zinc-800 overflow-hidden font-mono">
      <div className="h-10 border-b border-zinc-800 bg-[#161616] flex items-center justify-between px-3 shrink-0">
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${status === 'crawling' ? 'bg-indigo-500 animate-pulse' : status === 'ready' ? 'bg-zinc-500' : status === 'failed' ? 'bg-red-500' : 'bg-amber-500 animate-pulse'}`} />
            <span className="text-zinc-300 capitalize">{getStatusLabel(status)}</span>
          </div>
          <div className="w-[1px] h-3 bg-zinc-700" />
          <div className="text-zinc-500 flex items-center gap-3">
            <span>{t('logs.title')}: {logs.length}</span>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <div className="flex bg-[#222] rounded p-0.5 border border-zinc-800">
            {LOG_FILTERS.map((level) => (
              <button key={level} onClick={() => setLevelFilter(level)} className={`px-2 py-0.5 rounded transition-colors ${levelFilter === level ? 'bg-[#333] text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'}`}>
                {level}
              </button>
            ))}
          </div>
          <div className="w-[1px] h-3 bg-zinc-700" />
          <button onClick={() => setAutoScroll(!autoScroll)} className="flex items-center gap-1.5 text-zinc-400 hover:text-zinc-200 cursor-pointer">
            <input type="checkbox" checked={autoScroll} readOnly className="accent-indigo-500" />
            {t('logs.autoScroll')}
          </button>
          <div className="w-[1px] h-3 bg-zinc-700" />
          <button onClick={copyLogs} className="text-zinc-400 hover:text-zinc-200" title={t('logs.copyLogs')}><Copy size={14} /></button>
          <button onClick={() => setHiddenBefore(logs.length)} className="text-zinc-400 hover:text-zinc-200" title={t('logs.clearDisplay')}><Trash2 size={14} /></button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 text-[13px] leading-relaxed space-y-1">
        {visibleLogs.length === 0 && <div className="text-zinc-600">{t('logs.noLogs')}</div>}
        {visibleLogs.map((log, index) => {
          const color = log.level === 'error' ? 'text-red-400 font-medium' : log.level === 'warn' ? 'text-amber-400' : 'text-zinc-300';
          return (
            <div key={`${log.time}-${index}-${log.msg}`} className="flex gap-4 hover:bg-white/[0.02] px-2 py-0.5 rounded -mx-2 transition-colors">
              <span className="text-zinc-600 shrink-0 select-none">{log.time}</span>
              <span className={`shrink-0 uppercase w-10 text-[10px] flex items-center tracking-wider font-bold ${log.level === 'error' ? 'text-red-500' : log.level === 'warn' ? 'text-amber-500' : 'text-indigo-400'}`}>
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
