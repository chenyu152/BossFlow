import type {
  ConfigPayload,
  CvDocumentResponse,
  CvStatusResponse,
  EvidenceClassification,
  EvidenceItem,
  EvidenceItemInput,
  EvidenceMutationResponse,
  EvidenceOverviewResponse,
  EvidenceRequirement,
  EvidenceRequirementsResponse,
  EvidenceTaskInput,
  EvidenceTasksResponse,
  EvaluatePipelineResponse,
  GreetingDraftResponse,
  GreetingDraftStatus,
  InterviewItemsResponse,
  InterviewPrepResponse,
  InterviewStoryBankResponse,
  InterviewStoryDraft,
  InterviewStoryDraftPromoteResponse,
  InterviewStoryDraftsResponse,
  Job,
  JobLiveStatusUpdateRequest,
  JobsResponse,
  LlmEvaluatePipelineResponse,
  LlmSettingsStatus,
  MatchingRulesSuggestionResponse,
  PipelineDeleteResponse,
  PipelineReportResponse,
  PipelineResponse,
  ProjectListResponse,
  ResumeDraftResponse,
  ResumeItemsResponse,
  ResumeSuggestionResponse,
  ScoringKeywordSuggestionResponse,
  ScoreJobsResponse,
  ScorePipelineResponse,
  TaskStatusResponse,
} from './types';

