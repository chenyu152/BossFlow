import { useCallback, useState } from 'react';
import { bossApi } from '../api';
import type { Job } from '../types';

export function useJobs({
  showNotice,
  t,
}: {
  showNotice: (message: string) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobsTotal, setJobsTotal] = useState(0);
  const [jobSearch, setJobSearch] = useState('');
  const [sortJobsByScore, setSortJobsByScore] = useState(false);
  const [jobScoringIds, setJobScoringIds] = useState<number[]>([]);

  const loadJobs = useCallback(async (targetProject: string, search = '') => {
    const data = await bossApi.getJobs(targetProject, search);
    setJobs(data.items);
    setJobsTotal(data.total);
    return data;
  }, []);

  const refreshJobs = useCallback(async (projectName?: string, search = jobSearch) => {
    if (!projectName) return;
    try {
      await loadJobs(projectName, search);
    } catch (error) {
      showNotice(t('notices.refreshJobsFailed', { error: (error as Error).message }));
    }
  }, [jobSearch, loadJobs, showNotice, t]);

  const exportJobs = useCallback(async (projectName?: string) => {
    if (!projectName) return;
    try {
      const response = await fetch(bossApi.exportJobsUrl(projectName, jobSearch));
      if (!response.ok) {
        let message = `${response.status} ${response.statusText}`;
        try {
          const body = await response.json() as { detail?: string };
          message = body.detail || message;
        } catch {
          // Keep the HTTP status when the response is not JSON.
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const encodedFilename = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const plainFilename = disposition.match(/filename="?([^";]+)"?/i)?.[1];
      const filename = encodedFilename
        ? decodeURIComponent(encodedFilename)
        : plainFilename || 'boss_jobs_export.xlsx';
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      showNotice(t('notices.exportJobsFailed', { error: (error as Error).message }));
    }
  }, [jobSearch, showNotice, t]);

  const scoreJobs = useCallback(async (projectName: string | undefined, jobIds: number[]) => {
    if (!projectName || !jobIds.length) return false;
    setJobScoringIds((ids) => Array.from(new Set([...ids, ...jobIds])));
    try {
      const data = await bossApi.scoreJobs(projectName, jobIds);
      await loadJobs(projectName, jobSearch);
      showNotice(t('notices.jobScoringComplete', {
        scored: data.scored,
        errors: data.errors.length ? t('notices.withErrors', { count: data.errors.length }) : '',
      }));
      return true;
    } catch (error) {
      showNotice(t('notices.jobScoringFailed', { error: (error as Error).message }));
      return false;
    } finally {
      setJobScoringIds((ids) => ids.filter((id) => !jobIds.includes(id)));
    }
  }, [jobSearch, loadJobs, showNotice, t]);

  return {
    jobs,
    jobsTotal,
    jobSearch,
    sortJobsByScore,
    jobScoringIds,
    setJobSearch,
    setSortJobsByScore,
    loadJobs,
    refreshJobs,
    exportJobs,
    scoreJobs,
  };
}
