import {
  BookOpenText,
  BrainCircuit,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clipboard,
  FileText,
  Loader2,
  MessageSquareText,
  Save,
  Send,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useAppTranslation } from '../i18n';
import { DetailItem } from './DetailItem';
import { EvidenceDetailDrawer } from './EvidenceDetailDrawer';
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
  ProficiencyLevel,
  GreetingDraft,
  GreetingPreflightResponse,
  GreetingPrepareResponse,
  GreetingDraftStatus,
  Job,
  PipelineItem,
} from '../types';
import { buildRequirementUnits } from '../utils/requirementLogic';

type WorkspaceTab = 'overview' | 'evaluation' | 'materials' | 'interview';
type NextAction = 'llm' | 'evidence_assessment' | 'evidence_gap' | 'evidence_review' | 'resume' | 'draft' | 'interview' | 'confirm' | 'review';
type EvidenceDecisionTarget = {
  requirement: EvidenceRequirement;
  classification: EvidenceClassification;
  reviewMode?: 'full' | 'candidate';
};

type JobMatchingResult = {
  canonicalKey: string;
  title: string;
  importance: EvidenceRequirement['importance'];
  category: EvidenceRequirement['category'];
  requiredProficiency?: ProficiencyLevel;
  proficiencyApplicable: boolean;
  groupMode: 'all_of' | 'any_of';
  alternatives: string[];
  status: 'matched' | 'partial' | 'missing' | 'unknown';
  rationale: string;
  jdQuote: string;
};

type StatusOption = {
  value: DecisionStatus;
  label: string;
};

const PROFICIENCY_LABELS: Record<'zh' | 'en', Record<ProficiencyLevel, string>> = {
  zh: { unspecified: '未说明', awareness: '了解', familiar: '熟悉', working: '掌握', proficient: '熟练', expert: '精通' },
  en: { unspecified: 'Not specified', awareness: 'Awareness', familiar: 'Familiar', working: 'Working', proficient: 'Proficient', expert: 'Expert' },
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
    userProficiency?: ProficiencyLevel,
  ) => Promise<EvidenceMutationResponse | null>;
  onCreateEvidenceItem: (item: EvidenceItemInput) => Promise<EvidenceMutationResponse | null>;
  onUpdateEvidenceItem: (item: EvidenceItem) => Promise<EvidenceMutationResponse | null>;
  onConfirmEvidenceItem: (evidenceId: string) => Promise<EvidenceMutationResponse | null>;
  onOpenPersonalResume: () => void;
  onOpenEvidenceProfile: () => void;
  targetRequirementId?: string;
  targetRequestId?: number;
  evidenceFocusRequestId?: number;
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
  greetingPreparing: boolean;
  onSaveGreetingDraft: (editedText: string, status: GreetingDraftStatus) => Promise<unknown>;
  onPreflightGreeting: (message: string) => Promise<GreetingPreflightResponse | null>;
  onPrepareGreeting: (message: string) => Promise<GreetingPrepareResponse | null>;
  onGenerateResumeSuggestions: () => void;
  onViewResumeSuggestion: () => void;
  isResumeSuggesting: boolean;
  resumeLoading: boolean;
  onGenerateInterviewPrep: () => void;
  onViewInterviewPrep: () => void;
  isInterviewPreparing: boolean;
  interviewLoading: boolean;
  onOpenResumeMaterials: () => void;
  jobLabels: Map<string, string>;
  layout?: 'drawer' | 'embedded';
};

const STATUS_CLASSES: Record<DecisionStatus, { active: string; idle: string }> = {
  needs_llm: {
    active: 'workspace-status-control workspace-status-control--info is-active',
    idle: 'workspace-status-control workspace-status-control--info',
  },
  needs_review: {
    active: 'workspace-status-control workspace-status-control--pending is-active',
    idle: 'workspace-status-control workspace-status-control--pending',
  },
  ready_to_greet: {
    active: 'workspace-status-control workspace-status-control--success is-active',
    idle: 'workspace-status-control workspace-status-control--success',
  },
  greeted: {
    active: 'workspace-status-control workspace-status-control--info is-active',
    idle: 'workspace-status-control workspace-status-control--info',
  },
  interviewing: {
    active: 'workspace-status-control workspace-status-control--info is-active',
    idle: 'workspace-status-control workspace-status-control--info',
  },
  skipped: {
    active: 'workspace-status-control workspace-status-control--risk is-active',
    idle: 'workspace-status-control workspace-status-control--risk',
  },
  archived: {
    active: 'workspace-status-control workspace-status-control--neutral is-active',
    idle: 'workspace-status-control workspace-status-control--neutral',
  },
};

