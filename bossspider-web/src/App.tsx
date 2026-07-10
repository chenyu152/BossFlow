import { lazy, Suspense, type ReactNode, useCallback, useEffect, useState } from 'react';
import { useAppTranslation } from './i18n';
import {
  Briefcase,
  BookOpenText,
  ChevronDown,
  ChevronRight,
  Crosshair,
  Database,
  FileText,
  Inbox,
  MessageSquareText,
  LayoutDashboard,
  Play,
  SlidersHorizontal,
  Square,
  Tags,
  Terminal,
} from 'lucide-react';
import { NavItem } from './components/NavItem';
import { StatusBadge } from './components/StatusBadge';
import { useBossSpider } from './hooks/useBossSpider';
import type { DashboardTaskTarget } from './pages/Dashboard';
import type { ResumeNavigationTarget, Tab } from './types';

type NavStage = 'discovery' | 'evaluation' | 'materials' | 'interview';

const Dashboard = lazy(() => import('./pages/Dashboard').then((module) => ({ default: module.Dashboard })));
const Interview = lazy(() => import('./pages/Interview').then((module) => ({ default: module.Interview })));
const Jobs = lazy(() => import('./pages/Jobs').then((module) => ({ default: module.Jobs })));
const Logs = lazy(() => import('./pages/Logs').then((module) => ({ default: module.Logs })));
const Pipeline = lazy(() => import('./pages/Pipeline').then((module) => ({ default: module.Pipeline })));
const Resume = lazy(() => import('./pages/Resume').then((module) => ({ default: module.Resume })));
const Rules = lazy(() => import('./pages/Rules').then((module) => ({ default: module.Rules })));
const Scope = lazy(() => import('./pages/Scope').then((module) => ({ default: module.Scope })));
const Story = lazy(() => import('./pages/Story').then((module) => ({ default: module.Story })));

function PageLoading({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-[240px] items-center justify-center rounded-lg border border-zinc-900 bg-zinc-950 text-sm text-zinc-500">
      {label}
    </div>
  );
}

