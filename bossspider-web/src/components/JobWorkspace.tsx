import {
  BookOpenText,
  BrainCircuit,
  CheckCircle2,
  Circle,
  Clipboard,
  FileText,
  Loader2,
  MessageSquareText,
  Save,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useAppTranslation } from '../i18n';
import { DetailItem } from './DetailItem';
import { EvidenceDecisionDialog, type EvidenceDecisionInput } from './EvidenceDecisionDialog';
import { JobDescription } from './JobDescription';
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
  GreetingDraft,
  GreetingDraftStatus,
  Job,
  PipelineItem,
} from '../types';

type WorkspaceTab = 'overview' | 'info' | 'evaluation' | 'materials' | 'interview' | 'records';
type NextAction = 'llm' | 'resume' | 'draft' | 'interview' | 'confirm' | 'review';
type MaterialStepKey = 'llm' | 'resumeSuggestion' | 'resumeDraft' | 'interviewPrep';
type EvidenceDecisionTarget = {
  requirement: EvidenceRequirement;
  classification: EvidenceClassification;
};

type StatusOption = {
  value: DecisionStatus;
  label: string;
};

type JobWorkspaceProps = {
  item: PipelineItem;
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
  job: Job | null;
  detailLoading: boolean;
  statusOptions: StatusOption[];
  onClose: () => void;
  onStatusChange: (status: DecisionStatus) => void;
  onDelete: () => void;
  onLlmEvaluate: () => void;
  isLlmEvaluating: boolean;
  onViewReport: () => void;
  reportLoading: boolean;
  greetingDraft: GreetingDraft | null;
  greetingLoading: boolean;
  greetingSaving: boolean;
  onSaveGreetingDraft: (editedText: string, status: GreetingDraftStatus) => Promise<unknown>;
  onGenerateResumeSuggestions: () => void;
  onViewResumeSuggestion: () => void;
  isResumeSuggesting: boolean;
  resumeLoading: boolean;
  onGenerateInterviewPrep: () => void;
  onViewInterviewPrep: () => void;
  isInterviewPreparing: boolean;
  interviewLoading: boolean;
  onOpenResumeMaterials: () => void;
};

const MATERIAL_TONES = {
  llm: 'border-emerald-900/60 bg-emerald-950/40 text-emerald-300',
  resume: 'border-indigo-900/60 bg-indigo-950/40 text-indigo-300',
  interview: 'border-cyan-900/60 bg-cyan-950/40 text-cyan-300',
  missing: 'border-zinc-800 bg-zinc-900/50 text-zinc-500',
};

const STATUS_CLASSES: Record<DecisionStatus, { active: string; idle: string }> = {
  needs_llm: {
    active: 'border-sky-700 bg-sky-950/50 text-sky-200',
    idle: 'border-sky-950/70 text-sky-400 hover:bg-sky-950/30',
  },
  needs_review: {
    active: 'border-amber-700 bg-amber-950/50 text-amber-200',
    idle: 'border-amber-950/70 text-amber-400 hover:bg-amber-950/30',
  },
  ready_to_greet: {
    active: 'border-emerald-700 bg-emerald-950/50 text-emerald-200',
    idle: 'border-emerald-950/70 text-emerald-400 hover:bg-emerald-950/30',
  },
  greeted: {
    active: 'border-blue-700 bg-blue-950/50 text-blue-200',
    idle: 'border-blue-950/70 text-blue-400 hover:bg-blue-950/30',
  },
  interviewing: {
    active: 'border-violet-700 bg-violet-950/50 text-violet-200',
    idle: 'border-violet-950/70 text-violet-400 hover:bg-violet-950/30',
  },
  skipped: {
    active: 'border-red-700 bg-red-950/50 text-red-200',
    idle: 'border-red-950/70 text-red-400 hover:bg-red-950/30',
  },
  archived: {
    active: 'border-zinc-700 bg-zinc-900 text-zinc-200',
    idle: 'border-zinc-800 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300',
  },
};

function statusButtonClass(status: DecisionStatus, active: boolean) {
  const classes = STATUS_CLASSES[status];
  if (!classes) return active ? 'border-indigo-700 bg-indigo-950/40 text-indigo-200' : 'border-zinc-800 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200';
  return active ? classes.active : classes.idle;
}

function splitFactLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function MaterialPill({
  label,
  ready,
  tone,
  current,
  onClick,
}: {
  label: string;
  ready: boolean;
  tone: 'llm' | 'resume' | 'interview';
  current?: boolean;
  onClick?: () => void;
}) {
  const className = `inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium ${
    ready ? MATERIAL_TONES[tone] : MATERIAL_TONES.missing
  } ${
    current ? 'ring-1 ring-indigo-500/70 ring-offset-1 ring-offset-zinc-950' : ''
  } ${
    onClick ? 'cursor-pointer transition-colors hover:border-indigo-700 hover:bg-indigo-950/30 hover:text-indigo-200' : ''
  }`;
  const content = (
    <>
      {ready ? <CheckCircle2 size={11} /> : <Circle size={11} />}
      {label}
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {content}
      </button>
    );
  }
  return (
    <span className={className}>
      {content}
    </span>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 rounded border border-zinc-800 bg-zinc-950 p-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h4>
      {children}
    </section>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  tone = 'zinc',
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'emerald' | 'indigo' | 'cyan' | 'zinc';
}) {
  const classes = {
    emerald: 'border-emerald-900/70 bg-emerald-950/40 text-emerald-200 hover:bg-emerald-900/40',
    indigo: 'border-indigo-900/70 bg-indigo-950/40 text-indigo-200 hover:bg-indigo-900/40',
    cyan: 'border-cyan-900/70 bg-cyan-950/40 text-cyan-200 hover:bg-cyan-900/40',
    zinc: 'border-zinc-800 text-zinc-300 hover:bg-zinc-900',
  }[tone];

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-2 rounded border px-3 py-2 text-xs font-medium transition-colors disabled:cursor-wait disabled:opacity-60 ${classes}`}
    >
      {children}
    </button>
  );
}

export function JobWorkspace({
  item,
  evidenceOverview,
  evidenceLoading,
  evidenceError,
  onClassifyEvidenceCoverage,
  onCreateEvidenceItem,
  onUpdateEvidenceItem,
  onConfirmEvidenceItem,
  onCreateEvidenceTask,
  job,
  detailLoading,
  statusOptions,
  onClose,
  onStatusChange,
  onDelete,
  onLlmEvaluate,
  isLlmEvaluating,
  onViewReport,
  reportLoading,
  greetingDraft,
  greetingLoading,
  greetingSaving,
  onSaveGreetingDraft,
  onGenerateResumeSuggestions,
  onViewResumeSuggestion,
  isResumeSuggesting,
  resumeLoading,
  onGenerateInterviewPrep,
  onViewInterviewPrep,
  isInterviewPreparing,
  interviewLoading,
  onOpenResumeMaterials,
}: JobWorkspaceProps) {
  const { t } = useAppTranslation();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('overview');
  const [greetingText, setGreetingText] = useState('');
  const [decisionTarget, setDecisionTarget] = useState<EvidenceDecisionTarget | null>(null);
  const [decisionSaving, setDecisionSaving] = useState(false);
  const [decisionError, setDecisionError] = useState('');
  const [confirmingEvidenceIds, setConfirmingEvidenceIds] = useState<string[]>([]);
  const [workspaceEvidenceError, setWorkspaceEvidenceError] = useState('');
  const materialReadyCount = [
    item.reportPath,
    item.resumeSuggestionPath,
    item.resumeDraftPath,
    item.interviewPrepPath,
  ].filter(Boolean).length;
  const requirements = useMemo(
    () => (evidenceOverview?.requirements || [])
      .filter((requirement) => requirement.sourceKey === item.sourceKey && requirement.active !== false)
      .sort((left, right) => {
        const importanceOrder = { required: 0, preferred: 1, context: 2 };
        const importanceDiff = importanceOrder[left.importance] - importanceOrder[right.importance];
        if (importanceDiff) return importanceDiff;
        return left.label.localeCompare(right.label);
      }),
    [evidenceOverview?.requirements, item.sourceKey],
  );
  const coverageByRequirement = useMemo(
    () => new Map((evidenceOverview?.coverages || []).map((coverage) => [coverage.requirementId, coverage])),
    [evidenceOverview?.coverages],
  );
  const evidenceById = useMemo(
    () => new Map((evidenceOverview?.evidenceItems || []).map((evidence) => [evidence.evidenceId, evidence])),
    [evidenceOverview?.evidenceItems],
  );
  const selectedDecisionEvidence = useMemo(() => {
    if (!decisionTarget) return null;
    const coverage = coverageByRequirement.get(decisionTarget.requirement.requirementId);
    const linked = (coverage?.evidenceIds || [])
      .map((evidenceId) => evidenceById.get(evidenceId))
      .filter((evidence): evidence is EvidenceItem => Boolean(evidence));
    return linked.find((evidence) => evidence.status === 'draft') || linked[0] || null;
  }, [coverageByRequirement, decisionTarget, evidenceById]);
  const requirementCount = requirements.length || item.requirementCount || 0;
  const confirmedCoverageCount = requirements.length
    ? requirements.filter((requirement) => coverageByRequirement.get(requirement.requirementId)?.coverageStatus === 'supported').length
    : item.supportedRequirementCount || 0;
  const pendingDecisionCount = requirements.length
    ? requirements.filter((requirement) => !coverageByRequirement.get(requirement.requirementId)?.userDecisionAt).length
    : item.unresolvedRequirementCount || 0;
  const confirmedGapCount = requirements.filter(
    (requirement) => coverageByRequirement.get(requirement.requirementId)?.coverageStatus === 'user_confirmed_absent',
  ).length;
  const potentialEvidenceCount = requirements.length
    ? requirements.filter((requirement) => {
      const coverage = coverageByRequirement.get(requirement.requirementId);
      return !coverage?.userDecisionAt && (coverage?.assessmentStatus === 'supported' || coverage?.assessmentStatus === 'partial');
    }).length
    : item.potentialEvidenceRequirementCount || 0;
  const averageSalary = (job?.avg ?? item.avg ?? 0).toFixed(1);
  const greetingSourceText = greetingDraft?.editedText || greetingDraft?.draftText || '';

  useEffect(() => {
    setGreetingText(greetingSourceText);
  }, [greetingDraft?.sourceKey, greetingDraft?.updatedAt, greetingSourceText]);

  useEffect(() => {
    setDecisionTarget(null);
    setDecisionError('');
    setWorkspaceEvidenceError('');
  }, [item.sourceKey]);

  const nextAction = useMemo<NextAction>(() => {
    if (!item.reportPath) return 'llm';
    if (!item.resumeSuggestionPath) return 'resume';
    if (!item.resumeDraftPath) return 'draft';
    if (!item.interviewPrepPath) return 'interview';
    if (item.decisionStatus === 'needs_review') return 'confirm';
    return 'review';
  }, [item.decisionStatus, item.interviewPrepPath, item.reportPath, item.resumeDraftPath, item.resumeSuggestionPath]);

  const materialSteps: Array<{
    key: MaterialStepKey;
    label: string;
    ready: boolean;
    tone: 'llm' | 'resume' | 'interview';
    tab: WorkspaceTab;
    current: boolean;
  }> = [
    { key: 'llm', label: t('pipeline.material.llm'), ready: Boolean(item.reportPath), tone: 'llm', tab: 'evaluation', current: nextAction === 'llm' },
    { key: 'resumeSuggestion', label: t('pipeline.material.resumeSuggestion'), ready: Boolean(item.resumeSuggestionPath), tone: 'resume', tab: 'materials', current: nextAction === 'resume' },
    { key: 'resumeDraft', label: t('pipeline.material.resumeDraft'), ready: Boolean(item.resumeDraftPath), tone: 'resume', tab: 'materials', current: nextAction === 'draft' },
    { key: 'interviewPrep', label: t('pipeline.material.interviewPrep'), ready: Boolean(item.interviewPrepPath), tone: 'interview', tab: 'interview', current: nextAction === 'interview' },
  ];

  const tabs: Array<{ value: WorkspaceTab; label: string }> = [
    { value: 'overview', label: t('jobWorkspace.tabs.overview') },
    { value: 'info', label: t('jobWorkspace.tabs.info') },
    { value: 'evaluation', label: t('jobWorkspace.tabs.evaluation') },
    { value: 'materials', label: t('jobWorkspace.tabs.materials') },
    { value: 'interview', label: t('jobWorkspace.tabs.interview') },
    { value: 'records', label: t('jobWorkspace.tabs.records') },
  ];

  const riskText = (risk?: string) => {
    if (risk === 'matched') return t('pipeline.risk.ok');
    if (risk === 'near') return t('pipeline.risk.near');
    if (risk === 'risk') return t('pipeline.risk.risk');
    return t('pipeline.risk.unknown');
  };

  const saveGreeting = (status: GreetingDraftStatus = 'edited') => {
    void onSaveGreetingDraft(greetingText, status);
  };

  const copyGreeting = async () => {
    if (!greetingText.trim()) return;
    await navigator.clipboard.writeText(greetingText);
    await onSaveGreetingDraft(greetingText, 'copied');
  };

  const greetingStatusLabel = greetingDraft
    ? t(`jobWorkspace.greetingStatuses.${greetingDraft.status}`)
    : t('jobWorkspace.greetingStatuses.draft');

  const evidenceStatus = (coverage?: EvidenceCoverage) => {
    if (coverage?.userDecisionAt) {
      if (coverage.coverageStatus === 'supported') return { label: t('jobWorkspace.evidence.statuses.supported'), classes: 'border-emerald-900/70 bg-emerald-950/40 text-emerald-300' };
      if (coverage.userClassification === 'done') return { label: t('jobWorkspace.evidence.statuses.doneNeedsFacts'), classes: 'border-indigo-900/70 bg-indigo-950/40 text-indigo-300' };
      if (coverage.userClassification === 'adjacent') return { label: t('jobWorkspace.evidence.statuses.adjacent'), classes: 'border-cyan-900/70 bg-cyan-950/40 text-cyan-300' };
      if (coverage.userClassification === 'not_done') return { label: t('jobWorkspace.evidence.statuses.confirmedAbsent'), classes: 'border-red-900/70 bg-red-950/40 text-red-300' };
      return { label: t('jobWorkspace.evidence.statuses.unsure'), classes: 'border-zinc-700 bg-zinc-900 text-zinc-300' };
    }
    if (coverage?.assessmentStatus === 'supported') return { label: t('jobWorkspace.evidence.statuses.candidate'), classes: 'border-amber-900/70 bg-amber-950/40 text-amber-300' };
    if (coverage?.assessmentStatus === 'partial') return { label: t('jobWorkspace.evidence.statuses.partial'), classes: 'border-amber-900/70 bg-amber-950/40 text-amber-300' };
    if (coverage?.assessmentStatus === 'not_found' || coverage?.coverageStatus === 'not_found') return { label: t('jobWorkspace.evidence.statuses.notFound'), classes: 'border-zinc-700 bg-zinc-900 text-zinc-300' };
    return { label: t('jobWorkspace.evidence.statuses.unknown'), classes: 'border-zinc-800 bg-zinc-900/60 text-zinc-500' };
  };

  const importanceClasses = (requirement: EvidenceRequirement) => (
    requirement.importance === 'required'
      ? 'border-red-900/60 bg-red-950/30 text-red-300'
      : requirement.importance === 'preferred'
        ? 'border-indigo-900/60 bg-indigo-950/30 text-indigo-300'
        : 'border-zinc-800 bg-zinc-900 text-zinc-400'
  );

  const openEvidenceDecision = (requirement: EvidenceRequirement, classification: EvidenceClassification) => {
    setDecisionError('');
    setWorkspaceEvidenceError('');
    setDecisionTarget({ requirement, classification });
  };

  const submitEvidenceDecision = async (input: EvidenceDecisionInput) => {
    if (!decisionTarget) return;
    setDecisionSaving(true);
    setDecisionError('');
    const { requirement } = decisionTarget;
    try {
      let evidenceIds: string[] = [];
      if (input.classification === 'done' || input.classification === 'adjacent') {
        const isAdjacent = input.classification === 'adjacent';
        const itemInput: EvidenceItemInput = {
          title: isAdjacent
            ? `${requirement.label}：${t('jobWorkspace.evidence.dialog.adjacentEvidenceTitle')}`
            : `${requirement.label}：${input.experience.slice(0, 32)}`,
          evidenceType: 'fact',
          summary: input.experience,
          userRole: isAdjacent ? '' : input.role,
          actions: isAdjacent ? [`${t('jobWorkspace.evidence.dialog.transferablePrefix')}${input.transferable}`] : splitFactLines(input.actions),
          results: isAdjacent ? [`${t('jobWorkspace.evidence.dialog.boundariesPrefix')}${input.boundaries}`] : splitFactLines(input.results),
          sourceRefs: [{
            type: 'user_statement',
            ref: isAdjacent ? t('jobWorkspace.evidence.dialog.userStatement') : input.source,
            quote: input.experience,
          }],
          tags: [requirement.canonicalKey, ...(isAdjacent ? ['adjacent'] : [])],
          status: 'draft',
        };
        const itemResult = selectedDecisionEvidence?.status === 'draft'
          ? await onUpdateEvidenceItem({ ...selectedDecisionEvidence, ...itemInput, status: 'draft' })
          : await onCreateEvidenceItem(itemInput);
        if (!itemResult?.item) throw new Error(t('jobWorkspace.evidence.errors.saveItem'));
        evidenceIds = [itemResult.item.evidenceId];
      }

      const rationale = t(`jobWorkspace.evidence.decisionRationale.${input.classification}`);
      const classificationResult = await onClassifyEvidenceCoverage(
        requirement.requirementId,
        input.classification,
        evidenceIds,
        rationale,
        1,
      );
      if (!classificationResult) throw new Error(t('jobWorkspace.evidence.errors.classify'));

      const taskType = input.classification === 'done'
        ? 'strengthen'
        : input.classification === 'adjacent'
          ? 'translate'
          : input.taskType;
      if (!taskType) throw new Error(t('jobWorkspace.evidence.errors.action'));
      const taskInput: EvidenceTaskInput = {
        requirementId: requirement.requirementId,
        taskType,
        affectedSourceKeys: [requirement.sourceKey],
        recommendedAction: t(`jobWorkspace.evidence.taskRecommendations.${taskType}`),
        estimatedEffortBand: input.timeBudget || 'under_1_hour',
        timeBudget: input.timeBudget || 'under_1_hour',
        userWillingness: input.userWillingness || 'yes',
        priorityBand: requirement.importance === 'required' ? 'high' : 'medium',
        status: 'pending',
        completionEvidenceIds: [],
      };
      const taskResult = await onCreateEvidenceTask(taskInput);
      if (!taskResult) throw new Error(t('jobWorkspace.evidence.errors.saveTask'));

      setDecisionTarget(null);
    } catch (error) {
      setDecisionError((error as Error).message || t('jobWorkspace.evidence.errors.unknown'));
    } finally {
      setDecisionSaving(false);
    }
  };

  const confirmEvidence = async (evidenceId: string) => {
    setWorkspaceEvidenceError('');
    setConfirmingEvidenceIds((ids) => ids.includes(evidenceId) ? ids : [...ids, evidenceId]);
    try {
      const result = await onConfirmEvidenceItem(evidenceId);
      if (!result) setWorkspaceEvidenceError(t('jobWorkspace.evidence.errors.confirm'));
    } finally {
      setConfirmingEvidenceIds((ids) => ids.filter((id) => id !== evidenceId));
    }
  };

  return (
    <div className="w-[42rem] shrink-0 border-l border-zinc-800 bg-zinc-950 flex flex-col">
      <div className="border-b border-zinc-800 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-indigo-300">{t('jobWorkspace.title')}</div>
            <h3 className="truncate text-base font-semibold text-zinc-100">{item.company} · {item.title}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              <span>{item.city || '-'}</span>
              <span>{item.salary || '-'}</span>
              <span>{t('pipeline.score')} {item.score ? item.score.toFixed(1) : '-'}</span>
              <span>{t('pipeline.llm')} {item.llmScore ? item.llmScore.toFixed(1) : '-'}</span>
              <span className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-300">
                {statusOptions.find((option) => option.value === item.decisionStatus)?.label || item.decisionStatus}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={onDelete}
              title={t('pipeline.deleteItem')}
              className="rounded border border-red-900/70 bg-red-950/20 p-1.5 text-red-300 transition-colors hover:bg-red-950/40 hover:text-red-200"
            >
              <Trash2 size={16} />
            </button>
            <button onClick={onClose} className="rounded border border-zinc-800 p-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <MaterialPill label={t('pipeline.material.llm')} ready={Boolean(item.reportPath)} tone="llm" />
          <MaterialPill label={t('pipeline.material.resumeSuggestion')} ready={Boolean(item.resumeSuggestionPath)} tone="resume" />
          <MaterialPill label={t('pipeline.material.resumeDraft')} ready={Boolean(item.resumeDraftPath)} tone="resume" />
          <MaterialPill label={t('pipeline.material.interviewPrep')} ready={Boolean(item.interviewPrepPath)} tone="interview" />
        </div>
      </div>

      <div className="border-b border-zinc-800 px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={`rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${
                activeTab === tab.value
                  ? 'bg-indigo-600 text-white'
                  : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'overview' && (
          <div className="space-y-4">
            <Section title={t('jobWorkspace.nextAction')}>
              <div className="rounded border border-zinc-800 bg-zinc-900/40 p-3">
                <div className="space-y-2">
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">{t('jobWorkspace.nextActionCurrent')}</div>
                    <div className="mt-1 text-sm font-semibold text-zinc-100">{t(`jobWorkspace.nextActionLabels.${nextAction}`)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">{t('jobWorkspace.nextActionWhy')}</div>
                    <div className="mt-1 text-xs leading-relaxed text-zinc-400">{t(`jobWorkspace.nextActionReasons.${nextAction}`)}</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {nextAction === 'llm' && (
                    <ActionButton onClick={onLlmEvaluate} disabled={isLlmEvaluating} tone="emerald">
                      {isLlmEvaluating && <Loader2 size={13} className="animate-spin" />}
                      {isLlmEvaluating ? t('pipeline.generating') : t('pipeline.llmEval')}
                    </ActionButton>
                  )}
                  {nextAction === 'resume' && (
                    <ActionButton onClick={onGenerateResumeSuggestions} disabled={isResumeSuggesting || resumeLoading} tone="indigo">
                      {isResumeSuggesting || resumeLoading ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
                      {t('pipeline.generateSuggestions')}
                    </ActionButton>
                  )}
                  {nextAction === 'draft' && (
                    <ActionButton
                      onClick={onOpenResumeMaterials}
                      tone="indigo"
                    >
                      <FileText size={13} />
                      {t('jobWorkspace.openResumeMaterials')}
                    </ActionButton>
                  )}
                  {nextAction === 'interview' && (
                    <ActionButton onClick={onGenerateInterviewPrep} disabled={isInterviewPreparing || interviewLoading} tone="cyan">
                      {isInterviewPreparing || interviewLoading ? <Loader2 size={13} className="animate-spin" /> : <BrainCircuit size={13} />}
                      {t('pipeline.generateInterviewPrep')}
                    </ActionButton>
                  )}
                  {nextAction === 'confirm' && (
                    <ActionButton onClick={() => setActiveTab('records')} tone="zinc">
                      <CheckCircle2 size={13} />
                      {t('jobWorkspace.nextActionButtons.confirm')}
                    </ActionButton>
                  )}
                  {item.reportPath && (
                    <ActionButton onClick={onViewReport} disabled={reportLoading} tone="emerald">
                      {reportLoading ? <Loader2 size={13} className="animate-spin" /> : <BookOpenText size={13} />}
                      {t('pipeline.viewReport')}
                    </ActionButton>
                  )}
                </div>
              </div>
            </Section>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded border border-zinc-800 bg-zinc-950 p-3">
                <div className="text-xs text-zinc-500">{t('jobWorkspace.materialProgress')}</div>
                <div className="mt-2 text-2xl font-semibold text-zinc-100">{materialReadyCount}/4</div>
              </div>
              <div className="rounded border border-zinc-800 bg-zinc-950 p-3">
                <div className="text-xs text-zinc-500">{t('jobWorkspace.evidence.confirmedCoverage')}</div>
                <div className="mt-2 text-2xl font-semibold text-emerald-200">{requirementCount ? `${confirmedCoverageCount}/${requirementCount}` : '-'}</div>
                {potentialEvidenceCount > 0 && <div className="mt-1 text-[10px] text-amber-400">{t('jobWorkspace.evidence.candidateHint', { count: potentialEvidenceCount })}</div>}
              </div>
              <div className="rounded border border-zinc-800 bg-zinc-950 p-3">
                <div className="text-xs text-zinc-500">{t('jobWorkspace.evidence.pendingDecision')}</div>
                <div className="mt-2 text-2xl font-semibold text-amber-200">{requirementCount ? pendingDecisionCount : '-'}</div>
              </div>
              <div className="rounded border border-zinc-800 bg-zinc-950 p-3">
                <div className="text-xs text-zinc-500">{t('jobWorkspace.evidence.confirmedGaps')}</div>
                <div className="mt-2 text-2xl font-semibold text-red-200">{requirementCount ? confirmedGapCount : '-'}</div>
              </div>
            </div>

            <Section title={t('pipeline.materials')}>
              <div className="grid grid-cols-2 gap-2">
                {materialSteps.map((step) => (
                  <MaterialPill
                    key={step.key}
                    label={step.label}
                    ready={step.ready}
                    tone={step.tone}
                    current={step.current}
                    onClick={() => setActiveTab(step.tab)}
                  />
                ))}
              </div>
            </Section>
          </div>
        )}

        {activeTab === 'info' && (
          <div className="space-y-4">
            {detailLoading && (
              <div className="flex items-center gap-2 text-sm text-zinc-500">
                <Loader2 size={14} className="animate-spin" />
                {t('pipeline.loadingDetails')}
              </div>
            )}
            <Section title={t('jobWorkspace.basicInfo')}>
              <DetailItem label={t('pipeline.jobTitle')} value={item.title} strong />
              <div className="grid grid-cols-2 gap-4">
                <DetailItem label={t('pipeline.company')} value={item.company} />
                <DetailItem label={t('pipeline.city')} value={item.city} />
                <DetailItem label={t('pipeline.salary')} value={item.salary} accent />
                <DetailItem label={t('pipeline.avgSalary')} value={`${averageSalary}k`} />
                <DetailItem label={t('pipeline.experience')} value={job?.exp || '-'} />
                <DetailItem label={t('pipeline.education')} value={job?.edu || '-'} />
              </div>
              {(job?.url || item.url) && (
                <a href={job?.url || item.url} target="_blank" rel="noreferrer" className="text-xs text-indigo-400 hover:underline">
                  {t('jobs.viewOriginalLink')}
                </a>
              )}
            </Section>
            <Section title={t('jobs.tableHeaders.category')}>
              <div className="flex flex-wrap gap-1.5">
                {((job?.cats.length ? job.cats : [job?.tier || '-'])).map((cat) => (
                  <span key={cat} className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300">{cat}</span>
                ))}
              </div>
            </Section>
            <JobDescription text={job?.desc} />
          </div>
        )}

        {activeTab === 'evaluation' && (
          <div className="space-y-4">
            <Section title={t('jobWorkspace.coarseEvaluation')}>
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-500">{t('pipeline.score')}</span>
                <span className="text-sm font-semibold text-zinc-100">{item.score ? item.score.toFixed(1) : '-'} / 5.0</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-zinc-400">
                <div>{t('pipeline.coverage', { n: item.coverage ?? 0 })}</div>
                <div>{t('pipeline.jdQuality', { n: item.jdQuality ?? 0 })}</div>
                <div>{t('pipeline.expRisk', { risk: riskText(item.experienceRisk) })}</div>
                <div>{t('pipeline.eduRisk', { risk: riskText(item.educationRisk) })}</div>
              </div>
            </Section>
            <Section title={t('jobWorkspace.llmEvaluation')}>
              <div className="flex items-center justify-between">
                <span className="text-xs text-emerald-500">{t('pipeline.llm')}</span>
                <span className="text-sm font-semibold text-emerald-200">{item.llmScore ? item.llmScore.toFixed(1) : item.reportId || '-'} / 5.0</span>
              </div>
              {item.llmFitLevel && <div className="text-xs text-emerald-400">{item.llmFitLevel}</div>}
              {item.llmRecommendation && <div className="text-xs leading-relaxed text-zinc-300">{item.llmRecommendation}</div>}
              {item.reportPath ? (
                <>
                  <div className="break-all text-[10px] text-zinc-500">{item.reportPath}</div>
                  <ActionButton onClick={onViewReport} disabled={reportLoading} tone="emerald">
                    {reportLoading ? <Loader2 size={13} className="animate-spin" /> : <BookOpenText size={13} />}
                    {t('pipeline.viewReport')}
                  </ActionButton>
                </>
              ) : (
                <ActionButton onClick={onLlmEvaluate} disabled={isLlmEvaluating} tone="emerald">
                  {isLlmEvaluating && <Loader2 size={13} className="animate-spin" />}
                  {isLlmEvaluating ? t('pipeline.generating') : t('pipeline.llmEval')}
                </ActionButton>
              )}
            </Section>
            <Section title={t('jobWorkspace.evidence.requirementsTitle')}>
              {evidenceLoading ? (
                <div className="flex items-center gap-2 text-sm text-zinc-500">
                  <Loader2 size={14} className="animate-spin" />
                  {t('jobWorkspace.evidence.loading')}
                </div>
              ) : requirements.length ? (
                <div className="space-y-2.5">
                  {(workspaceEvidenceError || evidenceError) && (
                    <div className="rounded border border-red-900/60 bg-red-950/30 p-3 text-xs text-red-300">
                      {workspaceEvidenceError || evidenceError}
                    </div>
                  )}
                  <div className="text-xs leading-relaxed text-zinc-500">
                    {t('jobWorkspace.evidence.requirementsSummary', {
                      count: requirements.length,
                      required: requirements.filter((requirement) => requirement.importance === 'required').length,
                    })}
                  </div>
                  {requirements.map((requirement) => {
                    const coverage = coverageByRequirement.get(requirement.requirementId);
                    const status = evidenceStatus(coverage);
                    const confidence = coverage?.assessmentConfidence ?? coverage?.confidence ?? requirement.extractionConfidence;
                    const rationale = coverage?.userDecisionAt
                      ? coverage?.rationale
                      : (coverage?.assessmentRationale || coverage?.rationale);
                    const candidateRefs = coverage?.candidateEvidenceRefs || [];
                    const linkedEvidenceItems = (coverage?.evidenceIds || [])
                      .map((evidenceId) => evidenceById.get(evidenceId))
                      .filter((evidence): evidence is EvidenceItem => Boolean(evidence));
                    const activeTask = (evidenceOverview?.tasks || []).find(
                      (task) => task.requirementId === requirement.requirementId && (task.status === 'pending' || task.status === 'in_progress'),
                    );
                    return (
                      <div key={requirement.requirementId} className="rounded border border-zinc-800 bg-zinc-900/35 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-zinc-100">{requirement.label}</div>
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${importanceClasses(requirement)}`}>
                                {t(`jobWorkspace.evidence.importance.${requirement.importance}`)}
                              </span>
                              <span className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400">
                                {t(`jobWorkspace.evidence.categories.${requirement.category}`)}
                              </span>
                            </div>
                          </div>
                          <span className={`shrink-0 rounded border px-2 py-1 text-[10px] font-medium ${status.classes}`}>
                            {status.label}
                          </span>
                        </div>

                        {requirement.jdQuote && (
                          <div className="mt-3 border-l-2 border-zinc-700 pl-3 text-xs leading-relaxed text-zinc-400">
                            <span className="mr-1 text-zinc-600">JD</span>
                            {requirement.jdQuote}
                          </div>
                        )}

                        <div className="mt-3 rounded border border-zinc-800/80 bg-zinc-950/70 p-2.5">
                          {linkedEvidenceItems.length ? (
                            <div className="space-y-2">
                              <div className="text-[10px] font-medium uppercase tracking-wide text-indigo-400">{t('jobWorkspace.evidence.userEvidence')}</div>
                              {linkedEvidenceItems.map((evidence) => (
                                <div key={evidence.evidenceId} className="rounded border border-zinc-800 bg-zinc-900/60 p-2.5">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <div className="text-xs font-medium text-zinc-200">{evidence.title}</div>
                                      <div className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-zinc-500">{evidence.summary}</div>
                                    </div>
                                    <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${
                                      evidence.status === 'confirmed'
                                        ? 'border-emerald-900/60 bg-emerald-950/30 text-emerald-300'
                                        : 'border-amber-900/60 bg-amber-950/30 text-amber-300'
                                    }`}>
                                      {evidence.status === 'confirmed' ? t('jobWorkspace.evidence.evidenceConfirmed') : t('jobWorkspace.evidence.evidenceDraft')}
                                    </span>
                                  </div>
                                  {evidence.status === 'draft' && (
                                    <button
                                      type="button"
                                      onClick={() => { void confirmEvidence(evidence.evidenceId); }}
                                      disabled={confirmingEvidenceIds.includes(evidence.evidenceId)}
                                      className="mt-2 inline-flex items-center gap-1.5 rounded border border-emerald-900/70 bg-emerald-950/30 px-2.5 py-1.5 text-[10px] font-medium text-emerald-300 hover:bg-emerald-900/40 disabled:cursor-wait disabled:opacity-60"
                                    >
                                      {confirmingEvidenceIds.includes(evidence.evidenceId) ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                                      {t('jobWorkspace.evidence.confirmFact')}
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : coverage?.userClassification === 'not_done' ? (
                            <div className="text-xs leading-relaxed text-red-300">{t('jobWorkspace.evidence.confirmedAbsentStatement')}</div>
                          ) : coverage?.userClassification === 'unsure' ? (
                            <div className="text-xs leading-relaxed text-zinc-400">{t('jobWorkspace.evidence.unsureStatement')}</div>
                          ) : candidateRefs.length ? (
                            <div className="space-y-1.5">
                              <div className="text-[10px] font-medium uppercase tracking-wide text-amber-500">{t('jobWorkspace.evidence.candidateSources')}</div>
                              {candidateRefs.slice(0, 2).map((source, index) => (
                                <div key={`${requirement.requirementId}:${index}`} className="text-xs leading-relaxed text-zinc-300">
                                  {source.locator && <span className="mr-1 text-zinc-500">{source.locator}：</span>}
                                  {source.quote}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-xs leading-relaxed text-zinc-400">{t('jobWorkspace.evidence.notFoundStatement')}</div>
                          )}
                        </div>

                        {(rationale || confidence > 0) && (
                          <div className="mt-2 flex flex-wrap items-start justify-between gap-2 text-[10px] leading-relaxed text-zinc-500">
                            <span className="min-w-0 flex-1">{rationale}</span>
                            {confidence > 0 && <span className="shrink-0">{t('jobWorkspace.evidence.confidence', { value: Math.round(confidence * 100) })}</span>}
                          </div>
                        )}

                        <div className="mt-3 border-t border-zinc-800 pt-3">
                          <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-zinc-500">{t('jobWorkspace.evidence.myDecision')}</div>
                          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                            {(['done', 'adjacent', 'not_done', 'unsure'] as const).map((classification) => {
                              const active = coverage?.userClassification === classification;
                              const tones = {
                                done: active ? 'border-emerald-600 bg-emerald-950/50 text-emerald-200' : 'border-emerald-950/70 text-emerald-400 hover:bg-emerald-950/30',
                                adjacent: active ? 'border-cyan-600 bg-cyan-950/50 text-cyan-200' : 'border-cyan-950/70 text-cyan-400 hover:bg-cyan-950/30',
                                not_done: active ? 'border-red-700 bg-red-950/50 text-red-200' : 'border-red-950/70 text-red-400 hover:bg-red-950/30',
                                unsure: active ? 'border-zinc-600 bg-zinc-800 text-zinc-100' : 'border-zinc-800 text-zinc-400 hover:bg-zinc-900',
                              };
                              return (
                                <button
                                  key={classification}
                                  type="button"
                                  onClick={() => openEvidenceDecision(requirement, classification)}
                                  disabled={decisionSaving}
                                  className={`min-h-8 min-w-0 whitespace-normal break-words rounded border px-2 py-1.5 text-[10px] font-medium leading-tight transition-colors disabled:opacity-50 ${tones[classification]}`}
                                >
                                  {t(`jobWorkspace.evidence.classifications.${classification}`)}
                                </button>
                              );
                            })}
                          </div>
                          {activeTask && (
                            <div className="mt-2 rounded border border-indigo-950/70 bg-indigo-950/20 px-2.5 py-2 text-[10px] leading-relaxed text-indigo-300">
                              <span className="mr-1 text-indigo-500">{t('jobWorkspace.evidence.currentAction')}</span>
                              {activeTask.recommendedAction}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : item.reportPath ? (
                <div className="space-y-3 rounded border border-dashed border-zinc-800 bg-zinc-900/30 p-3">
                  <div className="text-xs leading-relaxed text-zinc-500">{t('jobWorkspace.evidence.legacyReportHint')}</div>
                  <ActionButton onClick={onLlmEvaluate} disabled={isLlmEvaluating} tone="emerald">
                    {isLlmEvaluating && <Loader2 size={13} className="animate-spin" />}
                    {t('jobWorkspace.evidence.regenerateAssessment')}
                  </ActionButton>
                </div>
              ) : (
                <div className="text-xs leading-relaxed text-zinc-500">{t('jobWorkspace.evidence.noAssessment')}</div>
              )}
            </Section>
          </div>
        )}

        {activeTab === 'materials' && (
          <div className="space-y-4">
            <Section title={t('pipeline.material.resumeSuggestion')}>
              <div className="text-xs leading-relaxed text-zinc-400">{t('pipeline.resumeHint')}</div>
              {item.resumeSuggestedAt && <div className="text-[10px] text-zinc-500">{t('pipeline.generatedAt', { date: item.resumeSuggestedAt })}</div>}
              {item.resumeSuggestionPath && <div className="break-all text-[10px] text-zinc-500">{item.resumeSuggestionPath}</div>}
              <div className="flex flex-wrap gap-2">
                <ActionButton onClick={onGenerateResumeSuggestions} disabled={isResumeSuggesting || resumeLoading} tone="indigo">
                  {isResumeSuggesting || resumeLoading ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
                  {item.resumeSuggestionPath ? t('pipeline.regenerateSuggestions') : t('pipeline.generateSuggestions')}
                </ActionButton>
                {item.resumeSuggestionPath && (
                  <ActionButton onClick={onViewResumeSuggestion} disabled={resumeLoading}>
                    {resumeLoading ? <Loader2 size={13} className="animate-spin" /> : <BookOpenText size={13} />}
                    {t('pipeline.viewSuggestions')}
                  </ActionButton>
                )}
              </div>
            </Section>
            <Section title={t('pipeline.material.resumeDraft')}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-zinc-500">{item.resumeDraftPath ? t('pipeline.ready') : t('pipeline.notReady')}</span>
                <MaterialPill label={item.resumeDraftPath ? t('pipeline.ready') : t('pipeline.notReady')} ready={Boolean(item.resumeDraftPath)} tone="resume" />
              </div>
              {item.resumeDraftedAt && <div className="text-[10px] text-zinc-500">{t('pipeline.generatedAt', { date: item.resumeDraftedAt })}</div>}
              {item.resumeDraftPath && <div className="break-all text-[10px] text-zinc-500">{item.resumeDraftPath}</div>}
              {!item.resumeDraftPath && (
                <ActionButton onClick={onOpenResumeMaterials} tone="indigo">
                  <FileText size={13} />
                  {t('jobWorkspace.openResumeMaterials')}
                </ActionButton>
              )}
            </Section>
            <Section title={t('jobWorkspace.greeting')}>
              {greetingLoading ? (
                <div className="flex items-center gap-2 text-sm text-zinc-500">
                  <Loader2 size={14} className="animate-spin" />
                  {t('jobWorkspace.loadingGreeting')}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                      <MessageSquareText size={14} className="text-emerald-400" />
                      <span>{t('jobWorkspace.greetingStatus', { status: greetingStatusLabel })}</span>
                    </div>
                    {greetingDraft?.updatedAt && (
                      <span className="text-[10px] text-zinc-600">{t('story.updatedAt')}: {greetingDraft.updatedAt}</span>
                    )}
                  </div>
                  <textarea
                    value={greetingText}
                    onChange={(event) => setGreetingText(event.target.value)}
                    placeholder={t('jobWorkspace.greetingEmpty')}
                    className="min-h-44 w-full resize-y rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm leading-6 text-zinc-200 outline-none transition-colors placeholder:text-zinc-600 focus:border-emerald-800"
                  />
                  {!greetingSourceText.trim() && (
                    <div className="text-xs leading-relaxed text-zinc-500">{t('jobWorkspace.greetingEmptyHint')}</div>
                  )}
                  {greetingDraft?.sourceReportPath && (
                    <div className="break-all text-[10px] text-zinc-600">{greetingDraft.sourceReportPath}</div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <ActionButton
                      onClick={() => saveGreeting('edited')}
                      disabled={greetingSaving || !greetingDraft}
                      tone="emerald"
                    >
                      {greetingSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                      {t('jobWorkspace.saveGreeting')}
                    </ActionButton>
                    <ActionButton
                      onClick={copyGreeting}
                      disabled={greetingSaving || !greetingDraft || !greetingText.trim()}
                    >
                      <Clipboard size={13} />
                      {t('jobWorkspace.copyGreeting')}
                    </ActionButton>
                    <ActionButton
                      onClick={() => saveGreeting('sent')}
                      disabled={greetingSaving || !greetingDraft || !greetingText.trim()}
                      tone="cyan"
                    >
                      <Send size={13} />
                      {t('jobWorkspace.markGreetingSent')}
                    </ActionButton>
                  </div>
                </div>
              )}
            </Section>
          </div>
        )}

        {activeTab === 'interview' && (
          <div className="space-y-4">
            <Section title={t('pipeline.material.interviewPrep')}>
              <div className="text-xs leading-relaxed text-zinc-400">{t('pipeline.interviewPrepHint')}</div>
              {item.interviewPreparedAt && <div className="text-[10px] text-zinc-500">{t('pipeline.generatedAt', { date: item.interviewPreparedAt })}</div>}
              {item.interviewPrepPath && <div className="break-all text-[10px] text-zinc-500">{item.interviewPrepPath}</div>}
              <div className="flex flex-wrap gap-2">
                <ActionButton onClick={onGenerateInterviewPrep} disabled={isInterviewPreparing || interviewLoading} tone="cyan">
                  {isInterviewPreparing || interviewLoading ? <Loader2 size={13} className="animate-spin" /> : <BrainCircuit size={13} />}
                  {item.interviewPrepPath ? t('pipeline.regenerateInterviewPrep') : t('pipeline.generateInterviewPrep')}
                </ActionButton>
                {item.interviewPrepPath && (
                  <ActionButton onClick={onViewInterviewPrep} disabled={interviewLoading}>
                    {interviewLoading ? <Loader2 size={13} className="animate-spin" /> : <BookOpenText size={13} />}
                    {t('pipeline.viewInterviewPrep')}
                  </ActionButton>
                )}
              </div>
            </Section>
            <Section title={t('jobWorkspace.storyMatch')}>
              <div className="text-sm text-zinc-500">{t('jobWorkspace.storyPlaceholder')}</div>
            </Section>
          </div>
        )}

        {activeTab === 'records' && (
          <div className="space-y-4">
            <Section title={t('jobWorkspace.statusFlow')}>
              <div className="grid grid-cols-2 gap-2">
                {statusOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => onStatusChange(option.value)}
                    className={`rounded border px-2.5 py-1.5 text-xs font-medium transition-colors ${statusButtonClass(option.value, item.decisionStatus === option.value)}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </Section>
            <Section title={t('jobWorkspace.timeline')}>
              <div className="space-y-2 text-xs text-zinc-400">
                <div className="flex justify-between gap-3"><span>{t('pipeline.added')}</span><span className="text-right text-zinc-300">{item.addedAt || '-'}</span></div>
                <div className="flex justify-between gap-3"><span>{t('pipeline.material.llm')}</span><span className="text-right text-zinc-300">{item.evaluatedAt || '-'}</span></div>
                <div className="flex justify-between gap-3"><span>{t('pipeline.material.resumeSuggestion')}</span><span className="text-right text-zinc-300">{item.resumeSuggestedAt || '-'}</span></div>
                <div className="flex justify-between gap-3"><span>{t('pipeline.material.resumeDraft')}</span><span className="text-right text-zinc-300">{item.resumeDraftedAt || '-'}</span></div>
                <div className="flex justify-between gap-3"><span>{t('pipeline.material.interviewPrep')}</span><span className="text-right text-zinc-300">{item.interviewPreparedAt || '-'}</span></div>
              </div>
            </Section>
            <button
              onClick={onDelete}
              className="flex w-full items-center justify-center gap-2 rounded border border-red-900/70 bg-red-950/20 px-3 py-2 text-sm font-medium text-red-300 hover:bg-red-950/40 transition-colors"
            >
              <Trash2 size={15} />
              {t('pipeline.deleteItem')}
            </button>
          </div>
        )}
      </div>
      {decisionTarget && (
        <EvidenceDecisionDialog
          requirement={decisionTarget.requirement}
          classification={decisionTarget.classification}
          existingEvidence={selectedDecisionEvidence}
          saving={decisionSaving}
          error={decisionError}
          onCancel={() => { if (!decisionSaving) setDecisionTarget(null); }}
          onSubmit={(input) => { void submitEvidenceDecision(input); }}
        />
      )}
    </div>
  );
}
