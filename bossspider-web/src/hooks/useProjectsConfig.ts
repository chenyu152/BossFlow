import { useCallback, useEffect, useRef, useState } from 'react';
import { bossApi } from '../api';
import { chooseInitialProject } from '../projectSelection';
import type { ConfigPatch, ConfigPayload, ProjectTemplateSeed } from '../types';

const ACTIVE_DIRECTION_STORAGE_KEY = 'bossflow.active-direction';

function toRequestBody(config: ConfigPayload) {
  return {
    project: config.project,
    keywordsText: config.keywordsText,
    citiesText: config.citiesText,
    newJobTarget: config.newJobTarget,
    maxJobs: config.maxJobs,
    minSalary: config.minSalary,
    headlessMode: config.headlessMode,
    autoSqlite: config.autoSqlite,
    catRulesText: config.catRulesText,
    scoringRulesText: config.scoringRulesText,
    relevanceText: config.relevanceText,
    blacklistText: config.blacklistText,
  };
}

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
  // The project directory is discovered from /api/projects.  An invented
  // fallback such as "agent" can race the first request and does not
  // necessarily match the user's real directory name.
  const [project, setProject] = useState('');
  const [config, setConfig] = useState<ConfigPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [isConfigDirty, setIsConfigDirty] = useState(false);
  const projectRef = useRef('');
  const savedConfigRef = useRef<ConfigPayload | null>(null);
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
      savedConfigRef.current = data;
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
        const initialProject = chooseInitialProject(data.projects, data.defaultProject, remembered);
        setProject(initialProject);
        projectRef.current = initialProject;
        window.localStorage.setItem(ACTIVE_DIRECTION_STORAGE_KEY, initialProject);
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

  // Navigation can explicitly discard edits. Keep a local saved snapshot so a
  // confirmed leave immediately restores the page state instead of repeatedly
  // warning about the same abandoned edits.
  const discardConfigChanges = useCallback(() => {
    if (savedConfigRef.current) setConfig(savedConfigRef.current);
    setIsConfigDirty(false);
  }, []);

  const requestBody = useCallback((patch?: ConfigPatch) => {
    if (!config) throw new Error(t('notices.configNotLoaded'));
    const nextConfig = patch ? { ...config, ...patch } : config;
    return toRequestBody(nextConfig);
  }, [config, t]);

  const saveConfig = useCallback(async (patch?: ConfigPatch) => {
    try {
      const saved = await bossApi.saveConfig(requestBody(patch));
      setConfig(saved);
      savedConfigRef.current = saved;
      setIsConfigDirty(false);
      showNotice(t('notices.configSaved'));
      return saved;
    } catch (error) {
      showNotice(t('notices.saveFailed', { error: (error as Error).message }));
      return null;
    }
  }, [requestBody, showNotice, t]);

  const createProject = useCallback(async (name: string, seed?: ProjectTemplateSeed) => {
    const created = await bossApi.createProject(name);
    setProjects((current) => Array.from(new Set([...current, created.project])).sort());
    if (seed) {
      const base = await bossApi.getConfig(created.project);
      let scoringRules: Record<string, unknown> = {};
      try {
        scoringRules = JSON.parse(base.scoringRulesText || '{}') as Record<string, unknown>;
      } catch {
        scoringRules = {};
      }
      const initialized: ConfigPayload = {
        ...base,
        ...seed,
        scoringRulesText: JSON.stringify({ ...scoringRules, keywordHints: seed.scoringKeywords }, null, 2),
      };
      await bossApi.saveConfig(toRequestBody(initialized));
    }
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
    discardConfigChanges,
    requestBody,
    saveConfig,
    createProject,
  };
}
