import { useCallback, useState } from 'react';
import { bossApi } from '../api';
import type { PipelineResponse } from '../types';

export function usePipeline({
  showNotice,
  t,
}: {
  showNotice: (message: string) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const [pipeline, setPipeline] = useState<PipelineResponse | null>(null);
  const [sortPipelineByLlmScore, setSortPipelineByLlmScore] = useState(false);
  const [llmEvaluatingKeys, setLlmEvaluatingKeys] = useState<string[]>([]);

  const refreshPipeline = useCallback(async () => {
    const data = await bossApi.getPipeline();
    setPipeline(data);
    return data;
  }, []);

  const addJobsToPipeline = useCallback(async (projectName: string | undefined, jobIds: number[]) => {
    if (!projectName || !jobIds.length) return false;
    try {
      const data = await bossApi.addJobsToPipeline(projectName, jobIds);
      setPipeline(data);
      showNotice(t('notices.addedToPipeline', { added: data.added || 0, skipped: data.skipped || 0 }));
      return true;
    } catch (error) {
      showNotice(t('notices.addToPipelineFailed', { error: (error as Error).message }));
      return false;
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
      const data = await bossApi.scorePipeline();
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
  }, [showNotice, t]);

  const llmEvaluatePipelineItem = useCallback(async (sourceKey: string) => {
    setLlmEvaluatingKeys((keys) => keys.includes(sourceKey) ? keys : [...keys, sourceKey]);
    showNotice(t('notices.llmEvalStarted'));
    try {
      const data = await bossApi.llmEvaluatePipelineItem(sourceKey);
      setPipeline(data.pipeline);
      showNotice(t('notices.llmEvalComplete', {
        reportId: data.reportId,
        scoreInfo: data.summary.score ? `，${data.summary.score.toFixed(1)} / 5.0` : '',
      }));
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
    loadJobDetail,
    loadPipelineReport,
    updatePipelineStatus,
    deletePipelineItem,
  };
}
