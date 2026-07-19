export type Tab = 'Dashboard' | 'Scope' | 'MatchingRules' | 'ScoringRules' | 'Jobs' | 'Pipeline' | 'Evidence' | 'PersonalResume' | 'Resume' | 'Story' | 'Interview' | 'Logs' | 'Settings';

export type LlmSettingsStatus = {
  configured: boolean;
  apiKeyMasked: string;
  apiBase: string;
  model: string;
  source: 'environment' | 'settings-file';
};

export type AutomationCadence = 'daily' | 'weekdays' | 'weekly';
export type AutomationMisfirePolicy = 'run_once' | 'skip';
export type AutomationRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'missed' | 'interrupted' | 'cancelled';

export type AutomationScheduleInput = {
  project: string;
  enabled: boolean;
  cadence: AutomationCadence;
  timeOfDay: string;
  daysOfWeek: number[];
  misfirePolicy: AutomationMisfirePolicy;
  maxDelayMinutes: number;
  keywordsText: string;
  citiesText: string;
  newJobTarget: number;
  maxJobs: number;
};

export type AutomationSchedule = AutomationScheduleInput & {
  id: string;
  nextRunAt: string;
  lastRunStatus: AutomationRunStatus | '';
  lastRunAt: string;
  createdAt: string;
  updatedAt: string;
  keywordCount: number;
  cityCount: number;
  combinationCount: number;
  estimatedListedJobs: number;
  estimatedDetailJobs: number;
  estimatedReusedJobs: number;
  estimatedStopCondition: 'new_job_target' | 'max_jobs';
  estimatedMinutes: number;
  estimatedRangeMinutes: [number, number];
};

export type AutomationRun = {
  id: string;
  scheduleId: string;
  project: string;
  trigger: 'schedule' | 'manual';
  scheduledFor: string;
  status: AutomationRunStatus;
  createdAt: string;
  startedAt: string;
  finishedAt: string;
  error: string;
};

export type AutomationResponse = {
  ok: boolean;
  schedules: AutomationSchedule[];
  runs: AutomationRun[];
  queue: {
    queued: number;
    running: number;
    serial: boolean;
    schedulerRunning: boolean;
    lastError: string;
  };
  limits: {
    maxSchedules: number;
    recommendedDailyMinutes: number;
  };
};

export type LoginState = {
  project: string;
  status: 'missing' | 'expired' | 'refresh_recommended' | 'available';
  canSchedule: boolean;
  hasCookieDatabase: boolean;
  authCookieCount: number;
  verifiedByLiveSession?: boolean;
  lastSavedAt: string;
  daysSinceSaved: number | null;
  earliestClientExpiryAt: string;
  refreshRecommendedAfterDays: number;
  message: string;
  validityNote: string;
};

export type DesktopSettings = {
  supported: boolean;
  openAtLogin: boolean;
  startMinimized: boolean;
  keepRunningInTray: boolean;
};

export type AgentMcpConfig = {
  type: 'stdio' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
};

export type McpServerInfo = {
  name: string;
  status: 'running' | 'unavailable' | 'disabled';
  transport: string;
  endpoint: string;
  toolCount: number;
  resourceCount: number;
};

export type AgentAccess = {
  supported: boolean;
  server: McpServerInfo;
  endpoint: string;
  connectionFile: string;
  stdioConfig: AgentMcpConfig | null;
  httpConfig: AgentMcpConfig | null;
};

export type Status = 'ready' | 'crawling' | 'login' | 'processing-partial' | 'live-status' | 'stopping' | 'failed';

export type ConfigPayload = {
  ok: boolean;
  project: string;
  configPath: string;
  dbPath: string;
  partialPath: string;
  profilePath: string;
  keywordsText: string;
  citiesText: string;
  catRulesText: string;
  scoringRulesText: string;
  relevanceText: string;
  blacklistText: string;
  newJobTarget: number;
  maxJobs: number;
  minSalary: number;
  headlessMode: boolean;
  autoSqlite: boolean;
  jobCount: number;
  keywordCount: number;
  cityCount: number;
  dbFileName: string;
  dbFilePath: string;
};

export type ProjectTemplateSeed = Pick<ConfigPayload, 'keywordsText' | 'citiesText' | 'catRulesText' | 'relevanceText' | 'blacklistText'> & {
  scoringKeywords: string[];
};

