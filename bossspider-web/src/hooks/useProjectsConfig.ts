import { useCallback, useEffect, useRef, useState } from 'react';
import { bossApi } from '../api';
import type { ConfigPatch, ConfigPayload } from '../types';

export function useProjectsConfig({
  loadInitialResources,
  showNotice,
  t,
}: {
  loadInitialResources: (projectName: string) => Promise<void>;
  showNotice: (message: string) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const [projects, setProjects] = useState<string[]>([]);
  const [project, setProject] = useState('agent');
  const [config, setConfig] = useState<ConfigPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [isConfigDirty, setIsConfigDirty] = useState(false);
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
      setIsConfigDirty(false);
      setProject(data.project);
      projectRef.current = data.project;
      await loadInitialResources(data.project);
    } catch (error) {
      showNotice(tRef.current('notices.loadFailed', { error: (error as Error).message }));
    } finally {
      setLoading(false);
    }
  }, [loadInitialResources, showNotice]);

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
    setIsConfigDirty(true);
  }, []);

  const requestBody = useCallback((patch?: ConfigPatch) => {
    if (!config) throw new Error(t('notices.configNotLoaded'));
    const nextConfig = patch ? { ...config, ...patch } : config;
    return {
      project: nextConfig.project,
      keywordsText: nextConfig.keywordsText,
      citiesText: nextConfig.citiesText,
      maxPages: nextConfig.maxPages,
      scrollTarget: nextConfig.scrollTarget,
      scrollMax: nextConfig.scrollMax,
      minSalary: nextConfig.minSalary,
      catRulesText: nextConfig.catRulesText,
      scoringRulesText: nextConfig.scoringRulesText,
      relevanceText: nextConfig.relevanceText,
      blacklistText: nextConfig.blacklistText,
    };
  }, [config, t]);

  const saveConfig = useCallback(async (patch?: ConfigPatch) => {
    try {
      const saved = await bossApi.saveConfig(requestBody(patch));
      setConfig(saved);
      setIsConfigDirty(false);
      showNotice(t('notices.configSaved'));
      return saved;
    } catch (error) {
      showNotice(t('notices.saveFailed', { error: (error as Error).message }));
      return null;
    }
  }, [requestBody, showNotice, t]);

  return {
    projects,
    project,
    config,
    loading,
    isConfigDirty,
    loadConfig,
    updateConfig,
    requestBody,
    saveConfig,
  };
}
