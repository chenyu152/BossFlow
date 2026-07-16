import { ArrowDownWideNarrow, BookOpenText, BrainCircuit, CheckCircle2, Circle, FileText, Loader2, PanelLeftClose, PanelLeftOpen, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { JobWorkspace } from '../components/JobWorkspace';
import { useGreetingDraftEditor } from '../hooks/useGreetingDraftEditor';
import { useJobWorkspaceArtifacts } from '../hooks/useJobWorkspaceArtifacts';
import { useSelectedPipelineItem } from '../hooks/useSelectedPipelineItem';
import type {
  DecisionStatus,
  EvidenceClassification,
  EvidenceCoverage,
  EvidenceItem,
  EvidenceItemInput,
  EvidenceMutationResponse,
  EvidenceOverviewResponse,
  EvidenceRequirement,
  EvidenceTaskInput,
  GreetingDraftResponse,
  GreetingDraftStatus,
  InterviewPrepResponse,
  Job,
  PipelineItem,
  PipelineReportResponse,
  PipelineResponse,
  ResumeNavigationTarget,
  ResumeSuggestionResponse,
} from '../types';
import { useAppTranslation } from '../i18n';

function getDecisionLabel(status: DecisionStatus, t: (key: string) => string): string {
  const map: Record<DecisionStatus, string> = {
    needs_llm: 'pipeline.decisionStatus.needs_llm',
    needs_review: 'pipeline.decisionStatus.needs_review',
    ready_to_greet: 'pipeline.decisionStatus.ready_to_greet',
    greeted: 'pipeline.decisionStatus.greeted',
    interviewing: 'pipeline.decisionStatus.interviewing',
    skipped: 'pipeline.decisionStatus.skipped',
    archived: 'pipeline.decisionStatus.archived',
  };
  return t(map[status] || status);
}

const STATUS_CLASSES: Record<DecisionStatus, { badge: string; active: string; idle: string }> = {
  needs_llm: {
    badge: 'pipeline-status pipeline-status--info',
    active: 'pipeline-status-control pipeline-status-control--info is-active',
    idle: 'pipeline-status-control pipeline-status-control--info',
  },
  needs_review: {
    badge: 'pipeline-status pipeline-status--pending',
    active: 'pipeline-status-control pipeline-status-control--pending is-active',
    idle: 'pipeline-status-control pipeline-status-control--pending',
  },
  ready_to_greet: {
    badge: 'pipeline-status pipeline-status--success',
    active: 'pipeline-status-control pipeline-status-control--success is-active',
    idle: 'pipeline-status-control pipeline-status-control--success',
  },
  greeted: {
    badge: 'pipeline-status pipeline-status--info',
    active: 'pipeline-status-control pipeline-status-control--info is-active',
    idle: 'pipeline-status-control pipeline-status-control--info',
  },
  interviewing: {
    badge: 'pipeline-status pipeline-status--info',
    active: 'pipeline-status-control pipeline-status-control--info is-active',
    idle: 'pipeline-status-control pipeline-status-control--info',
  },
  skipped: {
    badge: 'pipeline-status pipeline-status--risk',
    active: 'pipeline-status-control pipeline-status-control--risk is-active',
    idle: 'pipeline-status-control pipeline-status-control--risk',
  },
  archived: {
    badge: 'pipeline-status pipeline-status--neutral',
    active: 'pipeline-status-control pipeline-status-control--neutral is-active',
    idle: 'pipeline-status-control pipeline-status-control--neutral',
  },
};

function statusBadgeClass(status: DecisionStatus) {
  return STATUS_CLASSES[status]?.badge || 'pipeline-status pipeline-status--neutral';
}

function statusButtonClass(status: DecisionStatus, active: boolean) {
  const classes = STATUS_CLASSES[status];
  if (!classes) return active ? 'pipeline-status-control pipeline-status-control--info is-active' : 'pipeline-status-control pipeline-status-control--neutral';
  return active ? classes.active : classes.idle;
}

function MaterialBadge({ label, ready, tone = 'zinc' }: { label: string; ready: boolean; tone?: 'emerald' | 'indigo' | 'cyan' | 'zinc' }) {
  return (
    <span className={`pipeline-material-badge pipeline-material-badge--${tone} ${ready ? 'is-ready' : 'is-missing'} inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium`}>
      {ready ? <CheckCircle2 size={10} /> : <Circle size={10} />}
      {label}
    </span>
  );
}

type EvidenceReadiness = 'ready' | 'needs_confirmation' | 'hard_gap' | 'unassessed';

type EvidenceReadinessSummary = {
  status: EvidenceReadiness;
  requirementCount: number;
  supportedCount: number;
  pendingDecisionCount: number;
  confirmedHardGapCount: number;
};

const EVIDENCE_READINESS_ORDER: Record<EvidenceReadiness, number> = {
  hard_gap: 0,
  needs_confirmation: 1,
  unassessed: 2,
  ready: 3,
};

function getEvidenceReadiness(
  item: PipelineItem,
  requirements: EvidenceRequirement[],
  coverageByRequirement: Map<string, EvidenceCoverage>,
): EvidenceReadinessSummary {
  const requirementCount = requirements.length || item.requirementCount || 0;
  const hasAssessment = requirements.length > 0 || Boolean(item.requirementAssessedAt);
  if (!hasAssessment || !requirementCount) {
    return {
      status: 'unassessed',
      requirementCount: 0,
      supportedCount: 0,
      pendingDecisionCount: 0,
      confirmedHardGapCount: 0,
    };
  }

  if (!requirements.length) {
    const pendingDecisionCount = Math.max(0, item.unresolvedRequirementCount || 0);
    return {
      status: pendingDecisionCount ? 'needs_confirmation' : 'ready',
      requirementCount,
      supportedCount: item.supportedRequirementCount || 0,
      pendingDecisionCount,
      confirmedHardGapCount: 0,
    };
  }

  const supportedCount = requirements.filter(
    (requirement) => coverageByRequirement.get(requirement.requirementId)?.coverageStatus === 'supported',
  ).length;
  const pendingDecisionCount = requirements.filter((requirement) => {
    const coverage = coverageByRequirement.get(requirement.requirementId);
    return coverage?.coverageStatus !== 'supported' && !coverage?.userDecisionAt;
  }).length;
  const confirmedHardGapCount = requirements.filter((requirement) => {
    const coverage = coverageByRequirement.get(requirement.requirementId);
    return requirement.importance === 'required' && coverage?.coverageStatus === 'user_confirmed_absent';
  }).length;

  return {
    status: confirmedHardGapCount
      ? 'hard_gap'
      : pendingDecisionCount
        ? 'needs_confirmation'
        : 'ready',
    requirementCount,
    supportedCount,
    pendingDecisionCount,
    confirmedHardGapCount,
  };
}

function evidenceReadinessClass(status: EvidenceReadiness) {
  return {
    ready: 'evidence-readiness evidence-readiness--success',
    needs_confirmation: 'evidence-readiness evidence-readiness--pending',
    hard_gap: 'evidence-readiness evidence-readiness--risk',
    unassessed: 'evidence-readiness evidence-readiness--neutral',
  }[status];
}

export function Pipeline({
  pipeline,
  evidenceOverview,
  evidenceLoading,
  evidenceError,
  onClassifyEvidenceCoverage,
  onCreateEvidenceItem,
  onUpdateEvidenceItem,
  onConfirmEvidenceItem,
  onCreateEvidenceTask,
  onOpenPersonalResume,
  onRefresh,
  onLlmEvaluate,
  llmEvaluatingKeys,
  resumeSuggestingKeys,
  interviewPreparingKeys,
  sortByLlmScore,
  setSortByLlmScore,
  onLoadJobDetail,
  onLoadReport,
  onLoadGreetingDraft,
  onSaveGreetingDraft,
  onGenerateResumeSuggestions,
  onLoadResumeSuggestion,
  onGenerateInterviewPrep,
  onLoadInterviewPrep,
  onUpdateStatus,
  onDeleteItem,
  onOpenResumeMaterials,
  targetSourceKey,
  targetRequirementId,
  targetRequestId,
}: {
  pipeline: PipelineResponse | null;
  evidenceOverview: EvidenceOverviewResponse | null;
  evidenceLoading: boolean;
  evidenceError: string;
  onClassifyEvidenceCoverage: (
    requirementId: string,
    classification: EvidenceClassification,
    evidenceIds?: string[],
    rationale?: string,
    confidence?: number,
  ) => Promise<EvidenceMutationResponse | null>;
  onCreateEvidenceItem: (item: EvidenceItemInput) => Promise<EvidenceMutationResponse | null>;
  onUpdateEvidenceItem: (item: EvidenceItem) => Promise<EvidenceMutationResponse | null>;
  onConfirmEvidenceItem: (evidenceId: string) => Promise<EvidenceMutationResponse | null>;
  onCreateEvidenceTask: (task: EvidenceTaskInput) => Promise<EvidenceMutationResponse | null>;
  onOpenPersonalResume: () => void;
  onRefresh: () => void;
  onLlmEvaluate: (sourceKey: string) => void;
  llmEvaluatingKeys: string[];
  resumeSuggestingKeys: string[];
  interviewPreparingKeys: string[];
  sortByLlmScore: boolean;
  setSortByLlmScore: (value: boolean | ((current: boolean) => boolean)) => void;
  onLoadJobDetail: (project: string, jobId: number) => Promise<Job | null>;
  onLoadReport: (sourceKey: string) => Promise<PipelineReportResponse | null>;
  onLoadGreetingDraft: (sourceKey: string) => Promise<GreetingDraftResponse | null>;
  onSaveGreetingDraft: (sourceKey: string, editedText: string, status: GreetingDraftStatus) => Promise<GreetingDraftResponse | null>;
  onGenerateResumeSuggestions: (sourceKey: string) => Promise<ResumeSuggestionResponse | null>;
  onLoadResumeSuggestion: (sourceKey: string) => Promise<ResumeSuggestionResponse | null>;
  onGenerateInterviewPrep: (sourceKey: string, userNotes: string) => Promise<InterviewPrepResponse | null>;
  onLoadInterviewPrep: (sourceKey: string) => Promise<InterviewPrepResponse | null>;
  onUpdateStatus: (sourceKey: string, decisionStatus: string) => Promise<boolean>;
  onDeleteItem: (sourceKey: string) => Promise<boolean>;
  onOpenResumeMaterials: (target: ResumeNavigationTarget) => void;
  targetSourceKey?: string;
  targetRequirementId?: string;
  targetRequestId?: number;
}) {
  const { t } = useAppTranslation();

  const STATUS_OPTIONS: Array<{ value: DecisionStatus; label: string }> = useMemo(
    () => [
      { value: 'needs_llm', label: getDecisionLabel('needs_llm', t) },
      { value: 'needs_review', label: getDecisionLabel('needs_review', t) },
      { value: 'ready_to_greet', label: getDecisionLabel('ready_to_greet', t) },
      { value: 'greeted', label: getDecisionLabel('greeted', t) },
      { value: 'interviewing', label: getDecisionLabel('interviewing', t) },
      { value: 'skipped', label: getDecisionLabel('skipped', t) },
      { value: 'archived', label: getDecisionLabel('archived', t) },
    ],
    [t],
  );

  const STATUS_FILTERS: Array<{ value: 'all' | DecisionStatus; label: string }> = useMemo(
    () => [
      { value: 'all', label: t('jobs.allJobs') },
      ...STATUS_OPTIONS,
    ],
    [t, STATUS_OPTIONS],
  );

  const pending = pipeline?.pending || [];
  const processed = pipeline?.processed || [];
  const jobLabels = useMemo(
    () => new Map([...pending, ...processed].map((item) => [item.sourceKey, `${item.company} · ${item.title}`])),
    [pending, processed],
  );
  const [statusFilter, setStatusFilter] = useState<'all' | DecisionStatus>('all');
  const [evidenceFilter, setEvidenceFilter] = useState<'all' | EvidenceReadiness>('all');
  const [sortByEvidence, setSortByEvidence] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [evidenceFocus, setEvidenceFocus] = useState<{ sourceKey: string; requestId: number } | null>(null);
  const evaluatingSet = new Set(llmEvaluatingKeys);
  const suggestingSet = new Set(resumeSuggestingKeys);
  const preparingSet = new Set(interviewPreparingKeys);
  const resetWorkspaceRef = useRef<() => void>(() => {});
  const initialSelectionAppliedRef = useRef(false);

  const resetWorkspace = useCallback(() => {
    resetWorkspaceRef.current();
  }, []);
  const revealTargetInAllStatuses = useCallback(() => {
    setStatusFilter('all');
  }, []);

  const {
    selectedSourceKey,
    selectedItem,
    selectedJob,
    detailLoading,
    selectItem,
    clearSelection,
  } = useSelectedPipelineItem({
    pending,
    onLoadJobDetail,
    onSelectionReset: resetWorkspace,
    onTargetSelected: revealTargetInAllStatuses,
    targetSourceKey,
    targetRequestId,
  });

  const {
    report,
    resumeSuggestion,
    interviewPrep,
    reportLoading,
    resumeLoading,
    interviewLoading,
    viewReport,
    closeReport,
    viewResumeSuggestion,
    closeResumeSuggestion,
    generateResumeSuggestion,
    viewInterviewPrep,
    closeInterviewPrep,
    generateInterviewPrep,
    clearArtifacts,
  } = useJobWorkspaceArtifacts({
    selectedItem,
    onLoadReport,
    onGenerateResumeSuggestions,
    onLoadResumeSuggestion,
    onGenerateInterviewPrep,
    onLoadInterviewPrep,
  });

  const {
    greetingDraft,
    greetingLoading,
    greetingSaving,
    saveGreetingDraft,
    clearGreetingDraft,
  } = useGreetingDraftEditor({
    selectedItem,
    onLoadGreetingDraft,
    onSaveGreetingDraft,
  });

  resetWorkspaceRef.current = () => {
    clearArtifacts();
    clearGreetingDraft();
  };

  const isSelectedResumeSuggesting = selectedItem ? suggestingSet.has(selectedItem.sourceKey) : false;
  const isSelectedInterviewPreparing = selectedItem ? preparingSet.has(selectedItem.sourceKey) : false;
  const isSelectedLlmEvaluating = selectedItem ? evaluatingSet.has(selectedItem.sourceKey) : false;

  const requirementsBySourceKey = useMemo(() => {
    const grouped = new Map<string, EvidenceRequirement[]>();
    (evidenceOverview?.requirements || []).forEach((requirement) => {
      if (requirement.active === false) return;
      const requirements = grouped.get(requirement.sourceKey) || [];
      requirements.push(requirement);
      grouped.set(requirement.sourceKey, requirements);
    });
    return grouped;
  }, [evidenceOverview?.requirements]);
  const coverageByRequirement = useMemo(
    () => new Map((evidenceOverview?.coverages || []).map((coverage) => [coverage.requirementId, coverage])),
    [evidenceOverview?.coverages],
  );
  const evidenceReadinessBySourceKey = useMemo(
    () => new Map(pending.map((item) => [
      item.sourceKey,
      getEvidenceReadiness(item, requirementsBySourceKey.get(item.sourceKey) || [], coverageByRequirement),
    ])),
    [coverageByRequirement, pending, requirementsBySourceKey],
  );

  const displayedPending = useMemo(() => {
    const statusFiltered = statusFilter === 'all'
      ? pending
      : pending.filter((item) => item.decisionStatus === statusFilter);
    const filtered = evidenceFilter === 'all'
      ? statusFiltered
      : statusFiltered.filter((item) => evidenceReadinessBySourceKey.get(item.sourceKey)?.status === evidenceFilter);
    if (!sortByLlmScore && !sortByEvidence) return filtered;
    return [...filtered].sort((left, right) => {
      if (sortByEvidence) {
        const readinessDifference = EVIDENCE_READINESS_ORDER[evidenceReadinessBySourceKey.get(left.sourceKey)?.status || 'unassessed']
          - EVIDENCE_READINESS_ORDER[evidenceReadinessBySourceKey.get(right.sourceKey)?.status || 'unassessed'];
        if (readinessDifference) return readinessDifference;
        const pendingDifference = (evidenceReadinessBySourceKey.get(right.sourceKey)?.pendingDecisionCount || 0)
          - (evidenceReadinessBySourceKey.get(left.sourceKey)?.pendingDecisionCount || 0);
        if (pendingDifference) return pendingDifference;
      }
      if (sortByLlmScore) return (right.llmScore ?? -1) - (left.llmScore ?? -1);
      return 0;
    });
  }, [evidenceFilter, evidenceReadinessBySourceKey, pending, sortByEvidence, sortByLlmScore, statusFilter]);

  const openEvidenceReadiness = useCallback((item: PipelineItem) => {
    setEvidenceFocus((current) => ({
      sourceKey: item.sourceKey,
      requestId: (current?.requestId || 0) + 1,
    }));
    void selectItem(item);
  }, [selectItem]);

  useEffect(() => {
    if (initialSelectionAppliedRef.current || selectedSourceKey || !displayedPending.length) return;
    if (targetSourceKey && targetRequestId) return;
    initialSelectionAppliedRef.current = true;
    void selectItem(displayedPending[0]);
  }, [displayedPending, selectItem, selectedSourceKey, targetRequestId, targetSourceKey]);

  const riskText = (risk?: string) => {
    if (risk === 'matched') return t('pipeline.risk.ok');
    if (risk === 'near') return t('pipeline.risk.near');
    if (risk === 'risk') return t('pipeline.risk.risk');
    return t('pipeline.risk.unknown');
  };

  const changeStatus = async (sourceKey: string, decisionStatus: DecisionStatus) => {
    await onUpdateStatus(sourceKey, decisionStatus);
  };

  const deleteSelected = async () => {
    if (!selectedItem) return;
    const ok = window.confirm(t('pipeline.confirmDelete'));
    if (!ok) return;
    if (await onDeleteItem(selectedItem.sourceKey)) {
      clearSelection();
    }
  };

  return (
    <div className="pipeline-page h-full flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">{t('pipeline.title')}</h2>
          <p className="text-xs text-zinc-500">
            {t('pipeline.pending', { n: pending.length.toLocaleString() })} / {t('pipeline.processed', { n: processed.length.toLocaleString() })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSortByLlmScore((value) => !value)}
            disabled={!pending.length}
            className={`pipeline-toolbar-button pipeline-toolbar-button--success inline-flex items-center gap-2 rounded border px-3 py-1.5 text-sm font-medium disabled:opacity-40 transition-colors ${sortByLlmScore ? 'is-active' : ''}`}
          >
            <ArrowDownWideNarrow size={14} />
            {t('pipeline.llmSort')}
          </button>
          <button
            onClick={() => setSortByEvidence((value) => !value)}
            disabled={!pending.length}
            className={`pipeline-toolbar-button pipeline-toolbar-button--pending inline-flex items-center gap-2 rounded border px-3 py-1.5 text-sm font-medium disabled:opacity-40 transition-colors ${sortByEvidence ? 'is-active' : ''}`}
          >
            <ArrowDownWideNarrow size={14} />
            {t('pipeline.evidence.sort')}
          </button>
          <button
            type="button"
            onClick={() => setFocusMode((value) => !value)}
            aria-pressed={focusMode}
            className={`pipeline-toolbar-button pipeline-toolbar-button--info inline-flex items-center gap-2 rounded border px-3 py-1.5 text-sm font-medium transition-colors ${focusMode ? 'is-active' : ''}`}
          >
            {focusMode ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
            {focusMode ? t('pipeline.exitFocusMode') : t('pipeline.focusMode')}
          </button>
          <button aria-label={t('pipeline.refresh')} title={t('pipeline.refresh')} onClick={onRefresh} className="pipeline-toolbar-button p-1.5 border rounded transition-colors">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter.value}
            onClick={() => setStatusFilter(filter.value)}
            className={`pipeline-filter rounded border px-2.5 py-1 text-xs font-medium transition-colors ${filter.value === 'all' ? (statusFilter === 'all' ? 'pipeline-status-control pipeline-status-control--info is-active' : 'pipeline-status-control pipeline-status-control--neutral') : statusButtonClass(filter.value, statusFilter === filter.value)}`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 border-t border-zinc-900 pt-3">
        <span className="mr-1 text-xs text-zinc-500">{t('pipeline.evidence.title')}</span>
        {(['all', 'ready', 'needs_confirmation', 'hard_gap', 'unassessed'] as const).map((filter) => (
          <button
            key={filter}
            onClick={() => setEvidenceFilter(filter)}
            className={`rounded border px-2.5 py-1 text-xs font-medium transition-colors ${
              evidenceFilter === filter
                ? filter === 'all' ? 'pipeline-status-control pipeline-status-control--info is-active' : evidenceReadinessClass(filter)
                : 'pipeline-status-control pipeline-status-control--neutral'
            }`}
          >
            {t(`pipeline.evidence.filters.${filter}`)}
          </button>
        ))}
      </div>

      <div className="pipeline-workspace flex min-h-0 flex-1 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/40">
          <aside className={`pipeline-list ${focusMode && selectedItem ? 'hidden' : selectedItem ? 'hidden min-[900px]:flex' : 'flex'} w-full shrink-0 flex-col border-r border-zinc-800 bg-zinc-950/70 min-[900px]:w-[20rem] lg:w-[23rem] xl:w-[26rem]`}>
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-zinc-100">{t('pipeline.title')}</div>
              <div className="mt-0.5 text-[11px] text-zinc-500">{t('pipeline.pending', { n: displayedPending.length.toLocaleString() })}</div>
            </div>
            {sortByLlmScore && (
              <span className="pipeline-status pipeline-status--success rounded border px-2 py-1 text-[10px] font-medium">
                {t('pipeline.llmSort')}
              </span>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {displayedPending.length ? (
            <div className="space-y-2">
              {displayedPending.map((item) => {
                const isLlmEvaluating = evaluatingSet.has(item.sourceKey);
                const materialReadyCount = [item.reportPath, item.resumeSuggestionPath, item.resumeDraftPath, item.interviewPrepPath].filter(Boolean).length;
                const isSelected = selectedSourceKey === item.sourceKey;
                return (
                  <button
                      key={item.sourceKey || item.raw}
                      type="button"
                      tabIndex={0}
                      onClick={(event) => {
                        if ((event.target as HTMLElement).closest('[data-evidence-readiness]')) {
                          openEvidenceReadiness(item);
                          return;
                        }
                        void selectItem(item);
                      }}
                      aria-pressed={isSelected}
                      className={`pipeline-job-card w-full rounded-md border p-3 text-left transition-colors ${isSelected ? 'pipeline-job-card--selected' : isLlmEvaluating ? 'pipeline-job-card--evaluating' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-zinc-100" title={item.title}>{item.title}</div>
                        <div className="mt-1 truncate text-xs text-zinc-400" title={item.company}>{item.company}</div>
                      </div>
                      <span className={`shrink-0 rounded border px-2 py-1 text-[10px] ${statusBadgeClass(item.decisionStatus)}`}>
                        {getDecisionLabel(item.decisionStatus, t)}
                      </span>
                    </div>

                    <div className="mt-2 flex min-w-0 items-center gap-2 text-[11px] text-zinc-500">
                      <span className="truncate">{item.city || '-'}</span>
                      <span className="text-zinc-700">/</span>
                      <span className="shrink-0 font-medium text-emerald-400">{item.salary || '-'}</span>
                    </div>

                    <div className="mt-3 flex items-center gap-2">
                      <span className="pipeline-score-badge rounded px-2 py-1 text-[11px] font-medium">
                        {t('pipeline.score')} {item.score != null ? item.score.toFixed(1) : '-'}
                      </span>
                      <span className={`pipeline-llm-badge ${item.llmScore != null ? 'is-ready' : 'is-missing'} rounded px-2 py-1 text-[11px] font-medium`}>
                        {isLlmEvaluating ? <Loader2 size={11} className="mr-1 inline animate-spin" /> : null}
                        {t('pipeline.llm')} {item.llmScore != null ? item.llmScore.toFixed(1) : '-'}
                      </span>
                      <span className="ml-auto text-[10px] text-zinc-500">{materialReadyCount}/4 {t('pipeline.materials')}</span>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-1">
                      <MaterialBadge label={t('pipeline.materialShort.llm')} ready={Boolean(item.reportPath)} tone="emerald" />
                      <MaterialBadge label={t('pipeline.materialShort.resumeSuggestion')} ready={Boolean(item.resumeSuggestionPath)} tone="indigo" />
                      <MaterialBadge label={t('pipeline.materialShort.resumeDraft')} ready={Boolean(item.resumeDraftPath)} tone="indigo" />
                      <MaterialBadge label={t('pipeline.materialShort.interviewPrep')} ready={Boolean(item.interviewPrepPath)} tone="cyan" />
                    </div>
                    {(() => {
                      const readiness = evidenceReadinessBySourceKey.get(item.sourceKey) || getEvidenceReadiness(item, [], coverageByRequirement);
                      return (
                        <span
                          data-evidence-readiness
                          className={`mt-2 flex w-full items-center justify-between gap-2 rounded border px-2 py-1.5 text-left text-[10px] transition-colors ${evidenceReadinessClass(readiness.status)}`}
                          title={t('pipeline.evidence.openEvaluation')}
                        >
                          <span className="shrink-0 font-medium">{t(`pipeline.evidence.readiness.${readiness.status}`)}</span>
                          {readiness.requirementCount ? (
                            <span className="min-w-0 truncate text-right">
                              {readiness.supportedCount}/{readiness.requirementCount} {t('pipeline.evidence.covered')}
                              {' · '}{readiness.pendingDecisionCount} {t('pipeline.evidence.pending')}
                              {' · '}{readiness.confirmedHardGapCount} {t('pipeline.evidence.hardGaps')}
                            </span>
                          ) : (
                            <span>{t('pipeline.evidence.openEvaluation')}</span>
                          )}
                        </span>
                      );
                    })()}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-zinc-500">
              {t('pipeline.noMatch')}
            </div>
          )}
          </div>
        </aside>

        {selectedItem && (
          <JobWorkspace
            item={selectedItem}
            evidenceOverview={evidenceOverview}
            evidenceLoading={evidenceLoading}
            evidenceError={evidenceError}
            onClassifyEvidenceCoverage={onClassifyEvidenceCoverage}
            onCreateEvidenceItem={onCreateEvidenceItem}
            onUpdateEvidenceItem={onUpdateEvidenceItem}
            onConfirmEvidenceItem={onConfirmEvidenceItem}
            onCreateEvidenceTask={onCreateEvidenceTask}
            onOpenPersonalResume={onOpenPersonalResume}
            targetRequirementId={targetRequirementId}
            targetRequestId={targetRequestId}
            evidenceFocusRequestId={evidenceFocus?.sourceKey === selectedItem.sourceKey ? evidenceFocus.requestId : undefined}
            job={selectedJob}
            detailLoading={detailLoading}
            statusOptions={STATUS_OPTIONS}
            onClose={clearSelection}
            onStatusChange={(status) => { void changeStatus(selectedItem.sourceKey, status); }}
            onDelete={deleteSelected}
            onLlmEvaluate={() => onLlmEvaluate(selectedItem.sourceKey)}
            isLlmEvaluating={isSelectedLlmEvaluating}
            onViewReport={viewReport}
            reportLoading={reportLoading}
            greetingDraft={greetingDraft}
            greetingLoading={greetingLoading}
            greetingSaving={greetingSaving}
            onSaveGreetingDraft={saveGreetingDraft}
            onGenerateResumeSuggestions={generateResumeSuggestion}
            onViewResumeSuggestion={viewResumeSuggestion}
            isResumeSuggesting={isSelectedResumeSuggesting}
            resumeLoading={resumeLoading}
            onGenerateInterviewPrep={generateInterviewPrep}
            onViewInterviewPrep={viewInterviewPrep}
            isInterviewPreparing={isSelectedInterviewPreparing}
            interviewLoading={interviewLoading}
            onOpenResumeMaterials={() => onOpenResumeMaterials({
              sourceKey: selectedItem.sourceKey,
              jobId: selectedItem.jobId,
              company: selectedItem.company,
              title: selectedItem.title,
              city: selectedItem.city,
            })}
            jobLabels={jobLabels}
            layout="embedded"
          />
        )}
        {!selectedItem && (
          <div className="hidden min-w-0 flex-1 items-center justify-center bg-zinc-950/30 p-8 text-center lg:flex">
            <div className="max-w-sm">
              <BookOpenText className="mx-auto text-zinc-700" size={30} />
              <div className="mt-3 text-sm font-medium text-zinc-300">{t('resume.selectJob')}</div>
              <div className="mt-1 text-xs leading-relaxed text-zinc-600">{t('pipeline.noMatch')}</div>
            </div>
          </div>
        )}
      </div>

      {pipeline?.path && (
        <div className="mt-3 text-xs text-zinc-600 truncate">
          {t('pipeline.sourceFile', { path: pipeline.path })}
        </div>
      )}

      {report && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6 py-5"
          onClick={closeReport}
        >
          <div
            className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-zinc-800 px-5 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <BookOpenText size={16} className="text-emerald-400" />
                  <h3 className="truncate text-base font-semibold text-zinc-100">{report.title || t('pipeline.report', { id: report.reportId })}</h3>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                  {report.reportId && <span>{t('pipeline.report', { id: report.reportId })}</span>}
                  <span className="max-w-3xl truncate">{report.reportPath}</span>
                </div>
              </div>
              <button
                onClick={closeReport}
                className="rounded border border-zinc-800 p-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            <div className="overflow-auto px-8 py-6">
              <article className="max-w-none text-sm leading-7 text-zinc-300 [&_h1]:mb-5 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-zinc-100 [&_h2]:mb-3 [&_h2]:mt-8 [&_h2]:border-b [&_h2]:border-zinc-800 [&_h2]:pb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-zinc-100 [&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:font-semibold [&_h3]:text-zinc-100 [&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_strong]:text-zinc-100 [&_code]:rounded [&_code]:bg-zinc-900 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-emerald-300 [&_pre]:my-4 [&_pre]:overflow-auto [&_pre]:rounded [&_pre]:border [&_pre]:border-zinc-800 [&_pre]:bg-zinc-900 [&_pre]:p-4 [&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-zinc-800 [&_th]:bg-zinc-900 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-zinc-100 [&_td]:border [&_td]:border-zinc-800 [&_td]:px-3 [&_td]:py-2 [&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-emerald-700 [&_blockquote]:pl-4 [&_blockquote]:text-zinc-400">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {report.content}
                </ReactMarkdown>
              </article>
            </div>
          </div>
        </div>
      )}

      {resumeSuggestion && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6 py-5"
          onClick={closeResumeSuggestion}
        >
          <div
            className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-zinc-800 px-5 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <FileText size={16} className="text-indigo-400" />
                  <h3 className="truncate text-base font-semibold text-zinc-100">
                    {t('resume.suggestions', { id: resumeSuggestion.resumeSuggestionId })}
                  </h3>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                  <span className="max-w-3xl truncate">{resumeSuggestion.suggestionPath}</span>
                </div>
              </div>
              <button
                onClick={closeResumeSuggestion}
                className="rounded border border-zinc-800 p-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            <div className="overflow-auto px-8 py-6">
              <article className="max-w-none text-sm leading-7 text-zinc-300 [&_h1]:mb-5 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-zinc-100 [&_h2]:mb-3 [&_h2]:mt-8 [&_h2]:border-b [&_h2]:border-zinc-800 [&_h2]:pb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-zinc-100 [&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:font-semibold [&_h3]:text-zinc-100 [&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_strong]:text-zinc-100 [&_code]:rounded [&_code]:bg-zinc-900 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-indigo-300 [&_pre]:my-4 [&_pre]:overflow-auto [&_pre]:rounded [&_pre]:border [&_pre]:border-zinc-800 [&_pre]:bg-zinc-900 [&_pre]:p-4 [&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-zinc-800 [&_th]:bg-zinc-900 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-zinc-100 [&_td]:border [&_td]:border-zinc-800 [&_td]:px-3 [&_td]:py-2 [&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-indigo-700 [&_blockquote]:pl-4 [&_blockquote]:text-zinc-400">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {resumeSuggestion.content}
                </ReactMarkdown>
              </article>
            </div>
          </div>
        </div>
      )}

      {interviewPrep && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6 py-5"
          onClick={closeInterviewPrep}
        >
          <div
            className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-zinc-800 px-5 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <BrainCircuit size={16} className="text-cyan-400" />
                  <h3 className="truncate text-base font-semibold text-zinc-100">
                    {t('pipeline.interviewPrepTitle', { id: interviewPrep.interviewPrepId })}
                  </h3>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                  <span className="max-w-3xl truncate">{interviewPrep.prepPath}</span>
                </div>
              </div>
              <button
                onClick={closeInterviewPrep}
                className="rounded border border-zinc-800 p-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            <div className="overflow-auto px-8 py-6">
              <article className="max-w-none text-sm leading-7 text-zinc-300 [&_h1]:mb-5 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-zinc-100 [&_h2]:mb-3 [&_h2]:mt-8 [&_h2]:border-b [&_h2]:border-zinc-800 [&_h2]:pb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-zinc-100 [&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:font-semibold [&_h3]:text-zinc-100 [&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_strong]:text-zinc-100 [&_code]:rounded [&_code]:bg-zinc-900 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-cyan-300 [&_pre]:my-4 [&_pre]:overflow-auto [&_pre]:rounded [&_pre]:border [&_pre]:border-zinc-800 [&_pre]:bg-zinc-900 [&_pre]:p-4 [&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-zinc-800 [&_th]:bg-zinc-900 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-zinc-100 [&_td]:border [&_td]:border-zinc-800 [&_td]:px-3 [&_td]:py-2 [&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-cyan-700 [&_blockquote]:pl-4 [&_blockquote]:text-zinc-400">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {interviewPrep.content}
                </ReactMarkdown>
              </article>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
