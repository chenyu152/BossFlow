import type {
  ConfigPayload,
  EvaluatePipelineResponse,
  Job,
  JobsResponse,
  LlmEvaluatePipelineResponse,
  PipelineDeleteResponse,
  PipelineReportResponse,
  PipelineResponse,
  ProjectListResponse,
  ResumeSuggestionResponse,
  ScoreJobsResponse,
  ScorePipelineResponse,
  TaskStatusResponse,
} from './types';

export const API_BASE = import.meta.env.VITE_API_BASE || '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
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
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

export const bossApi = {
  getProjects() {
    return request<ProjectListResponse>('/api/projects');
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

  getPipeline() {
    return request<PipelineResponse>('/api/pipeline');
  },

  getPipelineReport(sourceKey: string) {
    return request<PipelineReportResponse>(`/api/pipeline/report?sourceKey=${encodeURIComponent(sourceKey)}`);
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

  evaluatePipelineItem(sourceKey: string) {
    return request<EvaluatePipelineResponse>('/api/pipeline/evaluate', {
      method: 'POST',
      body: JSON.stringify({ sourceKey }),
    });
  },

  scorePipeline(sourceKeys: string[] = []) {
    return request<ScorePipelineResponse>('/api/pipeline/score', {
      method: 'POST',
      body: JSON.stringify({ sourceKeys }),
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
