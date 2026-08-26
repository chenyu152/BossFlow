import type {
  AutomationResponse,
  AccountActivityImportResponse,
  AccountActivityResponse,
  AccountActivitySyncResponse,
  AccountActivityTab,
  AutomationRun,
  AutomationSchedule,
  AutomationScheduleInput,
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
  GreetingPreflightResponse,
  GreetingPrepareResponse,
  InterviewItemsResponse,
  InterviewPrepResponse,
  InterviewStoryBankResponse,
  InterviewStoryDraft,
  InterviewStoryDraftPromoteResponse,
  InterviewStoryDraftsResponse,
  MockInterviewDifficulty,
  MockInterviewMode,
  MockInterviewSessionResponse,
  MockInterviewSessionsResponse,
  MockInterviewStoryDraftResponse,
  Job,
  JobLiveStatusUpdateRequest,
  JobsResponse,
  LlmEvaluatePipelineResponse,
  LlmSettingsStatus,
  LoginState,
  PipelineDeleteResponse,
  PipelineReportResponse,
  PipelineResponse,
  ProficiencyLevel,
  ProjectListResponse,
  ResumeDraftResponse,
  ResumeCapabilityImportPreview,
  ResumeCapabilityImportResult,
  ResumeCapabilityImportSelection,
  ResumeItemsResponse,
  ResumeSuggestionResponse,
  ScoreJobsResponse,
  ScorePipelineResponse,
  SearchFilterOptionsResponse,
  TaskStatusResponse,
} from './types';

export const API_BASE = import.meta.env.VITE_API_BASE || '';