export type Job = {
  id: number;
  title: string;
  company: string;
  city: string;
  salary: string;
  avg: number;
  tier: string;
  exp: string;
  edu: string;
  cats: string[];
  desc: string;
  url: string;
  firstSeen: string;
  lastSeen: string;
  liveStatus?: 'open' | 'closed' | 'unknown' | '';
  liveStatusRaw?: string;
  liveCheckedAt?: string;
  liveClosedAt?: string;
  liveCheckError?: string;
  recruitmentObservationStatus?:
    | 'not_checked'
    | 'open_observed'
    | 'closed_observed'
    | 'unknown_observed'
    | 'login_required'
    | 'verification_required'
    | 'security_check'
    | '';
  recruitmentObservationRaw?: string;
  recruitmentObservedAt?: string;
  score?: number | null;
  fitLevel?: string;
  coverage?: number | null;
  jdQuality?: number | null;
  salarySignal?: number | null;
  experienceSignal?: number | null;
  experienceRisk?: string;
  experienceLabel?: string;
  candidateYears?: number | null;
  requiredYears?: number | null;
  educationSignal?: number | null;
  educationRisk?: string;
  candidateEducation?: string;
  requiredEducation?: string;
  matchedTerms?: string[];
  missingTerms?: string[];
  scoredAt?: string;
};

export type DecisionStatus =
  | 'needs_llm'
  | 'needs_review'
  | 'ready_to_greet'
  | 'greeted'
  | 'interviewing'
  | 'skipped'
  | 'archived';

export type ParsedLog = {
  time: string;
  level: 'info' | 'warn' | 'error';
  msg: string;
  raw: string;
};

export type ProjectListResponse = {
  projects: string[];
  defaultProject: string;
};

export type JobsResponse = {
  items: Job[];
  total: number;
};

export type PipelineItem = {
  status: 'pending' | 'processed';
  company: string;
  title: string;
  city: string;
  salary: string;
  url: string;
  project: string;
  jobId: number | null;
  avg: number | null;
  addedAt: string;
  sourceKey: string;
  score: number | null;
  fitLevel: string;
  coverage: number | null;
  jdQuality: number | null;
  salarySignal: number | null;
  experienceSignal: number | null;
  experienceRisk: string;
  experienceLabel: string;
  candidateYears: number | null;
  requiredYears: number | null;
  educationSignal: number | null;
  educationRisk: string;
  candidateEducation: string;
  requiredEducation: string;
  matchedTerms: string[];
  missingTerms: string[];
  scoredAt: string;
  reportPath: string;
  reportId: string;
  evaluatedAt: string;
  llmScore: number | null;
  llmFitLevel: string;
  llmRecommendation: string;
  greetingReady: string;
  resumeSuggestionId: string;
  resumeSuggestionPath: string;
  resumeSuggestionJsonPath: string;
  resumeSuggestedAt: string;
  resumeDraftId: string;
  resumeDraftPath: string;
  resumeDraftJsonPath: string;
  resumeDraftedAt: string;
  interviewPrepId: string;
  interviewPrepPath: string;
  interviewPrepJsonPath: string;
  interviewPreparedAt: string;
  requirementCount: number;
  supportedRequirementCount: number;
  potentialEvidenceRequirementCount: number;
  unresolvedRequirementCount: number;
  blockingGapCount: number;
  requirementAssessedAt: string;
  evaluationProfileVersion: number;
  decisionStatus: DecisionStatus;
  raw: string;
};

export type ResumeNavigationTarget = {
  sourceKey?: string;
  jobId?: number | null;
  company?: string;
  title?: string;
  city?: string;
};

export type PipelineResponse = {
  path: string;
  schemaVersion: number;
  pending: PipelineItem[];
  processed: PipelineItem[];
  counts: {
    pending: number;
    processed: number;
  };
  ok?: boolean;
  added?: number;
  skipped?: number;
  missing?: number;
};

export type EvaluatePipelineResponse = {
  ok: boolean;
  sourceKey: string;
  score: number;
  fitLevel: string;
  metrics: {
    score: number;
    coverage: number;
    jdQuality: number;
    salarySignal: number;
    experienceSignal: number;
    experienceRisk: string;
    experienceLabel: string;
    candidateYears: number | null;
    requiredYears: number | null;
    educationSignal: number;
    educationRisk: string;
    candidateEducation: string;
    requiredEducation: string;
    fitLevel: string;
    matchedTerms: string[];
    missingTerms: string[];
  };
  pipeline: PipelineResponse;
};

export type ScorePipelineResponse = {
  ok: boolean;
  scored: number;
  errors: Array<{ sourceKey: string; error: string }>;
  pipeline: PipelineResponse;
};

