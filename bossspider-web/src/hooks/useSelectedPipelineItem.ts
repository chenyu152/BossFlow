import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Job, PipelineItem } from '../types';

export function useSelectedPipelineItem({
  pending,
  onLoadJobDetail,
  onSelectionReset,
  onTargetSelected,
  targetSourceKey,
  targetRequestId,
}: {
  pending: PipelineItem[];
  onLoadJobDetail: (project: string, jobId: number) => Promise<Job | null>;
  onSelectionReset: () => void;
  onTargetSelected: () => void;
  targetSourceKey?: string;
  targetRequestId?: number;
}) {
  const [selectedSourceKey, setSelectedSourceKey] = useState('');
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const appliedTargetRef = useRef('');
  const selectedSourceKeyRef = useRef('');
  const detailRequestRef = useRef(0);

  const selectedItem = useMemo(
    () => pending.find((item) => item.sourceKey === selectedSourceKey) || null,
    [pending, selectedSourceKey],
  );

  const clearSelection = useCallback(() => {
    selectedSourceKeyRef.current = '';
    detailRequestRef.current += 1;
    setSelectedSourceKey('');
    setSelectedJob(null);
    setDetailLoading(false);
    onSelectionReset();
  }, [onSelectionReset]);

  const selectItem = useCallback(async (item: PipelineItem) => {
    const requestId = detailRequestRef.current + 1;
    detailRequestRef.current = requestId;
    selectedSourceKeyRef.current = item.sourceKey;
    setSelectedSourceKey(item.sourceKey);
    setSelectedJob(null);
    onSelectionReset();

    if (!item.project || !item.jobId) {
      setDetailLoading(false);
      return;
    }

    setDetailLoading(true);
    try {
      const job = await onLoadJobDetail(item.project, item.jobId);
      if (detailRequestRef.current === requestId && selectedSourceKeyRef.current === item.sourceKey && job) {
        setSelectedJob(job);
      }
    } finally {
      if (detailRequestRef.current === requestId && selectedSourceKeyRef.current === item.sourceKey) {
        setDetailLoading(false);
      }
    }
  }, [onLoadJobDetail, onSelectionReset]);

  useEffect(() => {
    if (selectedSourceKey && !selectedItem) clearSelection();
  }, [clearSelection, selectedItem, selectedSourceKey]);

  useEffect(() => {
    if (!targetSourceKey || !targetRequestId) return;
    const targetKey = `${targetRequestId}:${targetSourceKey}`;
    if (appliedTargetRef.current === targetKey) return;
    const item = pending.find((entry) => entry.sourceKey === targetSourceKey);
    if (!item) return;
    appliedTargetRef.current = targetKey;
    onTargetSelected();
    void selectItem(item);
  }, [onTargetSelected, pending, selectItem, targetRequestId, targetSourceKey]);

  return {
    selectedSourceKey,
    selectedItem,
    selectedJob,
    detailLoading,
    selectItem,
    clearSelection,
  };
}