function statusButtonClass(status: DecisionStatus, active: boolean) {
  const classes = STATUS_CLASSES[status];
  if (!classes) return active ? 'workspace-status-control workspace-status-control--info is-active' : 'workspace-status-control workspace-status-control--neutral';
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
  const className = `workspace-material-pill workspace-material-pill--${tone} ${ready ? 'is-ready' : 'is-missing'} inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium ${
    current ? 'is-current' : ''
  } ${onClick ? 'cursor-pointer transition-colors' : ''}`;
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
    <section className="workspace-section space-y-3 rounded border p-3">
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
  tone?: 'emerald' | 'indigo' | 'cyan' | 'zinc' | 'amber' | 'red';
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`workspace-action workspace-action--${tone} inline-flex items-center gap-2 rounded border px-3 py-2 text-xs font-medium transition-colors disabled:cursor-wait disabled:opacity-60`}
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
  onOpenPersonalResume,
  onOpenEvidenceProfile,
  targetRequirementId,
  targetRequestId,
  evidenceFocusRequestId,
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
  greetingPreparing,
  onSaveGreetingDraft,
  onPreflightGreeting,
  onPrepareGreeting,
  onGenerateResumeSuggestions,
  onViewResumeSuggestion,
  isResumeSuggesting,
  resumeLoading,
  onGenerateInterviewPrep,
  onViewInterviewPrep,
  isInterviewPreparing,
  interviewLoading,
  onOpenResumeMaterials,
  jobLabels,
  layout = 'drawer',
}: JobWorkspaceProps) {
  const { t, i18n } = useAppTranslation();
  const language = i18n.resolvedLanguage?.startsWith('en') ? 'en' : 'zh';
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('overview');
  const [greetingText, setGreetingText] = useState('');
  const [greetingPreflight, setGreetingPreflight] = useState<GreetingPreflightResponse | null>(null);
  const [greetingChecking, setGreetingChecking] = useState(false);
  const [greetingActionError, setGreetingActionError] = useState('');
  const [decisionTarget, setDecisionTarget] = useState<EvidenceDecisionTarget | null>(null);
  const [decisionSaving, setDecisionSaving] = useState(false);
  const [decisionError, setDecisionError] = useState('');
  const [confirmingEvidenceIds, setConfirmingEvidenceIds] = useState<string[]>([]);
  const [workspaceEvidenceError, setWorkspaceEvidenceError] = useState('');
  const [selectedEvidenceId, setSelectedEvidenceId] = useState('');
  const materialReadyCount = [
    item.reportPath,
    item.resumeSuggestionPath,
    item.resumeDraftPath,
    item.interviewPrepPath,
  ].filter(Boolean).length;
  const isLegacyEvaluation = Boolean(item.reportPath) && (item.evaluationProfileVersion || 0) < 2;
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
  const matchingResults = useMemo<JobMatchingResult[]>(() => {
    const importanceRank = { context: 0, preferred: 1, required: 2 };
    return buildRequirementUnits(requirements).map((unit) => {
      const group = unit.requirements;
      const coverages = group
        .map((requirement) => coverageByRequirement.get(requirement.requirementId))
        .filter((coverage): coverage is EvidenceCoverage => Boolean(coverage));
      const matchedCount = coverages.filter((coverage) => (
        coverage.userClassification === 'done'
        || coverage.verificationStatus === 'source_verified'
        || coverage.coverageStatus === 'supported'
      )).length;
      const partialCount = coverages.filter((coverage) => (
        coverage.userClassification === 'adjacent'
        || ['supported', 'partial'].includes(coverage.assessmentStatus || '')
        || coverage.coverageStatus === 'partial'
      )).length;
      const confirmedMissingCount = coverages.filter((coverage) => (
        coverage.userClassification === 'not_done'
        || coverage.coverageStatus === 'user_confirmed_absent'
      )).length;
      const status: JobMatchingResult['status'] = matchedCount >= unit.minimumSatisfied
        ? 'matched'
        : partialCount
          ? 'partial'
          : group.length - confirmedMissingCount < unit.minimumSatisfied
            ? 'missing'
            : 'unknown';
      const representative = group[0];
      const importance = group.reduce((current, requirement) => (
        importanceRank[requirement.importance] > importanceRank[current]
          ? requirement.importance
          : current
      ), representative.importance);
      const rationale = coverages
        .map((coverage) => coverage.userDecisionAt ? coverage.rationale : (coverage.assessmentRationale || coverage.rationale))
        .find(Boolean) || '';
      return {
        canonicalKey: unit.unitId,
        title: unit.mode === 'any_of' ? unit.label : representative.capabilityName || representative.label,
        importance,
        category: representative.category,
        requiredProficiency: representative.requiredProficiency,
        proficiencyApplicable: unit.mode !== 'any_of' && Boolean(representative.proficiencyApplicable),
        groupMode: unit.mode,
        alternatives: group.map((requirement) => requirement.capabilityName || requirement.label),
        status,
        rationale,
        jdQuote: group.map((requirement) => requirement.jdQuote).find(Boolean) || '',
      };
    }).sort((left, right) => {
      const importanceOrder = { required: 0, preferred: 1, context: 2 };
      return importanceOrder[left.importance] - importanceOrder[right.importance]
        || left.title.localeCompare(right.title);
    });
  }, [coverageByRequirement, requirements]);
  const evidenceById = useMemo(
    () => new Map((evidenceOverview?.evidenceItems || []).map((evidence) => [evidence.evidenceId, evidence])),
    [evidenceOverview?.evidenceItems],
  );
  const selectedEvidence = evidenceById.get(selectedEvidenceId) || null;
  const selectedDecisionEvidence = useMemo(() => {
    if (!decisionTarget) return null;
    const coverage = coverageByRequirement.get(decisionTarget.requirement.requirementId);
    const linked = (coverage?.evidenceIds || [])
      .map((evidenceId) => evidenceById.get(evidenceId))
      .filter((evidence): evidence is EvidenceItem => Boolean(evidence));
    return linked.find((evidence) => evidence.status === 'draft') || linked[0] || null;
  }, [coverageByRequirement, decisionTarget, evidenceById]);
  const requirementUnits = useMemo(() => buildRequirementUnits(requirements), [requirements]);
  const requirementUnitStates = useMemo(() => requirementUnits.map((unit) => {
    const coverages = unit.requirements
      .map((requirement) => coverageByRequirement.get(requirement.requirementId))
      .filter((coverage): coverage is EvidenceCoverage => Boolean(coverage));
    const supported = coverages.filter((coverage) => coverage.coverageStatus === 'supported').length;
    const confirmedAbsent = coverages.filter(
      (coverage) => coverage.coverageStatus === 'user_confirmed_absent',
    ).length;
    const isSupported = supported >= unit.minimumSatisfied;
    const isRequired = unit.requirements.some((requirement) => requirement.importance === 'required');
    return {
      isSupported,
      isConfirmedGap: !isSupported && unit.requirements.length - confirmedAbsent < unit.minimumSatisfied,
      isHardGap: isRequired && !isSupported && unit.requirements.length - confirmedAbsent < unit.minimumSatisfied,
      isPending: !isSupported && (
        coverages.length < unit.requirements.length
        || coverages.some((coverage) => !coverage.userDecisionAt)
      ),
      hasPotentialEvidence: !isSupported && coverages.some((coverage) => (
        !coverage.userDecisionAt
        && (coverage.assessmentStatus === 'supported' || coverage.assessmentStatus === 'partial')
      )),
    };
  }), [coverageByRequirement, requirementUnits]);
  const requirementCount = requirementUnits.length || item.requirementCount || 0;
  const confirmedCoverageCount = requirements.length
    ? requirementUnitStates.filter((state) => state.isSupported).length
    : item.supportedRequirementCount || 0;
  const pendingDecisionCount = requirements.length
    ? requirementUnitStates.filter((state) => state.isPending).length
    : item.unresolvedRequirementCount || 0;
  const confirmedGapCount = requirementUnitStates.filter((state) => state.isConfirmedGap).length;
  const confirmedHardGapCount = requirementUnitStates.filter((state) => state.isHardGap).length;
  const hasEvidenceAssessment = requirements.length > 0 || Boolean(item.requirementAssessedAt);
  const potentialEvidenceCount = requirements.length
    ? requirementUnitStates.filter((state) => state.hasPotentialEvidence).length
    : item.potentialEvidenceRequirementCount || 0;
  const averageSalary = (job?.avg ?? item.avg ?? 0).toFixed(1);
  const greetingSourceText = greetingDraft?.editedText || greetingDraft?.draftText || '';
  const greetingOptions = (greetingDraft?.draftOptions || []).filter((option) => option.trim());
  const selectedGreetingOption = greetingOptions.findIndex((option) => option === greetingText);

  useEffect(() => {
    setGreetingText(greetingSourceText);
  }, [greetingDraft?.sourceKey, greetingDraft?.updatedAt, greetingSourceText]);

  useEffect(() => {
    setDecisionTarget(null);
    setDecisionError('');
    setWorkspaceEvidenceError('');
    setGreetingPreflight(null);
    setGreetingActionError('');
  }, [item.sourceKey]);

  useEffect(() => {
    if (!targetRequirementId) return;
    const targetRequirement = evidenceOverview?.requirements.find(
      (requirement) => requirement.requirementId === targetRequirementId,
    );
    if (!targetRequirement || targetRequirement.sourceKey !== item.sourceKey) return;
    setActiveTab('evaluation');
    let scrollFrame = 0;
    const frame = window.requestAnimationFrame(() => {
      scrollFrame = window.requestAnimationFrame(() => {
        document.querySelector(`[data-requirement-id="${targetRequirementId}"]`)?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(scrollFrame);
    };
  }, [evidenceOverview?.requirements, item.sourceKey, targetRequestId, targetRequirementId]);

  useEffect(() => {
    if (!evidenceFocusRequestId) return;
    setActiveTab('evaluation');
  }, [evidenceFocusRequestId]);

  const nextAction = useMemo<NextAction>(() => {
    if (!item.reportPath) return 'llm';
    if (!hasEvidenceAssessment) return 'evidence_assessment';
    if (confirmedHardGapCount > 0) return 'evidence_gap';
    if (pendingDecisionCount > 0) return 'evidence_review';
    if (!item.resumeSuggestionPath) return 'resume';
    if (!item.resumeDraftPath) return 'draft';
    if (!item.interviewPrepPath) return 'interview';
    if (item.decisionStatus === 'needs_review') return 'confirm';
    return 'review';
  }, [
    confirmedHardGapCount,
    hasEvidenceAssessment,
    item.decisionStatus,
    item.interviewPrepPath,
    item.reportPath,
    item.resumeDraftPath,
    item.resumeSuggestionPath,
    pendingDecisionCount,
  ]);

  const tabs: Array<{ value: WorkspaceTab; label: string }> = [
    { value: 'overview', label: t('jobWorkspace.tabs.overview') },
    { value: 'evaluation', label: t('jobWorkspace.tabs.evaluation') },
    { value: 'materials', label: t('jobWorkspace.tabs.materials') },
    { value: 'interview', label: t('jobWorkspace.tabs.interview') },
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

  const checkGreeting = async () => {
    setGreetingChecking(true);
    setGreetingActionError('');
    try {
      const result = await onPreflightGreeting(greetingText);
      if (!result) return;
      if (!result.canProceed) {
        setGreetingActionError(result.errors.join('；'));
        return;
      }
      setGreetingPreflight(result);
    } finally {
      setGreetingChecking(false);
    }
  };

  const confirmGreetingPrepare = async () => {
    const result = await onPrepareGreeting(greetingText);
    if (result) setGreetingPreflight(null);
  };

  const markGreetingSent = async () => {
    if (!window.confirm(t('jobWorkspace.greetingMarkSentConfirm'))) return;
    await onSaveGreetingDraft(greetingText, 'manually_marked_sent');
  };

  const greetingStatusLabel = greetingDraft
    ? t(`jobWorkspace.greetingStatuses.${greetingDraft.status}`)
    : t('jobWorkspace.greetingStatuses.draft');

  const evidenceStatus = (coverage?: EvidenceCoverage) => {
    if (coverage?.verificationStatus === 'source_verified') {
      return { label: t('jobWorkspace.evidence.statuses.sourceVerified'), classes: 'border-emerald-900/70 bg-emerald-950/40 text-emerald-300' };
    }
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

  const importanceClasses = (requirement: Pick<EvidenceRequirement, 'importance'>) => (
    requirement.importance === 'required'
      ? 'border-red-900/60 bg-red-950/30 text-red-300'
      : requirement.importance === 'preferred'
        ? 'border-indigo-900/60 bg-indigo-950/30 text-indigo-300'
        : 'border-zinc-800 bg-zinc-900 text-zinc-400'
  );

  const openEvidenceDecision = (requirement: EvidenceRequirement, classification: EvidenceClassification) => {
    setDecisionError('');
    setWorkspaceEvidenceError('');
    setDecisionTarget({ requirement, classification, reviewMode: 'full' });
  };

  const openCandidateEvidenceReview = (requirement: EvidenceRequirement) => {
    setDecisionError('');
    setWorkspaceEvidenceError('');
    setDecisionTarget({ requirement, classification: 'done', reviewMode: 'candidate' });
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
        const candidateRefs = coverageByRequirement.get(requirement.requirementId)?.candidateEvidenceRefs || [];
        const isCandidateReview = decisionTarget.reviewMode === 'candidate';
        const itemInput: EvidenceItemInput = {
          title: isAdjacent
            ? `${requirement.label}：${t('jobWorkspace.evidence.dialog.adjacentEvidenceTitle')}`
            : `${requirement.label}：${input.experience.slice(0, 32)}`,
          evidenceType: 'fact',
          summary: input.experience,
          userRole: isAdjacent ? '' : input.role,
          actions: isAdjacent ? [`${t('jobWorkspace.evidence.dialog.transferablePrefix')}${input.transferable}`] : splitFactLines(input.actions),
          results: isAdjacent ? [`${t('jobWorkspace.evidence.dialog.boundariesPrefix')}${input.boundaries}`] : splitFactLines(input.results),
          sourceRefs: isCandidateReview
            ? candidateRefs.map((source) => ({ type: source.sourceType, ref: source.locator, quote: source.quote }))
            : [{
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
        input.proficiency,
      );
      if (!classificationResult) throw new Error(t('jobWorkspace.evidence.errors.classify'));

      if (decisionTarget.reviewMode === 'candidate' && evidenceIds[0]) {
        const confirmed = await onConfirmEvidenceItem(evidenceIds[0]);
        if (!confirmed) throw new Error(t('jobWorkspace.evidence.errors.confirm'));
        setDecisionTarget(null);
        return;
      }

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

  const confirmCandidateEvidence = async (requirement: EvidenceRequirement) => {
    const candidateRefs = coverageByRequirement.get(requirement.requirementId)?.candidateEvidenceRefs || [];
    if (!candidateRefs.length) return;
    setDecisionSaving(true);
    setWorkspaceEvidenceError('');
    try {
      const summary = candidateRefs.map((source) => source.quote).filter(Boolean).join('\n');
      const created = await onCreateEvidenceItem({
        title: requirement.label,
        evidenceType: requirement.category === 'experience' ? 'project' : 'fact',
        summary,
        userRole: '',
        actions: [],
        results: [],
        sourceRefs: candidateRefs.map((source) => ({ type: source.sourceType, ref: source.locator, quote: source.quote })),
        tags: [requirement.canonicalKey, 'source-backed'],
        status: 'draft',
      });
      if (!created?.item) throw new Error(t('jobWorkspace.evidence.errors.saveItem'));
      const classified = await onClassifyEvidenceCoverage(
        requirement.requirementId,
        'done',
        [created.item.evidenceId],
        t('jobWorkspace.evidence.decisionRationale.candidateConfirmed'),
        1,
        requirement.requiredProficiency && requirement.requiredProficiency !== 'unspecified'
          ? requirement.requiredProficiency
          : 'working',
      );
      if (!classified) throw new Error(t('jobWorkspace.evidence.errors.classify'));
      const confirmed = await onConfirmEvidenceItem(created.item.evidenceId);
      if (!confirmed) throw new Error(t('jobWorkspace.evidence.errors.confirm'));
    } catch (error) {
      setWorkspaceEvidenceError((error as Error).message || t('jobWorkspace.evidence.errors.unknown'));
    } finally {
      setDecisionSaving(false);
    }
  };

  const classifySimpleRequirement = async (
    requirement: EvidenceRequirement,
    classification: EvidenceClassification,
    rationaleKey: string,
  ) => {
    setDecisionSaving(true);
    setWorkspaceEvidenceError('');
    try {
      const result = await onClassifyEvidenceCoverage(
        requirement.requirementId,
        classification,
        [],
        t(rationaleKey),
        1,
      );
      if (!result) setWorkspaceEvidenceError(t('jobWorkspace.evidence.errors.classify'));
    } finally {
      setDecisionSaving(false);
    }
  };

  return (
    <div className={`job-workspace ${layout === 'embedded' ? 'min-w-0 flex-1' : 'w-[42rem] shrink-0 border-l border-zinc-800'} flex flex-col bg-zinc-950`}>
      <div className="border-b border-zinc-800 px-4 py-4 xl:px-6">
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
              aria-label={t('pipeline.deleteItem')}
              className="rounded border border-red-900/70 bg-red-950/20 p-1.5 text-red-300 transition-colors hover:bg-red-950/40 hover:text-red-200"
            >
              <Trash2 size={16} />
            </button>
            <button
              onClick={onClose}
              title={t('pipeline.backToList')}
              aria-label={t('pipeline.backToList')}
              className={`rounded border border-zinc-800 p-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 transition-colors ${layout === 'embedded' ? 'lg:hidden' : ''}`}
            >
              <X size={16} />
            </button>
          </div>
        </div>
      </div>

      <div className="border-b border-zinc-800 px-3 py-2">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label={t('jobWorkspace.title')}>
          {tabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              role="tab"
              aria-selected={activeTab === tab.value}
              className={`workspace-tab rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${
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

      <div className="flex-1 overflow-y-auto p-4 xl:p-6">
        <div className="mx-auto w-full max-w-6xl">
        {activeTab === 'overview' && (
          <div className="space-y-3">
            <Section title={t('jobWorkspace.nextAction')}>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">{t('jobWorkspace.nextActionCurrent')}</span>
                    <span className="text-sm font-semibold text-zinc-100">{t(`jobWorkspace.nextActionLabels.${nextAction}`)}</span>
                  </div>
                  <div className="mt-1 text-xs leading-relaxed text-zinc-400">{t(`jobWorkspace.nextActionReasons.${nextAction}`)}</div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {nextAction === 'llm' && (
                    <ActionButton onClick={onLlmEvaluate} disabled={isLlmEvaluating} tone="emerald">
                      {isLlmEvaluating && <Loader2 size={13} className="animate-spin" />}
                      {isLlmEvaluating ? t('pipeline.generating') : t('pipeline.llmEval')}
                    </ActionButton>
                  )}
                  {nextAction === 'evidence_assessment' && (
                    <ActionButton onClick={onLlmEvaluate} disabled={isLlmEvaluating} tone="emerald">
                      {isLlmEvaluating ? <Loader2 size={13} className="animate-spin" /> : <BrainCircuit size={13} />}
                      {isLlmEvaluating ? t('pipeline.generating') : t('jobWorkspace.nextActionButtons.evidenceAssessment')}
                    </ActionButton>
                  )}
                  {nextAction === 'evidence_gap' && (
                    <ActionButton onClick={onOpenEvidenceProfile} tone="red">
                      <CheckCircle2 size={13} />
                      {t('jobWorkspace.nextActionButtons.evidenceGap', { count: confirmedHardGapCount })}
                    </ActionButton>
                  )}
                  {nextAction === 'evidence_review' && (
                    <ActionButton onClick={onOpenEvidenceProfile} tone="amber">
                      <CheckCircle2 size={13} />
                      {t('jobWorkspace.nextActionButtons.evidenceReview', { count: pendingDecisionCount })}
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
                    <ActionButton
                      onClick={() => document.querySelector('[data-workspace-section="status-flow"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                      tone="zinc"
                    >
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

            <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
              <div className="workspace-metric flex items-center justify-between gap-3 rounded border border-zinc-800 bg-zinc-950 px-3 py-2.5">
                <div className="text-[11px] text-zinc-500">{t('jobWorkspace.materialProgress')}</div>
                <div className="text-lg font-semibold text-zinc-100">{materialReadyCount}/4</div>
              </div>
              <div className="workspace-metric flex items-center justify-between gap-3 rounded border border-zinc-800 bg-zinc-950 px-3 py-2.5">
                <div className="min-w-0 text-[11px] text-zinc-500">
                  <div>{t('jobWorkspace.evidence.confirmedCoverage')}</div>
                  {potentialEvidenceCount > 0 && <div className="truncate text-[9px] text-amber-400" title={t('jobWorkspace.evidence.candidateHint', { count: potentialEvidenceCount })}>{t('jobWorkspace.evidence.candidateHint', { count: potentialEvidenceCount })}</div>}
                </div>
                <div className="shrink-0 text-lg font-semibold text-emerald-200">{requirementCount ? `${confirmedCoverageCount}/${requirementCount}` : '-'}</div>
              </div>
              <div className="workspace-metric flex items-center justify-between gap-3 rounded border border-zinc-800 bg-zinc-950 px-3 py-2.5">
                <div className="text-[11px] text-zinc-500">{t('jobWorkspace.evidence.pendingDecision')}</div>
                <div className="text-lg font-semibold text-amber-200">{requirementCount ? pendingDecisionCount : '-'}</div>
              </div>
              <div className="workspace-metric flex items-center justify-between gap-3 rounded border border-zinc-800 bg-zinc-950 px-3 py-2.5">
                <div className="text-[11px] text-zinc-500">{t('jobWorkspace.evidence.confirmedGaps')}</div>
                <div className="text-lg font-semibold text-red-200">{requirementCount ? confirmedGapCount : '-'}</div>
              </div>
            </div>

            <div className="border-t border-zinc-800 pt-3">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">{t('jobWorkspace.tabs.info')}</div>
            </div>
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

            <div data-workspace-section="status-flow" className="scroll-mt-4 border-t border-zinc-800 pt-4">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">{t('jobWorkspace.tabs.records')}</div>
            </div>
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
          </div>
        )}

        {activeTab === 'evaluation' && (
          <div className="space-y-4">
            <Section title={t('jobWorkspace.coarseEvaluation')}>
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-500">{t('pipeline.conclusion')}</span>
                <span className="text-sm font-semibold text-zinc-100">{item.scoringVersion === 2 ? item.fitLevel : t('jobs.scoringOutdated')}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-zinc-400">
                <div>{t('pipeline.coverage', { n: item.keywordCoverage?.coverage ?? item.coverage ?? 0 })}</div>
                <div>{t('pipeline.confidence')} {item.confidence || '-'}</div>
                <div>{t('pipeline.expRisk', { risk: riskText(item.experienceRisk) })}</div>
                <div>{t('pipeline.eduRisk', { risk: riskText(item.educationRisk) })}</div>
              </div>
              {!!item.reasons?.length && <div className="mt-3 space-y-1 text-xs leading-relaxed text-zinc-400"><div className="text-zinc-500">{t('jobs.scoringReasons')}</div>{item.reasons.slice(0, 3).map((reason) => <div key={reason}>· {reason}</div>)}</div>}
            </Section>
            <Section title={t('jobWorkspace.llmEvaluation')}>
              <div className="flex items-center justify-between">
                <span className="text-xs text-emerald-500">{t('pipeline.llm')}</span>
                <span className="text-sm font-semibold text-emerald-200">{item.llmScore ? item.llmScore.toFixed(1) : item.reportId || '-'} / 5.0</span>
              </div>
              {item.llmFitLevel && <div className="text-xs text-emerald-400">{item.llmFitLevel}</div>}
              {item.llmRecommendation && <div className="text-xs leading-relaxed text-zinc-300">{item.llmRecommendation}</div>}
              {isLegacyEvaluation && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-amber-900/60 bg-amber-950/25 p-3">
                  <div className="min-w-0 text-xs leading-relaxed text-amber-200">{t('jobWorkspace.evidence.staleEvaluationHint')}</div>
                </div>
              )}
              {item.reportPath ? (
                <>
                  <div className="break-all text-[10px] text-zinc-500">{item.reportPath}</div>
                  <div className="flex flex-wrap gap-2">
                    <ActionButton onClick={onLlmEvaluate} disabled={isLlmEvaluating} tone="amber">
                      {isLlmEvaluating ? <Loader2 size={13} className="animate-spin" /> : <BrainCircuit size={13} />}
                      {isLlmEvaluating ? t('pipeline.generating') : t('pipeline.regenerateLlmEval')}
                    </ActionButton>
                    <ActionButton onClick={onViewReport} disabled={reportLoading} tone="emerald">
                      {reportLoading ? <Loader2 size={13} className="animate-spin" /> : <BookOpenText size={13} />}
                      {t('pipeline.viewReport')}
                    </ActionButton>
                  </div>
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
              ) : matchingResults.length ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-indigo-900/50 bg-indigo-950/20 px-3 py-2.5">
                    <div>
                      <div className="text-xs font-medium text-indigo-200">{t('jobWorkspace.evidence.matchingOnlyTitle')}</div>
                      <div className="mt-1 text-[10px] leading-relaxed text-zinc-500">{t('jobWorkspace.evidence.matchingOnlyHint')}</div>
                    </div>
                    <button type="button" onClick={onOpenEvidenceProfile} className="rounded border border-indigo-800/70 px-3 py-1.5 text-xs font-medium text-indigo-300 hover:bg-indigo-950/40">
                      {t('jobWorkspace.evidence.openCapabilityProfile')}
                    </button>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {matchingResults.map((result) => {
                      const statusClasses = {
                        matched: 'border-emerald-900/60 bg-emerald-950/25 text-emerald-300',
                        partial: 'border-cyan-900/60 bg-cyan-950/25 text-cyan-300',
                        missing: 'border-red-900/60 bg-red-950/25 text-red-300',
                        unknown: 'border-zinc-700 bg-zinc-900 text-zinc-400',
                      }[result.status];
                      return (
                        <article key={result.canonicalKey} className="rounded border border-zinc-800 bg-zinc-900/35 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-zinc-100">{result.title}</div>
                              <div className="mt-1.5 flex flex-wrap gap-1.5">
                                <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${importanceClasses(result)}`}>
                                  {t(`jobWorkspace.evidence.importance.${result.importance}`)}
                                </span>
                                <span className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400">
                                  {t(`jobWorkspace.evidence.categories.${result.category}`)}
                                </span>
                                {result.groupMode === 'any_of' && (
                                  <span className="job-match-any-of-badge rounded border px-1.5 py-0.5 text-[10px]">
                                    {t('jobWorkspace.evidence.anyOfGroup')}
                                  </span>
                                )}
                              </div>
                            </div>
                            <span className={`shrink-0 rounded border px-2 py-1 text-[10px] font-medium ${statusClasses}`}>
                              {t(`jobWorkspace.evidence.matchingStatuses.${result.status}`)}
                            </span>
                          </div>
                          {result.proficiencyApplicable && result.requiredProficiency && result.requiredProficiency !== 'unspecified' && (
                            <div className="mt-3 text-[10px] text-zinc-500">
                              {t('jobWorkspace.evidence.requiredProficiency')}：<span className="text-zinc-300">{PROFICIENCY_LABELS[language][result.requiredProficiency]}</span>
                            </div>
                          )}
                          {result.groupMode === 'any_of' && (
                            <div className="mt-3 text-[10px] leading-relaxed text-zinc-500">
                              {t('jobWorkspace.evidence.anyOfAlternatives')}：
                              <span className="text-zinc-300">{result.alternatives.join(' / ')}</span>
                            </div>
                          )}
                          {result.rationale && <p className="mt-2 text-xs leading-relaxed text-zinc-400">{result.rationale}</p>}
                        </article>
                      );
                    })}
                  </div>
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
              {false && (<>
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
                    const verificationMode = requirement.verificationMode
                      || (requirement.category === 'education'
                        ? 'document_fact'
                        : requirement.category === 'location' || requirement.category === 'preference'
                          ? 'preference'
                          : requirement.category === 'behavior'
                            ? 'behavior_example'
                            : requirement.category === 'skill' || requirement.category === 'experience'
                              ? 'experience_fact'
                              : 'manual_review');
                    const sourceVerified = coverage?.verificationStatus === 'source_verified';
                    const positiveEvidenceDecision = linkedEvidenceItems.length > 0
                      && (coverage?.userClassification === 'done' || coverage?.userClassification === 'adjacent');
                    const candidateNeedsReview = candidateRefs.length > 0
                      && !sourceVerified
                      && !coverage?.userDecisionAt;
                    const activeTask = (evidenceOverview?.tasks || []).find(
                      (task) => task.requirementId === requirement.requirementId && (task.status === 'pending' || task.status === 'in_progress'),
                    );
                    return (
                      <div key={requirement.requirementId} data-requirement-id={requirement.requirementId} className="rounded border border-zinc-800 bg-zinc-900/35 p-3">
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
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="text-[10px] font-medium uppercase tracking-wide text-indigo-400">{t('jobWorkspace.evidence.userEvidence')}</div>
                                {coverage?.decisionSource === 'canonical_reuse' && (
                                  <span
                                    className="rounded border border-cyan-900/70 bg-cyan-950/30 px-1.5 py-0.5 text-[10px] font-medium text-cyan-300"
                                    title={t('jobWorkspace.evidence.crossJobReuseHint')}
                                  >
                                    {t('jobWorkspace.evidence.crossJobReuse')}
                                  </span>
                                )}
                              </div>
                              {linkedEvidenceItems.map((evidence) => (
                                <div key={evidence.evidenceId} className="rounded border border-zinc-800 bg-zinc-900/60 p-2.5">
                                  <div className="flex items-start justify-between gap-2">
                                    <button
                                      type="button"
                                      onClick={() => setSelectedEvidenceId(evidence.evidenceId)}
                                      className="min-w-0 text-left"
                                    >
                                      <div className="text-xs font-medium text-zinc-200">{evidence.title}</div>
                                      <div className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-zinc-500">{evidence.summary}</div>
                                    </button>
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
                              <div className={`text-[10px] font-medium uppercase tracking-wide ${sourceVerified ? 'text-emerald-400' : 'text-amber-500'}`}>
                                {sourceVerified
                                  ? t('jobWorkspace.evidence.sourceVerifiedTitle')
                                  : t('jobWorkspace.evidence.candidateSources')}
                              </div>
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

                        {(rationale || (confidence > 0 && !sourceVerified)) && (
                          <div className="mt-2 flex flex-wrap items-start justify-between gap-2 text-[10px] leading-relaxed text-zinc-500">
                            <span className="min-w-0 flex-1">{rationale}</span>
                            {confidence > 0 && !sourceVerified && <span className="shrink-0">{t('jobWorkspace.evidence.confidence', { value: Math.round(confidence * 100) })}</span>}
                          </div>
                        )}

                        <div className="mt-3 border-t border-zinc-800 pt-3">
                          {sourceVerified ? (
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="inline-flex items-center gap-1.5 text-xs text-emerald-300">
                                <CheckCircle2 size={13} />
                                {t('jobWorkspace.evidence.sourceVerifiedNoConfirmation')}
                              </div>
                              <button type="button" onClick={onOpenPersonalResume} className="text-[10px] text-zinc-400 hover:text-zinc-200">
                                {t('jobWorkspace.evidence.informationIncorrect')}
                              </button>
                            </div>
                          ) : verificationMode === 'document_fact' && candidateNeedsReview ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <button type="button" onClick={() => { void confirmCandidateEvidence(requirement); }} disabled={decisionSaving} className="rounded border border-emerald-900/70 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-50">
                                {t('jobWorkspace.evidence.informationCorrect')}
                              </button>
                              <button type="button" onClick={onOpenPersonalResume} className="rounded border border-zinc-800 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-900">
                                {t('jobWorkspace.evidence.editPersonalResume')}
                              </button>
                            </div>
                          ) : verificationMode === 'document_fact' ? (
                            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
                              <span>{positiveEvidenceDecision ? t('jobWorkspace.evidence.confirmedOnce') : t('jobWorkspace.evidence.documentFactMissing')}</span>
                              <button type="button" onClick={onOpenPersonalResume} className="text-indigo-300 hover:text-indigo-200">
                                {t('jobWorkspace.evidence.editPersonalResume')}
                              </button>
                            </div>
                          ) : verificationMode === 'preference' ? (
                            <div>
                              <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-zinc-500">{t('jobWorkspace.evidence.preferenceDecision')}</div>
                              <div className="grid grid-cols-3 gap-1.5">
                                {([
                                  ['done', 'preferenceMatches'],
                                  ['adjacent', 'preferenceNegotiable'],
                                  ['not_done', 'preferenceDoesNotMatch'],
                                ] as const).map(([classification, labelKey]) => (
                                  <button
                                    key={classification}
                                    type="button"
                                    onClick={() => { void classifySimpleRequirement(requirement, classification, `jobWorkspace.evidence.decisionRationale.${labelKey}`); }}
                                    disabled={decisionSaving}
                                    className={`min-h-8 rounded border px-2 py-1.5 text-[10px] font-medium ${coverage?.userClassification === classification ? 'border-indigo-600 bg-indigo-950/50 text-indigo-200' : 'border-zinc-800 text-zinc-400 hover:bg-zinc-900'}`}
                                  >
                                    {t(`jobWorkspace.evidence.${labelKey}`)}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ) : candidateNeedsReview ? (
                            <div>
                              <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-zinc-500">{t('jobWorkspace.evidence.candidateDecision')}</div>
                              <div className="flex flex-wrap gap-2">
                                <button type="button" onClick={() => { void confirmCandidateEvidence(requirement); }} disabled={decisionSaving} className="rounded border border-emerald-900/70 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-50">
                                  {t('jobWorkspace.evidence.confirmCandidateMatch')}
                                </button>
                                <button type="button" onClick={() => openCandidateEvidenceReview(requirement)} disabled={decisionSaving} className="rounded border border-indigo-900/70 px-3 py-2 text-xs text-indigo-300 hover:bg-indigo-950/30 disabled:opacity-50">
                                  {t('jobWorkspace.evidence.reviewCandidate')}
                                </button>
                                <button type="button" onClick={() => { void classifySimpleRequirement(requirement, 'unsure', 'jobWorkspace.evidence.decisionRationale.candidateRejected'); }} disabled={decisionSaving} className="rounded border border-zinc-800 px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-900 disabled:opacity-50">
                                  {t('jobWorkspace.evidence.candidateNotApplicable')}
                                </button>
                              </div>
                            </div>
                          ) : positiveEvidenceDecision ? (
                            <div className="inline-flex items-center gap-1.5 text-xs text-emerald-300">
                              <CheckCircle2 size={13} />
                              {t('jobWorkspace.evidence.confirmedOnce')}
                            </div>
                          ) : (
                            <div>
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
                            </div>
                          )}
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
              </>)}
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
                  {greetingOptions.length > 0 && (
                    <div className="grid gap-2 lg:grid-cols-2">
                      {greetingOptions.map((option, index) => {
                        const selected = selectedGreetingOption === index;
                        return (
                          <button
                            key={`${index}:${option}`}
                            type="button"
                            onClick={() => {
                              setGreetingText(option);
                              setGreetingActionError('');
                            }}
                            className={`rounded border p-3 text-left transition-colors ${selected
                              ? 'border-emerald-600 bg-emerald-950/30 text-zinc-100'
                              : 'border-zinc-800 bg-zinc-900/40 text-zinc-300 hover:border-zinc-700'}`}
                          >
                            <span className="mb-1.5 flex items-center justify-between gap-2 text-xs font-semibold">
                              <span>{t('jobWorkspace.greetingOption', { index: index + 1 })}</span>
                              <span className={selected ? 'text-emerald-400' : 'text-zinc-600'}>
                                {selected ? t('jobWorkspace.greetingOptionSelected') : t('jobWorkspace.greetingOptionChoose')}
                              </span>
                            </span>
                            <span className="block text-xs leading-5">{option}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className="text-xs font-medium text-zinc-500">{t('jobWorkspace.greetingFinalEditable')}</div>
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
                  {greetingDraft?.status === 'preparing' && (
                    <div className="flex items-start gap-2 rounded border border-blue-800/50 bg-blue-950/30 p-3 text-xs leading-relaxed text-blue-200">
                      <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin" />
                      <span>{t('jobWorkspace.greetingPreparingHint')}</span>
                    </div>
                  )}
                  {greetingDraft?.status === 'prepared' && (
                    <div className="flex items-start gap-2 rounded border border-emerald-800/50 bg-emerald-950/30 p-3 text-xs leading-relaxed text-emerald-200">
                      <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                      <span>{t('jobWorkspace.greetingPreparedHint')}</span>
                    </div>
                  )}
                  {greetingDraft?.status === 'prepare_failed' && (
                    <div className="flex items-start gap-2 rounded border border-red-800/50 bg-red-950/30 p-3 text-xs leading-relaxed text-red-200">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                      <span>{greetingDraft.lastError || t('jobWorkspace.greetingPrepareUnknownError')}</span>
                    </div>
                  )}
                  {greetingActionError && (
                    <div className="rounded border border-red-800/50 bg-red-950/30 px-3 py-2 text-xs text-red-200">{greetingActionError}</div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <ActionButton
                      onClick={() => saveGreeting('edited')}
                      disabled={greetingSaving || greetingPreparing || !greetingDraft}
                      tone="emerald"
                    >
                      {greetingSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                      {t('jobWorkspace.saveGreeting')}
                    </ActionButton>
                    <ActionButton
                      onClick={copyGreeting}
                      disabled={greetingSaving || greetingPreparing || !greetingDraft || !greetingText.trim()}
                    >
                      <Clipboard size={13} />
                      {t('jobWorkspace.copyGreeting')}
                    </ActionButton>
                    <ActionButton
                      onClick={() => { void checkGreeting(); }}
                      disabled={greetingSaving || greetingPreparing || greetingChecking || !greetingDraft || !greetingText.trim()}
                      tone="cyan"
                    >
                      {greetingChecking || greetingPreparing ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                      {t('jobWorkspace.openGreeting')}
                    </ActionButton>
                    {greetingDraft?.status === 'prepared' && (
                      <ActionButton
                        onClick={() => { void markGreetingSent(); }}
                        disabled={greetingSaving}
                        tone="emerald"
                      >
                        <CheckCircle2 size={13} />
                        {t('jobWorkspace.markGreetingSent')}
                      </ActionButton>
                    )}
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

        </div>
      </div>
      {decisionTarget && (
        <EvidenceDecisionDialog
          requirement={decisionTarget.requirement}
          classification={decisionTarget.classification}
          existingEvidence={selectedDecisionEvidence}
          candidateEvidenceRefs={coverageByRequirement.get(decisionTarget.requirement.requirementId)?.candidateEvidenceRefs || []}
          compactCandidateReview={decisionTarget.reviewMode === 'candidate'}
          saving={decisionSaving}
          error={decisionError}
          onCancel={() => { if (!decisionSaving) setDecisionTarget(null); }}
          onSubmit={(input) => { void submitEvidenceDecision(input); }}
        />
      )}
      {greetingPreflight && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 px-4 py-6"
          onClick={() => { if (!greetingPreparing) setGreetingPreflight(null); }}
        >
          <div
            className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-zinc-800 px-5 py-4">
              <div>
                <div className="flex items-center gap-2 text-base font-semibold text-zinc-100">
                  <ShieldCheck size={17} className="text-emerald-400" />
                  {t('jobWorkspace.greetingConfirmTitle')}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-zinc-500">{t('jobWorkspace.greetingConfirmSubtitle')}</p>
              </div>
              <button
                type="button"
                onClick={() => setGreetingPreflight(null)}
                disabled={greetingPreparing}
                className="rounded border border-zinc-800 p-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
              >
                <X size={16} />
              </button>
            </div>
            <div className="space-y-4 overflow-y-auto px-5 py-4">
              <div className="grid gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 sm:grid-cols-2">
                <div>
                  <div className="text-[11px] text-zinc-500">{t('pipeline.company')}</div>
                  <div className="mt-1 text-sm font-medium text-zinc-100">{greetingPreflight.preview.company || '-'}</div>
                </div>
                <div>
                  <div className="text-[11px] text-zinc-500">{t('jobWorkspace.greetingTargetPosition')}</div>
                  <div className="mt-1 text-sm font-medium text-zinc-100">{greetingPreflight.preview.title || '-'}</div>
                </div>
                <div className="sm:col-span-2">
                  <div className="text-[11px] text-zinc-500">{t('jobWorkspace.greetingTargetUrl')}</div>
                  <div className="mt-1 break-all text-xs text-zinc-300">{greetingPreflight.preview.url}</div>
                </div>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between text-xs text-zinc-500">
                  <span>{t('jobWorkspace.greetingFinalMessage')}</span>
                  <span>{greetingPreflight.preview.messageLength} / 800</span>
                </div>
                <div className="whitespace-pre-wrap rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-6 text-zinc-200">
                  {greetingPreflight.preview.message}
                </div>
              </div>
              <div className="flex items-start gap-2 rounded-lg border border-amber-800/40 bg-amber-950/25 p-3 text-xs leading-relaxed text-amber-100">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                <span>{t('jobWorkspace.greetingSafetyNotice')}</span>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-zinc-800 px-5 py-4">
              <ActionButton onClick={() => setGreetingPreflight(null)} disabled={greetingPreparing}>
                {t('jobWorkspace.greetingCancel')}
              </ActionButton>
              <ActionButton onClick={() => { void confirmGreetingPrepare(); }} disabled={greetingPreparing} tone="emerald">
                {greetingPreparing ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
                {t('jobWorkspace.greetingConfirmOpen')}
              </ActionButton>
            </div>
          </div>
        </div>
      )}
      {selectedEvidence && (
        <EvidenceDetailDrawer
          evidence={selectedEvidence}
          overview={evidenceOverview}
          jobLabels={jobLabels}
          onClose={() => setSelectedEvidenceId('')}
        />
      )}
    </div>
  );
}