export type ScoringKeywordSuggestionResponse = {
  ok: boolean;
  project: string;
  sampleCount: number;
  keywords: string[];
  rationale: string;
};

export type MatchingRulesSuggestionResponse = {
  ok: boolean;
  project: string;
  basedOn: string[];
  categoryRules: Record<string, string[]>;
  relevanceKeywords: string[];
  blacklistKeywords: string[];
  rationale: string;
  warnings: string[];
};

export type ScoreJobsResponse = {
  ok: boolean;
  project: string;
  scored: number;
  results: Array<{
    project: string;
    jobId: number;
    score: number | null;
    fitLevel: string;
    metrics: EvaluatePipelineResponse['metrics'];
  }>;
  errors: Array<{ jobId: number; error: string }>;
};

export type PipelineDeleteResponse = PipelineResponse & {
  ok: boolean;
  deleted: boolean;
  deletedReports: string[];
  deletedResumeArtifacts?: string[];
  deletedInterviewArtifacts?: string[];
};

export type PipelineReportResponse = {
  ok: boolean;
  sourceKey: string;
  reportId: string;
  reportPath: string;
  title: string;
  content: string;
};

export type LlmEvaluatePipelineResponse = {
  ok: boolean;
  reportId: string;
  reportPath: string;
  jsonPath: string;
  summary: {
    score: number | null;
    fitLevel: string;
    recommendation: string;
    greetingReady: string;
  };
  requirementAssessment: Array<{
    canonicalKey: string;
    capabilityName: string;
    label: string;
    category: EvidenceRequirementCategory;
    verificationMode?: EvidenceVerificationMode;
    importance: EvidenceRequirementImportance;
    requiredProficiency: ProficiencyLevel;
    requiredProficiencySource: string;
    jdQuote: string;
    candidateEvidenceRefs: Array<{ sourceType: string; quote: string; locator: string }>;
    coverageStatus: 'supported' | 'partial' | 'not_found' | 'unknown';
    rationale: string;
    confidence: number;
  }>;
  evidenceSummary: {
    requirementCount: number;
    supportedRequirementCount: number;
    potentialEvidenceRequirementCount: number;
    unresolvedRequirementCount: number;
    blockingGapCount: number;
    requirementAssessedAt: string;
  };
  pipeline: PipelineResponse;
};

export type ResumeSuggestionResponse = {
  ok: boolean;
  sourceKey: string;
  resumeSuggestionId: string;
  suggestionPath: string;
  jsonPath?: string;
  content: string;
  evidenceBindingVersion?: number;
  evidenceMap?: ResumeEvidenceClaim[];
  pipeline?: PipelineResponse;
};

export type ResumeEvidenceSource = {
  type: string;
  field: string;
  quote: string;
};

export type ResumeEvidenceClaim = {
  claimId: string;
  claim: string;
  risk: string;
  evidenceIds: string[];
  sourceVerified: boolean;
  sources: ResumeEvidenceSource[];
  userDecision: string;
  usedIn: string[];
};

export type ResumeItem = {
  sourceKey: string;
  company: string;
  title: string;
  city: string;
  salary: string;
  url: string;
  project: string;
  jobId: number | null;
  llmScore: number | null;
  llmFitLevel: string;
  llmRecommendation: string;
  reportPath: string;
  resumeSuggestionId: string;
  resumeSuggestionPath: string;
  resumeSuggestedAt: string;
  resumeDraftId: string;
  resumeDraftPath: string;
  resumeDraftedAt: string;
  decisionStatus: DecisionStatus | string;
};

export type ResumeItemsResponse = {
  ok: boolean;
  items: ResumeItem[];
};

export type ResumeDraftResponse = {
  ok: boolean;
  sourceKey: string;
  resumeDraftId: string;
  draftPath: string;
  jsonPath?: string;
  content: string;
  evidenceMap?: ResumeEvidenceClaim[];
  pipeline?: PipelineResponse;
  editedAt?: string;
};

export type InterviewItem = {
  sourceKey: string;
  company: string;
  title: string;
  city: string;
  salary: string;
  url: string;
  project: string;
  jobId: number | null;
  llmScore: number | null;
  llmFitLevel: string;
  llmRecommendation: string;
  reportPath: string;
  resumeSuggestionPath: string;
  resumeDraftPath: string;
  interviewPrepId: string;
  interviewPrepPath: string;
  interviewPreparedAt: string;
  decisionStatus: DecisionStatus | string;
};