export type MockInterviewStreamCallbacks = {
  onStatus?: (phase: string) => void;
  onDelta?: (text: string) => void;
  onWarning?: (message: string) => void;
  onDone?: (data: MockInterviewSessionResponse & { followUpAdded?: boolean }) => void;
};

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
  getSearchFilterOptions() {
    return request<SearchFilterOptionsResponse>('/api/search-filters/options');
  },

  getLoginState(project: string) {
    return request<LoginState>(`/api/login-state?project=${encodeURIComponent(project)}`);
  },

  getAutomation() {
    return request<AutomationResponse>('/api/automation');
  },

  createAutomationSchedule(body: AutomationScheduleInput) {
    return request<AutomationSchedule>('/api/automation/schedules', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  updateAutomationSchedule(scheduleId: string, body: AutomationScheduleInput) {
    return request<AutomationSchedule>(`/api/automation/schedules/${encodeURIComponent(scheduleId)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  },

  deleteAutomationSchedule(scheduleId: string) {
    return request<{ ok: boolean; scheduleId: string }>(`/api/automation/schedules/${encodeURIComponent(scheduleId)}`, {
      method: 'DELETE',
    });
  },

  runAutomationSchedule(scheduleId: string) {
    return request<AutomationRun>(`/api/automation/schedules/${encodeURIComponent(scheduleId)}/run`, {
      method: 'POST',
    });
  },

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

  previewCvCapabilityImport(project: string) {
    return request<ResumeCapabilityImportPreview>(
      `/api/cv/capability-import-preview?project=${encodeURIComponent(project)}`,
    );
  },

  applyCvCapabilityImport(
    project: string,
    sourceRevision: string,
    selections: ResumeCapabilityImportSelection[],
  ) {
    return request<ResumeCapabilityImportResult>('/api/cv/capability-import', {
      method: 'POST',
      body: JSON.stringify({ project, sourceRevision, selections }),
    });
  },

  async parsePdfResume(file: File): Promise<{ ok: boolean; status: string }> {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${API_BASE}/api/cv/parse-pdf`, {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) {
      let message = `${response.status} ${response.statusText}`;
      try {
        const body = await response.json();
        message = body.detail || message;
      } catch {
        // keep HTTP status text
      }
      throw new Error(message);
    }
    return response.json();
  },

  getParseStatus() {
    return request<{ status: string; result: string; error: string }>('/api/cv/parse-status');
  },

  getJobs(project: string, search = '', limit = 20000) {
    return request<JobsResponse>(
      `/api/jobs?project=${encodeURIComponent(project)}&q=${encodeURIComponent(search)}&limit=${limit}`,
    );
  },

  createJob(project: string, data: { title: string; company: string; city?: string; salary?: string; exp?: string; edu?: string; desc?: string; url?: string }) {
    return request<{ ok: boolean; jobId: number }>('/api/jobs', {
      method: 'POST',
      body: JSON.stringify({ project, ...data }),
    });
  },

  getAccountActivity(project: string, tab: AccountActivityTab = 'all', page = 1, pageSize = 30, search = '', newOnly = false, options: { profileProject?: string; matchStatus?: string; importStatus?: string; jobStatus?: string; actionableOnly?: boolean } = {}) {
    const params = new URLSearchParams({ project, matchProject: project, tab, page: String(page), pageSize: String(pageSize), search, newOnly: String(newOnly), profileProject: options.profileProject || project });
    if (options.matchStatus && options.matchStatus !== 'all') params.set('matchStatus', options.matchStatus);
    if (options.importStatus && options.importStatus !== 'all') params.set('importStatus', options.importStatus);
    if (options.jobStatus && options.jobStatus !== 'all') params.set('jobStatus', options.jobStatus);
    if (options.actionableOnly) params.set('actionableOnly', 'true');
    return request<AccountActivityResponse>(`/api/account-activity?${params.toString()}`);
  },

  startAccountActivitySync(body: { project: string; profileProject?: string; matchProject?: string; accountKey?: string; tabs?: Exclude<AccountActivityTab, 'all'>[] }) {
    return request<AccountActivitySyncResponse>('/api/account-activity/sync', { method: 'POST', body: JSON.stringify(body) });
  },

  importAccountActivity(body: { project: string; matchProject?: string; profileProject?: string; accountKey?: string; accountJobIds: number[]; mode: 'library' | 'candidate'; allowUncertain?: boolean }) {
    return request<AccountActivityImportResponse>('/api/account-activity/import', { method: 'POST', body: JSON.stringify(body) });
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

  preflightGreeting(sourceKey: string, message: string) {
    return request<GreetingPreflightResponse>('/api/greetings/preflight', {
      method: 'POST',
      body: JSON.stringify({ sourceKey, message }),
    });
  },

  prepareGreeting(sourceKey: string, message: string) {
    return request<GreetingPrepareResponse>('/api/greetings/prepare', {
      method: 'POST',
      body: JSON.stringify({ sourceKey, message, confirmed: true }),
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
    userProficiency: ProficiencyLevel = 'unspecified',
  ) {
    return request<EvidenceMutationResponse>('/api/evidence/coverage/classify', {
      method: 'POST',
      body: JSON.stringify({ project, requirementId, userClassification, evidenceIds, rationale, confidence, userProficiency }),
    });
  },

  classifyCapability(
    project: string,
    capabilityId: string,
    classification: EvidenceClassification,
    evidenceIds: string[] = [],
    rationale = '',
    confidence = 1,
    userProficiency: ProficiencyLevel = 'unspecified',
  ) {
    return request<EvidenceMutationResponse>('/api/evidence/capabilities/classify', {
      method: 'POST',
      body: JSON.stringify({
        project,
        capabilityId,
        classification,
        evidenceIds,
        rationale,
        confidence,
        userProficiency,
      }),
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

  updateEvidenceTask(
    project: string,
    taskId: string,
    status: EvidenceTaskInput['status'],
    completionEvidenceIds: string[] = [],
    progressPercent = 0,
    nextStep = '',
    progressNotes: string[] = [],
    currentProficiency: ProficiencyLevel = 'unspecified',
    targetProficiency: ProficiencyLevel = 'working',
  ) {
    return request<EvidenceMutationResponse>('/api/evidence/tasks', {
      method: 'PUT',
      body: JSON.stringify({ project, taskId, status, completionEvidenceIds, progressPercent, nextStep, progressNotes, currentProficiency, targetProficiency }),
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

  createMockInterviewSession(body: {
    sourceKey: string;
    mode: MockInterviewMode;
    difficulty: MockInterviewDifficulty;
    durationMinutes: 10 | 20 | 30;
    userNotes?: string;
  }) {
    return request<MockInterviewSessionResponse>('/api/interview/mock/sessions', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  getMockInterviewSessions(project: string) {
    return request<MockInterviewSessionsResponse>(`/api/interview/mock/sessions?project=${encodeURIComponent(project)}`);
  },

  getMockInterviewSession(project: string, sessionId: string) {
    return request<MockInterviewSessionResponse>(
      `/api/interview/mock/sessions/${encodeURIComponent(sessionId)}?project=${encodeURIComponent(project)}`,
    );
  },

  saveMockInterviewAnswerDraft(
    project: string,
    sessionId: string,
    turnId: string,
    answer: string,
    assisted = false,
  ) {
    return request<MockInterviewSessionResponse>(
      `/api/interview/mock/sessions/${encodeURIComponent(sessionId)}/answer-draft`,
      {
        method: 'PUT',
        body: JSON.stringify({ project, turnId, answer, assisted }),
      },
    );
  },

  submitMockInterviewAnswer(
    project: string,
    sessionId: string,
    turnId: string,
    answer: string,
    assisted = false,
    skipped = false,
  ) {
    return request<MockInterviewSessionResponse>(
      `/api/interview/mock/sessions/${encodeURIComponent(sessionId)}/answers`,
      {
        method: 'POST',
        body: JSON.stringify({ project, turnId, answer, assisted, skipped }),
      },
    );
  },

  async submitMockInterviewAnswerStream(
    project: string,
    sessionId: string,
    turnId: string,
    answer: string,
    assisted = false,
    skipped = false,
    callbacks: MockInterviewStreamCallbacks = {},
  ) {
    const controller = new AbortController();
    let inactivityTimer = window.setTimeout(() => controller.abort(), 45_000);
    const keepAlive = () => {
      window.clearTimeout(inactivityTimer);
      inactivityTimer = window.setTimeout(() => controller.abort(), 45_000);
    };
    let response: Response;
    try {
      response = await fetch(
        `${API_BASE}/api/interview/mock/sessions/${encodeURIComponent(sessionId)}/answers/stream`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project, turnId, answer, assisted, skipped }),
          signal: controller.signal,
        },
      );
    } catch (cause) {
      window.clearTimeout(inactivityTimer);
      if ((cause as Error).name === 'AbortError') {
        throw new Error('The interview response timed out');
      }
      throw cause;
    }
    if (!response.ok) {
      window.clearTimeout(inactivityTimer);
      let message = `${response.status} ${response.statusText}`;
      try {
        const body = await response.json();
        message = body.detail || body.message || message;
      } catch {
        // Keep the HTTP status when the server did not return JSON.
      }
      throw new Error(message);
    }
    if (!response.body) {
      window.clearTimeout(inactivityTimer);
      throw new Error('Streaming response body is unavailable');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let completed: (MockInterviewSessionResponse & { followUpAdded?: boolean }) | null = null;

    const processEvent = (block: string) => {
      let eventName = 'message';
      const dataLines: string[] = [];
      block.split(/\r?\n/).forEach((line) => {
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
      });
      if (!dataLines.length) return;
      const payload = JSON.parse(dataLines.join('\n')) as Record<string, unknown>;
      if (eventName === 'status') callbacks.onStatus?.(String(payload.phase || ''));
      if (eventName === 'delta') callbacks.onDelta?.(String(payload.text || ''));
      if (eventName === 'warning') callbacks.onWarning?.(String(payload.message || ''));
      if (eventName === 'done') {
        completed = payload as unknown as MockInterviewSessionResponse & { followUpAdded?: boolean };
        callbacks.onDone?.(completed);
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        keepAlive();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() || '';
        blocks.forEach(processEvent);
        if (done) break;
      }
    } catch (cause) {
      if ((cause as Error).name === 'AbortError') {
        throw new Error('The interview response timed out');
      }
      throw cause;
    } finally {
      window.clearTimeout(inactivityTimer);
    }
    if (buffer.trim()) processEvent(buffer);
    if (!completed) throw new Error('Streaming response ended before the interview state was returned');
    return completed;
  },

  completeMockInterviewSession(project: string, sessionId: string) {
    return request<MockInterviewSessionResponse>(
      `/api/interview/mock/sessions/${encodeURIComponent(sessionId)}/complete`,
      {
        method: 'POST',
        body: JSON.stringify({ project }),
      },
    );
  },

  stageMockInterviewStoryDrafts(project: string, sessionId: string, candidateIds: string[]) {
    return request<MockInterviewStoryDraftResponse>(
      `/api/interview/mock/sessions/${encodeURIComponent(sessionId)}/story-drafts`,
      {
        method: 'POST',
        body: JSON.stringify({ project, candidateIds }),
      },
    );
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
