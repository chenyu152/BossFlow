import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BookOpenCheck,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Filter,
  FolderKanban,
  GraduationCap,
  Layers3,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  X,
} from 'lucide-react';
import { useAppTranslation } from '../i18n';
import type {
  CapabilityImpactTier,
  CapabilityProfile,
  CapabilityStatus,
  EvidenceClassification,
  EvidenceItem,
  EvidenceItemInput,
  EvidenceMutationResponse,
  EvidenceOverviewResponse,
  EvidenceSourceRef,
  EvidenceTask,
  EvidenceTaskInput,
  EvidenceTaskStatus,
  ProficiencyLevel,
} from '../types';

type WorkspaceMode = 'abilities' | 'pending' | 'basics' | 'gaps' | 'plans';

type EvidenceDraft = {
  title: string;
  summary: string;
  sourceType: string;
  sourceRef: string;
  sourceQuote: string;
  tags: string;
};

const EMPTY_EVIDENCE_DRAFT: EvidenceDraft = {
  title: '',
  summary: '',
  sourceType: 'user_statement',
  sourceRef: '',
  sourceQuote: '',
  tags: '',
};

const IMPROVEMENT_TYPES = new Set(['learn', 'project', 'strengthen', 'translate']);
const PROFICIENCY_OPTIONS: ProficiencyLevel[] = ['awareness', 'familiar', 'working', 'proficient', 'expert'];

const statusIcons: Record<CapabilityStatus, typeof CheckCircle2> = {
  mastered: CheckCircle2,
  adjacent: Layers3,
  pending: CircleHelp,
  gap: Target,
};

const tierIcons: Record<CapabilityImpactTier, typeof TrendingUp> = {
  core: Sparkles,
  high_value: TrendingUp,
  common: Layers3,
  specialized: Target,
};

function splitTags(value: string) {
  return value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
}

function proficiencyLabel(level: ProficiencyLevel, isZh: boolean) {
  const labels: Record<ProficiencyLevel, [string, string]> = {
    unspecified: ['未说明', 'Not specified'],
    awareness: ['了解', 'Awareness'],
    familiar: ['熟悉', 'Familiar'],
    working: ['掌握', 'Working knowledge'],
    proficient: ['熟练', 'Proficient'],
    expert: ['精通', 'Expert'],
  };
  return labels[level]?.[isZh ? 0 : 1] || level;
}

function CapabilityCard({
  capability,
  copy,
  onOpen,
}: {
  capability: CapabilityProfile;
  copy: ReturnType<typeof createCopy>;
  onOpen: () => void;
}) {
  const StatusIcon = statusIcons[capability.status];
  const TierIcon = tierIcons[capability.impactTier];
  return (
    <button
      type="button"
      className={`capability-card capability-card--${capability.impactTier}`}
      onClick={onOpen}
    >
      <div className="capability-card__top">
        <span className={`capability-tier capability-tier--${capability.impactTier}`}>
          <TierIcon size={12} />
          {copy.tiers[capability.impactTier]}
        </span>
        <span className={`capability-status capability-status--${capability.status}`}>
          <StatusIcon size={12} />
          {copy.statuses[capability.status]}
        </span>
      </div>
      <div className="capability-card__body">
        <span className="capability-card__category">{copy.categories[capability.category] || capability.category}</span>
        <h3>{capability.label}</h3>
        <p>{copy.coverageSummary(capability.jobCount, capability.requiredCount, capability.preferredCount)}</p>
        {capability.proficiencyApplicable && (
          <div className="capability-card__proficiency">
            <span>{copy.myProficiency}</span>
            <strong>{proficiencyLabel(capability.userProficiency, copy.isZh)}</strong>
            <i />
            <span>{copy.jobRequires}</span>
            <strong>{proficiencyLabel(capability.highestRequiredProficiency, copy.isZh)}</strong>
          </div>
        )}
      </div>
      <div className="capability-card__metrics">
        <span><strong>{capability.jobCount}</strong>{copy.jobs}</span>
        <span><strong>{capability.evidenceCount}</strong>{copy.evidenceCount}</span>
        <span><strong>{capability.sourceCount}</strong>{copy.sources}</span>
      </div>
      <div className="capability-card__footer">
        <span>{capability.status === 'pending' ? copy.confirmCapability : capability.planIds.length ? copy.inPlan : copy.viewDetails}</span>
        <ChevronRight size={14} />
      </div>
    </button>
  );
}

