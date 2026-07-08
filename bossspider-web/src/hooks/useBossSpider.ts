import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useInterview } from './useInterview';
import { useJobs } from './useJobs';
import { useNotice } from './useNotice';
import { usePipeline } from './usePipeline';
import { useProjectsConfig } from './useProjectsConfig';
import { useResume } from './useResume';
import { useTasks } from './useTasks';

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
    setPipeline,
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
    generateInterviewPrep,
    loadInterviewPrep,
  } = useInterview({ setPipeline, showNotice, t });

  const {
    resumeItems,
    resumeSuggestingKeys,
    resumeDraftingKeys,
    refreshResumeItems,
    generateResumeSuggestions,
    loadResumeSuggestion,
    generateResumeDraft,
    loadResumeDraft,
  } = useResume({
    refreshInterviewItems,
    setPipeline,
    showNotice,
    t,
  });

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
    loadJobs,
    refreshInterviewItems,
    refreshPipeline,
    refreshResumeItems,
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

  const deletePipelineItem = useCallback(async (sourceKey: string) => (
    deletePipelineItemBase(sourceKey, async () => {
      await refreshResumeItems();
      await refreshInterviewItems();
    })
  ), [deletePipelineItemBase, refreshInterviewItems, refreshResumeItems]);

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
