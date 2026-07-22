import { useCallback, useRef, useState } from 'react';
import { bossApi } from '../api';
import type {
  GreetingDraftResponse,
  GreetingDraftStatus,
  GreetingPreflightResponse,
  GreetingPrepareResponse,
  PipelineResponse,
} from '../types';

export function usePipeline({
  showNotice,
  t,
  getProject,
}: {
  showNotice: (message: string) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  getProject: () => string;
}) {
  const [pipeline, setPipeline] = useState<PipelineResponse | null>(null);
  const [sortPipelineByLlmScore, setSortPipelineByLlmScore] = useState(false);
  const [llmEvaluatingKeys, setLlmEvaluatingKeys] = useState<string[]>([]);
  const llmEvaluationActiveCountRef = useRef(0);
  const llmEvaluationPendingTasksRef = useRef<Array<() => Promise<void>>>([]);
  const queuedLlmEvaluationKeysRef = useRef(new Set<string>());

  const refreshPipeline = useCallback(async (project = getProject()) => {
    const data = await bossApi.getPipeline(project);
    if (getProject() === project) setPipeline(data);
    return data;
  }, [getProject]);

  const addJobsToPipeline = useCallback(async (projectName: string | undefined, jobIds: number[]) => {
    if (!projectName || !jobIds.length) return null;
    try {
      const data = await bossApi.addJobsToPipeline(projectName, jobIds);
      setPipeline(data);
      showNotice(t('notices.addedToPipeline', { added: data.added || 0, skipped: data.skipped || 0 }));
      return data;
    } catch (error) {
      showNotice(t('notices.addToPipelineFailed', { error: (error as Error).message }));
      return null;
    }
  }, [showNotice, t]);

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
      const data = await bossApi.scorePipeline(getProject());
      setPipeline(data.pipeline);
      showNotice(t('notices.batchScoreComplete', {
        scored: data.scored,
        errors: data.errors.length ? t('notices.withErrors', { count: data.errors.length }) : '',
      }));
      return true;
    } catch (error) {
      showNotice(t('notices.batchScoreFailed', { error: (error as Error).message }));
      return false;
    }
  }, [getProject, showNotice, t]);

  const queueLlmEvaluatePipelineItems = useCallback((sourceKeys: string[], notifyEach = false) => {
    const uniqueKeys = [...new Set(sourceKeys)].filter((sourceKey) => {
      if (!sourceKey || queuedLlmEvaluationKeysRef.current.has(sourceKey)) return false;
      queuedLlmEvaluationKeysRef.current.add(sourceKey);
      return true;
    });
    if (!uniqueKeys.length) return Promise.resolve({ queued: 0, succeeded: 0, failed: 0 });

    setLlmEvaluatingKeys((keys) => [...new Set([...keys, ...uniqueKeys])]);
    if (uniqueKeys.length > 1) showNotice(t('notices.llmEvalBatchQueued', { count: uniqueKeys.length }));

    const schedulePendingTasks = () => {
      while (llmEvaluationActiveCountRef.current < 5 && llmEvaluationPendingTasksRef.current.length) {
        const pendingTask = llmEvaluationPendingTasksRef.current.shift();
        if (!pendingTask) break;
        llmEvaluationActiveCountRef.current += 1;
        void pendingTask().finally(() => {
          llmEvaluationActiveCountRef.current -= 1;
          schedulePendingTasks();
        });
      }
    };

    const tasks = uniqueKeys.map((sourceKey) => new Promise<boolean>((resolve) => {
      llmEvaluationPendingTasksRef.current.push(async () => {
        if (notifyEach) showNotice(t('notices.llmEvalStarted'));
        try {
          const data = await bossApi.llmEvaluatePipelineItem(sourceKey);
          setPipeline(data.pipeline);
          if (notifyEach) {
            showNotice(t('notices.llmEvalComplete', {
              reportId: data.reportId,
              scoreInfo: data.summary.score ? `，${data.summary.score.toFixed(1)} / 5.0` : '',
            }));
          }
          resolve(true);
        } catch (error) {
          if (notifyEach) showNotice(t('notices.llmEvalFailed', { error: (error as Error).message }));
          resolve(false);
        } finally {
          queuedLlmEvaluationKeysRef.current.delete(sourceKey);
          setLlmEvaluatingKeys((keys) => keys.filter((key) => key !== sourceKey));
        }
      });
      schedulePendingTasks();
    }));

    return Promise.all(tasks).then((results) => {
      const succeeded = results.filter(Boolean).length;
      const failed = results.length - succeeded;
      if (!notifyEach || results.length > 1) {
        showNotice(t('notices.llmEvalBatchComplete', { succeeded, failed }));
      }
      return { queued: uniqueKeys.length, succeeded, failed };
    });
  }, [showNotice, t]);

  const llmEvaluatePipelineItem = useCallback(async (sourceKey: string) => {
    const result = await queueLlmEvaluatePipelineItems([sourceKey], true);
    return result.succeeded === 1;
  }, [queueLlmEvaluatePipelineItems]);

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

  const loadGreetingDraft = useCallback(async (sourceKey: string): Promise<GreetingDraftResponse | null> => {
    try {
      return await bossApi.getGreetingDraft(sourceKey);
    } catch (error) {
      showNotice(t('notices.loadGreetingDraftFailed', { error: (error as Error).message }));
      return null;
    }
  }, [showNotice, t]);

  const saveGreetingDraft = useCallback(async (
    sourceKey: string,
    editedText: string,
    status: GreetingDraftStatus,
  ): Promise<GreetingDraftResponse | null> => {
    try {
      const data = await bossApi.saveGreetingDraft(sourceKey, editedText, status);
      if (data.pipeline) setPipeline(data.pipeline);
      showNotice(t('notices.greetingDraftSaved'));
      return data;
    } catch (error) {
      showNotice(t('notices.greetingDraftSaveFailed', { error: (error as Error).message }));
      return null;
    }
  }, [showNotice, t]);

  const preflightGreeting = useCallback(async (
    sourceKey: string,
    message: string,
  ): Promise<GreetingPreflightResponse | null> => {
    try {
      return await bossApi.preflightGreeting(sourceKey, message);
    } catch (error) {
      showNotice(t('notices.greetingPreflightFailed', { error: (error as Error).message }));
      return null;
    }
  }, [showNotice, t]);

  const prepareGreeting = useCallback(async (
    sourceKey: string,
    message: string,
  ): Promise<GreetingPrepareResponse | null> => {
    try {
      const data = await bossApi.prepareGreeting(sourceKey, message);
      showNotice(t('notices.greetingPrepareStarted'));
      return data;
    } catch (error) {
      showNotice(t('notices.greetingPrepareFailed', { error: (error as Error).message }));
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
      const deletedResumeCount = data.deletedResumeArtifacts?.length || 0;
      const deletedInterviewCount = data.deletedInterviewArtifacts?.length || 0;
      const reportsDeleted = data.deletedReports.length ? t('notices.withReportsDeleted', { count: data.deletedReports.length }) : '';
      const resumeArtsDeleted = deletedResumeCount ? t('notices.withResumeArtsDeleted', { count: deletedResumeCount }) : '';
      const interviewArtsDeleted = deletedInterviewCount ? t('notices.withInterviewArtsDeleted', { count: deletedInterviewCount }) : '';
      showNotice(t('notices.pipelineItemDeleted', {
        reports: reportsDeleted,
        resumeArts: resumeArtsDeleted,
        interviewArts: interviewArtsDeleted,
      }));
      return true;
    } catch (error) {
      showNotice(t('notices.deleteFailed', { error: (error as Error).message }));
      return false;
    }
  }, [showNotice, t]);

  return {
    pipeline,
    sortPipelineByLlmScore,
    setSortPipelineByLlmScore,
    llmEvaluatingKeys,
    refreshPipeline,
    addJobsToPipeline,
    evaluatePipelineItem,
    scoreAllPipeline,
    llmEvaluatePipelineItem,
    queueLlmEvaluatePipelineItems,
    loadJobDetail,
    loadPipelineReport,
    loadGreetingDraft,
    saveGreetingDraft,
    preflightGreeting,
    prepareGreeting,
    updatePipelineStatus,
    deletePipelineItem,
  };
}
