import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useInterview } from './useInterview';
import { useEvidence } from './useEvidence';
import { useJobs } from './useJobs';
import { useNotice } from './useNotice';
import { usePipeline } from './usePipeline';
import { useProjectsConfig } from './useProjectsConfig';
import { useResume } from './useResume';
import { useTasks } from './useTasks';

type ResourceKey = 'jobs' | 'pipeline' | 'resume' | 'interview' | 'evidence';

export function useBossSpider() {
  const { t } = useTranslation('common');
  const { notice, showNotice } = useNotice();
  const activeProjectRef = useRef('agent');
  const getActiveProject = useCallback(() => activeProjectRef.current, []);
  const evidence = useEvidence(getActiveProject);

  const {
    jobs,
    jobsTotal,
    jobSearch,
    sortJobsByScore,
    jobScoringIds,
    setJobSearch,
    setSortJobsByScore,
    loadJobs,
    refreshJobs: refreshJobsForProject,
    exportJobs: exportJobsForProject,
    scoreJobs: scoreJobsForProject,
  } = useJobs({ showNotice, t });

  const {
    pipeline,
    sortPipelineByLlmScore,
    setSortPipelineByLlmScore,
    llmEvaluatingKeys,
    refreshPipeline,
    addJobsToPipeline: addJobsToPipelineForProject,
    evaluatePipelineItem,
    scoreAllPipeline,
    llmEvaluatePipelineItem: llmEvaluatePipelineItemBase,
    loadJobDetail,
    loadPipelineReport,
    loadGreetingDraft,
    saveGreetingDraft,
    updatePipelineStatus,
    deletePipelineItem: deletePipelineItemBase,
  } = usePipeline({ showNotice, t, getProject: getActiveProject });

  const {
    interviewItems,
    interviewPreparingKeys,
    refreshInterviewItems,
    loadInterviewStoryBank,
    saveInterviewStoryBank,
    loadInterviewStoryDrafts,
    saveInterviewStoryDrafts,
    promoteInterviewStoryDraft,
    generateInterviewPrep: generateInterviewPrepBase,
    loadInterviewPrep,
  } = useInterview({ showNotice, t, getProject: getActiveProject });

  const {
    resumeItems,
    resumeSuggestingKeys,
    resumeDraftingKeys,
    refreshResumeItems,
    generateResumeSuggestions: generateResumeSuggestionsBase,
    loadResumeSuggestion,
    generateResumeDraft: generateResumeDraftBase,
    loadResumeDraft,
    saveResumeDraft,
  } = useResume({ showNotice, t, getProject: getActiveProject });

  const loadInitialResources = useCallback(async (projectName: string) => {
    activeProjectRef.current = projectName;
    await Promise.all([
      loadJobs(projectName, ''),
      refreshPipeline(projectName),
      refreshResumeItems(projectName),
      refreshInterviewItems(projectName),
      evidence.refreshEvidenceOverview(projectName),
    ]);
  }, [evidence.refreshEvidenceOverview, loadJobs, refreshInterviewItems, refreshPipeline, refreshResumeItems]);

  const {
    projects,
    project,
    config,
    loading,
    isConfigDirty,
    loadConfig,
    updateConfig,
    requestBody,
    saveConfig,
    createProject,
  } = useProjectsConfig({
    loadInitialResources,
    showNotice,
    t,
  });

  const refreshJobs = useCallback(async (search = jobSearch) => {
    await refreshJobsForProject(config?.project, search);
  }, [config?.project, jobSearch, refreshJobsForProject]);

  const {
    status,
    logs,
    parsedLogs,
    recentLogs,
    isRunning,
    startCrawl,
    startLogin,
    processPartial,
    startLiveStatusUpdate,
    stopTask,
  } = useTasks({
    configReady: Boolean(config),
    refreshJobs,
    requestBody,
    showNotice,
    t,
  });

  const exportJobs = useCallback(() => {
    exportJobsForProject(config?.project);
  }, [config?.project, exportJobsForProject]);

  const addJobsToPipeline = useCallback(async (jobIds: number[]) => (
    addJobsToPipelineForProject(config?.project, jobIds)
  ), [addJobsToPipelineForProject, config?.project]);

  const scoreJobs = useCallback(async (jobIds: number[]) => (
    scoreJobsForProject(config?.project, jobIds)
  ), [config?.project, scoreJobsForProject]);

  const updateJobLiveStatus = useCallback(async (options: {
    jobIds?: number[];
    limit?: number;
    workers?: number;
  } = {}) => {
    if (!config?.project) {
      showNotice(t('notices.configNotLoaded'));
      return false;
    }
    const ok = await startLiveStatusUpdate({
      project: config.project,
      jobIds: options.jobIds || [],
      limit: options.limit,
      skipClosed: true,
      workers: options.workers ?? 1,
      sleepSeconds: 5,
      browserWaitSeconds: 6,
      headless: true,
      interactiveOnCaptcha: true,
      verificationTimeoutSeconds: 240,
    });
    if (ok) showNotice(t('notices.liveStatusStarted'));
    return ok;
  }, [config?.project, showNotice, startLiveStatusUpdate, t]);

  const invalidate = useCallback(async (resources: ResourceKey[]) => {
    const unique = new Set(resources);
    const tasks: Promise<unknown>[] = [];
    if (unique.has('jobs')) tasks.push(refreshJobsForProject(config?.project, jobSearch));
    if (unique.has('pipeline')) tasks.push(refreshPipeline());
    if (unique.has('resume')) tasks.push(refreshResumeItems());
    if (unique.has('interview')) tasks.push(refreshInterviewItems());
    if (unique.has('evidence')) tasks.push(evidence.refreshEvidenceOverview());
    await Promise.all(tasks);
  }, [config?.project, evidence.refreshEvidenceOverview, jobSearch, refreshInterviewItems, refreshJobsForProject, refreshPipeline, refreshResumeItems]);

  const generateResumeSuggestions = useCallback(async (sourceKey: string) => {
    const data = await generateResumeSuggestionsBase(sourceKey);
    if (data) await invalidate(['pipeline', 'resume', 'interview']);
    return data;
  }, [generateResumeSuggestionsBase, invalidate]);

  const llmEvaluatePipelineItem = useCallback(async (sourceKey: string) => {
    const ok = await llmEvaluatePipelineItemBase(sourceKey);
    if (ok) await invalidate(['evidence']);
    return ok;
  }, [invalidate, llmEvaluatePipelineItemBase]);

  const generateResumeDraft = useCallback(async (
    sourceKey: string,
    approvedSuggestionIds: string[],
    userNotes: string,
  ) => {
    const data = await generateResumeDraftBase(sourceKey, approvedSuggestionIds, userNotes);
    if (data) await invalidate(['pipeline', 'resume', 'interview']);
    return data;
  }, [generateResumeDraftBase, invalidate]);

  const generateInterviewPrep = useCallback(async (sourceKey: string, userNotes: string) => {
    const data = await generateInterviewPrepBase(sourceKey, userNotes);
    if (data) await invalidate(['pipeline', 'interview']);
    return data;
  }, [generateInterviewPrepBase, invalidate]);

  const deletePipelineItem = useCallback(async (sourceKey: string) => {
    const ok = await deletePipelineItemBase(sourceKey);
    if (ok) await invalidate(['resume', 'interview']);
    return ok;
  }, [deletePipelineItemBase, invalidate]);

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
    notice,
    loading,
    isConfigDirty,
    jobScoringIds,
    llmEvaluatingKeys,
    resumeSuggestingKeys,
    resumeDraftingKeys,
    interviewPreparingKeys,
    isRunning,
    setJobSearch,
    setSortJobsByScore,
    setSortPipelineByLlmScore,
    loadConfig,
    refreshJobs,
    refreshPipeline,
    refreshResumeItems,
    refreshInterviewItems,
    updateConfig,
    saveConfig,
    createProject,
    startCrawl,
    startLogin,
    processPartial,
    stopTask,
    exportJobs,
    addJobsToPipeline,
    scoreJobs,
    updateJobLiveStatus,
    evaluatePipelineItem,
    scoreAllPipeline,
    llmEvaluatePipelineItem,
    loadJobDetail,
    loadPipelineReport,
    loadGreetingDraft,
    saveGreetingDraft,
    generateResumeSuggestions,
    loadResumeSuggestion,
    generateResumeDraft,
    loadResumeDraft,
    saveResumeDraft,
    loadInterviewStoryBank,
    saveInterviewStoryBank,
    loadInterviewStoryDrafts,
    saveInterviewStoryDrafts,
    promoteInterviewStoryDraft,
    generateInterviewPrep,
    loadInterviewPrep,
    updatePipelineStatus,
    deletePipelineItem,
    ...evidence,
  };
}