export const API_BASE = import.meta.env.VITE_API_BASE || '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    ...init,
  });

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      message = body.detail || message;
    } catch {
      // Keep the HTTP status text when the body is not JSON.
    }
    if (message.includes('Missing LLM API key')) {
      window.dispatchEvent(new Event('bossflow:llm-settings-required'));
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

export const bossApi = {
  getLlmSettings() {
    return request<LlmSettingsStatus>('/api/system/llm-settings');
  },

  saveLlmSettings(body: { apiKey: string; apiBase: string; model: string }) {
    return request<LlmSettingsStatus>('/api/system/llm-settings', {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  },

  revealLlmApiKey() {
    return request<{ apiKey: string }>('/api/system/llm-settings/api-key');
  },

  testLlmSettings(body: { apiKey: string; apiBase: string; model: string }) {
    return request<{ ok: string; model: string }>('/api/system/llm-settings/test', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  getProjects() {
    return request<ProjectListResponse>('/api/projects');
  },

  createProject(name: string) {
    return request<ConfigPayload>('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  },

  getConfig(project: string) {
    return request<ConfigPayload>(`/api/config?project=${encodeURIComponent(project)}`);
  },

  saveConfig(body: unknown) {
    return request<ConfigPayload>('/api/config', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  getCvStatus(project: string) {
    return request<CvStatusResponse>(`/api/cv/status?project=${encodeURIComponent(project)}`);
  },

  createCvFromTemplate(project: string) {
    return request<CvStatusResponse>(`/api/cv/from-template?project=${encodeURIComponent(project)}`, { method: 'POST' });
  },

  getCvDocument(project: string) {
    return request<CvDocumentResponse>(`/api/cv?project=${encodeURIComponent(project)}`);
  },

  saveCvDocument(project: string, content: string) {
    return request<CvDocumentResponse>('/api/cv', {
      method: 'PUT',
      body: JSON.stringify({ project, content }),
    });
  },

  getJobs(project: string, search = '', limit = 20000) {
    return request<JobsResponse>(
      `/api/jobs?project=${encodeURIComponent(project)}&q=${encodeURIComponent(search)}&limit=${limit}`,
    );
  },

  getJobItem(project: string, jobId: number) {
    return request<Job>(
      `/api/jobs/item?project=${encodeURIComponent(project)}&jobId=${encodeURIComponent(jobId)}`,
    );
  },

  getPipeline(project: string) {
    return request<PipelineResponse>(`/api/pipeline?project=${encodeURIComponent(project)}`);
  },

  getPipelineReport(sourceKey: string) {
    return request<PipelineReportResponse>(`/api/pipeline/report?sourceKey=${encodeURIComponent(sourceKey)}`);
  },

  getGreetingDraft(sourceKey: string) {
    return request<GreetingDraftResponse>(`/api/greetings/draft?sourceKey=${encodeURIComponent(sourceKey)}`);
  },

  saveGreetingDraft(sourceKey: string, editedText: string, status: GreetingDraftStatus) {
    return request<GreetingDraftResponse>('/api/greetings/draft', {
      method: 'PUT',
      body: JSON.stringify({ sourceKey, editedText, status }),
    });
  },

  addJobsToPipeline(project: string, jobIds: number[]) {
    return request<PipelineResponse>('/api/pipeline/jobs', {
      method: 'POST',
      body: JSON.stringify({ project, jobIds }),
    });
  },

  scoreJobs(project: string, jobIds: number[]) {
    return request<ScoreJobsResponse>('/api/jobs/score', {
      method: 'POST',
      body: JSON.stringify({ project, jobIds }),
    });
  },

  generateScoringKeywordSuggestions(project: string, limit = 80) {
    return request<ScoringKeywordSuggestionResponse>('/api/scoring/keyword-suggestions', {
      method: 'POST',
      body: JSON.stringify({ project, limit }),
    });
  },

  generateMatchingRulesSuggestion(project: string, snapshot: Pick<ConfigPayload, 'keywordsText' | 'catRulesText' | 'relevanceText' | 'blacklistText'>) {
    return request<MatchingRulesSuggestionResponse>('/api/matching-rules/suggestions', {
      method: 'POST',
      body: JSON.stringify({ project, ...snapshot }),
    });
  },

  updateJobLiveStatus(body: JobLiveStatusUpdateRequest) {
    return request<{ ok: boolean; status: string }>('/api/jobs/live-status/update', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  evaluatePipelineItem(sourceKey: string) {
    return request<EvaluatePipelineResponse>('/api/pipeline/evaluate', {
      method: 'POST',
      body: JSON.stringify({ sourceKey }),
    });
  },

  scorePipeline(project: string, sourceKeys: string[] = []) {
    return request<ScorePipelineResponse>('/api/pipeline/score', {
      method: 'POST',
      body: JSON.stringify({ project, sourceKeys }),
    });
  },

  updatePipelineStatus(sourceKey: string, decisionStatus: string) {
    return request<PipelineResponse>('/api/pipeline/status', {
      method: 'POST',
      body: JSON.stringify({ sourceKey, decisionStatus }),
    });
  },

  deletePipelineItem(sourceKey: string) {
    return request<PipelineDeleteResponse>('/api/pipeline/item', {
      method: 'DELETE',
      body: JSON.stringify({ sourceKey }),
    });
  },

  llmEvaluatePipelineItem(sourceKey: string) {
    return request<LlmEvaluatePipelineResponse>('/api/pipeline/llm-evaluate', {
      method: 'POST',
      body: JSON.stringify({ sourceKey }),
    });
  },

  generateResumeSuggestions(sourceKey: string) {
    return request<ResumeSuggestionResponse>('/api/resume/suggestions', {
      method: 'POST',
      body: JSON.stringify({ sourceKey }),
    });
  },

  getResumeSuggestion(sourceKey: string) {
    return request<ResumeSuggestionResponse>(`/api/resume/suggestion?sourceKey=${encodeURIComponent(sourceKey)}`);
  },

  getResumeItems(project: string) {
    return request<ResumeItemsResponse>(`/api/resume/items?project=${encodeURIComponent(project)}`);
  },

  generateResumeDraft(sourceKey: string, approvedSuggestionIds: string[], userNotes: string) {
    return request<ResumeDraftResponse>('/api/resume/draft', {
      method: 'POST',
      body: JSON.stringify({ sourceKey, approvedSuggestionIds, userNotes }),
    });
  },

  getResumeDraft(sourceKey: string) {
    return request<ResumeDraftResponse>(`/api/resume/draft?sourceKey=${encodeURIComponent(sourceKey)}`);
  },

  saveResumeDraft(sourceKey: string, content: string) {
    return request<ResumeDraftResponse>('/api/resume/draft', {
      method: 'PUT',
      body: JSON.stringify({ sourceKey, content }),
    });
  },

  getEvidenceOverview(project: string) {
    return request<EvidenceOverviewResponse>(`/api/evidence/overview?project=${encodeURIComponent(project)}`);
  },

  getEvidenceRequirements(project: string, sourceKey = '') {
    const params = new URLSearchParams({ project });
    if (sourceKey) params.set('sourceKey', sourceKey);
    const query = `?${params.toString()}`;
    return request<EvidenceRequirementsResponse>(`/api/evidence/requirements${query}`);
  },

  upsertEvidenceRequirements(project: string, requirements: EvidenceRequirement[]) {
    return request<EvidenceOverviewResponse>('/api/evidence/requirements', {
      method: 'PUT',
      body: JSON.stringify({ project, requirements }),
    });
  },

  getEvidenceTasks(project: string, status = '', sourceKey = '') {
    const params = new URLSearchParams();
    params.set('project', project);
    if (status) params.set('status', status);
    if (sourceKey) params.set('sourceKey', sourceKey);
    const query = params.size ? `?${params.toString()}` : '';
    return request<EvidenceTasksResponse>(`/api/evidence/tasks${query}`);
  },

  classifyEvidenceCoverage(
    project: string,
    requirementId: string,
    userClassification: EvidenceClassification,
    evidenceIds: string[] = [],
    rationale = '',
    confidence = 0,
  ) {
    return request<EvidenceMutationResponse>('/api/evidence/coverage/classify', {
      method: 'POST',
      body: JSON.stringify({ project, requirementId, userClassification, evidenceIds, rationale, confidence }),
    });
  },

  createEvidenceItem(project: string, item: EvidenceItemInput) {
    return request<EvidenceMutationResponse>('/api/evidence/items', {
      method: 'POST',
      body: JSON.stringify({ project, ...item }),
    });
  },

  updateEvidenceItem(project: string, item: EvidenceItem) {
    return request<EvidenceMutationResponse>('/api/evidence/items', {
      method: 'PUT',
      body: JSON.stringify({ project, ...item }),
    });
  },

  confirmEvidenceItem(project: string, evidenceId: string) {
    return request<EvidenceMutationResponse>('/api/evidence/items/confirm', {
      method: 'POST',
      body: JSON.stringify({ project, evidenceId }),
    });
  },

  createEvidenceTask(project: string, task: EvidenceTaskInput) {
    return request<EvidenceMutationResponse>('/api/evidence/tasks', {
      method: 'POST',
      body: JSON.stringify({ project, ...task }),
    });
  },

  updateEvidenceTask(project: string, taskId: string, status: EvidenceTaskInput['status'], completionEvidenceIds: string[] = []) {
    return request<EvidenceMutationResponse>('/api/evidence/tasks', {
      method: 'PUT',
      body: JSON.stringify({ project, taskId, status, completionEvidenceIds }),
    });
  },

  getInterviewItems(project: string) {
    return request<InterviewItemsResponse>(`/api/interview/items?project=${encodeURIComponent(project)}`);
  },

  getInterviewStoryBank(project: string) {
    return request<InterviewStoryBankResponse>(`/api/interview/story-bank?project=${encodeURIComponent(project)}`);
  },

  saveInterviewStoryBank(project: string, stories: unknown[]) {
    return request<InterviewStoryBankResponse>('/api/interview/story-bank', {
      method: 'PUT',
      body: JSON.stringify({ project, stories }),
    });
  },

  getInterviewStoryDrafts(project: string) {
    return request<InterviewStoryDraftsResponse>(`/api/interview/story-drafts?project=${encodeURIComponent(project)}`);
  },

  saveInterviewStoryDrafts(project: string, drafts: unknown[]) {
    return request<InterviewStoryDraftsResponse>('/api/interview/story-drafts', {
      method: 'PUT',
      body: JSON.stringify({ project, drafts }),
    });
  },

  promoteInterviewStoryDraft(project: string, draftId: string, draft: InterviewStoryDraft) {
    return request<InterviewStoryDraftPromoteResponse>('/api/interview/story-drafts/promote', {
      method: 'POST',
      body: JSON.stringify({ project, draftId, draft }),
    });
  },

  generateInterviewPrep(sourceKey: string, userNotes: string) {
    return request<InterviewPrepResponse>('/api/interview/prep', {
      method: 'POST',
      body: JSON.stringify({ sourceKey, userNotes }),
    });
  },

  getInterviewPrep(sourceKey: string) {
    return request<InterviewPrepResponse>(`/api/interview/prep?sourceKey=${encodeURIComponent(sourceKey)}`);
  },

  getTaskStatus() {
    return request<TaskStatusResponse>('/api/tasks/status');
  },

  startCrawl(body: unknown) {
    return request('/api/tasks/crawl', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  startLogin(body: unknown) {
    return request('/api/tasks/login', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  processPartial(body: unknown) {
    return request('/api/tasks/process-partial', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  stopTask() {
    return request('/api/tasks/stop', { method: 'POST' });
  },

  exportJobsUrl(project: string, search = '') {
    return `${API_BASE}/api/jobs/export?project=${encodeURIComponent(project)}&q=${encodeURIComponent(search)}`;
  },
};
