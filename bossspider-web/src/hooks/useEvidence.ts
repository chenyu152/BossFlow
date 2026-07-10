import { useCallback, useState } from 'react';
import { bossApi } from '../api';
import type {
  EvidenceClassification,
  EvidenceItem,
  EvidenceItemInput,
  EvidenceMutationResponse,
  EvidenceOverviewResponse,
  EvidenceRequirement,
  EvidenceTaskInput,
  EvidenceTaskStatus,
} from '../types';

export function useEvidence() {
  const [evidenceOverview, setEvidenceOverview] = useState<EvidenceOverviewResponse | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState('');

  const refreshEvidenceOverview = useCallback(async () => {
    setEvidenceLoading(true);
    setEvidenceError('');
    try {
      const data = await bossApi.getEvidenceOverview();
      setEvidenceOverview(data);
      return data;
    } catch (error) {
      setEvidenceError((error as Error).message);
      return null;
    } finally {
      setEvidenceLoading(false);
    }
  }, []);

  const applyMutation = useCallback((data: EvidenceMutationResponse) => {
    setEvidenceOverview(data.overview);
    setEvidenceError('');
    return data;
  }, []);

  const upsertEvidenceRequirements = useCallback(async (requirements: EvidenceRequirement[]) => {
    try {
      const data = await bossApi.upsertEvidenceRequirements(requirements);
      setEvidenceOverview(data);
      setEvidenceError('');
      return data;
    } catch (error) {
      setEvidenceError((error as Error).message);
      return null;
    }
  }, []);

  const classifyEvidenceCoverage = useCallback(async (
    requirementId: string,
    classification: EvidenceClassification,
    evidenceIds: string[] = [],
    rationale = '',
    confidence = 0,
  ) => {
    try {
      return applyMutation(await bossApi.classifyEvidenceCoverage(
        requirementId,
        classification,
        evidenceIds,
        rationale,
        confidence,
      ));
    } catch (error) {
      setEvidenceError((error as Error).message);
      return null;
    }
  }, [applyMutation]);

  const createEvidenceItem = useCallback(async (item: EvidenceItemInput) => {
    try {
      return applyMutation(await bossApi.createEvidenceItem(item));
    } catch (error) {
      setEvidenceError((error as Error).message);
      return null;
    }
  }, [applyMutation]);

  const updateEvidenceItem = useCallback(async (item: EvidenceItem) => {
    try {
      return applyMutation(await bossApi.updateEvidenceItem(item));
    } catch (error) {
      setEvidenceError((error as Error).message);
      return null;
    }
  }, [applyMutation]);

  const confirmEvidenceItem = useCallback(async (evidenceId: string) => {
    try {
      return applyMutation(await bossApi.confirmEvidenceItem(evidenceId));
    } catch (error) {
      setEvidenceError((error as Error).message);
      return null;
    }
  }, [applyMutation]);

  const createEvidenceTask = useCallback(async (task: EvidenceTaskInput) => {
    try {
      return applyMutation(await bossApi.createEvidenceTask(task));
    } catch (error) {
      setEvidenceError((error as Error).message);
      return null;
    }
  }, [applyMutation]);

  const updateEvidenceTask = useCallback(async (
    taskId: string,
    status: EvidenceTaskStatus,
    completionEvidenceIds: string[] = [],
  ) => {
    try {
      return applyMutation(await bossApi.updateEvidenceTask(taskId, status, completionEvidenceIds));
    } catch (error) {
      setEvidenceError((error as Error).message);
      return null;
    }
  }, [applyMutation]);

  return {
    evidenceOverview,
    evidenceLoading,
    evidenceError,
    refreshEvidenceOverview,
    upsertEvidenceRequirements,
    classifyEvidenceCoverage,
    createEvidenceItem,
    updateEvidenceItem,
    confirmEvidenceItem,
    createEvidenceTask,
    updateEvidenceTask,
  };
}