function createCopy(isZh: boolean) {
  return isZh ? {
    isZh,
    eyebrow: '材料准备',
    title: '能力档案',
    description: '把岗位要求归一化为可复用能力，查看覆盖岗位、依据来源与提升价值。',
    refresh: '刷新',
    addEvidence: '新增能力依据',
    search: '搜索能力、要求或来源',
    all: '全部',
    abilities: '我的能力',
    pendingAbilities: '待确认',
    basics: '基础条件',
    gaps: '能力缺口',
    plans: '提升计划',
    mastered: '已掌握能力',
    pending: '待确认能力',
    gapCount: '已确认缺口',
    activePlans: '进行中计划',
    jobs: '岗位',
    evidenceCount: '项依据',
    sources: '个来源',
    inPlan: '已加入提升计划',
    viewDetails: '查看覆盖与依据',
    emptyAbilities: '当前还没有用户已确认的能力。你在岗位精评中确认后，会自动归入这里。',
    emptyPending: '当前没有等待你确认的能力。',
    emptyBasics: '尚未提取到学历、工作年限等基础条件。',
    emptyGaps: '暂无用户已确认的能力缺口。简历中未找到不等于用户没有，系统会先放入“待确认”。',
    emptyPlans: '尚未创建提升计划。请先查看能力缺口影响的岗位，再决定是否投入。',
    sampleHint: (count: number) => count >= 3
      ? `已基于 ${count} 个精评岗位聚合，适合用于比较能力影响范围。`
      : `当前只有 ${count} 个精评岗位，建议至少精评 3 个岗位后再判断学习优先级。`,
    statuses: {
      mastered: '已掌握',
      adjacent: '相近可迁移',
      pending: '待确认',
      gap: '已确认缺口',
    } as Record<CapabilityStatus, string>,
    tiers: {
      core: '核心',
      high_value: '高收益',
      common: '常见',
      specialized: '专项',
    } as Record<CapabilityImpactTier, string>,
    categories: {
      skill: '技能',
      experience: '经验',
      behavior: '行为能力',
      education: '学历',
      other: '其他',
      location: '城市约束',
      preference: '工作偏好',
    } as Record<string, string>,
    coverageSummary: (jobs: number, required: number, preferred: number) => `覆盖 ${jobs} 个岗位 · ${required} 个硬性要求 · ${preferred} 个加分项`,
    detailCoverage: '岗位覆盖',
    detailEvidence: '能力依据',
    requirementSource: '岗位要求来源',
    anyOfRequirement: '满足任一项即可',
    noEvidence: '还没有已保存的能力依据。',
    addForCapability: '为此能力补充依据',
    createPlan: '加入提升计划',
    planExists: '该能力已有进行中的提升计划',
    myProficiency: '我的熟练度',
    jobRequires: '岗位最高要求',
    confirmCapability: '确认这项能力',
    confirmStatus: '确认当前掌握情况',
    confirmStatusHint: '状态会复用于所有归属于同一原子能力的岗位要求。',
    confirmDecision: '保存确认',
    targetProficiency: '目标熟练度',
    proficiencyPath: '熟练度目标',
    sourceJob: '来源岗位',
    close: '关闭',
    required: '硬性要求',
    preferred: '加分项',
    context: '背景信息',
    planTitle: '创建提升计划',
    planType: '提升方式',
    learn: '系统学习',
    project: '项目实践',
    strengthen: '巩固并补充依据',
    timeBudget: '预计投入',
    oneToThreeDays: '1–3 天',
    oneToThreeWeeks: '1–3 周',
    longTerm: '长期持续',
    nextStep: '下一步',
    nextStepPlaceholder: '例如：完成一个可运行的 RAG 小项目',
    savePlan: '创建计划',
    cancel: '取消',
    planProgress: '当前进度',
    planStatus: '计划状态',
    pendingPlan: '待开始',
    inProgress: '进行中',
    completed: '已完成',
    dismissed: '已取消',
    progressNote: '进展记录',
    progressNotePlaceholder: '记录本次完成了什么、遇到什么问题',
    addNote: '添加记录',
    saveProgress: '保存进度',
    completionHint: '完成计划后请新增本次产生的项目、作品、证书或事实依据，系统会把它关联到对应能力。',
    evidenceModalTitle: '能力依据',
    linkCapability: '归属能力',
    selectCapability: '请选择该依据要证明的能力',
    evidenceTitle: '依据标题',
    evidenceSummary: '事实摘要',
    sourceType: '来源类型',
    sourceRef: '文件或位置',
    sourceQuote: '原文或说明',
    tags: '标签',
    saveEvidence: '保存并确认',
    editEvidence: '编辑依据',
    saveChanges: '保存修改',
    validationEvidence: '请选择归属能力，并填写标题、事实摘要和来源位置。',
    validationPlan: '请选择目标熟练度。',
    saved: '已保存',
    impactExplanation: '等级依据',
    impactText: (capability: CapabilityProfile) => `基于 ${capability.jobCount} 个岗位、${capability.requiredCount} 个硬性要求和 ${capability.preferredCount} 个加分项计算。颜色只辅助区分，实际依据以这些数字为准。`,
  } : {
    isZh,
    eyebrow: 'Prepare materials',
    title: 'Capability profile',
    description: 'Normalize job requirements into reusable capabilities and compare coverage, sources, and improvement value.',
    refresh: 'Refresh',
    addEvidence: 'Add capability evidence',
    search: 'Search capabilities, requirements, or sources',
    all: 'All',
    abilities: 'My capabilities',
    pendingAbilities: 'To confirm',
    basics: 'Baseline conditions',
    gaps: 'Capability gaps',
    plans: 'Improvement plans',
    mastered: 'Mastered',
    pending: 'Needs confirmation',
    gapCount: 'Confirmed gaps',
    activePlans: 'Active plans',
    jobs: 'jobs',
    evidenceCount: 'evidence',
    sources: 'sources',
    inPlan: 'In an improvement plan',
    viewDetails: 'View coverage and evidence',
    emptyAbilities: 'No user-confirmed capability is available in this scope yet.',
    emptyPending: 'No capability is waiting for confirmation.',
    emptyBasics: 'No baseline conditions have been extracted yet.',
    emptyGaps: 'No user-confirmed gaps. Missing resume evidence stays under To confirm.',
    emptyPlans: 'No improvement plans yet. Review cross-job impact before deciding what to learn.',
    sampleHint: (count: number) => count >= 3
      ? `Aggregated from ${count} fine-reviewed jobs.`
      : `Only ${count} fine-reviewed jobs. Review at least 3 before prioritizing learning.`,
    statuses: { mastered: 'Mastered', adjacent: 'Transferable', pending: 'Needs confirmation', gap: 'Confirmed gap' } as Record<CapabilityStatus, string>,
    tiers: { core: 'Core', high_value: 'High value', common: 'Common', specialized: 'Specialized' } as Record<CapabilityImpactTier, string>,
    categories: { skill: 'Skill', experience: 'Experience', behavior: 'Behavior', education: 'Education', other: 'Other', location: 'Location', preference: 'Preference' } as Record<string, string>,
    coverageSummary: (jobs: number, required: number, preferred: number) => `${jobs} jobs · ${required} required · ${preferred} preferred`,
    detailCoverage: 'Job coverage',
    detailEvidence: 'Capability evidence',
    requirementSource: 'Requirement sources',
    anyOfRequirement: 'Any one option satisfies this requirement',
    noEvidence: 'No saved evidence yet.',
    addForCapability: 'Add evidence for this capability',
    createPlan: 'Add to improvement plans',
    planExists: 'An active plan already exists',
    myProficiency: 'My proficiency',
    jobRequires: 'Highest job requirement',
    confirmCapability: 'Confirm this capability',
    confirmStatus: 'Confirm current capability',
    confirmStatusHint: 'This decision is reused for all requirements mapped to the same atomic capability.',
    confirmDecision: 'Save confirmation',
    targetProficiency: 'Target proficiency',
    proficiencyPath: 'Proficiency target',
    sourceJob: 'Source job',
    close: 'Close',
    required: 'Required',
    preferred: 'Preferred',
    context: 'Context',
    planTitle: 'Create improvement plan',
    planType: 'Plan type',
    learn: 'Structured learning',
    project: 'Project practice',
    strengthen: 'Strengthen evidence',
    timeBudget: 'Estimated effort',
    oneToThreeDays: '1–3 days',
    oneToThreeWeeks: '1–3 weeks',
    longTerm: 'Long term',
    nextStep: 'Next step',
    nextStepPlaceholder: 'For example: complete a runnable RAG project',
    savePlan: 'Create plan',
    cancel: 'Cancel',
    planProgress: 'Progress',
    planStatus: 'Status',
    pendingPlan: 'Not started',
    inProgress: 'In progress',
    completed: 'Completed',
    dismissed: 'Cancelled',
    progressNote: 'Progress log',
    progressNotePlaceholder: 'Record what you completed and what blocked you',
    addNote: 'Add note',
    saveProgress: 'Save progress',
    completionHint: 'When the plan is complete, add the project, artifact, certificate, or fact it produced.',
    evidenceModalTitle: 'Capability evidence',
    linkCapability: 'Capability',
    selectCapability: 'Select the capability this evidence supports',
    evidenceTitle: 'Title',
    evidenceSummary: 'Fact summary',
    sourceType: 'Source type',
    sourceRef: 'File or location',
    sourceQuote: 'Excerpt or explanation',
    tags: 'Tags',
    saveEvidence: 'Save and confirm',
    editEvidence: 'Edit evidence',
    saveChanges: 'Save changes',
    validationEvidence: 'Select a capability and enter a title, fact summary, and source location.',
    validationPlan: 'Select a target proficiency.',
    saved: 'Saved',
    impactExplanation: 'Why this tier',
    impactText: (capability: CapabilityProfile) => `Based on ${capability.jobCount} jobs, ${capability.requiredCount} required items, and ${capability.preferredCount} preferred items.`,
  };
}

