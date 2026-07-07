import { BarChart3, FileText, Inbox, Settings, Sparkles, Terminal } from 'lucide-react';
import { STRATEGIES } from '../constants';
import { MetricCard } from '../components/MetricCard';
import { OptionToggle } from '../components/OptionToggle';
import { StrategyCard } from '../components/StrategyCard';
import type { ConfigPayload, Job, ParsedLog, PipelineResponse, Tab } from '../types';

export function Dashboard({
  config,
  jobs,
  pipeline,
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
  jobs: Job[];
  pipeline: PipelineResponse | null;
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
  const pending = pipeline?.pending || [];
  const processed = pipeline?.processed || [];
  const scoredJobs = jobs.filter((job) => job.score);
  const highFitJobs = jobs.filter((job) => (job.score ?? 0) >= 4);
  const worthReviewingJobs = jobs.filter((job) => (job.score ?? 0) >= 3.5 && (job.score ?? 0) < 4);
  const llmReports = pending.filter((item) => item.reportPath).length + processed.filter((item) => item.reportPath).length;
  const resumeSuggestions = pending.filter((item) => item.resumeSuggestionPath).length + processed.filter((item) => item.resumeSuggestionPath).length;
  const readyToGreet = pending.filter((item) => item.decisionStatus === 'ready_to_greet').length;
  const needsLlm = pending.filter((item) => item.decisionStatus === 'needs_llm').length;
  const needsReview = pending.filter((item) => item.decisionStatus === 'needs_review').length;
  const avgScore = scoredJobs.length
    ? scoredJobs.reduce((sum, job) => sum + (job.score || 0), 0) / scoredJobs.length
    : 0;
  const topCities = Array.from(
    jobs.reduce((map, job) => map.set(job.city || '-', (map.get(job.city || '-') || 0) + 1), new Map<string, number>()),
  ).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topCategories = Array.from(
    jobs.reduce((map, job) => {
      const category = job.cats[0] || job.tier || '-';
      map.set(category, (map.get(category) || 0) + 1);
      return map;
    }, new Map<string, number>()),
  ).sort((a, b) => b[1] - a[1]).slice(0, 5);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 gap-4">
        <MetricCard label="Total Jobs" value={config.jobCount.toLocaleString()} />
        <MetricCard label="Pipeline" value={pending.length.toLocaleString()} hint={`${processed.length.toLocaleString()} processed`} />
        <MetricCard label="High Fit" value={highFitJobs.length.toLocaleString()} hint={`${worthReviewingJobs.length.toLocaleString()} worth reviewing`} />
        <MetricCard label="Resume Suggestions" value={resumeSuggestions.toLocaleString()} hint={`${llmReports.toLocaleString()} LLM reports`} />
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-md border border-zinc-800 bg-zinc-900/30 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100">
                <BarChart3 size={15} className="text-indigo-400" />
                Scoring
              </div>
              <div className="space-y-3 text-xs text-zinc-400">
                <div className="flex items-center justify-between">
                  <span>Scored jobs</span>
                  <span className="font-medium text-zinc-100">{scoredJobs.length.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Average score</span>
                  <span className="font-medium text-zinc-100">{avgScore ? avgScore.toFixed(1) : '-'}</span>
                </div>
                <button onClick={() => setActiveTab('Jobs')} className="text-indigo-400 hover:text-indigo-300 transition-colors">
                  Open Jobs
                </button>
              </div>
            </div>

            <div className="rounded-md border border-zinc-800 bg-zinc-900/30 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100">
                <Inbox size={15} className="text-emerald-400" />
                Pipeline
              </div>
              <div className="space-y-3 text-xs text-zinc-400">
                <div className="flex items-center justify-between">
                  <span>Needs LLM</span>
                  <span className="font-medium text-sky-300">{needsLlm.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Needs review</span>
                  <span className="font-medium text-amber-300">{needsReview.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Ready to greet</span>
                  <span className="font-medium text-emerald-300">{readyToGreet.toLocaleString()}</span>
                </div>
              </div>
            </div>

            <div className="rounded-md border border-zinc-800 bg-zinc-900/30 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100">
                <FileText size={15} className="text-indigo-400" />
                Materials
              </div>
              <div className="space-y-3 text-xs text-zinc-400">
                <div className="flex items-center justify-between">
                  <span>LLM reports</span>
                  <span className="font-medium text-zinc-100">{llmReports.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Resume suggestions</span>
                  <span className="font-medium text-zinc-100">{resumeSuggestions.toLocaleString()}</span>
                </div>
                <button onClick={() => setActiveTab('Pipeline')} className="text-indigo-400 hover:text-indigo-300 transition-colors">
                  Open Pipeline
                </button>
              </div>
            </div>
          </div>

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

        <div className="col-span-1 space-y-6">
          <div className="border border-zinc-800 bg-zinc-950 rounded-md overflow-hidden">
            <div className="border-b border-zinc-800 bg-zinc-900/50 px-4 py-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                <Sparkles size={14} className="text-zinc-400" /> Snapshot
              </h2>
            </div>
            <div className="p-4 space-y-5">
              <div>
                <div className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">Top Cities</div>
                <div className="space-y-2">
                  {topCities.length ? topCities.map(([city, count]) => (
                    <div key={city} className="flex items-center justify-between text-xs">
                      <span className="truncate text-zinc-300">{city}</span>
                      <span className="text-zinc-500">{count}</span>
                    </div>
                  )) : <div className="text-xs text-zinc-600">No jobs loaded.</div>}
                </div>
              </div>
              <div>
                <div className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">Top Categories</div>
                <div className="space-y-2">
                  {topCategories.length ? topCategories.map(([category, count]) => (
                    <div key={category} className="flex items-center justify-between gap-3 text-xs">
                      <span className="truncate text-zinc-300">{category}</span>
                      <span className="text-zinc-500">{count}</span>
                    </div>
                  )) : <div className="text-xs text-zinc-600">No categories loaded.</div>}
                </div>
              </div>
            </div>
          </div>

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