export type InterviewItemsResponse = {
  ok: boolean;
  items: InterviewItem[];
};

export type InterviewStory = {
  id?: string;
  title: string;
  theme: string;
  source: string;
  tags: string[];
  rawNote: string;
  format: 'freeform' | 'star' | 'car' | 'par' | string;
  structureStatus: 'needs_structuring' | 'structured' | 'confirmed' | string;
  situation: string;
  task: string;
  action: string;
  result: string;
  reflection: string;
};

export type InterviewStoryBankResponse = {
  ok: boolean;
  path: string;
  content: string;
  stories: InterviewStory[];
};

export type InterviewStoryDraft = InterviewStory & {
  draftId: string;
  status: 'needs_confirmation' | 'editing' | 'ready' | 'promoted' | 'dismissed';
  sourceKey: string;
  sourceLabel: string;
  prepPath: string;
  createdAt: string;
  updatedAt: string;
  promotedAt?: string;
  promotedStoryId?: string;
};

export type InterviewStoryDraftsResponse = {
  ok: boolean;
  path: string;
  drafts: InterviewStoryDraft[];
};

export type InterviewStoryDraftPromoteResponse = {
  ok: boolean;
  story: InterviewStory;
  draft: InterviewStoryDraft;
  storyBank: InterviewStoryBankResponse;
  storyDrafts: InterviewStoryDraftsResponse;
};

export type InterviewPrepEvidenceContext = {
  confirmedEvidence: Array<Pick<EvidenceItem, 'evidenceId' | 'title' | 'summary' | 'userRole' | 'actions' | 'results' | 'sourceRefs'>>;
  sourceVerifiedRequirements: Array<{
    requirementId: string;
    label: string;
    jdQuote: string;
    candidateEvidenceRefs: NonNullable<EvidenceCoverage['candidateEvidenceRefs']>;
  }>;
  pendingRequirements: Array<{
    requirementId: string;
    label: string;
    importance: EvidenceRequirementImportance;
    coverageStatus: EvidenceCoverageStatus;
    userClassification: string;
    rationale: string;
  }>;
};

export type InterviewPrepResponse = {
  ok: boolean;
  sourceKey: string;
  interviewPrepId: string;
  prepPath: string;
  jsonPath?: string;
  content: string;
  evidenceBindingVersion?: number;
  evidenceContext?: InterviewPrepEvidenceContext;
  pipeline?: PipelineResponse;
};

export type EvidenceRequirementCategory = 'skill' | 'experience' | 'behavior' | 'education' | 'location' | 'preference' | 'other';
export type EvidenceRequirementImportance = 'required' | 'preferred' | 'context';
export type EvidenceVerificationMode = 'document_fact' | 'experience_fact' | 'preference' | 'behavior_example' | 'manual_review';
export type EvidenceCoverageStatus = 'supported' | 'partial' | 'not_found' | 'user_confirmed_absent' | 'unknown';
export type EvidenceClassification = 'done' | 'adjacent' | 'not_done' | 'unsure';
export type ProficiencyLevel = 'unspecified' | 'awareness' | 'familiar' | 'working' | 'proficient' | 'expert';
export type EvidenceItemStatus = 'draft' | 'confirmed' | 'rejected' | 'archived';
export type EvidenceTaskType = 'extract' | 'strengthen' | 'translate' | 'learn' | 'project' | 'accept_risk' | 'ignore';
export type EvidenceTaskStatus = 'pending' | 'in_progress' | 'completed' | 'dismissed';

export type EvidenceRequirement = {
  requirementId: string;
  canonicalKey: string;
  canonicalGroupId?: string;
  capabilityName?: string;
  label: string;
  category: EvidenceRequirementCategory;
  verificationMode?: EvidenceVerificationMode;
  importance: EvidenceRequirementImportance;
  sourceKey: string;
  jdQuote: string;
  requiredProficiency?: ProficiencyLevel;
  requiredProficiencySource?: string;
  proficiencyApplicable?: boolean;
  requirementGroupId?: string;
  requirementGroupMode?: 'all_of' | 'any_of';
  requirementGroupLabel?: string;
  minimumSatisfied?: number;
  extractionConfidence: number;
  active?: boolean;
  assessedAt?: string;
};

export type EvidenceSourceRef = {
  type: string;
  ref: string;
  quote: string;
};

