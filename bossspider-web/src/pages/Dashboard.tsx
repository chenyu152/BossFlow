import {
  AlertCircle,
  ArrowRight,
  BookOpenText,
  Briefcase,
  CheckCircle2,
  Clock3,
  FileCheck2,
  FileText,
  Inbox,
  Layers3,
  ListChecks,
  MessageSquareText,
  Search,
  Sparkles,
  Terminal,
  UserRound,
} from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useAppTranslation } from '../i18n';
import { bossApi } from '../api';
import type {
  ConfigPayload,
  CvStatusResponse,
  EvidenceOverviewResponse,
  InterviewStoryDraft,
  InterviewStoryDraftsResponse,
  Job,
  ParsedLog,
  PipelineItem,
  PipelineResponse,
  Tab,
} from '../types';

type TaskTone = 'amber' | 'emerald' | 'indigo' | 'cyan' | 'zinc';

export type DashboardTaskTarget = {
  jobId?: number;
  sourceKey?: string;
  draftId?: string;
  requirementId?: string;
  evidenceTaskId?: string;
};

type DashboardTask = {
  id: string;
  title: string;
  detail: string;
  meta: string;
  tone: TaskTone;
  tab: Tab;
  action: string;
  target?: DashboardTaskTarget;
};

const cvMissingLabels: Record<string, string> = {
  hasContent: 'cvGuide.missingContent',
  hasYears: 'cvGuide.missingYears',
  hasEducation: 'cvGuide.missingEducation',
  hasSkills: 'cvGuide.missingSkills',
  hasProjects: 'cvGuide.missingProjects',
  hasExperience: 'cvGuide.missingExperience',
};

const toneClasses: Record<TaskTone, { border: string; icon: string; pill: string }> = {
  amber: {
    border: 'dashboard-task dashboard-task--pending border-amber-900/60 bg-amber-950/20',
    icon: 'dashboard-task__icon text-amber-300',
    pill: 'dashboard-task__pill border-amber-900/70 bg-amber-950/40 text-amber-300',
  },
  emerald: {
    border: 'dashboard-task dashboard-task--success border-emerald-900/60 bg-emerald-950/20',
    icon: 'dashboard-task__icon text-emerald-300',
    pill: 'dashboard-task__pill border-emerald-900/70 bg-emerald-950/40 text-emerald-300',
  },
  indigo: {
    border: 'dashboard-task dashboard-task--info border-indigo-900/60 bg-indigo-950/20',
    icon: 'dashboard-task__icon text-indigo-300',
    pill: 'dashboard-task__pill border-indigo-900/70 bg-indigo-950/40 text-indigo-300',
  },
  cyan: {
    border: 'dashboard-task dashboard-task--info border-cyan-900/60 bg-cyan-950/20',
    icon: 'dashboard-task__icon text-cyan-300',
    pill: 'dashboard-task__pill border-cyan-900/70 bg-cyan-950/40 text-cyan-300',
  },
  zinc: {
    border: 'dashboard-task dashboard-task--neutral border-zinc-800 bg-zinc-900/40',
    icon: 'dashboard-task__icon text-zinc-400',
    pill: 'dashboard-task__pill border-zinc-800 bg-zinc-900 text-zinc-400',
  },
};

function parseTime(value?: string) {
  if (!value) return 0;
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const time = new Date(normalized).getTime();
  return Number.isFinite(time) ? time : 0;
}

function isToday(value?: string) {
  const time = parseTime(value);
  if (!time) return false;
  const date = new Date(time);
  const now = new Date();
  return date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
}

function itemScore(item: PipelineItem) {
  return Math.max(item.llmScore ?? 0, item.score ?? 0);
}

