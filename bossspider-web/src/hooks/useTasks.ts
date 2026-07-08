import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bossApi } from '../api';
import type { Status } from '../types';
import { parseLog } from '../utils';

type TaskRequestBody = Record<string, unknown>;

export function useTasks({
  autoSqlite,
  configReady,
  headlessMode,
  quickMode,
  refreshJobs,
  requestBody,
  showNotice,
  strategyIndex,
  t,
}: {
  autoSqlite: boolean;
  configReady: boolean;
  headlessMode: boolean;
  quickMode: boolean;
  refreshJobs: () => Promise<void>;
  requestBody: () => TaskRequestBody;
  showNotice: (message: string) => void;
  strategyIndex: number;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const [status, setStatus] = useState<Status>('ready');
  const [logs, setLogs] = useState<string[]>([]);
  const firstStatusLoad = useRef(true);

  const parsedLogs = useMemo(() => logs.map(parseLog), [logs]);
  const recentLogs = parsedLogs.slice(-6);
  const isRunning = status !== 'ready' && status !== 'failed';

  useEffect(() => {
    const timer = window.setInterval(async () => {
      try {
        const data = await bossApi.getTaskStatus();
        setStatus(data.status || (data.running ? 'crawling' : 'ready'));
        setLogs(data.logs || []);
        if (!data.running && !firstStatusLoad.current) await refreshJobs();
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
      await bossApi.startCrawl({ ...requestBody(), strategyIndex, quickMode, headlessMode, autoSqlite });
      setStatus('crawling');
      return true;
    } catch (error) {
      showNotice(t('notices.startFailed', { error: (error as Error).message }));
      return false;
    }
  }, [autoSqlite, configReady, headlessMode, quickMode, requestBody, showNotice, strategyIndex, t]);

  const startLogin = useCallback(async () => {
    try {
      await bossApi.startLogin(requestBody());
      setStatus('login');
      return true;
    } catch (error) {
      showNotice(t('notices.loginStartFailed', { error: (error as Error).message }));
      return false;
    }
  }, [requestBody, showNotice, t]);

  const processPartial = useCallback(async () => {
    try {
      await bossApi.processPartial({ ...requestBody(), autoSqlite });
      setStatus('processing-partial');
      return true;
    } catch (error) {
      showNotice(t('notices.processPartialFailed', { error: (error as Error).message }));
      return false;
    }
  }, [autoSqlite, requestBody, showNotice, t]);

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
    logs,
    parsedLogs,
    recentLogs,
    isRunning,
    startCrawl,
    startLogin,
    processPartial,
    stopTask,
  };
}