export type EvidenceItem = {
  evidenceId: string;
  title: string;
  evidenceType: 'fact' | 'project' | 'metric' | 'artifact' | 'story';
  summary: string;
  userRole: string;
  actions: string[];
  results: string[];
  sourceRefs: EvidenceSourceRef[];
  tags: string[];
  requirementIds?: string[];
  capabilityIds?: string[];
  sourceRevision?: string;
  status: EvidenceItemStatus;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string;
  lastValidatedAt: string;
};

export type EvidenceCoverage = {
  requirementId: string;
  evidenceIds: string[];
  coverageStatus: EvidenceCoverageStatus;
  rationale: string;
  confidence: number;
  userClassification: EvidenceClassification;
  userProficiency?: ProficiencyLevel;
  userDecisionAt: string;
  decisionSource?: 'assessment' | 'direct' | 'canonical_reuse' | 'source_document';
  verificationStatus?: 'source_verified' | 'candidate' | 'needs_input' | 'user_confirmed';
  sourceVerifiedAt?: string;
  reusedFromRequirementId?: string;
  reusedAt?: string;
  assessmentStatus?: 'supported' | 'partial' | 'not_found' | 'unknown';
  assessmentRationale?: string;
  assessmentConfidence?: number;
  candidateEvidenceRefs?: Array<{
    sourceType: string;
    quote: string;
    locator: string;
  }>;
  assessedAt?: string;
};

