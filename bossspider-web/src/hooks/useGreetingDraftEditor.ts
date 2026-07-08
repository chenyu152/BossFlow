import { useCallback, useEffect, useRef, useState } from 'react';
import type { GreetingDraft, GreetingDraftResponse, GreetingDraftStatus, PipelineItem } from '../types';

export function useGreetingDraftEditor({
  selectedItem,
  onLoadGreetingDraft,
  onSaveGreetingDraft,
}: {
  selectedItem: PipelineItem | null;
  onLoadGreetingDraft: (sourceKey: string) => Promise<GreetingDraftResponse | null>;
  onSaveGreetingDraft: (sourceKey: string, editedText: string, status: GreetingDraftStatus) => Promise<GreetingDraftResponse | null>;
}) {
  const [greetingDraft, setGreetingDraft] = useState<GreetingDraft | null>(null);
  const [greetingLoading, setGreetingLoading] = useState(false);
  const [greetingSaving, setGreetingSaving] = useState(false);
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
  }, [isCurrentRequest, onLoadGreetingDraft, selectedItem?.sourceKey]);

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

  return {
    greetingDraft,
    greetingLoading,
    greetingSaving,
    saveGreetingDraft,
    clearGreetingDraft,
  };
}
