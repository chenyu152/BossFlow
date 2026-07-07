import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { bossApi } from '../api';
import { parseLog } from '../utils';
import type {
  ConfigPatch,
  ConfigPayload,
  InterviewItem,
  InterviewPrepResponse,
  InterviewStory,
  InterviewStoryBankResponse,
  InterviewStoryDraft,
  InterviewStoryDraftPromoteResponse,
  InterviewStoryDraftsResponse,
  Job,
  PipelineResponse,
  ResumeDraftResponse,
  ResumeItem,
  ResumeSuggestionResponse,
  Status,
} from '../types';

export function useBossSpider() {
  const { t } = useTranslation('common');
  const [status, setStatus] = useState<Status>('ready');
  const [projects, setProjects] = useState<string[]>([]);
  const [project, setProject] = useState('agent');
  const [config, setConfig] = useState<ConfigPayload | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobsTotal, setJobsTotal] = useState(0);
  const [pipeline, setPipeline] = useState<PipelineResponse | null>(null);
  const [resumeItems, setResumeItems] = useState<ResumeItem[]>([]);
  const [interviewItems, setInterviewItems] = useState<InterviewItem[]>([]);
  const [jobSearch, setJobSearch] = useState('');
  const [sortJobsByScore, setSortJobsByScore] = useState(false);
  const [sortPipelineByLlmScore, setSortPipelineByLlmScore] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [strategyIndex, setStrategyIndex] = useState(0);
  const [quickMode, setQuickMode] = useState(false);
  const [headlessMode, setHeadlessMode] = useState(true);
  const [autoSqlite, setAutoSqlite] = useState(true);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [jobScoringIds, setJobScoringIds] = useState<number[]>([]);
  const [llmEvaluatingKeys, setLlmEvaluatingKeys] = useState<string[]>([]);
  const [resumeSuggestingKeys, setResumeSuggestingKeys] = useState<string[]>([]);
  const [resumeDraftingKeys, setResumeDraftingKeys] = useState<string[]>([]);
  const [interviewPreparingKeys, setInterviewPreparingKeys] = useState<string[]>([]);
  const firstStatusLoad = useRef(true);
  const projectRef = useRef(project);
  const tRef = useRef(t);

  const parsedLogs = useMemo(() => logs.map(parseLog), [logs]);
  const recentLogs = parsedLogs.slice(-6);
  const isRunning = status !== 'ready' && status !== 'failed';

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 4200);
  }, []);

  const loadJobs = useCallback(async (targetProject: string, search = '') => {
    const data = await bossApi.getJobs(targetProject, search);
    setJobs(data.items);
    setJobsTotal(data.total);
  }, []);

  const refreshPipeline = useCallback(async () => {
    const data = await bossApi.getPipeline();
    setPipeline(data);
    return data;
  }, []);

  const refreshResumeItems = useCallback(async () => {
    const data = await bossApi.getResumeItems();
    setResumeItems(data.items || []);
    return data.items || [];
  }, []);

  const refreshInterviewItems = useCallback(async () => {
    const data = await bossApi.getInterviewItems();
    setInterviewItems(data.items || []);
    return data.items || [];
  }, []);

  const loadConfig = useCallback(async (targetProject?: string) => {
    setLoading(true);
    try {
      const data = await bossApi.getConfig(targetProject ?? projectRef.current);
      setConfig(data);
      setProject(data.project);
      projectRef.current = data.project;
      await loadJobs(data.project, '');
      await refreshPipeline();
      await refreshResumeItems();
      await refreshInterviewItems();
    } catch (error) {
      showNotice(tRef.current('notices.loadFailed', { error: (error as Error).message }));
    } finally {
      setLoading(false);
    }
  }, [loadJobs, refreshInterviewItems, refreshPipeline, refreshResumeItems, showNotice]);

  const refreshJobs = useCallback(async (search = jobSearch) => {
    if (!config) return;
    try {
      await loadJobs(config.project, search);
    } catch (error) {
      showNotice(t('notices.refreshJobsFailed', { error: (error as Error).message }));
    }
  }, [config, jobSearch, loadJobs, showNotice, t]);

  useEffect(() => {
    bossApi.getProjects()
      .then(async (data) => {
        setProjects(data.projects);
        setProject(data.defaultProject);
        await loadConfig(data.defaultProject);
      })
      .catch((error) => showNotice(tRef.current('notices.backendConnectionFailed', { error: (error as Error).message })));
  }, [loadConfig, showNotice]);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      try {
        const data = await bossApi.getTaskStatus();
        setStatus(data.status || (data.running ? 'crawling' : 'ready'));
        setLogs(data.logs || []);
        if (!data.running && !firstStatusLoad.current) refreshJobs();
        firstStatusLoad.current = false;
      } catch {
        // Avoid noisy UI while the backend is starting.
      }
    }, 1500);

    return () => window.clearInterval(timer);
  }, [refreshJobs]);

  const updateConfig = useCallback((patch: ConfigPatch) => {
    setConfig((current) => current ? { ...current, ...patch } : current);
  }, []);

  const requestBody = useCallback(() => {
    if (!config) throw new Error(t('notices.configNotLoaded'));
    return {
      project: config.project,
      keywordsText: config.keywordsText,
      citiesText: config.citiesText,
      maxPages: config.maxPages,
      scrollTarget: config.scrollTarget,
      scrollMax: config.scrollMax,
      minSalary: config.minSalary,
      catRulesText: config.catRulesText,
      relevanceText: config.relevanceText,
      blacklistText: config.blacklistText,
    };
  }, [config]);

  const saveConfig = useCallback(async () => {
    try {
      const saved = await bossApi.saveConfig(requestBody());
      setConfig(saved);
      showNotice(t('notices.configSaved'));
    } catch (error) {
      showNotice(t('notices.saveFailed', { error: (error as Error).message }));
    }
  }, [requestBody, showNotice, t]);

  const startCrawl = useCallback(async () => {
    if (!config) return false;
    try {
      await bossApi.startCrawl({ ...requestBody(), strategyIndex, quickMode, headlessMode, autoSqlite });
      setStatus('crawling');
      return true;
    } catch (error) {
      showNotice(t('notices.startFailed', { error: (error as Error).message }));
      return false;
    }
  }, [autoSqlite, config, headlessMode, quickMode, requestBody, showNotice, strategyIndex, t]);

  const startLogin = useCallback(async () => {
    try {
      await bossApi.startLogin(requestBody());
      setStatus('login');
      return true;
    } catch (error) {
      showNotice(t('notices.loginStartFailed', { error: (error as Error).message }));
      return false;
    }
  }, [requestBody, showNotice, t]);

  const processPartial = useCallback(async () => {
    try {
      await bossApi.processPartial({ ...requestBody(), autoSqlite });
      setStatus('processing-partial');
      return true;
    } catch (error) {
      showNotice(t('notices.processPartialFailed', { error: (error as Error).message }));
      return false;
    }
  }, [autoSqlite, requestBody, showNotice, t]);

  const stopTask = useCallback(async () => {
    try {
      await bossApi.stopTask();
      setStatus('stopping');
      return true;
    } catch (error) {
      showNotice(t('notices.stopFailed', { error: (error as Error).message }));
      return false;
    }
  }, [showNotice, t]);

  const exportJobs = useCallback(() => {
    if (!config) return;
    window.open(bossApi.exportJobsUrl(config.project, jobSearch), '_blank');
  }, [config, jobSearch]);

  const addJobsToPipeline = useCallback(async (jobIds: number[]) => {
    if (!config || !jobIds.length) return false;
    try {
      const data = await bossApi.addJobsToPipeline(config.project, jobIds);
      setPipeline(data);
      showNotice(t('notices.addedToPipeline', { added: data.added || 0, skipped: data.skipped || 0 }));
      return true;
    } catch (error) {
      showNotice(t('notices.addToPipelineFailed', { error: (error as Error).message }));
      return false;
    }
  }, [config, showNotice, t]);

  const scoreJobs = useCallback(async (jobIds: number[]) => {
    if (!config || !jobIds.length) return false;
    setJobScoringIds((ids) => Array.from(new Set([...ids, ...jobIds])));
    try {
      const data = await bossApi.scoreJobs(config.project, jobIds);
      await loadJobs(config.project, jobSearch);
      showNotice(t('notices.jobScoringComplete', { scored: data.scored, errors: data.errors.length ? t('notices.withErrors', { count: data.errors.length }) : '' }));
      return true;
    } catch (error) {
      showNotice(t('notices.jobScoringFailed', { error: (error as Error).message }));
      return false;
    } finally {
      setJobScoringIds((ids) => ids.filter((id) => !jobIds.includes(id)));
    }
  }, [config, jobSearch, loadJobs, showNotice, t]);

  const evaluatePipelineItem = useCallback(async (sourceKey: string) => {
    try {
      const data = await bossApi.evaluatePipelineItem(sourceKey);
      setPipeline(data.pipeline);
      showNotice(t('notices.evalComplete', { score: data.score.toFixed(1), fitLevel: data.fitLevel }));
      return true;
    } catch (error) {
      showNotice(t('notices.evalFailed', { error: (error as Error).message }));
      return false;
    }
  }, [showNotice, t]);

  const scoreAllPipeline = useCallback(async () => {
    try {
      const data = await bossApi.scorePipeline();
      setPipeline(data.pipeline);
      showNotice(t('notices.batchScoreComplete', { scored: data.scored, errors: data.errors.length ? t('notices.withErrors', { count: data.errors.length }) : '' }));
      return true;
    } catch (error) {
      showNotice(t('notices.batchScoreFailed', { error: (error as Error).message }));
      return false;
    }
  }, [showNotice, t]);

  const llmEvaluatePipelineItem = useCallback(async (sourceKey: string) => {
    setLlmEvaluatingKeys((keys) => keys.includes(sourceKey) ? keys : [...keys, sourceKey]);
    showNotice(t('notices.llmEvalStarted'));
    try {
      const data = await bossApi.llmEvaluatePipelineItem(sourceKey);
      setPipeline(data.pipeline);
      showNotice(t('notices.llmEvalComplete', { reportId: data.reportId, scoreInfo: data.summary.score ? `，${data.summary.score.toFixed(1)} / 5.0` : '' }));
      return true;
    } catch (error) {
      showNotice(t('notices.llmEvalFailed', { error: (error as Error).message }));
      return false;
    } finally {
      setLlmEvaluatingKeys((keys) => keys.filter((key) => key !== sourceKey));
    }
  }, [showNotice, t]);

  const loadJobDetail = useCallback(async (projectName: string, jobId: number) => {
    try {
      return await bossApi.getJobItem(projectName, jobId);
    } catch (error) {
      showNotice(t('notices.loadJobDetailFailed', { error: (error as Error).message }));
      return null;
    }
  }, [showNotice, t]);

  const loadPipelineReport = useCallback(async (sourceKey: string) => {
    try {
      return await bossApi.getPipelineReport(sourceKey);
    } catch (error) {
      showNotice(t('notices.loadReportFailed', { error: (error as Error).message }));
      return null;
    }
  }, [showNotice, t]);

  const generateResumeSuggestions = useCallback(async (sourceKey: string): Promise<ResumeSuggestionResponse | null> => {
    setResumeSuggestingKeys((keys) => keys.includes(sourceKey) ? keys : [...keys, sourceKey]);
    showNotice(t('notices.resumeSuggestionGenerating'));
    try {
      const data = await bossApi.generateResumeSuggestions(sourceKey);
      if (data.pipeline) setPipeline(data.pipeline);
      await refreshResumeItems();
      await refreshInterviewItems();
      showNotice(t('notices.resumeSuggestionGenerated', { id: data.resumeSuggestionId }));
      return data;
    } catch (error) {
      showNotice(t('notices.resumeSuggestionFailed', { error: (error as Error).message }));
      return null;
    } finally {
      setResumeSuggestingKeys((keys) => keys.filter((key) => key !== sourceKey));
    }
  }, [refreshInterviewItems, refreshResumeItems, showNotice, t]);

  const loadResumeSuggestion = useCallback(async (sourceKey: string): Promise<ResumeSuggestionResponse | null> => {
    try {
      return await bossApi.getResumeSuggestion(sourceKey);
    } catch (error) {
      showNotice(t('notices.loadResumeSuggestionFailed', { error: (error as Error).message }));
      return null;
    }
  }, [showNotice, t]);

  const generateResumeDraft = useCallback(async (
    sourceKey: string,
    approvedSuggestionIds: string[],
    userNotes: string,
  ): Promise<ResumeDraftResponse | null> => {
    setResumeDraftingKeys((keys) => keys.includes(sourceKey) ? keys : [...keys, sourceKey]);
    showNotice(t('notices.resumeDraftGenerating'));
    try {
      const data = await bossApi.generateResumeDraft(sourceKey, approvedSuggestionIds, userNotes);
      if (data.pipeline) setPipeline(data.pipeline);
      await refreshResumeItems();
      await refreshInterviewItems();
      showNotice(t('notices.resumeDraftGenerated', { id: data.resumeDraftId }));
      return data;
    } catch (error) {
      showNotice(t('notices.resumeDraftFailed', { error: (error as Error).message }));
      return null;
    } finally {
      setResumeDraftingKeys((keys) => keys.filter((key) => key !== sourceKey));
    }
  }, [refreshInterviewItems, refreshResumeItems, showNotice, t]);

  const loadResumeDraft = useCallback(async (sourceKey: string): Promise<ResumeDraftResponse | null> => {
    try {
      return await bossApi.getResumeDraft(sourceKey);
    } catch (error) {
      showNotice(t('notices.loadResumeDraftFailed', { error: (error as Error).message }));
      return null;
    }
  }, [showNotice, t]);

  const loadInterviewStoryBank = useCallback(async (): Promise<InterviewStoryBankResponse | null> => {
    try {
      return await bossApi.getInterviewStoryBank();
    } catch (error) {
      showNotice(t('notices.loadStoryBankFailed', { error: (error as Error).message }));
      return null;
    }
  }, [showNotice, t]);

  const saveInterviewStoryBank = useCallback(async (stories: InterviewStory[]): Promise<InterviewStoryBankResponse | null> => {
    try {
      const data = await bossApi.saveInterviewStoryBank(stories);
      showNotice(t('notices.storyBankSaved'));
      return data;
    } catch (error) {
      showNotice(t('notices.saveStoryBankFailed', { error: (error as Error).message }));
      return null;
    }
  }, [showNotice, t]);

  const loadInterviewStoryDrafts = useCallback(async (): Promise<InterviewStoryDraftsResponse | null> => {
    try {
      return await bossApi.getInterviewStoryDrafts();
    } catch (error) {
      showNotice(t('notices.loadStoryDraftsFailed', { error: (error as Error).message }));
      return null;
    }
  }, [showNotice, t]);

  const saveInterviewStoryDrafts = useCallback(async (drafts: InterviewStoryDraft[]): Promise<InterviewStoryDraftsResponse | null> => {
    try {
      const data = await bossApi.saveInterviewStoryDrafts(drafts);
      showNotice(t('notices.storyDraftsSaved'));
      return data;
    } catch (error) {
      showNotice(t('notices.saveStoryDraftsFailed', { error: (error as Error).message }));
      return null;
    }
  }, [showNotice, t]);

  const promoteInterviewStoryDraft = useCallback(async (
    draftId: string,
    draft: InterviewStoryDraft,
  ): Promise<InterviewStoryDraftPromoteResponse | null> => {
    try {
      const data = await bossApi.promoteInterviewStoryDraft(draftId, draft);
      showNotice(t('notices.storyDraftPromoted'));
      return data;
    } catch (error) {
      showNotice(t('notices.storyDraftPromoteFailed', { error: (error as Error).message }));
      return null;
    }
  }, [showNotice, t]);

  const generateInterviewPrep = useCallback(async (
    sourceKey: string,
    userNotes: string,
  ): Promise<InterviewPrepResponse | null> => {
    setInterviewPreparingKeys((keys) => keys.includes(sourceKey) ? keys : [...keys, sourceKey]);
    showNotice(t('notices.interviewPrepGenerating'));
    try {
      const data = await bossApi.generateInterviewPrep(sourceKey, userNotes);
      if (data.pipeline) setPipeline(data.pipeline);
      await refreshInterviewItems();
      showNotice(t('notices.interviewPrepGenerated', { id: data.interviewPrepId }));
      return data;
    } catch (error) {
      showNotice(t('notices.interviewPrepFailed', { error: (error as Error).message }));
      return null;
    } finally {
      setInterviewPreparingKeys((keys) => keys.filter((key) => key !== sourceKey));
    }
  }, [refreshInterviewItems, showNotice, t]);

  const loadInterviewPrep = useCallback(async (sourceKey: string): Promise<InterviewPrepResponse | null> => {
    try {
      return await bossApi.getInterviewPrep(sourceKey);
    } catch (error) {
      showNotice(t('notices.loadInterviewPrepFailed', { error: (error as Error).message }));
      return null;
    }
  }, [showNotice, t]);

  const updatePipelineStatus = useCallback(async (sourceKey: string, decisionStatus: string) => {
    try {
      const data = await bossApi.updatePipelineStatus(sourceKey, decisionStatus);
      setPipeline(data);
      showNotice(t('notices.pipelineStatusUpdated'));
      return true;
    } catch (error) {
      showNotice(t('notices.updateStatusFailed', { error: (error as Error).message }));
      return false;
    }
  }, [showNotice, t]);

  const deletePipelineItem = useCallback(async (sourceKey: string) => {
    try {
      const data = await bossApi.deletePipelineItem(sourceKey);
      setPipeline(data);
      await refreshResumeItems();
      await refreshInterviewItems();
      const deletedResumeCount = data.deletedResumeArtifacts?.length || 0;
      const deletedInterviewCount = data.deletedInterviewArtifacts?.length || 0;
      const reportsDeleted = data.deletedReports.length ? t('notices.withReportsDeleted', { count: data.deletedReports.length }) : '';
      const resumeArtsDeleted = deletedResumeCount ? t('notices.withResumeArtsDeleted', { count: deletedResumeCount }) : '';
      const interviewArtsDeleted = deletedInterviewCount ? t('notices.withInterviewArtsDeleted', { count: deletedInterviewCount }) : '';
      showNotice(t('notices.pipelineItemDeleted', { reports: reportsDeleted, resumeArts: resumeArtsDeleted, interviewArts: interviewArtsDeleted }));
      return true;
    } catch (error) {
      showNotice(t('notices.deleteFailed', { error: (error as Error).message }));
      return false;
    }
  }, [refreshInterviewItems, refreshResumeItems, showNotice, t]);

  return {
    status,
    projects,
    project,
    config,
    jobs,
    jobsTotal,
    pipeline,
    resumeItems,
    interviewItems,
    jobSearch,
    sortJobsByScore,
    sortPipelineByLlmScore,
    logs,
    parsedLogs,
    recentLogs,
    strategyIndex,
    quickMode,
    headlessMode,
    autoSqlite,
    notice,
    loading,
    jobScoringIds,
    llmEvaluatingKeys,
    resumeSuggestingKeys,
    resumeDraftingKeys,
    interviewPreparingKeys,
    isRunning,
    setJobSearch,
    setSortJobsByScore,
    setSortPipelineByLlmScore,
    setStrategyIndex,
    setQuickMode,
    setHeadlessMode,
    setAutoSqlite,
    loadConfig,
    refreshJobs,
    refreshPipeline,
    refreshResumeItems,
    refreshInterviewItems,
    updateConfig,
    saveConfig,
    startCrawl,
    startLogin,
    processPartial,
    stopTask,
    exportJobs,
    addJobsToPipeline,
    scoreJobs,
    evaluatePipelineItem,
    scoreAllPipeline,
    llmEvaluatePipelineItem,
    loadJobDetail,
    loadPipelineReport,
    generateResumeSuggestions,
    loadResumeSuggestion,
    generateResumeDraft,
    loadResumeDraft,
    loadInterviewStoryBank,
    saveInterviewStoryBank,
    loadInterviewStoryDrafts,
    saveInterviewStoryDrafts,
    promoteInterviewStoryDraft,
    generateInterviewPrep,
    loadInterviewPrep,
    updatePipelineStatus,
    deletePipelineItem,
  };
}
