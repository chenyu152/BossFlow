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
  ProficiencyLevel,
} from '../types';

export function useEvidence(getProject: () => string) {
  const [evidenceOverview, setEvidenceOverview] = useState<EvidenceOverviewResponse | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState('');

  const refreshEvidenceOverview = useCallback(async (project = getProject()) => {
    setEvidenceLoading(true);
    setEvidenceError('');
    try {
      const data = await bossApi.getEvidenceOverview(project);
      if (getProject() === project) setEvidenceOverview(data);
      return data;
    } catch (error) {
      setEvidenceError((error as Error).message);
      return null;
    } finally {
      setEvidenceLoading(false);
    }
  }, [getProject]);

  const applyMutation = useCallback((data: EvidenceMutationResponse) => {
    setEvidenceOverview(data.overview);
    setEvidenceError('');
    return data;
  }, []);

  const upsertEvidenceRequirements = useCallback(async (requirements: EvidenceRequirement[]) => {
    try {
      const data = await bossApi.upsertEvidenceRequirements(getProject(), requirements);
      setEvidenceOverview(data);
      setEvidenceError('');
      return data;
    } catch (error) {
      setEvidenceError((error as Error).message);
      return null;
    }
  }, [getProject]);

  const classifyEvidenceCoverage = useCallback(async (
    requirementId: string,
    classification: EvidenceClassification,
    evidenceIds: string[] = [],
    rationale = '',
    confidence = 0,
    userProficiency: ProficiencyLevel = 'unspecified',
  ) => {
    try {
      return applyMutation(await bossApi.classifyEvidenceCoverage(
        getProject(),
        requirementId,
        classification,
        evidenceIds,
        rationale,
        confidence,
        userProficiency,
      ));
    } catch (error) {
      setEvidenceError((error as Error).message);
      return null;
    }
  }, [applyMutation, getProject]);

  const classifyCapability = useCallback(async (
    capabilityId: string,
    classification: EvidenceClassification,
    evidenceIds: string[] = [],
    rationale = '',
    confidence = 1,
    userProficiency: ProficiencyLevel = 'unspecified',
  ) => {
    try {
      return applyMutation(await bossApi.classifyCapability(
        getProject(),
        capabilityId,
        classification,
        evidenceIds,
        rationale,
        confidence,
        userProficiency,
      ));
    } catch (error) {
      setEvidenceError((error as Error).message);
      return null;
    }
  }, [applyMutation, getProject]);

  const createEvidenceItem = useCallback(async (item: EvidenceItemInput) => {
    try {
      return applyMutation(await bossApi.createEvidenceItem(getProject(), item));
    } catch (error) {
      setEvidenceError((error as Error).message);
      return null;
    }
  }, [applyMutation, getProject]);

  const updateEvidenceItem = useCallback(async (item: EvidenceItem) => {
    try {
      return applyMutation(await bossApi.updateEvidenceItem(getProject(), item));
    } catch (error) {
      setEvidenceError((error as Error).message);
      return null;
    }
  }, [applyMutation, getProject]);

  const confirmEvidenceItem = useCallback(async (evidenceId: string) => {
    try {
      return applyMutation(await bossApi.confirmEvidenceItem(getProject(), evidenceId));
    } catch (error) {
      setEvidenceError((error as Error).message);
      return null;
    }
  }, [applyMutation, getProject]);

  const createEvidenceTask = useCallback(async (task: EvidenceTaskInput) => {
    try {
      return applyMutation(await bossApi.createEvidenceTask(getProject(), task));
    } catch (error) {
      setEvidenceError((error as Error).message);
      return null;
    }
  }, [applyMutation, getProject]);

  const updateEvidenceTask = useCallback(async (
    taskId: string,
    status: EvidenceTaskStatus,
    completionEvidenceIds: string[] = [],
    progressPercent = 0,
    nextStep = '',
    progressNotes: string[] = [],
    currentProficiency: ProficiencyLevel = 'unspecified',
    targetProficiency: ProficiencyLevel = 'working',
  ) => {
    try {
      return applyMutation(await bossApi.updateEvidenceTask(
        getProject(),
        taskId,
        status,
        completionEvidenceIds,
        progressPercent,
        nextStep,
        progressNotes,
        currentProficiency,
        targetProficiency,
      ));
    } catch (error) {
      setEvidenceError((error as Error).message);
      return null;
    }
  }, [applyMutation, getProject]);

  return {
    evidenceOverview,
    evidenceLoading,
    evidenceError,
    refreshEvidenceOverview,
    upsertEvidenceRequirements,
    classifyEvidenceCoverage,
    classifyCapability,
    createEvidenceItem,
    updateEvidenceItem,
    confirmEvidenceItem,
    createEvidenceTask,
    updateEvidenceTask,
  };
}
