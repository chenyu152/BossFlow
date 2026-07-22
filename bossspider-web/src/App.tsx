import { lazy, Suspense, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useAppTranslation } from './i18n';
import {
  Briefcase,
  BookOpenText,
  ChartNoAxesCombined,
  Code2,
  Crosshair,
  Cpu,
  Database,
  FileCheck2,
  FileText,
  Inbox,
  MessageSquareText,
  LayoutDashboard,
  Play,
  PanelsTopLeft,
  Plus,
  Server,
  Sparkles,
  SlidersHorizontal,
  Square,
  Settings as SettingsIcon,
  Tags,
  Terminal,
  UserRound,
} from 'lucide-react';
import { StatusBadge } from './components/StatusBadge';
import { ThemePicker } from './components/ThemePicker';
import { GuidedTour } from './components/GuidedTour';
import { CitySelector } from './components/CitySelector';
import { useBossSpider } from './hooks/useBossSpider';
import { buildTemplateSeed, JOB_DIRECTION_TEMPLATES, type JobDirectionTemplate } from './jobTemplates';
import type { DashboardTaskTarget } from './pages/Dashboard';
import type { ResumeNavigationTarget, Tab } from './types';

type RailMenu = 'discovery' | 'materials' | 'interview';

const Dashboard = lazy(() => import('./pages/Dashboard').then((module) => ({ default: module.Dashboard })));
const Evidence = lazy(() => import('./pages/Evidence').then((module) => ({ default: module.Evidence })));
const Interview = lazy(() => import('./pages/Interview').then((module) => ({ default: module.Interview })));
const Jobs = lazy(() => import('./pages/Jobs').then((module) => ({ default: module.Jobs })));
const Logs = lazy(() => import('./pages/Logs').then((module) => ({ default: module.Logs })));
const Pipeline = lazy(() => import('./pages/Pipeline').then((module) => ({ default: module.Pipeline })));
const PersonalResume = lazy(() => import('./pages/PersonalResume').then((module) => ({ default: module.PersonalResume })));
const Resume = lazy(() => import('./pages/Resume').then((module) => ({ default: module.Resume })));
const Rules = lazy(() => import('./pages/Rules').then((module) => ({ default: module.Rules })));
const Scope = lazy(() => import('./pages/Scope').then((module) => ({ default: module.Scope })));
const Settings = lazy(() => import('./pages/Settings').then((module) => ({ default: module.Settings })));
const Story = lazy(() => import('./pages/Story').then((module) => ({ default: module.Story })));

