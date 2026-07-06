export type Tab = 'Dashboard' | 'Scope' | 'Rules' | 'Jobs' | 'Pipeline' | 'Logs';

export type Status = 'ready' | 'crawling' | 'login' | 'processing-partial' | 'stopping' | 'failed';

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

export type TaskStatusResponse = {
  running: boolean;
  status: Status;
  logs: string[];
};

export type ConfigPatch = Partial<ConfigPayload>;
