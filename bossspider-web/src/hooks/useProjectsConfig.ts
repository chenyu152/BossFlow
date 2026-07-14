import { useCallback, useEffect, useRef, useState } from 'react';
import { bossApi } from '../api';
import type { ConfigPatch, ConfigPayload } from '../types';

const ACTIVE_DIRECTION_STORAGE_KEY = 'bossflow.active-direction';

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
  const [loading, setLoading] = useState(true);
  const [isConfigDirty, setIsConfigDirty] = useState(false);
  const projectRef = useRef(project);
  const loadEpochRef = useRef(0);
  const tRef = useRef(t);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const loadConfig = useCallback(async (targetProject?: string) => {
    const loadEpoch = ++loadEpochRef.current;
    setLoading(true);
    try {
      const data = await bossApi.getConfig(targetProject ?? projectRef.current);
      if (loadEpoch !== loadEpochRef.current) return;
      setConfig(data);
      setIsConfigDirty(false);
      setProject(data.project);
      projectRef.current = data.project;
      window.localStorage.setItem(ACTIVE_DIRECTION_STORAGE_KEY, data.project);
      await loadInitialResources(data.project);
    } catch (error) {
      showNotice(tRef.current('notices.loadFailed', { error: (error as Error).message }));
    } finally {
      if (loadEpoch === loadEpochRef.current) setLoading(false);
    }
  }, [loadInitialResources, showNotice]);

  useEffect(() => {
    bossApi.getProjects()
      .then(async (data) => {
        setProjects(data.projects);
        if (!data.projects.length) {
          setProject('');
          projectRef.current = '';
          setConfig(null);
          setLoading(false);
          return;
        }
        const remembered = window.localStorage.getItem(ACTIVE_DIRECTION_STORAGE_KEY);
        const initialProject = remembered && data.projects.includes(remembered) ? remembered : data.defaultProject;
        setProject(initialProject);
        await loadConfig(initialProject);
      })
      .catch((error) => {
        setLoading(false);
        showNotice(tRef.current('notices.backendConnectionFailed', { error: (error as Error).message }));
      });
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
      strategyIndex: nextConfig.strategyIndex,
      headlessMode: nextConfig.headlessMode,
      autoSqlite: nextConfig.autoSqlite,
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

  const createProject = useCallback(async (name: string) => {
    const created = await bossApi.createProject(name);
    setProjects((current) => Array.from(new Set([...current, created.project])).sort());
    await loadConfig(created.project);
    return created;
  }, [loadConfig]);

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
    createProject,
  };
}