function PageLoading({ label }: { label: string }) {
  return (
    <div className="page-loading" role="status" aria-live="polite">
      <span className="page-loading__mark" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

function RailButton({
  icon,
  label,
  active,
  expanded,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  expanded?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      aria-expanded={expanded}
      className={`desktop-rail__button${active ? ' desktop-rail__button--active' : ''}${expanded ? ' desktop-rail__button--expanded' : ''}`}
      title={label}
    >
      <span className="desktop-rail__icon">{icon}</span>
      <span className="desktop-rail__label">{label}</span>
    </button>
  );
}

export default function App() {
  const { t, i18n } = useAppTranslation();
  const [activeTab, setActiveTab] = useState<Tab>('Dashboard');
  const [dbPathExpanded, setDbPathExpanded] = useState(false);
  const [selectedInterviewKey, setSelectedInterviewKey] = useState('');
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [selectedPipelineKey, setSelectedPipelineKey] = useState('');
  const [selectedEvidenceRequirementId, setSelectedEvidenceRequirementId] = useState('');
  const [selectedEvidenceTaskId, setSelectedEvidenceTaskId] = useState('');
  const [selectedResumeKey, setSelectedResumeKey] = useState('');
  const [selectedResumeTarget, setSelectedResumeTarget] = useState<ResumeNavigationTarget | null>(null);
  const [selectedStoryDraftId, setSelectedStoryDraftId] = useState('');
  const [dashboardTargetRequestId, setDashboardTargetRequestId] = useState(0);
  const [personalResumeDirty, setPersonalResumeDirty] = useState(false);
  const [createDirectionOpen, setCreateDirectionOpen] = useState(false);
  const [directionName, setDirectionName] = useState(JOB_DIRECTION_TEMPLATES[0].defaultName);
  const [directionCitiesText, setDirectionCitiesText] = useState('');
  const [selectedDirectionTemplateId, setSelectedDirectionTemplateId] = useState<string>(JOB_DIRECTION_TEMPLATES[0].id);
  const [directionCreateError, setDirectionCreateError] = useState('');
  const [creatingDirection, setCreatingDirection] = useState(false);
  const [scopeGuideAutoStartPending, setScopeGuideAutoStartPending] = useState(false);
  const [matchingGuideAutoStartPending, setMatchingGuideAutoStartPending] = useState(false);
  const [returnToMatchingGuideAfterApiTest, setReturnToMatchingGuideAfterApiTest] = useState(false);
  const [crawlGuideOpen, setCrawlGuideOpen] = useState(false);
  const [resumeGuideAutoStartPending, setResumeGuideAutoStartPending] = useState(false);
  const [resumeGuideAfterCrawl, setResumeGuideAfterCrawl] = useState(false);
  const [activeRailMenu, setActiveRailMenu] = useState<RailMenu | null>(null);
  const railRef = useRef<HTMLElement>(null);
  const boss = useBossSpider();
  const isWideWorkspace = activeTab === 'Jobs' || activeTab === 'Pipeline' || activeTab === 'Evidence' || activeTab === 'PersonalResume' || activeTab === 'Resume' || activeTab === 'Story' || activeTab === 'Interview' || activeTab === 'Logs';
  const currentLanguage = i18n.resolvedLanguage || i18n.language;
  const hasUnsavedChanges = boss.isConfigDirty || personalResumeDirty;

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    const closeRailMenu = (event: MouseEvent) => {
      if (!railRef.current?.contains(event.target as Node)) setActiveRailMenu(null);
    };
    const closeRailMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActiveRailMenu(null);
    };
    document.addEventListener('mousedown', closeRailMenu);
    document.addEventListener('keydown', closeRailMenuOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeRailMenu);
      document.removeEventListener('keydown', closeRailMenuOnEscape);
    };
  }, []);

  useEffect(() => {
    if (!boss.loading && !boss.config && boss.projects.length === 0) {
      setCreateDirectionOpen(true);
    }
  }, [boss.config, boss.loading, boss.projects.length]);

  const confirmUnsavedConfig = useCallback(() => (
    !hasUnsavedChanges || window.confirm(t('notices.unsavedChangesLeaveConfirm'))
  ), [hasUnsavedChanges, t]);

  const confirmDiscardUnsavedConfig = useCallback(() => {
    if (!confirmUnsavedConfig()) return false;
    // This path is used for navigation only.  Restore the last saved values so
    // an abandoned draft neither triggers another warning nor gets saved later.
    if (boss.isConfigDirty) boss.discardConfigChanges();
    return true;
  }, [boss.discardConfigChanges, boss.isConfigDirty, confirmUnsavedConfig]);

  useEffect(() => {
    const openSettings = () => {
      if (!confirmDiscardUnsavedConfig()) return;
      setActiveTab('Settings');
    };
    window.addEventListener('bossflow:llm-settings-required', openSettings);
    return () => window.removeEventListener('bossflow:llm-settings-required', openSettings);
  }, [confirmDiscardUnsavedConfig]);

  const navigateToTab = useCallback((tab: Tab) => {
    if (tab === activeTab || confirmDiscardUnsavedConfig()) {
      setActiveTab(tab);
      setActiveRailMenu(null);
    }
  }, [activeTab, confirmDiscardUnsavedConfig]);

  const setActiveTabStable = useCallback((tab: Tab) => {
    navigateToTab(tab);
  }, [navigateToTab]);

  const openDashboardTask = useCallback((tab: Tab, target?: DashboardTaskTarget) => {
    if (tab !== activeTab && !confirmDiscardUnsavedConfig()) return;
    setDashboardTargetRequestId((value) => value + 1);
    setSelectedJobId(tab === 'Jobs' ? target?.jobId ?? null : null);
    setSelectedPipelineKey(tab === 'Pipeline' ? target?.sourceKey ?? '' : '');
    setSelectedEvidenceRequirementId(tab === 'Pipeline' ? target?.requirementId ?? '' : '');
    setSelectedEvidenceTaskId(tab === 'Evidence' ? target?.evidenceTaskId ?? '' : '');
    setSelectedResumeKey(tab === 'Resume' ? target?.sourceKey ?? '' : '');
    setSelectedResumeTarget(tab === 'Resume' ? { sourceKey: target?.sourceKey ?? '' } : null);
    setSelectedStoryDraftId(tab === 'Story' ? target?.draftId ?? '' : '');
    if (tab === 'Interview' && target?.sourceKey) setSelectedInterviewKey(target.sourceKey);
    setActiveTab(tab);
  }, [activeTab, confirmDiscardUnsavedConfig]);

  const startCrawl = async () => {
    if (boss.isConfigDirty && !confirmUnsavedConfig()) return;
    if (await boss.startCrawl()) {
      setActiveTab('Logs');
    }
  };

  useEffect(() => {
    if (!resumeGuideAfterCrawl || !boss.crawlAuthenticated) return;
    setResumeGuideAfterCrawl(false);
    setResumeGuideAutoStartPending(true);
    setActiveTab('PersonalResume');
  }, [boss.crawlAuthenticated, resumeGuideAfterCrawl]);

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

  const openCreateDirection = () => {
    if (!confirmDiscardUnsavedConfig()) return;
    setSelectedDirectionTemplateId(JOB_DIRECTION_TEMPLATES[0].id);
    setDirectionName(JOB_DIRECTION_TEMPLATES[0].defaultName);
    setDirectionCitiesText('');
    setDirectionCreateError('');
    setCreateDirectionOpen(true);
  };

  const selectDirectionTemplate = (template?: JobDirectionTemplate) => {
    setSelectedDirectionTemplateId(template?.id ?? 'custom');
    setDirectionName(template?.defaultName ?? '');
    setDirectionCreateError('');
  };

  const createDirection = async () => {
    const name = directionName.trim();
    if (!name) {
      setDirectionCreateError(t('directions.nameRequired'));
      return;
    }
    if (!directionCitiesText.trim()) {
      setDirectionCreateError(t('directions.cityRequired'));
      return;
    }
    setCreatingDirection(true);
    setDirectionCreateError('');
    try {
      const template = JOB_DIRECTION_TEMPLATES.find((item) => item.id === selectedDirectionTemplateId);
      await boss.createProject(name, buildTemplateSeed(template, name, directionCitiesText));
      setCreateDirectionOpen(false);
      setActiveTab('Scope');
      setScopeGuideAutoStartPending(false);
    } catch (error) {
      setDirectionCreateError((error as Error).message);
    } finally {
      setCreatingDirection(false);
    }
  };

  const pageTitleByTab: Record<Tab, string> = {
    Dashboard: t('nav.dashboard'), Scope: t('nav.scope'), MatchingRules: t('nav.matchingRules'),
    ScoringRules: t('nav.scoringRules'), Jobs: t('nav.jobs'), Pipeline: t('nav.pipeline'),
    Evidence: t('nav.evidence'), PersonalResume: t('nav.personalResume'), Resume: t('nav.resume'), Story: t('nav.story'),
    Interview: t('nav.interview'), Logs: t('nav.logs'), Settings: t('nav.settings'),
  };
  const discoveryActive = activeTab === 'Scope' || activeTab === 'MatchingRules' || activeTab === 'ScoringRules' || activeTab === 'Jobs' || activeTab === 'Logs';
  const materialsActive = activeTab === 'Evidence' || activeTab === 'PersonalResume' || activeTab === 'Resume';
  const interviewActive = activeTab === 'Interview' || activeTab === 'Story';

  const renderRailFlyout = (menu: RailMenu) => {
    const definitions = {
      discovery: {
        title: t('nav.stages.discovery'),
        items: [
          { tab: 'Jobs' as Tab, icon: <Briefcase size={16} />, label: t('nav.jobs') },
          { tab: 'Scope' as Tab, icon: <Crosshair size={16} />, label: t('nav.scope') },
          { tab: 'MatchingRules' as Tab, icon: <Tags size={16} />, label: t('nav.matchingRules') },
          { tab: 'ScoringRules' as Tab, icon: <SlidersHorizontal size={16} />, label: t('nav.scoringRules') },
          { tab: 'Logs' as Tab, icon: <Terminal size={16} />, label: t('nav.logs') },
        ],
      },
      materials: {
        title: t('nav.stages.materials'),
        items: [
          { tab: 'Evidence' as Tab, icon: <FileCheck2 size={16} />, label: t('nav.evidence') },
          { tab: 'PersonalResume' as Tab, icon: <UserRound size={16} />, label: t('nav.personalResume') },
          { tab: 'Resume' as Tab, icon: <FileText size={16} />, label: t('nav.resume') },
        ],
      },
      interview: {
        title: t('nav.stages.interview'),
        items: [
          { tab: 'Interview' as Tab, icon: <MessageSquareText size={16} />, label: t('nav.interview') },
          { tab: 'Story' as Tab, icon: <BookOpenText size={16} />, label: t('nav.story') },
        ],
      },
    }[menu];
    return (
      <div className={`desktop-rail-menu desktop-rail-menu--${menu}`} role="menu" aria-label={definitions.title}>
        <div className="desktop-rail-menu__header">{definitions.title}</div>
        <div className="desktop-rail-menu__items">
          {definitions.items.map((item) => (
            <button key={item.tab} type="button" role="menuitem" onClick={() => navigateToTab(item.tab)} className={`desktop-rail-menu__item${activeTab === item.tab ? ' desktop-rail-menu__item--active' : ''}`}>
              <span>{item.icon}</span><span>{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="app-shell desktop-shell flex h-screen w-full overflow-hidden font-sans selection:bg-indigo-500/30">
      <aside ref={railRef} className="app-sidebar desktop-rail" aria-label="Primary navigation">
        <button type="button" className="desktop-rail__brand" onClick={() => navigateToTab('Dashboard')} title="BossFlow">
          <Crosshair size={18} />
          <span className="sr-only">BossFlow</span>
        </button>
        <nav className="desktop-rail__nav">
          <RailButton icon={<LayoutDashboard size={19} />} label={t('nav.dashboard')} active={activeTab === 'Dashboard'} onClick={() => navigateToTab('Dashboard')} />
          <div className="desktop-rail__group">
            <RailButton icon={<Briefcase size={19} />} label={t('nav.stages.discovery')} active={discoveryActive} expanded={activeRailMenu === 'discovery'} onClick={() => setActiveRailMenu((current) => current === 'discovery' ? null : 'discovery')} />
            {activeRailMenu === 'discovery' && renderRailFlyout('discovery')}
          </div>
          <RailButton icon={<Inbox size={19} />} label={t('nav.pipeline')} active={activeTab === 'Pipeline'} onClick={() => navigateToTab('Pipeline')} />
          <div className="desktop-rail__group">
            <RailButton icon={<FileText size={19} />} label={t('nav.stages.materials')} active={materialsActive} expanded={activeRailMenu === 'materials'} onClick={() => setActiveRailMenu((current) => current === 'materials' ? null : 'materials')} />
            {activeRailMenu === 'materials' && renderRailFlyout('materials')}
          </div>
          <div className="desktop-rail__group">
            <RailButton icon={<MessageSquareText size={19} />} label={t('nav.stages.interview')} active={interviewActive} expanded={activeRailMenu === 'interview'} onClick={() => setActiveRailMenu((current) => current === 'interview' ? null : 'interview')} />
            {activeRailMenu === 'interview' && renderRailFlyout('interview')}
          </div>
        </nav>
        <div className="desktop-rail__footer">
          <RailButton icon={<SettingsIcon size={19} />} label={t('nav.settings')} active={activeTab === 'Settings'} onClick={() => navigateToTab('Settings')} />
          <ThemePicker />
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="app-header desktop-titlebar">
          <div className="desktop-titlebar__identity">
            <span className="desktop-titlebar__product">BossFlow</span>
            <span className="desktop-titlebar__separator">/</span>
            <span className="desktop-titlebar__page">{pageTitleByTab[activeTab]}</span>
          </div>
          <div className="desktop-titlebar__controls">
            <div className="desktop-project-switcher">
              <select
                aria-label={t('header.project')}
                value={boss.project}
                onChange={(event) => {
                  if (confirmDiscardUnsavedConfig()) void boss.loadConfig(event.target.value);
                }}
                disabled={boss.projects.length === 0}
                className="desktop-project-switcher__select"
              >
                {boss.projects.length === 0 && <option value="">{t('directions.none')}</option>}
                {boss.projects.map((name) => <option value={name} key={name}>{name}</option>)}
              </select>
              <button
                type="button"
                onClick={openCreateDirection}
                className="desktop-titlebar__icon-button"
                title={t('directions.newButton')}
                aria-label={t('directions.newButton')}
              >
                <Plus size={14} />
              </button>
            </div>

            <div className="h-4 w-[1px] bg-zinc-800" />
            <StatusBadge status={boss.status} />
            <div className="h-4 w-[1px] bg-zinc-800" />

            <button
              className="desktop-titlebar__database"
              onClick={() => setDbPathExpanded(!dbPathExpanded)}
              title={boss.config?.dbFilePath || ''}
            >
              <Database size={14} className="shrink-0" />
              <span>
                {dbPathExpanded ? boss.config?.dbFilePath || t('header.noDatabaseLoaded') : boss.config?.dbFileName || t('header.noDatabase')}
              </span>
            </button>
            <div className="desktop-titlebar__secondary-controls">
            <button type="button" onClick={() => navigateToTab('Logs')} className="desktop-titlebar__icon-button" title={t('header.viewLogs')} aria-label={t('header.viewLogs')}>
              <Terminal size={15} />
            </button>
            {!boss.isRunning ? (
              <button data-guide-target="start-crawl" onClick={startCrawl} disabled={!boss.config || boss.loading} className="desktop-titlebar__primary-action">
                <Play size={14} />
                {t('header.startCrawl')}
              </button>
            ) : (
              <button onClick={stopTask} className="desktop-titlebar__stop-action">
                <Square size={14} />
                {t('header.stopCrawl')}
              </button>
            )}
            </div>
          </div>
        </header>

        {boss.notice && (
          <div className="absolute right-5 top-16 z-50 max-w-md rounded border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-100 shadow-xl">
            {boss.notice}
          </div>
        )}

        {createDirectionOpen && (
          <div className="direction-create-overlay">
            <div className="direction-create-dialog" role="dialog" aria-modal="true" aria-labelledby="direction-create-title">
              <div className="direction-create-dialog__header">
                <div>
                  <span>{t('directions.onboardingEyebrow')}</span>
                  <h2 id="direction-create-title">{t('directions.createTitle')}</h2>
                  <p>{t('directions.createDescription')}</p>
                </div>
                {boss.projects.length > 0 && <button type="button" onClick={() => setCreateDirectionOpen(false)} disabled={creatingDirection} aria-label={t('directions.cancel')}>×</button>}
              </div>
              <div className="direction-create-dialog__body">
                <section className="direction-template-picker">
                  <div className="direction-create-section-heading">
                    <div><strong>{t('directions.templateHeading')}</strong><p>{t('directions.templateHint')}</p></div>
                  </div>
                  <div className="direction-template-grid">
                    {JOB_DIRECTION_TEMPLATES.map((template) => {
                      const TemplateIcon = {
                        sparkles: Sparkles,
                        product: LayoutDashboard,
                        frontend: PanelsTopLeft,
                        backend: Server,
                        data: ChartNoAxesCombined,
                        embedded: Cpu,
                      }[template.icon];
                      const selected = selectedDirectionTemplateId === template.id;
                      return (
                        <button key={template.id} type="button" aria-pressed={selected} className={selected ? 'direction-template-card direction-template-card--selected' : 'direction-template-card'} onClick={() => selectDirectionTemplate(template)}>
                          <span className="direction-template-card__icon"><TemplateIcon size={17} /></span>
                          <span className="direction-template-card__copy"><strong>{t(template.titleKey)}</strong><small>{t(template.descriptionKey)}</small></span>
                        </button>
                      );
                    })}
                    <button type="button" aria-pressed={selectedDirectionTemplateId === 'custom'} className={selectedDirectionTemplateId === 'custom' ? 'direction-template-card direction-template-card--selected' : 'direction-template-card'} onClick={() => selectDirectionTemplate()}>
                      <span className="direction-template-card__icon"><Code2 size={17} /></span>
                      <span className="direction-template-card__copy"><strong>{t('directions.customTitle')}</strong><small>{t('directions.customDescription')}</small></span>
                    </button>
                  </div>
                </section>

                <section className="direction-target-setup">
                  <div className="direction-create-section-heading"><div><strong>{t('directions.setupHeading')}</strong></div></div>
                  <label htmlFor="direction-name">{t('directions.nameLabel')}</label>
                  <input id="direction-name" value={directionName} onChange={(event) => setDirectionName(event.target.value)} placeholder={t('directions.namePlaceholder')} />
                  {selectedDirectionTemplateId !== 'custom' && (() => {
                    const template = JOB_DIRECTION_TEMPLATES.find((item) => item.id === selectedDirectionTemplateId);
                    return template ? (
                      <div className="direction-template-keywords">
                        <span>{t('directions.templateKeywords')}</span>
                        <div>{template.keywords.map((keyword) => <small key={keyword}>{keyword}</small>)}</div>
                      </div>
                    ) : null;
                  })()}
                  <label>{t('directions.targetCities')}</label>
                  <CitySelector compact showAdvanced={false} value={directionCitiesText} onChange={(citiesText) => { setDirectionCitiesText(citiesText); setDirectionCreateError(''); }} />
                  {directionCreateError && <p className="direction-create-error">{directionCreateError}</p>}
                </section>
              </div>
              <div className="direction-create-dialog__footer">
                {boss.projects.length > 0 && <button className="direction-create-cancel" onClick={() => setCreateDirectionOpen(false)} disabled={creatingDirection}>{t('directions.cancel')}</button>}
                <button className="direction-create-submit" onClick={() => void createDirection()} disabled={creatingDirection}>
                  {creatingDirection ? t('directions.creating') : t('directions.createAction')}
                </button>
              </div>
            </div>
          </div>
        )}

        {crawlGuideOpen && (
          <GuidedTour
            steps={[{
              target: 'start-crawl',
              title: t('directions.crawlTour.title'),
              body: t('directions.crawlTour.body'),
            }]}
            activeStep={0}
            onStepChange={() => undefined}
            onClose={() => setCrawlGuideOpen(false)}
            nextLabel={t('directions.crawlTour.finish')}
            previousLabel={t('directions.crawlTour.finish')}
            finishLabel={t('directions.crawlTour.finish')}
            skipLabel={t('directions.crawlTour.skip')}
            progressLabel={(current, total) => t('directions.crawlTour.progress', { current, total })}
          />
        )}

        <main className="app-main flex-1 overflow-auto bg-zinc-950 p-4 lg:p-5">
          <div className={isWideWorkspace ? 'h-full w-full min-w-0' : 'max-w-6xl mx-auto h-full'}>
            <Suspense fallback={<PageLoading label={currentLanguage.startsWith('zh') ? '加载页面...' : 'Loading page...'} />}>
              {activeTab === 'Dashboard' && boss.config && (
                <Dashboard
                  config={boss.config}
                  jobs={boss.jobs}
                  pipeline={boss.pipeline}
                  evidenceOverview={boss.evidenceOverview}
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
                    if (boss.config && confirmDiscardUnsavedConfig()) void boss.loadConfig(boss.config.project);
                  }}
                  onLogin={startLogin}
                  onProcessPartial={processPartial}
                  autoStartGuide={scopeGuideAutoStartPending}
                  onAutoStartGuideHandled={() => setScopeGuideAutoStartPending(false)}
                  onGuideComplete={() => {
                    setMatchingGuideAutoStartPending(true);
                    setActiveTab('MatchingRules');
                  }}
                />
              )}
              {activeTab === 'MatchingRules' && boss.config && (
                <Rules
                  mode="matching"
                  config={boss.config}
                  updateConfig={boss.updateConfig}
                  onSave={boss.saveConfig}
                  autoStartGuide={matchingGuideAutoStartPending}
                  onAutoStartGuideHandled={() => setMatchingGuideAutoStartPending(false)}
                  onGuideComplete={() => {
                    setResumeGuideAfterCrawl(true);
                    setCrawlGuideOpen(true);
                  }}
                  onGuidedLlmSetupRequired={() => setReturnToMatchingGuideAfterApiTest(true)}
                />
              )}
              {activeTab === 'ScoringRules' && boss.config && (
                <Rules mode="scoring" config={boss.config} updateConfig={boss.updateConfig} onSave={boss.saveConfig} />
              )}
              {activeTab === 'Settings' && (
                <Settings
                  onUpdated={() => undefined}
                  returnToMatchingGuideAfterTest={returnToMatchingGuideAfterApiTest}
                  onReturnToMatchingGuide={() => {
                    setReturnToMatchingGuideAfterApiTest(false);
                    setMatchingGuideAutoStartPending(true);
                    setActiveTab('MatchingRules');
                  }}
                />
              )}
              {activeTab === 'Jobs' && (
                <Jobs
                  project={boss.project}
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
                  evidenceOverview={boss.evidenceOverview}
                  evidenceLoading={boss.evidenceLoading}
                  evidenceError={boss.evidenceError}
                  onClassifyEvidenceCoverage={boss.classifyEvidenceCoverage}
                  onCreateEvidenceItem={boss.createEvidenceItem}
                  onUpdateEvidenceItem={boss.updateEvidenceItem}
                  onConfirmEvidenceItem={boss.confirmEvidenceItem}
                  onOpenPersonalResume={() => navigateToTab('PersonalResume')}
                  onOpenEvidenceProfile={() => navigateToTab('Evidence')}
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
                  targetRequirementId={selectedEvidenceRequirementId}
                  targetRequestId={dashboardTargetRequestId}
                />
              )}
              {activeTab === 'Evidence' && (
                <Evidence
                  overview={boss.evidenceOverview}
                  loading={boss.evidenceLoading}
                  error={boss.evidenceError}
                  onRefresh={() => { void boss.refreshEvidenceOverview(); }}
                  onCreateEvidenceItem={boss.createEvidenceItem}
                  onUpdateEvidenceItem={boss.updateEvidenceItem}
                  onConfirmEvidenceItem={boss.confirmEvidenceItem}
                  onClassifyCapability={boss.classifyCapability}
                  onCreateEvidenceTask={boss.createEvidenceTask}
                  onUpdateEvidenceTask={boss.updateEvidenceTask}
                  targetTaskId={selectedEvidenceTaskId}
                  targetRequestId={dashboardTargetRequestId}
                />
              )}
              {activeTab === 'Resume' && (
                <Resume
                  items={boss.resumeItems}
                  evidenceOverview={boss.evidenceOverview}
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
              {activeTab === 'PersonalResume' && (
                <PersonalResume
                  project={boss.project}
                  items={boss.resumeItems}
                  onRefreshItems={() => { void boss.refreshResumeItems(); }}
                  onLoadDraft={boss.loadResumeDraft}
                  onSaveDraft={boss.saveResumeDraft}
                  onDirtyChange={setPersonalResumeDirty}
                  onOpenCapabilityProfile={() => navigateToTab('Evidence')}
                  autoStartGuide={resumeGuideAutoStartPending}
                  onAutoStartGuideHandled={() => setResumeGuideAutoStartPending(false)}
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
                  evidenceOverview={boss.evidenceOverview}
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
