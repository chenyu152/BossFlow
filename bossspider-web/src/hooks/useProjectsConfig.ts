import { useCallback, useEffect, useRef, useState } from 'react';
import { bossApi } from '../api';
import type { ConfigPatch, ConfigPayload, PipelineResponse, ResumeItem, InterviewItem } from '../types';

export function useProjectsConfig({
  loadJobs,
  refreshInterviewItems,
  refreshPipeline,
  refreshResumeItems,
  showNotice,
  t,
}: {
  loadJobs: (targetProject: string, search?: string) => Promise<void>;
  refreshInterviewItems: () => Promise<InterviewItem[]>;
  refreshPipeline: () => Promise<PipelineResponse>;
  refreshResumeItems: () => Promise<ResumeItem[]>;
  showNotice: (message: string) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const [projects, setProjects] = useState<string[]>([]);
  const [project, setProject] = useState('agent');
  const [config, setConfig] = useState<ConfigPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const projectRef = useRef(project);
  const tRef = useRef(t);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const loadConfig = useCallback(async (targetProject?: string) => {
    setLoading(true);
    try {
      const data = await bossApi.getConfig(targetProject ?? projectRef.current);
      setConfig(data);
      setProject(data.project);
      projectRef.current = data.project;
      await loadJobs(data.project, '');
      await refreshPipeline();
      await refreshResumeItems();
      await refreshInterviewItems();
    } catch (error) {
      showNotice(tRef.current('notices.loadFailed', { error: (error as Error).message }));
    } finally {
      setLoading(false);
    }
  }, [loadJobs, refreshInterviewItems, refreshPipeline, refreshResumeItems, showNotice]);

  useEffect(() => {
    bossApi.getProjects()
      .then(async (data) => {
        setProjects(data.projects);
        setProject(data.defaultProject);
        await loadConfig(data.defaultProject);
      })
      .catch((error) => showNotice(tRef.current('notices.backendConnectionFailed', { error: (error as Error).message })));
  }, [loadConfig, showNotice]);

  const updateConfig = useCallback((patch: ConfigPatch) => {
    setConfig((current) => current ? { ...current, ...patch } : current);
  }, []);

  const requestBody = useCallback(() => {
    if (!config) throw new Error(t('notices.configNotLoaded'));
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
  }, [config, t]);

  const saveConfig = useCallback(async () => {
    try {
      const saved = await bossApi.saveConfig(requestBody());
      setConfig(saved);
      showNotice(t('notices.configSaved'));
    } catch (error) {
      showNotice(t('notices.saveFailed', { error: (error as Error).message }));
    }
  }, [requestBody, showNotice, t]);

  return {
    projects,
    project,
    config,
    loading,
    loadConfig,
    updateConfig,
    requestBody,
    saveConfig,
  };
}
