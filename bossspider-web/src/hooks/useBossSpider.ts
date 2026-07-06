import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bossApi } from '../api';
import { parseLog } from '../utils';
import type { ConfigPatch, ConfigPayload, Job, PipelineResponse, Status } from '../types';

export function useBossSpider() {
  const [status, setStatus] = useState<Status>('ready');
  const [projects, setProjects] = useState<string[]>([]);
  const [project, setProject] = useState('agent');
  const [config, setConfig] = useState<ConfigPayload | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobsTotal, setJobsTotal] = useState(0);
  const [pipeline, setPipeline] = useState<PipelineResponse | null>(null);
  const [jobSearch, setJobSearch] = useState('');
  const [sortJobsByScore, setSortJobsByScore] = useState(false);
  const [sortPipelineByLlmScore, setSortPipelineByLlmScore] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [strategyIndex, setStrategyIndex] = useState(0);
  const [quickMode, setQuickMode] = useState(false);
  const [headlessMode, setHeadlessMode] = useState(true);
  const [autoSqlite, setAutoSqlite] = useState(true);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [jobScoringIds, setJobScoringIds] = useState<number[]>([]);
  const [llmEvaluatingKeys, setLlmEvaluatingKeys] = useState<string[]>([]);
  const firstStatusLoad = useRef(true);

  const parsedLogs = useMemo(() => logs.map(parseLog), [logs]);
  const recentLogs = parsedLogs.slice(-6);
  const isRunning = status !== 'ready' && status !== 'failed';

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 4200);
  }, []);

  const loadJobs = useCallback(async (targetProject: string, search = '') => {
    const data = await bossApi.getJobs(targetProject, search);
    setJobs(data.items);
    setJobsTotal(data.total);
  }, []);

  const refreshPipeline = useCallback(async () => {
    const data = await bossApi.getPipeline();
    setPipeline(data);
    return data;
  }, []);

  const loadConfig = useCallback(async (targetProject = project) => {
    setLoading(true);
    try {
      const data = await bossApi.getConfig(targetProject);
      setConfig(data);
      setProject(data.project);
      await loadJobs(data.project, '');
      await refreshPipeline();
    } catch (error) {
      showNotice(`加载失败：${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [loadJobs, project, refreshPipeline, showNotice]);

  const refreshJobs = useCallback(async (search = jobSearch) => {
    if (!config) return;
    try {
      await loadJobs(config.project, search);
    } catch (error) {
      showNotice(`刷新岗位失败：${(error as Error).message}`);
    }
  }, [config, jobSearch, loadJobs, showNotice]);

  useEffect(() => {
    bossApi.getProjects()
      .then(async (data) => {
        setProjects(data.projects);
        setProject(data.defaultProject);
        await loadConfig(data.defaultProject);
      })
      .catch((error) => showNotice(`后端连接失败：${(error as Error).message}`));
  }, [loadConfig, showNotice]);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      try {
        const data = await bossApi.getTaskStatus();
        setStatus(data.status || (data.running ? 'crawling' : 'ready'));
        setLogs(data.logs || []);
        if (!data.running && !firstStatusLoad.current) refreshJobs();
        firstStatusLoad.current = false;
      } catch {
        // Avoid noisy UI while the backend is starting.
      }
    }, 1500);

    return () => window.clearInterval(timer);
  }, [refreshJobs]);

  const updateConfig = useCallback((patch: ConfigPatch) => {
    setConfig((current) => current ? { ...current, ...patch } : current);
  }, []);

  const requestBody = useCallback(() => {
    if (!config) throw new Error('配置尚未加载');
    return {
      project: config.project,
      keywordsText: config.keywordsText,
      citiesText: config.citiesText,
      maxPages: config.maxPages,
      scrollTarget: config.scrollTarget,
      scrollMax: config.scrollMax,
      minSalary: config.minSalary,
      catRulesText: config.catRulesText,
      relevanceText: config.relevanceText,
      blacklistText: config.blacklistText,
    };
  }, [config]);

  const saveConfig = useCallback(async () => {
    try {
      const saved = await bossApi.saveConfig(requestBody());
      setConfig(saved);
      showNotice('配置已保存');
    } catch (error) {
      showNotice(`保存失败：${(error as Error).message}`);
    }
  }, [requestBody, showNotice]);

  const startCrawl = useCallback(async () => {
    if (!config) return false;
    try {
      await bossApi.startCrawl({ ...requestBody(), strategyIndex, quickMode, headlessMode, autoSqlite });
      setStatus('crawling');
      return true;
    } catch (error) {
      showNotice(`启动失败：${(error as Error).message}`);
      return false;
    }
  }, [autoSqlite, config, headlessMode, quickMode, requestBody, showNotice, strategyIndex]);

  const startLogin = useCallback(async () => {
    try {
      await bossApi.startLogin(requestBody());
      setStatus('login');
      return true;
    } catch (error) {
      showNotice(`登录流程启动失败：${(error as Error).message}`);
      return false;
    }
  }, [requestBody, showNotice]);

  const processPartial = useCallback(async () => {
    try {
      await bossApi.processPartial({ ...requestBody(), autoSqlite });
      setStatus('processing-partial');
      return true;
    } catch (error) {
      showNotice(`处理中断文件失败：${(error as Error).message}`);
      return false;
    }
  }, [autoSqlite, requestBody, showNotice]);

  const stopTask = useCallback(async () => {
    try {
      await bossApi.stopTask();
      setStatus('stopping');
      return true;
    } catch (error) {
      showNotice(`终止失败：${(error as Error).message}`);
      return false;
    }
  }, [showNotice]);

  const exportJobs = useCallback(() => {
    if (!config) return;
    window.open(bossApi.exportJobsUrl(config.project, jobSearch), '_blank');
  }, [config, jobSearch]);

  const addJobsToPipeline = useCallback(async (jobIds: number[]) => {
    if (!config || !jobIds.length) return false;
    try {
      const data = await bossApi.addJobsToPipeline(config.project, jobIds);
      setPipeline(data);
      showNotice(`已加入 Pipeline：${data.added || 0} 个，跳过重复：${data.skipped || 0} 个`);
      return true;
    } catch (error) {
      showNotice(`加入 Pipeline 失败：${(error as Error).message}`);
      return false;
    }
  }, [config, showNotice]);

  const scoreJobs = useCallback(async (jobIds: number[]) => {
    if (!config || !jobIds.length) return false;
    setJobScoringIds((ids) => Array.from(new Set([...ids, ...jobIds])));
    try {
      const data = await bossApi.scoreJobs(config.project, jobIds);
      await loadJobs(config.project, jobSearch);
      showNotice(`岗位粗筛完成：${data.scored} 个${data.errors.length ? `，失败 ${data.errors.length} 个` : ''}`);
      return true;
    } catch (error) {
      showNotice(`岗位粗筛失败：${(error as Error).message}`);
      return false;
    } finally {
      setJobScoringIds((ids) => ids.filter((id) => !jobIds.includes(id)));
    }
  }, [config, jobSearch, loadJobs, showNotice]);

  const evaluatePipelineItem = useCallback(async (sourceKey: string) => {
    try {
      const data = await bossApi.evaluatePipelineItem(sourceKey);
      setPipeline(data.pipeline);
      showNotice(`粗筛完成：${data.score.toFixed(1)} / 5.0，${data.fitLevel}`);
      return true;
    } catch (error) {
      showNotice(`粗筛失败：${(error as Error).message}`);
      return false;
    }
  }, [showNotice]);

  const scoreAllPipeline = useCallback(async () => {
    try {
      const data = await bossApi.scorePipeline();
      setPipeline(data.pipeline);
      showNotice(`粗筛完成：${data.scored} 个岗位${data.errors.length ? `，失败 ${data.errors.length} 个` : ''}`);
      return true;
    } catch (error) {
      showNotice(`一键粗筛失败：${(error as Error).message}`);
      return false;
    }
  }, [showNotice]);

  const llmEvaluatePipelineItem = useCallback(async (sourceKey: string) => {
    setLlmEvaluatingKeys((keys) => keys.includes(sourceKey) ? keys : [...keys, sourceKey]);
    showNotice('LLM 精评已开始，生成报告可能需要几十秒');
    try {
      const data = await bossApi.llmEvaluatePipelineItem(sourceKey);
      setPipeline(data.pipeline);
      showNotice(`LLM 精评完成：报告 ${data.reportId}${data.summary.score ? `，${data.summary.score.toFixed(1)} / 5.0` : ''}`);
      return true;
    } catch (error) {
      showNotice(`LLM 精评失败：${(error as Error).message}`);
      return false;
    } finally {
      setLlmEvaluatingKeys((keys) => keys.filter((key) => key !== sourceKey));
    }
  }, [showNotice]);

  const loadJobDetail = useCallback(async (projectName: string, jobId: number) => {
    try {
      return await bossApi.getJobItem(projectName, jobId);
    } catch (error) {
      showNotice(`加载岗位详情失败：${(error as Error).message}`);
      return null;
    }
  }, [showNotice]);

  const loadPipelineReport = useCallback(async (sourceKey: string) => {
    try {
      return await bossApi.getPipelineReport(sourceKey);
    } catch (error) {
      showNotice(`加载报告失败：${(error as Error).message}`);
      return null;
    }
  }, [showNotice]);

  const updatePipelineStatus = useCallback(async (sourceKey: string, decisionStatus: string) => {
    try {
      const data = await bossApi.updatePipelineStatus(sourceKey, decisionStatus);
      setPipeline(data);
      showNotice('Pipeline 状态已更新');
      return true;
    } catch (error) {
      showNotice(`更新状态失败：${(error as Error).message}`);
      return false;
    }
  }, [showNotice]);

  const deletePipelineItem = useCallback(async (sourceKey: string) => {
    try {
      const data = await bossApi.deletePipelineItem(sourceKey);
      setPipeline(data);
      showNotice(`已删除 Pipeline 条目${data.deletedReports.length ? `，同时删除报告 ${data.deletedReports.length} 个` : ''}`);
      return true;
    } catch (error) {
      showNotice(`删除失败：${(error as Error).message}`);
      return false;
    }
  }, [showNotice]);

  return {
    status,
    projects,
    project,
    config,
    jobs,
    jobsTotal,
    pipeline,
    jobSearch,
    sortJobsByScore,
    sortPipelineByLlmScore,
    logs,
    parsedLogs,
    recentLogs,
    strategyIndex,
    quickMode,
    headlessMode,
    autoSqlite,
    notice,
    loading,
    jobScoringIds,
    llmEvaluatingKeys,
    isRunning,
    setJobSearch,
    setSortJobsByScore,
    setSortPipelineByLlmScore,
    setStrategyIndex,
    setQuickMode,
    setHeadlessMode,
    setAutoSqlite,
    loadConfig,
    refreshJobs,
    refreshPipeline,
    updateConfig,
    saveConfig,
    startCrawl,
    startLogin,
    processPartial,
    stopTask,
    exportJobs,
    addJobsToPipeline,
    scoreJobs,
    evaluatePipelineItem,
    scoreAllPipeline,
    llmEvaluatePipelineItem,
    loadJobDetail,
    loadPipelineReport,
    updatePipelineStatus,
    deletePipelineItem,
  };
}
