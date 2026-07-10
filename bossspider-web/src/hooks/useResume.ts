import { useCallback, useState } from 'react';
import { bossApi } from '../api';
import type { ResumeDraftResponse, ResumeItem, ResumeSuggestionResponse } from '../types';

export function useResume({
  showNotice,
  t,
}: {
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
      showNotice(t('notices.resumeSuggestionGenerated', { id: data.resumeSuggestionId }));
      return data;
    } catch (error) {
      showNotice(t('notices.resumeSuggestionFailed', { error: (error as Error).message }));
      return null;
    } finally {
      setResumeSuggestingKeys((keys) => keys.filter((key) => key !== sourceKey));
    }
  }, [showNotice, t]);

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
      showNotice(t('notices.resumeDraftGenerated', { id: data.resumeDraftId }));
      return data;
    } catch (error) {
      showNotice(t('notices.resumeDraftFailed', { error: (error as Error).message }));
      return null;
    } finally {
      setResumeDraftingKeys((keys) => keys.filter((key) => key !== sourceKey));
    }
  }, [showNotice, t]);

  const loadResumeDraft = useCallback(async (sourceKey: string): Promise<ResumeDraftResponse | null> => {
    try {
      return await bossApi.getResumeDraft(sourceKey);
    } catch (error) {
      showNotice(t('notices.loadResumeDraftFailed', { error: (error as Error).message }));
      return null;
    }
  }, [showNotice, t]);

  const saveResumeDraft = useCallback(async (sourceKey: string, content: string): Promise<ResumeDraftResponse | null> => {
    try {
      const data = await bossApi.saveResumeDraft(sourceKey, content);
      showNotice(t('notices.resumeDraftSaved'));
      return data;
    } catch (error) {
      showNotice(t('notices.resumeDraftSaveFailed', { error: (error as Error).message }));
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
    saveResumeDraft,
  };
}
