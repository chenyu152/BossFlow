import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bossApi } from '../api';
import type { JobLiveStatusUpdateRequest, Status } from '../types';
import { parseLog } from '../utils';

type TaskRequestBody = Record<string, unknown>;

export function useTasks({
  configReady,
  refreshJobs,
  requestBody,
  showNotice,
  t,
}: {
  configReady: boolean;
  refreshJobs: () => Promise<void>;
  requestBody: () => TaskRequestBody;
  showNotice: (message: string) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const [status, setStatus] = useState<Status>('ready');
  const [crawlAuthenticated, setCrawlAuthenticated] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const firstStatusLoad = useRef(true);
  const wasRunningRef = useRef(false);

  const parsedLogs = useMemo(() => logs.map(parseLog), [logs]);
  const recentLogs = parsedLogs.slice(-6);
  const isRunning = status !== 'ready' && status !== 'failed';

  useEffect(() => {
    const timer = window.setInterval(async () => {
      try {
        const data = await bossApi.getTaskStatus();
        setStatus(data.status || (data.running ? 'crawling' : 'ready'));
        setCrawlAuthenticated(Boolean(data.crawlAuthenticated));
        setLogs(data.logs || []);
        if (!firstStatusLoad.current && wasRunningRef.current && !data.running) await refreshJobs();
        wasRunningRef.current = data.running;
        firstStatusLoad.current = false;
      } catch {
        // Avoid noisy UI while the backend is starting.
      }
    }, 1500);

    return () => window.clearInterval(timer);
  }, [refreshJobs]);

  const startCrawl = useCallback(async () => {
    if (!configReady) return false;
    try {
      await bossApi.startCrawl(requestBody());
      wasRunningRef.current = true;
      setStatus('crawling');
      setCrawlAuthenticated(false);
      return true;
    } catch (error) {
      showNotice(t('notices.startFailed', { error: (error as Error).message }));
      return false;
    }
  }, [configReady, requestBody, showNotice, t]);

  const startLogin = useCallback(async () => {
    try {
      await bossApi.startLogin(requestBody());
      wasRunningRef.current = true;
      setStatus('login');
      return true;
    } catch (error) {
      showNotice(t('notices.loginStartFailed', { error: (error as Error).message }));
      return false;
    }
  }, [requestBody, showNotice, t]);

  const processPartial = useCallback(async () => {
    try {
      await bossApi.processPartial(requestBody());
      wasRunningRef.current = true;
      setStatus('processing-partial');
      return true;
    } catch (error) {
      showNotice(t('notices.processPartialFailed', { error: (error as Error).message }));
      return false;
    }
  }, [requestBody, showNotice, t]);

  const startLiveStatusUpdate = useCallback(async (body: JobLiveStatusUpdateRequest) => {
    try {
      await bossApi.updateJobLiveStatus(body);
      wasRunningRef.current = true;
      setStatus('live-status');
      return true;
    } catch (error) {
      showNotice(t('notices.liveStatusStartFailed', { error: (error as Error).message }));
      return false;
    }
  }, [showNotice, t]);

  const stopTask = useCallback(async () => {
    try {
      await bossApi.stopTask();
      setStatus('stopping');
      return true;
    } catch (error) {
      showNotice(t('notices.stopFailed', { error: (error as Error).message }));
      return false;
    }
  }, [showNotice, t]);

  return {
    status,
    crawlAuthenticated,
    logs,
    parsedLogs,
    recentLogs,
    isRunning,
    startCrawl,
    startLogin,
    processPartial,
    startLiveStatusUpdate,
    stopTask,
  };
}