export type EvidenceTask = {
  taskId: string;
  requirementId: string;
  taskType: EvidenceTaskType;
  affectedSourceKeys: string[];
  recommendedAction: string;
  estimatedEffortBand: string;
  timeBudget: string;
  userWillingness: string;
  priorityBand: 'high' | 'medium' | 'low';
  status: EvidenceTaskStatus;
  completionEvidenceIds: string[];
  progressPercent: number;
  nextStep: string;
  progressNotes: string[];
  currentProficiency: ProficiencyLevel;
  targetProficiency: ProficiencyLevel;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type CapabilityStatus = 'mastered' | 'adjacent' | 'pending' | 'gap';
export type CapabilityImpactTier = 'core' | 'high_value' | 'common' | 'specialized';
export type CapabilityProofStatus = 'none' | 'self_reported' | 'resume_recorded' | 'source_backed' | 'external_verified';

export type CapabilityProfile = {
  capabilityId: string;
  canonicalKey: string;
  label: string;
  category: EvidenceRequirementCategory;
  actionability: 'developable' | 'basic';
  status: CapabilityStatus;
  proficiencyApplicable: boolean;
  userProficiency: ProficiencyLevel;
  highestRequiredProficiency: ProficiencyLevel;
  requiredProficiencyCounts: Record<ProficiencyLevel, number>;
  impactTier: CapabilityImpactTier;
  jobCount: number;
  requiredCount: number;
  preferredCount: number;
  evidenceCount: number;
  sourceCount: number;
  proofStatus: CapabilityProofStatus;
  requirementIds: string[];
  sourceKeys: string[];
  evidenceIds: string[];
  planIds: string[];
  requirements: Array<{
    requirementId: string;
    sourceKey: string;
    sourceLabel?: string;
    company?: string;
    jobTitle?: string;
    label: string;
    capabilityName?: string;
    requiredProficiency: ProficiencyLevel;
    requiredProficiencySource?: string;
    proficiencyApplicable?: boolean;
    requirementGroupId?: string;
    requirementGroupMode?: 'all_of' | 'any_of';
    requirementGroupLabel?: string;
    minimumSatisfied?: number;
    importance: EvidenceRequirementImportance;
    jdQuote: string;
  }>;
  origin?: 'resume' | 'job_requirement' | 'user' | string;
  userConfirmedAt?: string;
};

export type EvidenceOverviewResponse = {
  ok: boolean;
  path: string;
  schemaVersion: number;
  requirements: EvidenceRequirement[];
  evidenceItems: EvidenceItem[];
  coverages: EvidenceCoverage[];
  tasks: EvidenceTask[];
  capabilities: CapabilityProfile[];
  constraints: EvidenceRequirement[];
  updatedAt: string;
  counts: {
    requirements: number;
    evidenceItems: number;
    confirmedEvidenceItems: number;
    unresolvedCoverages: number;
    pendingTasks: number;
    capabilities: number;
    masteredCapabilities: number;
    pendingCapabilities: number;
    gapCapabilities: number;
    basicConditions: number;
    activePlans: number;
  };
};

export type EvidenceRequirementsResponse = {
  ok: boolean;
  path: string;
  schemaVersion: number;
  sourceKey: string;
  requirements: EvidenceRequirement[];
};

export type EvidenceTasksResponse = {
  ok: boolean;
  path: string;
  schemaVersion: number;
  tasks: EvidenceTask[];
};

export type EvidenceMutationResponse = {
  ok: boolean;
  overview: EvidenceOverviewResponse;
  affectedSourceKeys: string[];
  affectedRequirementIds?: string[];
  item?: EvidenceItem;
  coverage?: EvidenceCoverage;
  task?: EvidenceTask;
};

export type EvidenceItemInput = Omit<EvidenceItem, 'evidenceId' | 'status' | 'createdAt' | 'updatedAt' | 'confirmedAt' | 'lastValidatedAt'> & {
  status?: 'draft';
};
export type EvidenceTaskInput = Omit<EvidenceTask, 'taskId' | 'createdAt' | 'updatedAt' | 'completedAt'>;
export type EvidenceTaskUpdateInput = Pick<
  EvidenceTask,
  'taskId' | 'status' | 'completionEvidenceIds' | 'progressPercent' | 'nextStep' | 'progressNotes' | 'currentProficiency' | 'targetProficiency'
>;

export type GreetingDraftStatus = 'draft' | 'edited' | 'copied' | 'sent' | 'dismissed';

export type GreetingDraft = {
  sourceKey: string;
  project: string;
  jobId: number | null;
  company: string;
  title: string;
  channel: string;
  draftText: string;
  editedText: string;
  status: GreetingDraftStatus;
  sourceReportPath: string;
  sourceReportId: string;
  createdAt: string;
  updatedAt: string;
  usedAt: string;
};

export type GreetingDraftResponse = {
  ok: boolean;
  path: string;
  draft: GreetingDraft;
};

export type TaskStatusResponse = {
  running: boolean;
  status: Status;
  crawlAuthenticated: boolean;
  logs: string[];
};

export type JobLiveStatusUpdateRequest = {
  project: string;
  jobIds?: number[];
  limit?: number;
  skipClosed?: boolean;
  workers?: number;
  sleepSeconds?: number;
  browserWaitSeconds?: number;
  headless?: boolean;
  interactiveOnCaptcha?: boolean;
  verificationTimeoutSeconds?: number;
};

export type ConfigPatch = Partial<ConfigPayload>;

export type CvStatusResponse = {
  ok: boolean;
  exists: boolean;
  path: string;
  examplePath: string;
  isEmpty: boolean;
  checks: {
    hasContent: boolean;
    hasYears: boolean;
    hasEducation: boolean;
    hasSkills: boolean;
    hasProjects: boolean;
    hasExperience: boolean;
  };
  missing: string[];
  readyForScoring: boolean;
  readyForMaterials: boolean;
  canCreateFromTemplate: boolean;
};

export type CvDocumentResponse = CvStatusResponse & {
  content: string;
};

export type ResumeCapabilityImportAction = 'new' | 'merge' | 'already_imported';

export type ResumeCapabilityImportProposal = {
  proposalId: string;
  canonicalKey: string;
  capabilityId: string;
  label: string;
  category: EvidenceRequirementCategory;
  proficiencyApplicable: boolean;
  userProficiency: ProficiencyLevel;
  confidence: number;
  sourceRefs: Array<EvidenceSourceRef & { heading?: string }>;
  action: ResumeCapabilityImportAction;
  selected: boolean;
  existingCapability?: CapabilityProfile | null;
};

export type ResumeCapabilityImportPreview = {
  ok: boolean;
  sourceRevision: string;
  proposals: ResumeCapabilityImportProposal[];
  staleImports: Array<Pick<CapabilityProfile, 'capabilityId' | 'canonicalKey' | 'label'>>;
  counts: {
    total: number;
    new: number;
    merge: number;
    alreadyImported: number;
    needsReview: number;
    stale: number;
  };
};

export type ResumeCapabilityImportSelection = {
  proposalId: string;
  selected: boolean;
  label: string;
  userProficiency: ProficiencyLevel;
};

export type ResumeCapabilityImportResult = {
  ok: boolean;
  sourceRevision: string;
  imported: Array<{
    proposalId: string;
    capabilityId: string;
    label: string;
    action: ResumeCapabilityImportAction;
    evidenceId: string;
  }>;
  staleImports: ResumeCapabilityImportPreview['staleImports'];
  overview: EvidenceOverviewResponse;
  affectedSourceKeys: string[];
};
