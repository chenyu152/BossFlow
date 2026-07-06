import { Settings, Terminal } from 'lucide-react';
import { STRATEGIES } from '../constants';
import { MetricCard } from '../components/MetricCard';
import { OptionToggle } from '../components/OptionToggle';
import { StrategyCard } from '../components/StrategyCard';
import type { ConfigPayload, ParsedLog, Tab } from '../types';

export function Dashboard({
  config,
  strategyIndex,
  setStrategyIndex,
  quickMode,
  setQuickMode,
  headlessMode,
  setHeadlessMode,
  autoSqlite,
  setAutoSqlite,
  setActiveTab,
  recentLogs,
  onLogin,
  onProcessPartial,
}: {
  config: ConfigPayload;
  strategyIndex: number;
  setStrategyIndex: (value: number) => void;
  quickMode: boolean;
  setQuickMode: (value: boolean) => void;
  headlessMode: boolean;
  setHeadlessMode: (value: boolean) => void;
  autoSqlite: boolean;
  setAutoSqlite: (value: boolean) => void;
  setActiveTab: (tab: Tab) => void;
  recentLogs: ParsedLog[];
  onLogin: () => void;
  onProcessPartial: () => void;
}) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 gap-4">
        <MetricCard label="Total Jobs" value={config.jobCount.toLocaleString()} />
        <MetricCard label="Keywords" value={String(config.keywordCount)} />
        <MetricCard label="Cities" value={String(config.cityCount)} />
        <MetricCard label="Database" value={config.dbFileName || 'jobs_data.db'} />
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-6">
          <div className="border border-zinc-800 bg-zinc-900/30 rounded-md overflow-hidden">
            <div className="border-b border-zinc-800 bg-zinc-900/50 px-4 py-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                <Settings size={14} className="text-zinc-400" /> Current Run Configuration
              </h2>
            </div>
            <div className="p-5 space-y-6">
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-3 uppercase tracking-wider">Strategy</label>
                <div className="grid grid-cols-3 gap-3">
                  {STRATEGIES.map((strategy, index) => (
                    <StrategyCard
                      key={strategy.title}
                      title={strategy.title}
                      desc={strategy.desc}
                      active={strategyIndex === index}
                      onClick={() => setStrategyIndex(index)}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-3 uppercase tracking-wider">Options</label>
                <div className="flex gap-6">
                  <OptionToggle label="Quick Mode" active={quickMode} onToggle={() => setQuickMode(!quickMode)} />
                  <OptionToggle label="Headless" active={headlessMode} onToggle={() => setHeadlessMode(!headlessMode)} />
                  <OptionToggle label="Auto SQLite" active={autoSqlite} onToggle={() => setAutoSqlite(!autoSqlite)} />
                </div>
              </div>

              <div className="pt-4 border-t border-zinc-800 flex items-center gap-3">
                <button onClick={onLogin} className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-4 py-2 rounded text-sm font-medium transition-colors">
                  Login / Save Cookie
                </button>
                <button onClick={onProcessPartial} className="border border-zinc-800 hover:bg-zinc-800 text-zinc-300 px-4 py-2 rounded text-sm font-medium transition-colors">
                  Recover from partial JSON
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="col-span-1">
          <div className="border border-zinc-800 bg-zinc-950 rounded-md overflow-hidden h-full flex flex-col">
            <div className="border-b border-zinc-800 bg-zinc-900/50 px-4 py-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                <Terminal size={14} className="text-zinc-400" /> Recent Logs
              </h2>
              <button onClick={() => setActiveTab('Logs')} className="text-xs text-indigo-400 hover:text-indigo-300">Full Logs</button>
            </div>
            <div className="p-3 font-mono text-[11px] leading-relaxed space-y-1 flex-1 bg-zinc-950 overflow-hidden">
              {recentLogs.length === 0 ? (
                <div className="text-zinc-600">No logs yet.</div>
              ) : recentLogs.map((log, index) => (
                <div key={`${log.time}-${index}`} className="flex gap-3">
                  <span className="text-zinc-600 shrink-0">{log.time}</span>
                  <span className={`${log.level === 'error' ? 'text-red-400' : log.level === 'warn' ? 'text-amber-400' : 'text-zinc-300'} truncate`}>
                    {log.msg}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
