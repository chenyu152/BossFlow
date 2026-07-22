import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  GreetingDraft,
  GreetingDraftResponse,
  GreetingDraftStatus,
  GreetingPreflightResponse,
  GreetingPrepareResponse,
  PipelineItem,
} from '../types';

export function useGreetingDraftEditor({
  selectedItem,
  onLoadGreetingDraft,
  onSaveGreetingDraft,
  onPreflightGreeting,
  onPrepareGreeting,
}: {
  selectedItem: PipelineItem | null;
  onLoadGreetingDraft: (sourceKey: string) => Promise<GreetingDraftResponse | null>;
  onSaveGreetingDraft: (sourceKey: string, editedText: string, status: GreetingDraftStatus) => Promise<GreetingDraftResponse | null>;
  onPreflightGreeting: (sourceKey: string, message: string) => Promise<GreetingPreflightResponse | null>;
  onPrepareGreeting: (sourceKey: string, message: string) => Promise<GreetingPrepareResponse | null>;
}) {
  const [greetingDraft, setGreetingDraft] = useState<GreetingDraft | null>(null);
  const [greetingLoading, setGreetingLoading] = useState(false);
  const [greetingSaving, setGreetingSaving] = useState(false);
  const [greetingPreparing, setGreetingPreparing] = useState(false);
  const selectedSourceKeyRef = useRef('');
  const resetEpochRef = useRef(0);

  selectedSourceKeyRef.current = selectedItem?.sourceKey || '';

  const isCurrentRequest = useCallback((sourceKey: string, epoch: number) => (
    selectedSourceKeyRef.current === sourceKey && resetEpochRef.current === epoch
  ), []);

  const clearGreetingDraft = useCallback(() => {
    resetEpochRef.current += 1;
    setGreetingDraft(null);
    setGreetingLoading(false);
    setGreetingSaving(false);
    setGreetingPreparing(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadDraft = async () => {
      if (!selectedItem?.sourceKey) {
        setGreetingDraft(null);
        return;
      }
      const sourceKey = selectedItem.sourceKey;
      const epoch = resetEpochRef.current;
      setGreetingLoading(true);
      try {
        const data = await onLoadGreetingDraft(sourceKey);
        if (!cancelled && isCurrentRequest(sourceKey, epoch)) setGreetingDraft(data?.draft || null);
      } finally {
        if (!cancelled && isCurrentRequest(sourceKey, epoch)) setGreetingLoading(false);
      }
    };
    void loadDraft();
    return () => {
      cancelled = true;
    };
  }, [isCurrentRequest, onLoadGreetingDraft, selectedItem?.reportId, selectedItem?.sourceKey]);

  useEffect(() => {
    if (!selectedItem?.sourceKey || greetingDraft?.status !== 'preparing') return undefined;
    const sourceKey = selectedItem.sourceKey;
    const epoch = resetEpochRef.current;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void onLoadGreetingDraft(sourceKey).then((data) => {
        if (cancelled || !data || !isCurrentRequest(sourceKey, epoch)) return;
        setGreetingDraft(data.draft);
        if (data.draft.status !== 'preparing') setGreetingPreparing(false);
      });
    }, 1200);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [greetingDraft?.status, isCurrentRequest, onLoadGreetingDraft, selectedItem?.sourceKey]);

  const saveGreetingDraft = useCallback(async (editedText: string, status: GreetingDraftStatus) => {
    if (!selectedItem) return null;
    const sourceKey = selectedItem.sourceKey;
    const epoch = resetEpochRef.current;
    setGreetingSaving(true);
    try {
      const data = await onSaveGreetingDraft(sourceKey, editedText, status);
      if (data && isCurrentRequest(sourceKey, epoch)) setGreetingDraft(data.draft);
      return data;
    } finally {
      if (isCurrentRequest(sourceKey, epoch)) setGreetingSaving(false);
    }
  }, [isCurrentRequest, onSaveGreetingDraft, selectedItem]);

  const preflightGreeting = useCallback(async (message: string) => {
    if (!selectedItem) return null;
    return onPreflightGreeting(selectedItem.sourceKey, message);
  }, [onPreflightGreeting, selectedItem]);

  const prepareGreeting = useCallback(async (message: string) => {
    if (!selectedItem) return null;
    const sourceKey = selectedItem.sourceKey;
    const epoch = resetEpochRef.current;
    setGreetingPreparing(true);
    try {
      const data = await onPrepareGreeting(sourceKey, message);
      if (data && isCurrentRequest(sourceKey, epoch)) setGreetingDraft(data.draft);
      if (!data && isCurrentRequest(sourceKey, epoch)) setGreetingPreparing(false);
      return data;
    } catch (error) {
      if (isCurrentRequest(sourceKey, epoch)) setGreetingPreparing(false);
      throw error;
    }
  }, [isCurrentRequest, onPrepareGreeting, selectedItem]);

  return {
    greetingDraft,
    greetingLoading,
    greetingSaving,
    greetingPreparing,
    saveGreetingDraft,
    preflightGreeting,
    prepareGreeting,
    clearGreetingDraft,
  };
}
