import { useCallback, useState } from 'react';
import { bossApi } from '../api';
import type { PipelineResponse, ResumeDraftResponse, ResumeItem, ResumeSuggestionResponse } from '../types';

export function useResume({
  refreshInterviewItems,
  setPipeline,
  showNotice,
  t,
}: {
  refreshInterviewItems: () => Promise<unknown>;
  setPipeline: (pipeline: PipelineResponse) => void;
  showNotice: (message: string) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const [resumeItems, setResumeItems] = useState<ResumeItem[]>([]);
  const [resumeSuggestingKeys, setResumeSuggestingKeys] = useState<string[]>([]);
  const [resumeDraftingKeys, setResumeDraftingKeys] = useState<string[]>([]);

  const refreshResumeItems = useCallback(async () => {
    const data = await bossApi.getResumeItems();
    setResumeItems(data.items || []);
    return data.items || [];
  }, []);

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
  }, [refreshInterviewItems, refreshResumeItems, setPipeline, showNotice, t]);

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
  }, [refreshInterviewItems, refreshResumeItems, setPipeline, showNotice, t]);

  const loadResumeDraft = useCallback(async (sourceKey: string): Promise<ResumeDraftResponse | null> => {
    try {
      return await bossApi.getResumeDraft(sourceKey);
    } catch (error) {
      showNotice(t('notices.loadResumeDraftFailed', { error: (error as Error).message }));
      return null;
    }
  }, [showNotice, t]);

  return {
    resumeItems,
    resumeSuggestingKeys,
    resumeDraftingKeys,
    refreshResumeItems,
    generateResumeSuggestions,
    loadResumeSuggestion,
    generateResumeDraft,
    loadResumeDraft,
  };
}
