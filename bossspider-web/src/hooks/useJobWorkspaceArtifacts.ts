import { useCallback, useRef, useState } from 'react';
import type { InterviewPrepResponse, PipelineItem, PipelineReportResponse, ResumeSuggestionResponse } from '../types';

export function useJobWorkspaceArtifacts({
  selectedItem,
  onLoadReport,
  onGenerateResumeSuggestions,
  onLoadResumeSuggestion,
  onGenerateInterviewPrep,
  onLoadInterviewPrep,
}: {
  selectedItem: PipelineItem | null;
  onLoadReport: (sourceKey: string) => Promise<PipelineReportResponse | null>;
  onGenerateResumeSuggestions: (sourceKey: string) => Promise<ResumeSuggestionResponse | null>;
  onLoadResumeSuggestion: (sourceKey: string) => Promise<ResumeSuggestionResponse | null>;
  onGenerateInterviewPrep: (sourceKey: string, userNotes: string) => Promise<InterviewPrepResponse | null>;
  onLoadInterviewPrep: (sourceKey: string) => Promise<InterviewPrepResponse | null>;
}) {
  const [report, setReport] = useState<PipelineReportResponse | null>(null);
  const [resumeSuggestion, setResumeSuggestion] = useState<ResumeSuggestionResponse | null>(null);
  const [interviewPrep, setInterviewPrep] = useState<InterviewPrepResponse | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [resumeLoading, setResumeLoading] = useState(false);
  const [interviewLoading, setInterviewLoading] = useState(false);
  const selectedSourceKeyRef = useRef('');
  const resetEpochRef = useRef(0);

  selectedSourceKeyRef.current = selectedItem?.sourceKey || '';

  const isCurrentRequest = useCallback((sourceKey: string, epoch: number) => (
    selectedSourceKeyRef.current === sourceKey && resetEpochRef.current === epoch
  ), []);

  const clearArtifacts = useCallback(() => {
    resetEpochRef.current += 1;
    setReport(null);
    setResumeSuggestion(null);
    setInterviewPrep(null);
    setReportLoading(false);
    setResumeLoading(false);
    setInterviewLoading(false);
  }, []);

  const closeReport = useCallback(() => setReport(null), []);
  const closeResumeSuggestion = useCallback(() => setResumeSuggestion(null), []);
  const closeInterviewPrep = useCallback(() => setInterviewPrep(null), []);

  const viewReport = useCallback(async () => {
    if (!selectedItem?.reportPath) return;
    if (report?.sourceKey === selectedItem.sourceKey) {
      setReport(null);
      return;
    }
    const sourceKey = selectedItem.sourceKey;
    const epoch = resetEpochRef.current;
    setReportLoading(true);
    try {
      const data = await onLoadReport(sourceKey);
      if (data && isCurrentRequest(sourceKey, epoch)) setReport(data);
    } finally {
      if (isCurrentRequest(sourceKey, epoch)) setReportLoading(false);
    }
  }, [isCurrentRequest, onLoadReport, report?.sourceKey, selectedItem]);

  const viewResumeSuggestion = useCallback(async () => {
    if (!selectedItem?.resumeSuggestionPath) return;
    if (resumeSuggestion?.sourceKey === selectedItem.sourceKey) {
      setResumeSuggestion(null);
      return;
    }
    const sourceKey = selectedItem.sourceKey;
    const epoch = resetEpochRef.current;
    setResumeLoading(true);
    try {
      const data = await onLoadResumeSuggestion(sourceKey);
      if (data && isCurrentRequest(sourceKey, epoch)) setResumeSuggestion(data);
    } finally {
      if (isCurrentRequest(sourceKey, epoch)) setResumeLoading(false);
    }
  }, [isCurrentRequest, onLoadResumeSuggestion, resumeSuggestion?.sourceKey, selectedItem]);

  const generateResumeSuggestion = useCallback(async () => {
    if (!selectedItem) return;
    const sourceKey = selectedItem.sourceKey;
    const epoch = resetEpochRef.current;
    setResumeLoading(true);
    try {
      const data = await onGenerateResumeSuggestions(sourceKey);
      if (data && isCurrentRequest(sourceKey, epoch)) setResumeSuggestion(data);
    } finally {
      if (isCurrentRequest(sourceKey, epoch)) setResumeLoading(false);
    }
  }, [isCurrentRequest, onGenerateResumeSuggestions, selectedItem]);

  const viewInterviewPrep = useCallback(async () => {
    if (!selectedItem?.interviewPrepPath) return;
    if (interviewPrep?.sourceKey === selectedItem.sourceKey) {
      setInterviewPrep(null);
      return;
    }
    const sourceKey = selectedItem.sourceKey;
    const epoch = resetEpochRef.current;
    setInterviewLoading(true);
    try {
      const data = await onLoadInterviewPrep(sourceKey);
      if (data && isCurrentRequest(sourceKey, epoch)) setInterviewPrep(data);
    } finally {
      if (isCurrentRequest(sourceKey, epoch)) setInterviewLoading(false);
    }
  }, [interviewPrep?.sourceKey, isCurrentRequest, onLoadInterviewPrep, selectedItem]);

  const generateInterviewPrep = useCallback(async () => {
    if (!selectedItem) return;
    const sourceKey = selectedItem.sourceKey;
    const epoch = resetEpochRef.current;
    setInterviewLoading(true);
    try {
      const data = await onGenerateInterviewPrep(sourceKey, '');
      if (data && isCurrentRequest(sourceKey, epoch)) setInterviewPrep(data);
    } finally {
      if (isCurrentRequest(sourceKey, epoch)) setInterviewLoading(false);
    }
  }, [isCurrentRequest, onGenerateInterviewPrep, selectedItem]);

  return {
    report,
    resumeSuggestion,
    interviewPrep,
    reportLoading,
    resumeLoading,
    interviewLoading,
    viewReport,
    closeReport,
    viewResumeSuggestion,
    closeResumeSuggestion,
    generateResumeSuggestion,
    viewInterviewPrep,
    closeInterviewPrep,
    generateInterviewPrep,
    clearArtifacts,
  };
}