function NavSection({
  icon,
  label,
  active,
  expanded,
  onToggle,
  children,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          active ? 'bg-zinc-900/80 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
        }`}
      >
        <span className={active ? 'text-indigo-400' : 'text-zinc-500'}>{icon}</span>
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        {expanded ? <ChevronDown size={15} className="text-zinc-500" /> : <ChevronRight size={15} className="text-zinc-500" />}
      </button>
      {expanded && (
        <div className="ml-5 mt-1 space-y-1 border-l border-zinc-800/80 pl-2">
          {children}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const { t, i18n } = useAppTranslation();
  const [activeTab, setActiveTab] = useState<Tab>('Dashboard');
  const [dbPathExpanded, setDbPathExpanded] = useState(false);
  const [selectedInterviewKey, setSelectedInterviewKey] = useState('');
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [selectedPipelineKey, setSelectedPipelineKey] = useState('');
  const [selectedResumeKey, setSelectedResumeKey] = useState('');
  const [selectedResumeTarget, setSelectedResumeTarget] = useState<ResumeNavigationTarget | null>(null);
  const [selectedStoryDraftId, setSelectedStoryDraftId] = useState('');
  const [dashboardTargetRequestId, setDashboardTargetRequestId] = useState(0);
  const [expandedStages, setExpandedStages] = useState<Record<NavStage, boolean>>({
    discovery: true,
    evaluation: true,
    materials: true,
    interview: true,
  });
  const boss = useBossSpider();
  const isWideWorkspace = activeTab === 'Jobs' || activeTab === 'Pipeline' || activeTab === 'Resume' || activeTab === 'Story' || activeTab === 'Interview' || activeTab === 'Logs';
  const currentLanguage = i18n.resolvedLanguage || i18n.language;

  useEffect(() => {
    if (!boss.isConfigDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [boss.isConfigDirty]);

  const confirmUnsavedConfig = useCallback(() => (
    !boss.isConfigDirty || window.confirm(t('notices.unsavedConfigLeaveConfirm'))
  ), [boss.isConfigDirty, t]);

  const navigateToTab = useCallback((tab: Tab) => {
    if (tab === activeTab || confirmUnsavedConfig()) setActiveTab(tab);
  }, [activeTab, confirmUnsavedConfig]);

  const setActiveTabStable = useCallback((tab: Tab) => {
    navigateToTab(tab);
  }, [navigateToTab]);

  const openDashboardTask = useCallback((tab: Tab, target?: DashboardTaskTarget) => {
    if (tab !== activeTab && !confirmUnsavedConfig()) return;
    setDashboardTargetRequestId((value) => value + 1);
    setSelectedJobId(tab === 'Jobs' ? target?.jobId ?? null : null);
    setSelectedPipelineKey(tab === 'Pipeline' ? target?.sourceKey ?? '' : '');
    setSelectedResumeKey(tab === 'Resume' ? target?.sourceKey ?? '' : '');
    setSelectedResumeTarget(tab === 'Resume' ? { sourceKey: target?.sourceKey ?? '' } : null);
    setSelectedStoryDraftId(tab === 'Story' ? target?.draftId ?? '' : '');
    if (tab === 'Interview' && target?.sourceKey) setSelectedInterviewKey(target.sourceKey);
    setActiveTab(tab);
  }, [activeTab, confirmUnsavedConfig]);

  const toggleStage = (stage: NavStage) => {
    setExpandedStages((current) => ({ ...current, [stage]: !current[stage] }));
  };

  const startCrawl = async () => {
    if (boss.isConfigDirty && !confirmUnsavedConfig()) return;
    if (await boss.startCrawl()) setActiveTab('Logs');
  };

  const startLogin = async () => {
    if (boss.isConfigDirty && !confirmUnsavedConfig()) return;
    if (await boss.startLogin()) setActiveTab('Logs');
  };

  const processPartial = async () => {
    if (boss.isConfigDirty && !confirmUnsavedConfig()) return;
    if (await boss.processPartial()) setActiveTab('Logs');
  };

  const stopTask = async () => {
    if (boss.isConfigDirty && !confirmUnsavedConfig()) return;
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
            BossFlow
          </div>
        </div>

        <nav className="flex-1 space-y-2 overflow-y-auto p-3">
          <div className="space-y-1">
            <NavItem icon={<LayoutDashboard size={16} />} label={t('nav.dashboard')} active={activeTab === 'Dashboard'} onClick={() => navigateToTab('Dashboard')} />
          </div>

          <NavSection
            icon={<Crosshair size={16} />}
            label={t('nav.stages.discovery')}
            active={activeTab === 'Scope' || activeTab === 'MatchingRules' || activeTab === 'ScoringRules' || activeTab === 'Jobs' || activeTab === 'Logs'}
            expanded={expandedStages.discovery}
            onToggle={() => toggleStage('discovery')}
          >
            <NavItem icon={<Crosshair size={16} />} label={t('nav.scope')} active={activeTab === 'Scope'} onClick={() => navigateToTab('Scope')} />
            <NavItem icon={<Tags size={16} />} label={t('nav.matchingRules')} active={activeTab === 'MatchingRules'} onClick={() => navigateToTab('MatchingRules')} />
            <NavItem icon={<SlidersHorizontal size={16} />} label={t('nav.scoringRules')} active={activeTab === 'ScoringRules'} onClick={() => navigateToTab('ScoringRules')} />
            <NavItem icon={<Briefcase size={16} />} label={t('nav.jobs')} active={activeTab === 'Jobs'} onClick={() => navigateToTab('Jobs')} />
            <NavItem icon={<Terminal size={16} />} label={t('nav.logs')} active={activeTab === 'Logs'} onClick={() => navigateToTab('Logs')} />
          </NavSection>

          <NavSection
            icon={<Inbox size={16} />}
            label={t('nav.stages.evaluation')}
            active={activeTab === 'Pipeline'}
            expanded={expandedStages.evaluation}
            onToggle={() => toggleStage('evaluation')}
          >
            <NavItem icon={<Inbox size={16} />} label={t('nav.pipeline')} active={activeTab === 'Pipeline'} onClick={() => navigateToTab('Pipeline')} />
          </NavSection>

          <NavSection
            icon={<FileText size={16} />}
            label={t('nav.stages.materials')}
            active={activeTab === 'Resume'}
            expanded={expandedStages.materials}
            onToggle={() => toggleStage('materials')}
          >
            <NavItem icon={<FileText size={16} />} label={t('nav.resume')} active={activeTab === 'Resume'} onClick={() => navigateToTab('Resume')} />
          </NavSection>

          <NavSection
            icon={<MessageSquareText size={16} />}
            label={t('nav.stages.interview')}
            active={activeTab === 'Interview' || activeTab === 'Story'}
            expanded={expandedStages.interview}
            onToggle={() => toggleStage('interview')}
          >
            <NavItem icon={<MessageSquareText size={16} />} label={t('nav.interview')} active={activeTab === 'Interview'} onClick={() => navigateToTab('Interview')} />
            <NavItem icon={<BookOpenText size={16} />} label={t('nav.story')} active={activeTab === 'Story'} onClick={() => navigateToTab('Story')} />
          </NavSection>
        </nav>

        <div className="p-4 border-t border-zinc-800 text-xs text-zinc-600">
          {t('nav.webConsole')}
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur flex items-center justify-between px-4 shrink-0">
          <div className="flex items-center gap-4 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500 uppercase font-medium">{t('header.project')}</span>
              <select
                value={boss.project}
                onChange={(event) => {
                  if (confirmUnsavedConfig()) void boss.loadConfig(event.target.value);
                }}
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
                {dbPathExpanded ? boss.config?.dbFilePath || t('header.noDatabaseLoaded') : boss.config?.dbFileName || t('header.noDatabase')}
              </span>
            </button>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-0.5 rounded border border-zinc-800 bg-zinc-900/50 p-0.5">
              {(['zh', 'en'] as const).map((lang) => (
                <button
                  key={lang}
                  onClick={() => i18n.changeLanguage(lang)}
                  className={`px-1.5 py-0.5 text-[11px] font-medium rounded-sm transition-colors ${
                    currentLanguage.startsWith(lang)
                      ? 'bg-indigo-600 text-white'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                  title={lang === 'zh' ? '切换到中文' : 'Switch to English'}
                >
                  {lang === 'zh' ? '中' : 'EN'}
                </button>
              ))}
            </div>
            <button onClick={() => navigateToTab('Logs')} className="text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors">
              {t('header.viewLogs')}
            </button>
            {!boss.isRunning ? (
              <button onClick={startCrawl} disabled={!boss.config || boss.loading} className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-3 py-1.5 rounded text-sm font-medium transition-colors">
                <Play size={14} />
                {t('header.startCrawl')}
              </button>
            ) : (
              <button onClick={stopTask} className="flex items-center gap-1.5 bg-red-900/50 text-red-400 border border-red-900/50 hover:bg-red-900/80 px-3 py-1.5 rounded text-sm font-medium transition-colors">
                <Square size={14} />
                {t('header.stopCrawl')}
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
            <Suspense fallback={<PageLoading label={currentLanguage.startsWith('zh') ? '加载页面...' : 'Loading page...'} />}>
              {activeTab === 'Dashboard' && boss.config && (
                <Dashboard
                  config={boss.config}
                  jobs={boss.jobs}
                  pipeline={boss.pipeline}
                  setActiveTab={navigateToTab}
                  onOpenTask={openDashboardTask}
                  recentLogs={boss.recentLogs}
                  onLoadStoryDrafts={boss.loadInterviewStoryDrafts}
                />
              )}
              {activeTab === 'Scope' && boss.config && (
                <Scope
                  config={boss.config}
                  updateConfig={boss.updateConfig}
                  onSave={boss.saveConfig}
                  onReload={() => {
                    if (boss.config && confirmUnsavedConfig()) void boss.loadConfig(boss.config.project);
                  }}
                  onLogin={startLogin}
                  onProcessPartial={processPartial}
                />
              )}
              {activeTab === 'MatchingRules' && boss.config && (
                <Rules mode="matching" config={boss.config} updateConfig={boss.updateConfig} onSave={boss.saveConfig} />
              )}
              {activeTab === 'ScoringRules' && boss.config && (
                <Rules mode="scoring" config={boss.config} updateConfig={boss.updateConfig} onSave={boss.saveConfig} />
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
                  onUpdateLiveStatus={(jobIds, limit) => boss.updateJobLiveStatus({ jobIds, limit })}
                  scoringJobIds={boss.jobScoringIds}
                  taskRunning={boss.isRunning}
                  selectedJobId={selectedJobId}
                  targetRequestId={dashboardTargetRequestId}
                  onAddToPipeline={async (jobs) => {
                    if (await boss.addJobsToPipeline(jobs.map((job) => job.id))) navigateToTab('Pipeline');
                  }}
                />
              )}
              {activeTab === 'Pipeline' && (
                <Pipeline
                  pipeline={boss.pipeline}
                  onRefresh={() => { void boss.refreshPipeline(); }}
                  onLlmEvaluate={(sourceKey) => { void boss.llmEvaluatePipelineItem(sourceKey); }}
                  llmEvaluatingKeys={boss.llmEvaluatingKeys}
                  resumeSuggestingKeys={boss.resumeSuggestingKeys}
                  interviewPreparingKeys={boss.interviewPreparingKeys}
                  sortByLlmScore={boss.sortPipelineByLlmScore}
                  setSortByLlmScore={boss.setSortPipelineByLlmScore}
                  onLoadJobDetail={boss.loadJobDetail}
                  onLoadReport={boss.loadPipelineReport}
                  onLoadGreetingDraft={boss.loadGreetingDraft}
                  onSaveGreetingDraft={boss.saveGreetingDraft}
                  onGenerateResumeSuggestions={boss.generateResumeSuggestions}
                  onLoadResumeSuggestion={boss.loadResumeSuggestion}
                  onGenerateInterviewPrep={boss.generateInterviewPrep}
                  onLoadInterviewPrep={boss.loadInterviewPrep}
                  onUpdateStatus={boss.updatePipelineStatus}
                  onDeleteItem={boss.deletePipelineItem}
                  onOpenResumeMaterials={(target) => {
                    setDashboardTargetRequestId((value) => value + 1);
                    setSelectedResumeKey(target.sourceKey || '');
                    setSelectedResumeTarget(target);
                    void boss.refreshResumeItems();
                    setActiveTabStable('Resume');
                  }}
                  targetSourceKey={selectedPipelineKey}
                  targetRequestId={dashboardTargetRequestId}
                />
              )}
              {activeTab === 'Resume' && (
                <Resume
                  items={boss.resumeItems}
                  draftingKeys={boss.resumeDraftingKeys}
                  onRefresh={() => { void boss.refreshResumeItems(); }}
                  onLoadSuggestion={boss.loadResumeSuggestion}
                  onLoadDraft={boss.loadResumeDraft}
                  onGenerateDraft={boss.generateResumeDraft}
                  selectedSourceKey={selectedResumeKey}
                  selectedTarget={selectedResumeTarget}
                  targetRequestId={dashboardTargetRequestId}
                  onTargetApplied={() => {
                    setSelectedResumeKey('');
                    setSelectedResumeTarget(null);
                  }}
                />
              )}
              {activeTab === 'Story' && (
                <Story
                  onLoadStoryBank={boss.loadInterviewStoryBank}
                  onSaveStoryBank={boss.saveInterviewStoryBank}
                  onLoadStoryDrafts={boss.loadInterviewStoryDrafts}
                  onSaveStoryDrafts={boss.saveInterviewStoryDrafts}
                  onPromoteStoryDraft={boss.promoteInterviewStoryDraft}
                  selectedDraftId={selectedStoryDraftId}
                  targetRequestId={dashboardTargetRequestId}
                />
              )}
              {activeTab === 'Interview' && (
                <Interview
                  items={boss.interviewItems}
                  preparingKeys={boss.interviewPreparingKeys}
                  selectedKey={selectedInterviewKey}
                  onSelectedKeyChange={setSelectedInterviewKey}
                  onRefresh={() => { void boss.refreshInterviewItems(); }}
                  onLoadStoryBank={boss.loadInterviewStoryBank}
                  onLoadStoryDrafts={boss.loadInterviewStoryDrafts}
                  onSaveStoryDrafts={boss.saveInterviewStoryDrafts}
                  onOpenStory={() => setActiveTabStable('Story')}
                  onOpenStoryDraft={(draftId) => {
                    setDashboardTargetRequestId((value) => value + 1);
                    setSelectedStoryDraftId(draftId);
                    setActiveTabStable('Story');
                  }}
                  onLoadPrep={boss.loadInterviewPrep}
                  onGeneratePrep={boss.generateInterviewPrep}
                />
              )}
              {activeTab === 'Logs' && <Logs status={boss.status} logs={boss.parsedLogs} />}
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  );
}