function TaskRow({
  task,
  icon,
  onOpen,
}: {
  task: DashboardTask;
  icon: ReactNode;
  onOpen: (task: DashboardTask) => void;
}) {
  const tone = toneClasses[task.tone];
  return (
    <button
      data-task-id={task.id}
      onClick={() => onOpen(task)}
      className={`group flex w-full items-start gap-3 rounded border p-3 text-left transition-colors hover:border-zinc-600 hover:bg-zinc-900/80 ${tone.border}`}
    >
      <span className={`mt-0.5 shrink-0 ${tone.icon}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-zinc-100">{task.title}</span>
        <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-zinc-400">{task.detail}</span>
        <span className={`mt-2 inline-flex rounded border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${tone.pill}`}>
          {task.meta}
        </span>
      </span>
      <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-xs text-zinc-500 group-hover:text-zinc-200">
        {task.action}
        <ArrowRight size={12} />
      </span>
    </button>
  );
}

function TaskSection({
  title,
  subtitle,
  empty,
  children,
}: {
  title: string;
  subtitle: string;
  empty: string;
  children: ReactNode;
}) {
  const hasItems = Boolean(children);
  return (
    <section className="rounded-md border border-zinc-800 bg-zinc-950">
      <div className="border-b border-zinc-800 px-4 py-3">
        <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
        <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>
      </div>
      <div className="space-y-2 p-3">
        {hasItems ? children : (
          <div className="rounded border border-dashed border-zinc-800 bg-zinc-900/30 p-4 text-sm text-zinc-500">
            {empty}
          </div>
        )}
      </div>
    </section>
  );
}

function LauncherTile({
  icon,
  title,
  detail,
  count,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="dashboard-launcher-tile">
      <span className="dashboard-launcher-tile__icon">{icon}</span>
      <span className="dashboard-launcher-tile__copy">
        <span className="dashboard-launcher-tile__title">{title}</span>
        <span className="dashboard-launcher-tile__detail">{detail}</span>
      </span>
      {typeof count === 'number' && <span className="dashboard-launcher-tile__count">{count}</span>}
      <ArrowRight size={13} className="dashboard-launcher-tile__arrow" aria-hidden="true" />
    </button>
  );
}

export function Dashboard({
  config,
  jobs,
  pipeline,
  evidenceOverview,
  setActiveTab,
  onOpenTask,
  recentLogs,
  onLoadStoryDrafts,
}: {
  config: ConfigPayload;
  jobs: Job[];
  pipeline: PipelineResponse | null;
  evidenceOverview: EvidenceOverviewResponse | null;
  setActiveTab: (tab: Tab) => void;
  onOpenTask: (tab: Tab, target?: DashboardTaskTarget) => void;
  recentLogs: ParsedLog[];
  onLoadStoryDrafts: () => Promise<InterviewStoryDraftsResponse | null>;
}) {
  const { t, i18n } = useAppTranslation();
  const isZh = (i18n.resolvedLanguage || i18n.language).startsWith('zh');
  const pending = pipeline?.pending || [];
  const processed = pipeline?.processed || [];
  const allPipelineItems = useMemo(() => [...pending, ...processed], [pending, processed]);
  const [storyDrafts, setStoryDrafts] = useState<InterviewStoryDraft[]>([]);
  const [storyDraftsLoading, setStoryDraftsLoading] = useState(false);
  const [cvStatus, setCvStatus] = useState<CvStatusResponse | null>(null);
  const [cvLoading, setCvLoading] = useState(false);
  const [cvError, setCvError] = useState('');
  const scoringKeywordCount = useMemo(() => {
    try {
      const scoring = JSON.parse(config.scoringRulesText || '{}');
      return Array.isArray(scoring.keywordHints) ? scoring.keywordHints.filter((item: unknown) => String(item || '').trim()).length : 0;
    } catch {
      return 0;
    }
  }, [config.scoringRulesText]);

  const evidenceTasks = useMemo(() => {
    const activeTasks = (evidenceOverview?.tasks || []).filter(
      (task) => (task.status === 'pending' || task.status === 'in_progress')
        && ['learn', 'project', 'strengthen', 'translate'].includes(task.taskType),
    );
    if (!activeTasks.length) return [];

    const requirements = (evidenceOverview?.requirements || []).filter((requirement) => requirement.active !== false);
    const requirementsById = new Map(requirements.map((requirement) => [requirement.requirementId, requirement]));
    const pendingSourceKeys = new Set(pending.map((item) => item.sourceKey));
    const groups = new Map<string, typeof activeTasks>();
    for (const task of activeTasks) {
      const requirement = requirementsById.get(task.requirementId);
      if (!requirement) continue;
      const groupKey = requirement.canonicalGroupId || requirement.canonicalKey || requirement.requirementId;
      groups.set(groupKey, [...(groups.get(groupKey) || []), task]);
    }

    const priorityRank = { high: 0, medium: 1, low: 2 } as const;
    return Array.from(groups.entries()).map(([groupKey, groupedTasks]) => {
      const groupedRequirementIds = new Set(groupedTasks.map((task) => task.requirementId));
      const representativeTask = [...groupedTasks].sort(
        (a, b) => priorityRank[a.priorityBand] - priorityRank[b.priorityBand],
      )[0];
      const representativeRequirement = requirementsById.get(representativeTask.requirementId);
      const relatedRequirements = requirements.filter(
        (requirement) => (requirement.canonicalGroupId || requirement.canonicalKey || requirement.requirementId) === groupKey,
      );
      const affectedSourceKeys = Array.from(new Set([
        ...relatedRequirements.map((requirement) => requirement.sourceKey),
        ...groupedTasks.flatMap((task) => task.affectedSourceKeys || []),
      ])).filter((sourceKey) => pendingSourceKeys.has(sourceKey));
      const targetRequirement = representativeRequirement && pendingSourceKeys.has(representativeRequirement.sourceKey)
        ? representativeRequirement
        : relatedRequirements.find(
            (requirement) => requirement.sourceKey === affectedSourceKeys[0] && groupedRequirementIds.has(requirement.requirementId),
          ) || relatedRequirements.find((requirement) => requirement.sourceKey === affectedSourceKeys[0]);
      const requiredCount = relatedRequirements.filter(
        (requirement) => affectedSourceKeys.includes(requirement.sourceKey) && requirement.importance === 'required',
      ).length;
      const jobCount = affectedSourceKeys.length;
      const priority = requiredCount >= 2 || jobCount >= 3 || groupedTasks.some((task) => task.priorityBand === 'high')
        ? 'high'
        : requiredCount >= 1 || jobCount >= 2 || groupedTasks.some((task) => task.priorityBand === 'medium')
          ? 'medium'
          : 'low';
      return {
        id: `evidence:${groupKey}`,
        title: representativeRequirement?.label || t('dashboardTasks.evidenceUntitled'),
        detail: representativeTask.recommendedAction || t('dashboardTasks.evidenceDefaultAction'),
        meta: t('dashboardTasks.evidenceTaskMeta', {
          priority: t(`dashboardTasks.priority.${priority}`),
          jobs: jobCount,
          required: requiredCount,
        }),
        tone: (priority === 'high' ? 'amber' : priority === 'medium' ? 'indigo' : 'zinc') as TaskTone,
        tab: 'Evidence' as Tab,
        action: t('dashboardTasks.handleEvidence'),
        target: { evidenceTaskId: representativeTask.taskId },
        priority,
        jobCount,
        requiredCount,
      };
    }).filter((task) => task.target).sort((a, b) => (
      priorityRank[a.priority] - priorityRank[b.priority]
      || b.jobCount - a.jobCount
      || b.requiredCount - a.requiredCount
    )).slice(0, 6);
  }, [evidenceOverview, pending, t]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setStoryDraftsLoading(true);
      try {
        const data = await onLoadStoryDrafts();
        if (!cancelled) setStoryDrafts(data?.drafts || []);
      } finally {
        if (!cancelled) setStoryDraftsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [onLoadStoryDrafts]);

  const loadCvStatus = async () => {
    setCvLoading(true);
    setCvError('');
    try {
      setCvStatus(await bossApi.getCvStatus(config.project));
    } catch (error) {
      setCvError((error as Error).message);
    } finally {
      setCvLoading(false);
    }
  };

  useEffect(() => {
    void loadCvStatus();
  }, [config.project]);

  const allTodayJobs = useMemo(
    () => jobs
      .filter((job) => isToday(job.firstSeen || job.lastSeen))
      .sort((a, b) => parseTime(b.firstSeen || b.lastSeen) - parseTime(a.firstSeen || a.lastSeen)),
    [jobs],
  );

  // The dashboard only renders a short preview, but the summary and launcher
  // counters must reflect every job collected today rather than that preview.
  const todayJobs = useMemo(() => allTodayJobs.slice(0, 5), [allTodayJobs]);

  const recentJobs = useMemo(
    () => [...jobs]
      .sort((a, b) => parseTime(b.lastSeen) - parseTime(a.lastSeen))
      .slice(0, 5),
    [jobs],
  );

  const focusItems = useMemo(
    () => pending
      .filter((item) => item.decisionStatus !== 'skipped' && item.decisionStatus !== 'archived' && itemScore(item) >= 4)
      .sort((a, b) => itemScore(b) - itemScore(a))
      .slice(0, 5),
    [pending],
  );

  const waitingItems = useMemo(() => {
    const reviewTasks = pending
      .filter((item) => item.decisionStatus === 'needs_review')
      .slice(0, 3)
      .map((item): DashboardTask => ({
        id: `review:${item.sourceKey}`,
        title: `${item.company} · ${item.title}`,
        detail: item.llmRecommendation || t('dashboardTasks.waitingReviewDetail'),
        meta: t('dashboardTasks.waitingReviewMeta'),
        tone: 'amber',
        tab: 'Pipeline',
        action: t('dashboardTasks.openCandidate'),
        target: { sourceKey: item.sourceKey },
      }));

    const storyTasks = storyDrafts
      .filter((draft) => draft.status === 'needs_confirmation' || draft.status === 'editing')
      .slice(0, 3)
      .map((draft): DashboardTask => ({
        id: `story:${draft.draftId}`,
        title: draft.title || t('dashboardTasks.untitledStoryDraft'),
        detail: draft.sourceLabel || draft.prepPath || t('dashboardTasks.storyDraftDetail'),
        meta: t('dashboardTasks.storyDraftMeta'),
        tone: 'cyan',
        tab: 'Story',
        action: t('dashboardTasks.openStoryBank'),
        target: { draftId: draft.draftId },
      }));

    return [...reviewTasks, ...storyTasks].slice(0, 6);
  }, [pending, storyDrafts, t]);

  const materialTasks = useMemo(() => {
    const tasks: DashboardTask[] = [];
    for (const item of pending) {
      if (item.decisionStatus === 'skipped' || item.decisionStatus === 'archived') continue;
      if (item.reportPath && !item.resumeSuggestionPath) {
        tasks.push({
          id: `report:${item.sourceKey}`,
          title: `${item.company} · ${item.title}`,
          detail: item.llmRecommendation || t('dashboardTasks.reportUnusedDetail'),
          meta: t('dashboardTasks.reportUnusedMeta'),
          tone: 'emerald',
          tab: 'Pipeline',
          action: t('dashboardTasks.generateSuggestions'),
          target: { sourceKey: item.sourceKey },
        });
      } else if (item.resumeSuggestionPath && !item.resumeDraftPath) {
        tasks.push({
          id: `suggestion:${item.sourceKey}`,
          title: `${item.company} · ${item.title}`,
          detail: t('dashboardTasks.suggestionUnusedDetail'),
          meta: item.resumeSuggestedAt || t('dashboardTasks.materialReadyMeta'),
          tone: 'indigo',
          tab: 'Resume',
          action: t('dashboardTasks.openResume'),
          target: { sourceKey: item.sourceKey },
        });
      } else if (item.resumeDraftPath && item.decisionStatus !== 'ready_to_greet' && item.decisionStatus !== 'greeted') {
        tasks.push({
          id: `draft:${item.sourceKey}`,
          title: `${item.company} · ${item.title}`,
          detail: t('dashboardTasks.draftUnusedDetail'),
          meta: item.resumeDraftedAt || t('dashboardTasks.materialReadyMeta'),
          tone: 'indigo',
          tab: 'Pipeline',
          action: t('dashboardTasks.openCandidate'),
          target: { sourceKey: item.sourceKey },
        });
      } else if (item.interviewPrepPath && !storyDrafts.some((draft) => draft.sourceKey === item.sourceKey && draft.status === 'promoted')) {
        tasks.push({
          id: `prep:${item.sourceKey}`,
          title: `${item.company} · ${item.title}`,
          detail: t('dashboardTasks.interviewPrepUnusedDetail'),
          meta: item.interviewPreparedAt || t('dashboardTasks.materialReadyMeta'),
          tone: 'cyan',
          tab: 'Interview',
          action: t('dashboardTasks.openInterview'),
          target: { sourceKey: item.sourceKey },
        });
      }
    }
    return tasks.slice(0, 6);
  }, [pending, storyDrafts, t]);

  const storyGapTasks = useMemo(
    () => storyDrafts
      .filter((draft) => draft.status !== 'promoted' && draft.status !== 'dismissed')
      .slice(0, 5)
      .map((draft): DashboardTask => ({
        id: `gap:${draft.draftId}`,
        title: draft.title || t('dashboardTasks.untitledStoryDraft'),
        detail: draft.theme || draft.sourceLabel || t('dashboardTasks.storyGapDetail'),
        meta: draft.status === 'ready' ? t('dashboardTasks.storyReadyMeta') : t('dashboardTasks.storyNeedsConfirmationMeta'),
        tone: draft.status === 'ready' ? 'emerald' : 'cyan',
        tab: 'Story',
        action: t('dashboardTasks.openStoryBank'),
        target: { draftId: draft.draftId },
      })),
    [storyDrafts, t],
  );

  const highValueCount = focusItems.length;
  const waitingCount = waitingItems.length;
  const materialCount = materialTasks.length;
  const storyGapCount = storyGapTasks.length;
  const evidenceTaskCount = evidenceTasks.length;
  const todayCount = allTodayJobs.length;
  const jobsToShow = todayJobs.length ? todayJobs : recentJobs;
  const jobSectionTitle = todayJobs.length ? t('dashboardTasks.todayJobs') : t('dashboardTasks.recentJobs');
  const jobSectionSubtitle = todayJobs.length ? t('dashboardTasks.todayJobsSubtitle') : t('dashboardTasks.recentJobsSubtitle');
  const focusTask: DashboardTask | null = focusItems[0] ? {
    id: `focus:${focusItems[0].sourceKey}`,
    title: `${focusItems[0].company} · ${focusItems[0].title}`,
    detail: focusItems[0].llmRecommendation || `${focusItems[0].city || '-'} · ${focusItems[0].salary || '-'}`,
    meta: `${t('dashboardTasks.score')} ${itemScore(focusItems[0]).toFixed(1)}`,
    tone: 'emerald',
    tab: 'Pipeline',
    action: t('dashboardTasks.openCandidate'),
    target: { sourceKey: focusItems[0].sourceKey },
  } : null;
  const recentJobTask: DashboardTask | null = jobsToShow[0] ? {
    id: `job:${jobsToShow[0].id}`,
    title: `${jobsToShow[0].company} · ${jobsToShow[0].title}`,
    detail: `${jobsToShow[0].city || '-'} · ${jobsToShow[0].salary || '-'} · ${jobsToShow[0].fitLevel || t('dashboardTasks.notScored')}`,
    meta: (todayJobs.length ? jobsToShow[0].firstSeen : jobsToShow[0].lastSeen) || t('dashboardTasks.noTime'),
    tone: 'zinc',
    tab: 'Jobs',
    action: t('dashboardTasks.openJobs'),
    target: { jobId: jobsToShow[0].id },
  } : null;
  const primaryTask: DashboardTask | null = evidenceTasks[0] || waitingItems[0] || materialTasks[0] || focusTask || recentJobTask;

  return (
    <div className="dashboard-page dashboard-home space-y-5">
      <div className="dashboard-home__heading">
        <div>
          <div className="dashboard-home__eyebrow"><ListChecks size={14} />{t('dashboardTasks.eyebrow')}</div>
          <h2>{t('dashboardTasks.title')}</h2>
          <p>{t('dashboardTasks.subtitle')}</p>
        </div>
        <div className="dashboard-home__summary" aria-label={isZh ? '今日摘要' : 'Today summary'}>
          <span><strong>{todayCount}</strong>{isZh ? ' 新岗位' : ' new jobs'}</span>
          <span><strong>{highValueCount}</strong>{isZh ? ' 高价值' : ' high value'}</span>
          <span><strong>{evidenceTaskCount + waitingCount}</strong>{isZh ? ' 待处理' : ' to handle'}</span>
        </div>
      </div>

      <div className="dashboard-launch-grid">
        <section className="dashboard-command-card">
          <div className="dashboard-command-card__glow" aria-hidden="true" />
          <div className="dashboard-command-card__header">
            <span>{isZh ? '下一步' : 'Next action'}</span>
            <span>{isZh ? '由价值与阻塞程度排序' : 'Ranked by value and blockers'}</span>
          </div>
          {primaryTask ? (
            <div className="dashboard-command-card__body">
              <div className="dashboard-command-card__mark"><Sparkles size={20} /></div>
              <div className="min-w-0">
                <h3>{primaryTask.title}</h3>
                <p>{primaryTask.detail}</p>
                <span className="dashboard-command-card__meta">{primaryTask.meta}</span>
              </div>
              <button type="button" onClick={() => onOpenTask(primaryTask.tab, primaryTask.target)}>
                {primaryTask.action}<ArrowRight size={14} />
              </button>
            </div>
          ) : (
            <div className="dashboard-command-card__empty">
              <CheckCircle2 size={20} />
              <div><strong>{isZh ? '当前队列已清空' : 'Queue is clear'}</strong><span>{isZh ? '可以浏览新岗位或开始一次采集。' : 'Browse jobs or start a new crawl.'}</span></div>
            </div>
          )}
          <div className="dashboard-command-card__metrics">
            <span><i className="dashboard-dot dashboard-dot--green" />{pending.length} {isZh ? '候选中' : 'candidates'}</span>
            <span><i className="dashboard-dot dashboard-dot--amber" />{waitingCount} {isZh ? '待确认' : 'pending review'}</span>
            <span><i className="dashboard-dot dashboard-dot--blue" />{materialCount} {isZh ? '材料任务' : 'material tasks'}</span>
          </div>
        </section>

        <section className="dashboard-launcher-panel">
          <div className="dashboard-launcher-panel__header">
            <div><strong>{isZh ? '工作区' : 'Workspace'}</strong><span>{isZh ? '直接进入高频任务' : 'Jump into frequent tasks'}</span></div>
          </div>
          <div className="dashboard-launcher-panel__grid">
            <LauncherTile icon={<Search size={17} />} title={t('nav.jobs')} detail={isZh ? '筛选与评估新机会' : 'Filter and assess opportunities'} count={todayCount} onClick={() => setActiveTab('Jobs')} />
            <LauncherTile icon={<Inbox size={17} />} title={t('nav.pipeline')} detail={isZh ? '推进候选与证据' : 'Advance candidates and evidence'} count={pending.length} onClick={() => setActiveTab('Pipeline')} />
            <LauncherTile icon={<ListChecks size={17} />} title={isZh ? '提升计划' : 'Improvement plans'} detail={isZh ? '推进已选择的能力建设' : 'Advance chosen capability work'} count={evidenceTaskCount} onClick={() => evidenceTasks[0] ? onOpenTask('Evidence', evidenceTasks[0].target) : setActiveTab('Evidence')} />
            <LauncherTile icon={<UserRound size={17} />} title={t('nav.personalResume')} detail={isZh ? '维护可信基础档案' : 'Maintain your verified profile'} onClick={() => setActiveTab('PersonalResume')} />
            <LauncherTile icon={<Layers3 size={17} />} title={t('nav.resume')} detail={isZh ? '查看岗位定制材料' : 'Review tailored materials'} count={materialCount} onClick={() => setActiveTab('Resume')} />
            <LauncherTile icon={<MessageSquareText size={17} />} title={t('nav.interview')} detail={isZh ? '准备面试与故事' : 'Prepare interviews and stories'} count={storyGapCount} onClick={() => setActiveTab('Interview')} />
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <TaskSection
            title={t('dashboardTasks.evidenceTasks')}
            subtitle={t('dashboardTasks.evidenceTasksSubtitle')}
            empty={t('dashboardTasks.noEvidenceTasks')}
          >
            {evidenceTasks.length ? evidenceTasks.map((task) => (
              <TaskRow key={task.id} task={task} icon={<ListChecks size={15} />} onOpen={(item) => onOpenTask(item.tab, item.target)} />
            )) : null}
          </TaskSection>

          <TaskSection
            title={jobSectionTitle}
            subtitle={jobSectionSubtitle}
            empty={t('dashboardTasks.noTodayJobs')}
          >
            {jobsToShow.length ? jobsToShow.map((job) => (
              <TaskRow
                key={job.id}
                task={{
                  id: `job:${job.id}`,
                  title: `${job.company} · ${job.title}`,
                  detail: `${job.city || '-'} · ${job.salary || '-'} · ${job.fitLevel || t('dashboardTasks.notScored')}`,
                  meta: (todayJobs.length ? job.firstSeen : job.lastSeen) || t('dashboardTasks.noTime'),
                  tone: (job.score ?? 0) >= 4 ? 'emerald' : 'zinc',
                  tab: 'Jobs',
                  action: t('dashboardTasks.openJobs'),
                  target: { jobId: job.id },
                }}
                icon={<Briefcase size={15} />}
                onOpen={(task) => onOpenTask(task.tab, task.target)}
              />
            )) : null}
          </TaskSection>

          <TaskSection
            title={t('dashboardTasks.focusJobs')}
            subtitle={t('dashboardTasks.focusJobsSubtitle')}
            empty={t('dashboardTasks.noFocusJobs')}
          >
            {focusItems.length ? focusItems.map((item) => (
              <TaskRow
                key={item.sourceKey}
                task={{
                  id: `focus:${item.sourceKey}`,
                  title: `${item.company} · ${item.title}`,
                  detail: item.llmRecommendation || `${item.city || '-'} · ${item.salary || '-'}`,
                  meta: `${t('dashboardTasks.score')} ${itemScore(item).toFixed(1)}`,
                  tone: 'emerald',
                  tab: 'Pipeline',
                  action: t('dashboardTasks.openCandidate'),
                  target: { sourceKey: item.sourceKey },
                }}
                icon={<Sparkles size={15} />}
                onOpen={(task) => onOpenTask(task.tab, task.target)}
              />
            )) : null}
          </TaskSection>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <TaskSection
              title={t('dashboardTasks.waitingConfirm')}
              subtitle={t('dashboardTasks.waitingConfirmSubtitle')}
              empty={t('dashboardTasks.noWaitingConfirm')}
            >
              {waitingItems.length ? waitingItems.map((task) => (
                <TaskRow key={task.id} task={task} icon={<AlertCircle size={15} />} onOpen={(item) => onOpenTask(item.tab, item.target)} />
              )) : null}
            </TaskSection>

            <TaskSection
              title={t('dashboardTasks.storyGaps')}
              subtitle={t('dashboardTasks.storyGapsSubtitle')}
              empty={storyDraftsLoading ? t('dashboardTasks.loadingStoryDrafts') : t('dashboardTasks.noStoryGaps')}
            >
              {storyGapTasks.length ? storyGapTasks.map((task) => (
                <TaskRow key={task.id} task={task} icon={<BookOpenText size={15} />} onOpen={(item) => onOpenTask(item.tab, item.target)} />
              )) : null}
            </TaskSection>
          </div>

          <TaskSection
            title={t('dashboardTasks.unusedMaterials')}
            subtitle={t('dashboardTasks.unusedMaterialsSubtitle')}
            empty={t('dashboardTasks.noUnusedMaterials')}
          >
            {materialTasks.length ? materialTasks.map((task) => (
              <TaskRow key={task.id} task={task} icon={<FileCheck2 size={15} />} onOpen={(item) => onOpenTask(item.tab, item.target)} />
            )) : null}
          </TaskSection>
        </div>

        <aside className="space-y-5">
          {jobs.length > 0 && scoringKeywordCount === 0 && (
            <section className="rounded-md border border-cyan-900/60 bg-cyan-950/20 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-cyan-100">
                <Sparkles size={14} />
                {t('scoringGuide.title')}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-cyan-100/75">{t('scoringGuide.body', { count: jobs.length })}</p>
              <button onClick={() => setActiveTab('ScoringRules')} className="mt-3 inline-flex items-center gap-2 rounded border border-cyan-800 bg-cyan-950/40 px-3 py-1.5 text-xs font-medium text-cyan-100 hover:bg-cyan-900/40">
                {t('scoringGuide.action')}
                <ArrowRight size={13} />
              </button>
            </section>
          )}
          <section className={`rounded-md border bg-zinc-950 ${
            cvStatus?.readyForScoring && cvStatus?.readyForMaterials
              ? 'border-emerald-900/60'
              : 'border-amber-900/60'
          }`}>
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                <FileText size={14} className={cvStatus?.readyForScoring ? 'text-emerald-400' : 'text-amber-400'} />
                {t('cvGuide.title')}
              </h3>
              <button onClick={() => void loadCvStatus()} disabled={cvLoading} className="text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-50">
                {cvLoading ? t('cvGuide.checking') : t('cvGuide.refresh')}
              </button>
            </div>
            <div className="space-y-3 p-4 text-sm">
              {cvError && <div className="rounded border border-red-900/60 bg-red-950/20 p-2 text-xs text-red-300">{cvError}</div>}
              {!cvStatus ? (
                <div className="text-zinc-500">{cvLoading ? t('cvGuide.checking') : t('cvGuide.notLoaded')}</div>
              ) : !cvStatus.exists ? (
                <>
                  <div className="font-medium text-amber-200">{t('cvGuide.missingTitle')}</div>
                  <p className="text-xs leading-relaxed text-zinc-400">{t('cvGuide.missingBody')}</p>
                  <div className="break-all text-[10px] text-zinc-600">{cvStatus.path}</div>
                </>
              ) : cvStatus.readyForScoring && cvStatus.readyForMaterials ? (
                <>
                  <div className="flex items-center gap-2 font-medium text-emerald-300">
                    <CheckCircle2 size={14} />
                    {t('cvGuide.readyTitle')}
                  </div>
                  <p className="text-xs leading-relaxed text-zinc-400">{t('cvGuide.readyBody')}</p>
                  <div className="break-all text-[10px] text-zinc-600">{cvStatus.path}</div>
                </>
              ) : (
                <>
                  <div className="font-medium text-amber-200">{t('cvGuide.incompleteTitle')}</div>
                  <p className="text-xs leading-relaxed text-zinc-400">{t('cvGuide.incompleteBody')}</p>
                  <div className="flex flex-wrap gap-1">
                    {cvStatus.missing.map((key) => (
                      <span key={key} className="rounded border border-amber-900/60 bg-amber-950/20 px-2 py-0.5 text-[10px] text-amber-200">
                        {t(cvMissingLabels[key] || key)}
                      </span>
                    ))}
                  </div>
                  <div className="break-all text-[10px] text-zinc-600">{cvStatus.path}</div>
                </>
              )}
              {cvStatus && (
                <button
                  onClick={() => setActiveTab('PersonalResume')}
                  className="inline-flex items-center gap-2 rounded border border-indigo-800 bg-indigo-950/30 px-3 py-1.5 text-xs font-medium text-indigo-200 hover:bg-indigo-900/30"
                >
                  {cvStatus.readyForScoring && cvStatus.readyForMaterials
                    ? t('cvGuide.openPersonalResume')
                    : t('cvGuide.completePersonalResume')}
                  <ArrowRight size={13} />
                </button>
              )}
            </div>
          </section>

          <section className="rounded-md border border-zinc-800 bg-zinc-950">
            <div className="border-b border-zinc-800 px-4 py-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                <Clock3 size={14} className="text-zinc-400" />
                {t('dashboardTasks.workflowSnapshot')}
              </h3>
            </div>
            <div className="space-y-3 p-4 text-xs text-zinc-400">
              <div className="flex items-center justify-between">
                <span>{t('dashboard.totalJobs')}</span>
                <span className="font-medium text-zinc-100">{config.jobCount.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>{t('dashboard.pipeline')}</span>
                <span className="font-medium text-zinc-100">{pending.length.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>{t('dashboard.processed')}</span>
                <span className="font-medium text-zinc-100">{processed.length.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>{t('dashboardTasks.generatedMaterials')}</span>
                <span className="font-medium text-zinc-100">{materialCount.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>{t('dashboardTasks.confirmedDone')}</span>
                <span className="font-medium text-emerald-300">
                  <CheckCircle2 size={13} className="mr-1 inline" />
                  {allPipelineItems.filter((item) => item.decisionStatus === 'ready_to_greet' || item.decisionStatus === 'greeted').length}
                </span>
              </div>
            </div>
          </section>

          <section className="rounded-md border border-zinc-800 bg-zinc-950">
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                <Terminal size={14} className="text-zinc-400" />
                {t('dashboard.recentLogs')}
              </h3>
              <button onClick={() => setActiveTab('Logs')} className="text-xs text-indigo-400 hover:text-indigo-300">{t('dashboard.fullLogs')}</button>
            </div>
            <div className="space-y-1 p-3 font-mono text-[11px] leading-relaxed">
              {recentLogs.length === 0 ? (
                <div className="text-zinc-600">{t('dashboard.noLogsYet')}</div>
              ) : recentLogs.map((log, index) => (
                <div key={`${log.time}-${index}`} className="flex gap-3">
                  <span className="shrink-0 text-zinc-600">{log.time}</span>
                  <span className={`${log.level === 'error' ? 'text-red-400' : log.level === 'warn' ? 'text-amber-400' : 'text-zinc-300'} truncate`}>
                    {log.msg}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
