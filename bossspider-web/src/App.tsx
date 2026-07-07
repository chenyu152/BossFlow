import { useState } from 'react';
import {
  Briefcase,
  Crosshair,
  Database,
  FileJson,
  Inbox,
  LayoutDashboard,
  Play,
  Square,
  Terminal,
} from 'lucide-react';
import { NavItem } from './components/NavItem';
import { StatusBadge } from './components/StatusBadge';
import { useBossSpider } from './hooks/useBossSpider';
import { Dashboard } from './pages/Dashboard';
import { Jobs } from './pages/Jobs';
import { Logs } from './pages/Logs';
import { Pipeline } from './pages/Pipeline';
import { Rules } from './pages/Rules';
import { Scope } from './pages/Scope';
import type { Tab } from './types';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('Dashboard');
  const [dbPathExpanded, setDbPathExpanded] = useState(false);
  const boss = useBossSpider();
  const isWideWorkspace = activeTab === 'Jobs' || activeTab === 'Pipeline' || activeTab === 'Logs';

  const startCrawl = async () => {
    if (await boss.startCrawl()) setActiveTab('Logs');
  };

  const startLogin = async () => {
    if (await boss.startLogin()) setActiveTab('Logs');
  };

  const processPartial = async () => {
    if (await boss.processPartial()) setActiveTab('Logs');
  };

  const stopTask = async () => {
    if (await boss.stopTask()) setActiveTab('Logs');
  };

  return (
    <div className="flex h-screen w-full bg-zinc-950 text-zinc-300 font-sans selection:bg-indigo-500/30 overflow-hidden">
      <aside className="w-56 border-r border-zinc-800 bg-zinc-950 flex flex-col shrink-0">
        <div className="h-14 flex items-center px-4 border-b border-zinc-800">
          <div className="flex items-center gap-2 text-zinc-100 font-semibold tracking-wide">
            <div className="w-5 h-5 bg-indigo-600 rounded flex items-center justify-center text-[10px]">
              <Crosshair size={12} className="text-white" />
            </div>
            BossSpider
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          <NavItem icon={<LayoutDashboard size={16} />} label="Dashboard" active={activeTab === 'Dashboard'} onClick={() => setActiveTab('Dashboard')} />
          <NavItem icon={<Crosshair size={16} />} label="Scope" active={activeTab === 'Scope'} onClick={() => setActiveTab('Scope')} />
          <NavItem icon={<FileJson size={16} />} label="Rules" active={activeTab === 'Rules'} onClick={() => setActiveTab('Rules')} />
          <NavItem icon={<Briefcase size={16} />} label="Jobs" active={activeTab === 'Jobs'} onClick={() => setActiveTab('Jobs')} />
          <NavItem icon={<Inbox size={16} />} label="Pipeline" active={activeTab === 'Pipeline'} onClick={() => setActiveTab('Pipeline')} />
          <NavItem icon={<Terminal size={16} />} label="Logs" active={activeTab === 'Logs'} onClick={() => setActiveTab('Logs')} />
        </nav>

        <div className="p-4 border-t border-zinc-800 text-xs text-zinc-600">
          Web Console
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur flex items-center justify-between px-4 shrink-0">
          <div className="flex items-center gap-4 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500 uppercase font-medium">Project</span>
              <select
                value={boss.project}
                onChange={(event) => boss.loadConfig(event.target.value)}
                className="bg-zinc-900 border border-zinc-800 text-sm rounded px-2 py-1 outline-none focus:border-indigo-500"
              >
                {boss.projects.map((name) => <option value={name} key={name}>{name}</option>)}
              </select>
            </div>

            <div className="h-4 w-[1px] bg-zinc-800" />
            <StatusBadge status={boss.status} />
            <div className="h-4 w-[1px] bg-zinc-800" />

            <button
              className="flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors max-w-[340px] min-w-0"
              onClick={() => setDbPathExpanded(!dbPathExpanded)}
              title={boss.config?.dbFilePath || ''}
            >
              <Database size={14} className="shrink-0" />
              <span className="truncate">
                {dbPathExpanded ? boss.config?.dbFilePath || 'No database loaded' : boss.config?.dbFileName || 'No database'}
              </span>
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button onClick={() => setActiveTab('Logs')} className="text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors">
              View Logs
            </button>
            {!boss.isRunning ? (
              <button onClick={startCrawl} disabled={!boss.config || boss.loading} className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-3 py-1.5 rounded text-sm font-medium transition-colors">
                <Play size={14} />
                Start Crawl
              </button>
            ) : (
              <button onClick={stopTask} className="flex items-center gap-1.5 bg-red-900/50 text-red-400 border border-red-900/50 hover:bg-red-900/80 px-3 py-1.5 rounded text-sm font-medium transition-colors">
                <Square size={14} />
                Stop Crawl
              </button>
            )}
          </div>
        </header>

        {boss.notice && (
          <div className="absolute right-5 top-16 z-50 max-w-md rounded border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-100 shadow-xl">
            {boss.notice}
          </div>
        )}

        <main className="flex-1 overflow-auto bg-zinc-950 p-5">
          <div className={isWideWorkspace ? 'h-full w-full min-w-0' : 'max-w-6xl mx-auto h-full'}>
            {activeTab === 'Dashboard' && boss.config && (
              <Dashboard
                config={boss.config}
                jobs={boss.jobs}
                pipeline={boss.pipeline}
                strategyIndex={boss.strategyIndex}
                setStrategyIndex={boss.setStrategyIndex}
                quickMode={boss.quickMode}
                setQuickMode={boss.setQuickMode}
                headlessMode={boss.headlessMode}
                setHeadlessMode={boss.setHeadlessMode}
                autoSqlite={boss.autoSqlite}
                setAutoSqlite={boss.setAutoSqlite}
                setActiveTab={setActiveTab}
                recentLogs={boss.recentLogs}
                onLogin={startLogin}
                onProcessPartial={processPartial}
              />
            )}
            {activeTab === 'Scope' && boss.config && (
              <Scope
                config={boss.config}
                updateConfig={boss.updateConfig}
                onSave={boss.saveConfig}
                onReload={() => boss.config && boss.loadConfig(boss.config.project)}
              />
            )}
            {activeTab === 'Rules' && boss.config && (
              <Rules config={boss.config} updateConfig={boss.updateConfig} onSave={boss.saveConfig} />
            )}
            {activeTab === 'Jobs' && (
              <Jobs
                jobs={boss.jobs}
                total={boss.jobsTotal}
                search={boss.jobSearch}
                setSearch={boss.setJobSearch}
                sortByScore={boss.sortJobsByScore}
                setSortByScore={boss.setSortJobsByScore}
                onRefresh={() => boss.refreshJobs()}
                onExport={boss.exportJobs}
                onScoreJobs={boss.scoreJobs}
                scoringJobIds={boss.jobScoringIds}
                onAddToPipeline={async (jobs) => {
                  if (await boss.addJobsToPipeline(jobs.map((job) => job.id))) setActiveTab('Pipeline');
                }}
              />
            )}
            {activeTab === 'Pipeline' && (
              <Pipeline
                pipeline={boss.pipeline}
                onRefresh={() => { void boss.refreshPipeline(); }}
                onEvaluate={(sourceKey) => { void boss.evaluatePipelineItem(sourceKey); }}
                onScoreAll={() => { void boss.scoreAllPipeline(); }}
                onLlmEvaluate={(sourceKey) => { void boss.llmEvaluatePipelineItem(sourceKey); }}
                llmEvaluatingKeys={boss.llmEvaluatingKeys}
                resumeSuggestingKeys={boss.resumeSuggestingKeys}
                sortByLlmScore={boss.sortPipelineByLlmScore}
                setSortByLlmScore={boss.setSortPipelineByLlmScore}
                onLoadJobDetail={boss.loadJobDetail}
                onLoadReport={boss.loadPipelineReport}
                onGenerateResumeSuggestions={boss.generateResumeSuggestions}
                onLoadResumeSuggestion={boss.loadResumeSuggestion}
                onUpdateStatus={boss.updatePipelineStatus}
                onDeleteItem={boss.deletePipelineItem}
              />
            )}
            {activeTab === 'Logs' && <Logs status={boss.status} logs={boss.parsedLogs} />}
          </div>
        </main>
      </div>
    </div>
  );
}