export function Evidence({
  overview,
  loading,
  error,
  onRefresh,
  onCreateEvidenceItem,
  onUpdateEvidenceItem,
  onConfirmEvidenceItem,
  onClassifyEvidenceCoverage,
  onCreateEvidenceTask,
  onUpdateEvidenceTask,
  targetTaskId,
  targetRequestId,
}: {
  overview: EvidenceOverviewResponse | null;
  loading: boolean;
  error: string;
  onRefresh: () => void;
  onCreateEvidenceItem: (item: EvidenceItemInput) => Promise<EvidenceMutationResponse | null>;
  onUpdateEvidenceItem: (item: EvidenceItem) => Promise<EvidenceMutationResponse | null>;
  onConfirmEvidenceItem: (evidenceId: string) => Promise<EvidenceMutationResponse | null>;
  onClassifyEvidenceCoverage: (
    requirementId: string,
    classification: EvidenceClassification,
    evidenceIds?: string[],
    rationale?: string,
    confidence?: number,
    userProficiency?: ProficiencyLevel,
  ) => Promise<EvidenceMutationResponse | null>;
  onCreateEvidenceTask: (task: EvidenceTaskInput) => Promise<EvidenceMutationResponse | null>;
  onUpdateEvidenceTask: (
    taskId: string,
    status: EvidenceTaskStatus,
    completionEvidenceIds?: string[],
    progressPercent?: number,
    nextStep?: string,
    progressNotes?: string[],
    currentProficiency?: ProficiencyLevel,
    targetProficiency?: ProficiencyLevel,
  ) => Promise<EvidenceMutationResponse | null>;
  targetTaskId?: string;
  targetRequestId?: number;
}) {
  const { i18n } = useAppTranslation();
  const isZh = (i18n.resolvedLanguage || i18n.language).startsWith('zh');
  const copy = useMemo(() => createCopy(isZh), [isZh]);
  const [mode, setMode] = useState<WorkspaceMode>('abilities');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | CapabilityStatus>('all');
  const [selectedCapabilityId, setSelectedCapabilityId] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [planType, setPlanType] = useState<'learn' | 'project' | 'strengthen'>('learn');
  const [timeBudget, setTimeBudget] = useState('1_3_weeks');
  const [targetProficiency, setTargetProficiency] = useState<ProficiencyLevel>('working');
  const [decisionChoice, setDecisionChoice] = useState<EvidenceClassification>('unsure');
  const [decisionProficiency, setDecisionProficiency] = useState<ProficiencyLevel>('working');
  const [evidenceModal, setEvidenceModal] = useState<{ capabilityId?: string; evidenceId?: string } | null>(null);
  const [evidenceCapabilityId, setEvidenceCapabilityId] = useState('');
  const [evidenceDraft, setEvidenceDraft] = useState<EvidenceDraft>(EMPTY_EVIDENCE_DRAFT);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');

  const capabilities = overview?.capabilities || [];
  const evidenceItems = overview?.evidenceItems || [];
  const tasks = (overview?.tasks || []).filter((task) => IMPROVEMENT_TYPES.has(task.taskType));
  const evidenceById = useMemo(() => new Map(evidenceItems.map((item) => [item.evidenceId, item])), [evidenceItems]);
  const capabilityById = useMemo(() => new Map(capabilities.map((item) => [item.capabilityId, item])), [capabilities]);
  const selectedCapability = capabilityById.get(selectedCapabilityId) || null;
  const reviewedJobCount = useMemo(
    () => new Set(capabilities.flatMap((capability) => capability.sourceKeys)).size,
    [capabilities],
  );

  const visibleCapabilities = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return capabilities.filter((capability) => {
      if (mode === 'basics' && capability.actionability !== 'basic') return false;
      if (mode === 'gaps' && (capability.actionability !== 'developable' || capability.status !== 'gap')) return false;
      if (mode === 'pending' && (capability.actionability !== 'developable' || capability.status !== 'pending')) return false;
      if (
        mode === 'abilities'
        && (
          capability.actionability !== 'developable'
          || !['mastered', 'adjacent'].includes(capability.status)
        )
      ) return false;
      if (statusFilter !== 'all' && capability.status !== statusFilter) return false;
      if (!needle) return true;
      return [
        capability.label,
        capability.canonicalKey,
        ...capability.requirements.flatMap((item) => [item.label, item.jdQuote, item.sourceKey]),
      ].join(' ').toLocaleLowerCase().includes(needle);
    });
  }, [capabilities, mode, query, statusFilter]);

  useEffect(() => {
    if (!targetTaskId) return;
    setMode('plans');
    setSelectedTaskId(targetTaskId);
  }, [targetRequestId, targetTaskId]);

  const openCapability = (capability: CapabilityProfile) => {
    setSelectedCapabilityId(capability.capabilityId);
    setShowPlanForm(false);
    setDecisionChoice(
      capability.status === 'mastered' ? 'done'
        : capability.status === 'adjacent' ? 'adjacent'
          : capability.status === 'gap' ? 'not_done'
            : 'unsure',
    );
    setDecisionProficiency(
      capability.userProficiency !== 'unspecified'
        ? capability.userProficiency
        : capability.highestRequiredProficiency !== 'unspecified'
          ? capability.highestRequiredProficiency
          : 'working',
    );
    setTargetProficiency(
      capability.highestRequiredProficiency !== 'unspecified'
        ? capability.highestRequiredProficiency
        : 'working',
    );
    setFeedback('');
  };

  const openNewEvidence = (capability?: CapabilityProfile) => {
    setEvidenceDraft({
      ...EMPTY_EVIDENCE_DRAFT,
      title: capability?.label || '',
      tags: capability?.canonicalKey || '',
    });
    setEvidenceModal({ capabilityId: capability?.capabilityId });
    setEvidenceCapabilityId(capability?.capabilityId || '');
    setFeedback('');
  };

  const openEvidenceEdit = (item: EvidenceItem) => {
    const source = item.sourceRefs?.[0] || { type: 'user_statement', ref: '', quote: '' };
    setEvidenceDraft({
      title: item.title,
      summary: item.summary,
      sourceType: source.type,
      sourceRef: source.ref,
      sourceQuote: source.quote,
      tags: item.tags.join(', '),
    });
    setEvidenceModal({ evidenceId: item.evidenceId });
    setEvidenceCapabilityId('');
    setFeedback('');
  };

  const saveEvidence = async () => {
    if (
      !evidenceDraft.title.trim()
      || !evidenceDraft.summary.trim()
      || !evidenceDraft.sourceRef.trim()
      || (!evidenceModal?.evidenceId && !evidenceCapabilityId)
    ) {
      setFeedback(copy.validationEvidence);
      return;
    }
    setBusy(true);
    try {
      const sourceRefs: EvidenceSourceRef[] = [{
        type: evidenceDraft.sourceType.trim() || 'user_statement',
        ref: evidenceDraft.sourceRef.trim(),
        quote: evidenceDraft.sourceQuote.trim() || evidenceDraft.summary.trim(),
      }];
      if (evidenceModal?.evidenceId) {
        const current = evidenceById.get(evidenceModal.evidenceId);
        if (!current) return;
        await onUpdateEvidenceItem({
          ...current,
          title: evidenceDraft.title.trim(),
          summary: evidenceDraft.summary.trim(),
          sourceRefs,
          tags: splitTags(evidenceDraft.tags),
        });
      } else {
        const capability = capabilityById.get(evidenceCapabilityId) || null;
        const result = await onCreateEvidenceItem({
          title: evidenceDraft.title.trim(),
          evidenceType: 'fact',
          summary: evidenceDraft.summary.trim(),
          userRole: '',
          actions: [],
          results: [],
          sourceRefs,
          tags: splitTags(evidenceDraft.tags),
          requirementIds: capability?.requirementIds || [],
        });
        if (result?.item && capability?.requirementIds[0]) {
          await onClassifyEvidenceCoverage(
            capability.requirementIds[0],
            'done',
            [result.item.evidenceId],
            isZh ? '用户在能力档案中补充并确认了能力依据' : 'User added and confirmed capability evidence',
            1,
          );
          await onConfirmEvidenceItem(result.item.evidenceId);
        }
      }
      setEvidenceModal(null);
      setFeedback(copy.saved);
    } finally {
      setBusy(false);
    }
  };

  const createPlan = async () => {
    if (!selectedCapability || !selectedCapability.requirementIds[0]) {
      setFeedback(copy.validationPlan);
      return;
    }
    const currentLevel = selectedCapability.userProficiency;
    const recommendedAction = isZh
      ? `将${selectedCapability.label}从“${proficiencyLabel(currentLevel, true)}”提升到“${proficiencyLabel(targetProficiency, true)}”`
      : `Raise ${selectedCapability.label} from ${proficiencyLabel(currentLevel, false)} to ${proficiencyLabel(targetProficiency, false)}`;
    setBusy(true);
    try {
      const result = await onCreateEvidenceTask({
        requirementId: selectedCapability.requirementIds[0],
        taskType: planType,
        affectedSourceKeys: selectedCapability.sourceKeys,
        recommendedAction,
        estimatedEffortBand: timeBudget,
        timeBudget,
        userWillingness: 'yes',
        priorityBand: selectedCapability.impactTier === 'core' ? 'high' : selectedCapability.impactTier === 'high_value' ? 'medium' : 'low',
        status: 'pending',
        completionEvidenceIds: [],
        progressPercent: 0,
        nextStep: '',
        progressNotes: [],
        currentProficiency: currentLevel,
        targetProficiency,
      });
      if (result?.task) {
        setSelectedTaskId(result.task.taskId);
        setSelectedCapabilityId('');
        setMode('plans');
      }
      setShowPlanForm(false);
    } finally {
      setBusy(false);
    }
  };

  const confirmCapabilityDecision = async () => {
    if (!selectedCapability?.requirementIds[0]) return;
    setBusy(true);
    try {
      await onClassifyEvidenceCoverage(
        selectedCapability.requirementIds[0],
        decisionChoice,
        [],
        isZh ? '用户在能力档案中确认了当前掌握情况' : 'User confirmed the current capability state in Capability Profile',
        1,
        selectedCapability.proficiencyApplicable && (decisionChoice === 'done' || decisionChoice === 'adjacent')
          ? decisionProficiency
          : 'unspecified',
      );
      setFeedback(copy.saved);
      setSelectedCapabilityId('');
    } finally {
      setBusy(false);
    }
  };

  const updatePlanStatus = async (task: EvidenceTask, status: EvidenceTaskStatus) => {
    setBusy(true);
    try {
      await onUpdateEvidenceTask(
        task.taskId,
        status,
        task.completionEvidenceIds,
        status === 'completed' ? 100 : task.progressPercent,
        task.nextStep,
        task.progressNotes,
        task.currentProficiency,
        task.targetProficiency,
      );
      setFeedback(copy.saved);
    } finally {
      setBusy(false);
    }
  };

  const counts = overview?.counts;
  const confirmedAbilityCount = capabilities.filter(
    (capability) => capability.actionability === 'developable' && ['mastered', 'adjacent'].includes(capability.status),
  ).length;
  const pendingAbilityCount = capabilities.filter(
    (capability) => capability.actionability === 'developable' && capability.status === 'pending',
  ).length;
  const navItems: Array<{ key: WorkspaceMode; label: string; count: number; icon: typeof ShieldCheck }> = [
    { key: 'abilities', label: copy.abilities, count: confirmedAbilityCount, icon: ShieldCheck },
    { key: 'pending', label: copy.pendingAbilities, count: pendingAbilityCount, icon: CircleHelp },
    { key: 'basics', label: copy.basics, count: counts?.basicConditions || 0, icon: GraduationCap },
    { key: 'gaps', label: copy.gaps, count: counts?.gapCapabilities || 0, icon: Target },
    { key: 'plans', label: copy.plans, count: counts?.activePlans || 0, icon: BookOpenCheck },
  ];

  return (
    <div className="capability-page">
      <header className="capability-page__header">
        <div>
          <div className="capability-page__eyebrow"><ShieldCheck size={15} />{copy.eyebrow}</div>
          <h1>{copy.title}</h1>
          <p>{copy.description}</p>
        </div>
        <div className="capability-page__header-actions">
          <button type="button" className="evidence-button evidence-button--secondary" onClick={onRefresh} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />{copy.refresh}
          </button>
          <button type="button" className="evidence-button evidence-button--primary" onClick={() => openNewEvidence()}>
            <Plus size={15} />{copy.addEvidence}
          </button>
        </div>
      </header>

      <div className="capability-sample-hint"><TrendingUp size={15} /><span>{copy.sampleHint(reviewedJobCount)}</span></div>
      {error && <div className="evidence-page__error">{error}</div>}

      <section className="capability-workspace">
        <nav className="capability-nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                type="button"
                key={item.key}
                className={mode === item.key ? 'is-active' : ''}
                onClick={() => { setMode(item.key); setSelectedTaskId(''); setStatusFilter('all'); }}
              >
                <Icon size={15} /><span>{item.label}</span><strong>{item.count}</strong>
              </button>
            );
          })}
        </nav>

        <div className="capability-toolbar">
          <label className="capability-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.search} /></label>
          {mode !== 'plans' && (
            <label className="capability-filter"><Filter size={14} />
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | CapabilityStatus)}>
                <option value="all">{copy.all}</option>
                <option value="mastered">{copy.statuses.mastered}</option>
                <option value="adjacent">{copy.statuses.adjacent}</option>
                <option value="pending">{copy.statuses.pending}</option>
                <option value="gap">{copy.statuses.gap}</option>
              </select>
            </label>
          )}
        </div>

        <div className="capability-content">
          {mode !== 'plans' ? (
            visibleCapabilities.length ? (
              <div className="capability-grid">
                {visibleCapabilities.map((capability) => (
                  <CapabilityCard key={capability.capabilityId} capability={capability} copy={copy} onOpen={() => openCapability(capability)} />
                ))}
              </div>
            ) : (
              <div className="capability-empty">
                {loading ? <Loader2 size={22} className="animate-spin" /> : mode === 'basics' ? <GraduationCap size={28} /> : mode === 'gaps' ? <Target size={28} /> : mode === 'pending' ? <CircleHelp size={28} /> : <ShieldCheck size={28} />}
                <p>{mode === 'basics' ? copy.emptyBasics : mode === 'gaps' ? copy.emptyGaps : mode === 'pending' ? copy.emptyPending : copy.emptyAbilities}</p>
              </div>
            )
          ) : (
            tasks.length ? (
              <div className="plan-card-grid">
                {tasks.map((task) => {
                  const capability = capabilities.find((item) => item.requirementIds.includes(task.requirementId));
                  return (
                    <article key={task.taskId} className={`plan-summary-card${selectedTaskId === task.taskId ? ' is-active' : ''}`}>
                      <header>
                        <span className={`evidence-status evidence-status--${task.status}`}>{task.status === 'in_progress' ? copy.inProgress : task.status === 'completed' ? copy.completed : task.status === 'dismissed' ? copy.dismissed : copy.pendingPlan}</span>
                        <span className={`capability-tier capability-tier--${capability?.impactTier || 'specialized'}`}>{capability ? copy.tiers[capability.impactTier] : ''}</span>
                      </header>
                      <h3>{capability?.label || task.requirementId}</h3>
                      <p>{task.recommendedAction}</p>
                      <div className="plan-summary-card__levels">
                        <span>{copy.proficiencyPath}</span>
                        <strong>{proficiencyLabel(task.currentProficiency || 'unspecified', isZh)}</strong>
                        <ArrowRight size={14} />
                        <strong>{proficiencyLabel(task.targetProficiency || 'working', isZh)}</strong>
                      </div>
                      <footer>
                        <span>{task.affectedSourceKeys.length} {copy.jobs} · {task.timeBudget === '1_3_days' ? copy.oneToThreeDays : task.timeBudget === 'long_term' ? copy.longTerm : copy.oneToThreeWeeks}</span>
                        <select
                          value={task.status}
                          disabled={busy}
                          aria-label={copy.planStatus}
                          onChange={(event) => void updatePlanStatus(task, event.target.value as EvidenceTaskStatus)}
                        >
                          <option value="pending">{copy.pendingPlan}</option>
                          <option value="in_progress">{copy.inProgress}</option>
                          <option value="completed">{copy.completed}</option>
                          <option value="dismissed">{copy.dismissed}</option>
                        </select>
                      </footer>
                    </article>
                  );
                })}
              </div>
            ) : <div className="capability-empty"><BookOpenCheck size={28} /><p>{copy.emptyPlans}</p></div>
          )}
        </div>
      </section>

      {selectedCapability && (
        <div className="capability-modal-backdrop" onClick={() => setSelectedCapabilityId('')}>
          <article className="capability-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <div className="capability-modal__badges">
                  <span className={`capability-tier capability-tier--${selectedCapability.impactTier}`}>{copy.tiers[selectedCapability.impactTier]}</span>
                  <span className={`capability-status capability-status--${selectedCapability.status}`}>{copy.statuses[selectedCapability.status]}</span>
                </div>
                <h2>{selectedCapability.label}</h2>
                <p>{copy.coverageSummary(selectedCapability.jobCount, selectedCapability.requiredCount, selectedCapability.preferredCount)}</p>
              </div>
              <button type="button" aria-label={copy.close} onClick={() => setSelectedCapabilityId('')}><X size={18} /></button>
            </header>
            <div className="capability-modal__content">
              <section className="capability-impact">
                <div><TrendingUp size={16} /><strong>{copy.impactExplanation}</strong></div>
                <p>{copy.impactText(selectedCapability)}</p>
              </section>
              {selectedCapability.actionability === 'developable' && (
                <section className="capability-decision-panel">
                  <div className="capability-section-heading">
                    <div><CircleHelp size={16} /><strong>{copy.confirmStatus}</strong></div>
                  </div>
                  <p>{copy.confirmStatusHint}</p>
                  <div className="capability-decision-panel__choices">
                    {([
                      ['done', copy.statuses.mastered],
                      ['adjacent', copy.statuses.adjacent],
                      ['not_done', copy.statuses.gap],
                      ['unsure', copy.statuses.pending],
                    ] as Array<[EvidenceClassification, string]>).map(([value, label]) => (
                      <button
                        type="button"
                        key={value}
                        className={decisionChoice === value ? 'is-active' : ''}
                        onClick={() => setDecisionChoice(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {selectedCapability.proficiencyApplicable && (decisionChoice === 'done' || decisionChoice === 'adjacent') && (
                    <label className="capability-decision-panel__level">
                      <span>{copy.myProficiency}</span>
                      <select value={decisionProficiency} onChange={(event) => setDecisionProficiency(event.target.value as ProficiencyLevel)}>
                        {PROFICIENCY_OPTIONS.map((level) => <option key={level} value={level}>{proficiencyLabel(level, isZh)}</option>)}
                      </select>
                      <small>{copy.jobRequires}：{proficiencyLabel(selectedCapability.highestRequiredProficiency, isZh)}</small>
                    </label>
                  )}
                  <div className="capability-decision-panel__footer">
                    <span>{feedback}</span>
                    <button type="button" className="evidence-button evidence-button--primary" disabled={busy} onClick={() => void confirmCapabilityDecision()}>
                      {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}{copy.confirmDecision}
                    </button>
                  </div>
                </section>
              )}
              <section>
                <div className="capability-section-heading"><div><FolderKanban size={16} /><strong>{copy.detailEvidence}</strong><span>{selectedCapability.evidenceCount}</span></div><button type="button" onClick={() => openNewEvidence(selectedCapability)}><Plus size={14} />{copy.addForCapability}</button></div>
                <div className="capability-evidence-list">
                  {selectedCapability.evidenceIds.length ? selectedCapability.evidenceIds.map((evidenceId) => {
                    const item = evidenceById.get(evidenceId);
                    if (!item) return null;
                    return <button type="button" key={evidenceId} onClick={() => openEvidenceEdit(item)}><div><strong>{item.title}</strong><span>{item.status === 'confirmed' ? copy.statuses.mastered : item.status}</span></div><p>{item.summary}</p><footer>{item.sourceRefs.slice(0, 2).map((source) => source.ref).filter(Boolean).join(' · ')}</footer></button>;
                  }) : <p className="capability-section-empty">{copy.noEvidence}</p>}
                </div>
              </section>
              <section>
                <div className="capability-section-heading"><div><Target size={16} /><strong>{copy.requirementSource}</strong><span>{selectedCapability.requirements.length}</span></div></div>
                <div className="capability-requirement-list">
                  {selectedCapability.requirements.map((requirement) => (
                    <div key={requirement.requirementId}>
                      <span className={`requirement-importance requirement-importance--${requirement.importance}`}>{copy[requirement.importance]}</span>
                      <div>
                        <strong>{requirement.label}</strong>
                        <p>{requirement.jdQuote || '-'}</p>
                        <small>
                          {copy.sourceJob}：{requirement.sourceLabel || requirement.jobTitle || (isZh ? '岗位信息已失效' : 'Job metadata unavailable')}
                          {requirement.requirementGroupMode === 'any_of' && (
                            <>{' · '}{copy.anyOfRequirement}</>
                          )}
                          {requirement.proficiencyApplicable && (
                            <>{' · '}{copy.jobRequires}：{proficiencyLabel(requirement.requiredProficiency || 'unspecified', isZh)}</>
                          )}
                        </small>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
              {selectedCapability.status === 'gap' && selectedCapability.actionability === 'developable' && (
                <section className="capability-plan-entry">
                  {!showPlanForm ? (
                    <div><div><BookOpenCheck size={17} /><span>{selectedCapability.planIds.length ? copy.planExists : copy.createPlan}</span></div>{!selectedCapability.planIds.length && <button type="button" className="evidence-button evidence-button--primary" onClick={() => setShowPlanForm(true)}><Plus size={15} />{copy.createPlan}</button>}</div>
                  ) : (
                    <div className="capability-plan-form">
                      <h3>{copy.planTitle}</h3>
                      <div>
                        <label><span>{copy.planType}</span><select value={planType} onChange={(event) => setPlanType(event.target.value as typeof planType)}><option value="learn">{copy.learn}</option><option value="project">{copy.project}</option><option value="strengthen">{copy.strengthen}</option></select></label>
                        <label><span>{copy.timeBudget}</span><select value={timeBudget} onChange={(event) => setTimeBudget(event.target.value)}><option value="1_3_days">{copy.oneToThreeDays}</option><option value="1_3_weeks">{copy.oneToThreeWeeks}</option><option value="long_term">{copy.longTerm}</option></select></label>
                        <label className="is-wide"><span>{copy.targetProficiency}</span><select value={targetProficiency} onChange={(event) => setTargetProficiency(event.target.value as ProficiencyLevel)}>{PROFICIENCY_OPTIONS.map((level) => <option key={level} value={level}>{proficiencyLabel(level, isZh)}</option>)}</select></label>
                      </div>
                      {feedback && <p>{feedback}</p>}
                      <footer><button type="button" className="evidence-button evidence-button--secondary" onClick={() => setShowPlanForm(false)}>{copy.cancel}</button><button type="button" className="evidence-button evidence-button--primary" onClick={() => void createPlan()} disabled={busy}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}{copy.savePlan}</button></footer>
                    </div>
                  )}
                </section>
              )}
            </div>
          </article>
        </div>
      )}

      {evidenceModal && (
        <div className="capability-modal-backdrop capability-modal-backdrop--front" onClick={() => setEvidenceModal(null)}>
          <article className="evidence-compact-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header><div><span>{copy.evidenceModalTitle}</span><h2>{evidenceModal.evidenceId ? copy.editEvidence : copy.addEvidence}</h2></div><button type="button" onClick={() => setEvidenceModal(null)}><X size={18} /></button></header>
            <div className="evidence-compact-form">
              {!evidenceModal.evidenceId && (
                <label>
                  <span>{copy.linkCapability}</span>
                  <select value={evidenceCapabilityId} onChange={(event) => setEvidenceCapabilityId(event.target.value)}>
                    <option value="">{copy.selectCapability}</option>
                    {capabilities.map((capability) => (
                      <option key={capability.capabilityId} value={capability.capabilityId}>
                        {capability.label} · {copy.statuses[capability.status]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label><span>{copy.evidenceTitle}</span><input value={evidenceDraft.title} onChange={(event) => setEvidenceDraft((current) => ({ ...current, title: event.target.value }))} /></label>
              <label><span>{copy.evidenceSummary}</span><textarea rows={4} value={evidenceDraft.summary} onChange={(event) => setEvidenceDraft((current) => ({ ...current, summary: event.target.value }))} /></label>
              <div>
                <label><span>{copy.sourceType}</span><input value={evidenceDraft.sourceType} onChange={(event) => setEvidenceDraft((current) => ({ ...current, sourceType: event.target.value }))} /></label>
                <label><span>{copy.sourceRef}</span><input value={evidenceDraft.sourceRef} onChange={(event) => setEvidenceDraft((current) => ({ ...current, sourceRef: event.target.value }))} /></label>
              </div>
              <label><span>{copy.sourceQuote}</span><textarea rows={3} value={evidenceDraft.sourceQuote} onChange={(event) => setEvidenceDraft((current) => ({ ...current, sourceQuote: event.target.value }))} /></label>
              <label><span>{copy.tags}</span><input value={evidenceDraft.tags} onChange={(event) => setEvidenceDraft((current) => ({ ...current, tags: event.target.value }))} /></label>
              {feedback && <p>{feedback}</p>}
            </div>
            <footer><button type="button" className="evidence-button evidence-button--secondary" onClick={() => setEvidenceModal(null)}>{copy.cancel}</button><button type="button" className="evidence-button evidence-button--primary" onClick={() => void saveEvidence()} disabled={busy}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}{evidenceModal.evidenceId ? copy.saveChanges : copy.saveEvidence}</button></footer>
          </article>
        </div>
      )}
    </div>
  );
}
