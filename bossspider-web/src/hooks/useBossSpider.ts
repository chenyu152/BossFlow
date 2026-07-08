import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useInterview } from './useInterview';
import { useJobs } from './useJobs';
import { useNotice } from './useNotice';
import { usePipeline } from './usePipeline';
import { useProjectsConfig } from './useProjectsConfig';
import { useResume } from './useResume';
import { useTasks } from './useTasks';

type ResourceKey = 'jobs' | 'pipeline' | 'resume' | 'interview';

export function useBossSpider() {
  const { t } = useTranslation('common');
  const [strategyIndex, setStrategyIndex] = useState(0);
  const [quickMode, setQuickMode] = useState(false);
  const [headlessMode, setHeadlessMode] = useState(true);
  const [autoSqlite, setAutoSqlite] = useState(true);
  const { notice, showNotice } = useNotice();

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
    llmEvaluatePipelineItem,
    loadJobDetail,
    loadPipelineReport,
    updatePipelineStatus,
    deletePipelineItem: deletePipelineItemBase,
  } = usePipeline({ showNotice, t });

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
  } = useInterview({ showNotice, t });

  const {
    resumeItems,
    resumeSuggestingKeys,
    resumeDraftingKeys,
    refreshResumeItems,
    generateResumeSuggestions: generateResumeSuggestionsBase,
    loadResumeSuggestion,
    generateResumeDraft: generateResumeDraftBase,
    loadResumeDraft,
  } = useResume({ showNotice, t });

  const loadInitialResources = useCallback(async (projectName: string) => {
    await Promise.all([
      loadJobs(projectName, ''),
      refreshPipeline(),
      refreshResumeItems(),
      refreshInterviewItems(),
    ]);
  }, [loadJobs, refreshInterviewItems, refreshPipeline, refreshResumeItems]);

  const {
    projects,
    project,
    config,
    loading,
    loadConfig,
    updateConfig,
    requestBody,
    saveConfig,
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
    stopTask,
  } = useTasks({
    autoSqlite,
    configReady: Boolean(config),
    headlessMode,
    quickMode,
    refreshJobs,
    requestBody,
    showNotice,
    strategyIndex,
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

  const invalidate = useCallback(async (resources: ResourceKey[]) => {
    const unique = new Set(resources);
    const tasks: Promise<unknown>[] = [];
    if (unique.has('jobs')) tasks.push(refreshJobsForProject(config?.project, jobSearch));
    if (unique.has('pipeline')) tasks.push(refreshPipeline());
    if (unique.has('resume')) tasks.push(refreshResumeItems());
    if (unique.has('interview')) tasks.push(refreshInterviewItems());
    await Promise.all(tasks);
  }, [config?.project, jobSearch, refreshInterviewItems, refreshJobsForProject, refreshPipeline, refreshResumeItems]);

  const generateResumeSuggestions = useCallback(async (sourceKey: string) => {
    const data = await generateResumeSuggestionsBase(sourceKey);
    if (data) await invalidate(['pipeline', 'resume', 'interview']);
    return data;
  }, [generateResumeSuggestionsBase, invalidate]);

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
