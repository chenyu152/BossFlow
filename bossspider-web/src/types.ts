export type Tab = 'Dashboard' | 'Scope' | 'Rules' | 'Jobs' | 'Pipeline' | 'Resume' | 'Story' | 'Interview' | 'Logs';

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
  relevanceText: string;
  blacklistText: string;
  maxPages: number;
  scrollTarget: number;
  scrollMax: number;
  minSalary: number;
  jobCount: number;
  keywordCount: number;
  cityCount: number;
  dbFileName: string;
  dbFilePath: string;
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
  lastSeen: string;
  liveStatus?: 'open' | 'closed' | 'unknown' | '';
  liveStatusRaw?: string;
  liveCheckedAt?: string;
  liveClosedAt?: string;
  liveCheckError?: string;
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

export type DecisionStatus = 'needs_llm' | 'needs_review' | 'ready_to_greet' | 'greeted' | 'skipped';

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
  decisionStatus: DecisionStatus;
  raw: string;
};

export type PipelineResponse = {
  path: string;
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
  pipeline: PipelineResponse;
};

export type ResumeSuggestionResponse = {
  ok: boolean;
  sourceKey: string;
  resumeSuggestionId: string;
  suggestionPath: string;
  jsonPath?: string;
  content: string;
  pipeline?: PipelineResponse;
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
  pipeline?: PipelineResponse;
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

export type InterviewPrepResponse = {
  ok: boolean;
  sourceKey: string;
  interviewPrepId: string;
  prepPath: string;
  jsonPath?: string;
  content: string;
  pipeline?: PipelineResponse;
};

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
