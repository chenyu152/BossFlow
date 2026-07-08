import { useCallback, useState } from 'react';
import { bossApi } from '../api';
import type {
  InterviewItem,
  InterviewPrepResponse,
  InterviewStory,
  InterviewStoryBankResponse,
  InterviewStoryDraft,
  InterviewStoryDraftPromoteResponse,
  InterviewStoryDraftsResponse,
  PipelineResponse,
} from '../types';

export function useInterview({
  setPipeline,
  showNotice,
  t,
}: {
  setPipeline: (pipeline: PipelineResponse) => void;
  showNotice: (message: string) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const [interviewItems, setInterviewItems] = useState<InterviewItem[]>([]);
  const [interviewPreparingKeys, setInterviewPreparingKeys] = useState<string[]>([]);

  const refreshInterviewItems = useCallback(async () => {
    const data = await bossApi.getInterviewItems();
    setInterviewItems(data.items || []);
    return data.items || [];
  }, []);

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
  }, [refreshInterviewItems, setPipeline, showNotice, t]);

  const loadInterviewPrep = useCallback(async (sourceKey: string): Promise<InterviewPrepResponse | null> => {
    try {
      return await bossApi.getInterviewPrep(sourceKey);
    } catch (error) {
      showNotice(t('notices.loadInterviewPrepFailed', { error: (error as Error).message }));
      return null;
    }
  }, [showNotice, t]);

  return {
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
  };
}
