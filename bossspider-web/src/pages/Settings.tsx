import { AlertTriangle, CalendarClock, Check, ChevronDown, Clock3, Copy, Eye, EyeOff, KeyRound, Languages, MonitorUp, Pencil, Play, PlugZap, Plus, RefreshCw, Save, Server, Settings2, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { bossApi } from '../api';
import { GuidedTour, type GuidedTourStep } from '../components/GuidedTour';
import { CitySelector } from '../components/CitySelector';
import { KeywordInput } from '../components/KeywordInput';
import { ThemeOptions } from '../components/ThemePicker';
import { useAppTranslation } from '../i18n';
import type { AgentAccess, AutomationResponse, AutomationSchedule, AutomationScheduleInput, DesktopSettings, LlmSettingsStatus, LoginState } from '../types';
import { collectionEstimate } from '../utils/collectionEstimate';

const defaultSchedule: AutomationScheduleInput = {
  project: '',
  enabled: true,
  cadence: 'daily',
  timeOfDay: '09:00',
  daysOfWeek: [],
  misfirePolicy: 'run_once',
  maxDelayMinutes: 360,
  keywordsText: '',
  citiesText: '',
  newJobTarget: 20,
  maxJobs: 100,
};

type McpClient = 'claude' | 'codex' | 'trae';

function scheduleInput(schedule: AutomationSchedule): AutomationScheduleInput {
  return {
    project: schedule.project,
    enabled: schedule.enabled,
    cadence: schedule.cadence,
    timeOfDay: schedule.timeOfDay,
    daysOfWeek: schedule.daysOfWeek,
    misfirePolicy: schedule.misfirePolicy,
    maxDelayMinutes: schedule.maxDelayMinutes,
    keywordsText: schedule.keywordsText,
    citiesText: schedule.citiesText,
    newJobTarget: schedule.newJobTarget,
    maxJobs: schedule.maxJobs,
  };
}

type CompactSelectOption<T extends string> = {
  value: T;
  label: string;
};

function CompactSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder,
}: {
  value: T;
  options: CompactSelectOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [open]);

  const moveSelection = (direction: 1 | -1) => {
    if (!options.length) return;
    const currentIndex = Math.max(0, options.findIndex((option) => option.value === value));
    const nextIndex = (currentIndex + direction + options.length) % options.length;
    onChange(options[nextIndex].value);
    setOpen(true);
  };

  return (
    <div className={`compact-select ${open ? 'is-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="compact-select__trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        disabled={!options.length}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            moveSelection(event.key === 'ArrowDown' ? 1 : -1);
          } else if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
      >
        <span className={!selected ? 'is-placeholder' : ''}>{selected?.label || placeholder || ariaLabel}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open && (
        <div id={listboxId} className="compact-select__menu" role="listbox" aria-label={ariaLabel}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={option.value === value ? 'is-selected' : ''}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              {option.value === value && <Check size={14} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Settings({
  onUpdated,
  returnToMatchingGuideAfterTest = false,
  onReturnToMatchingGuide,
}: {
  onUpdated: (settings: LlmSettingsStatus) => void;
  returnToMatchingGuideAfterTest?: boolean;
  onReturnToMatchingGuide?: () => void;
}) {
  const { t, i18n } = useAppTranslation();
  const currentLanguage = (i18n.resolvedLanguage || i18n.language).startsWith('en') ? 'en' : 'zh';
  const isZh = currentLanguage === 'zh';
  const [settings, setSettings] = useState<LlmSettingsStatus | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [apiBase, setApiBase] = useState('');
  const [model, setModel] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [keyVisible, setKeyVisible] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [setupGuideOpen, setSetupGuideOpen] = useState(false);
  const [setupGuideError, setSetupGuideError] = useState('');
  const [automation, setAutomation] = useState<AutomationResponse | null>(null);
  const [projects, setProjects] = useState<string[]>([]);
  const [loginStates, setLoginStates] = useState<Record<string, LoginState>>({});
  const [scheduleDraft, setScheduleDraft] = useState<AutomationScheduleInput>(defaultSchedule);
  const [scheduleProjectJobCount, setScheduleProjectJobCount] = useState(0);
  const [editingScheduleId, setEditingScheduleId] = useState('');
  const [scheduleEditorOpen, setScheduleEditorOpen] = useState(false);
  const [automationBusy, setAutomationBusy] = useState('');
  const [automationError, setAutomationError] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginActionMessage, setLoginActionMessage] = useState('');
  const loginPollStartedAt = useRef(0);
  const [desktopSettings, setDesktopSettings] = useState<DesktopSettings | null>(null);
  const [desktopSaving, setDesktopSaving] = useState(false);
  const [agentAccess, setAgentAccess] = useState<AgentAccess | null>(null);
  const [agentLoading, setAgentLoading] = useState(Boolean(window.bossflowDesktop));
  const [agentAccessError, setAgentAccessError] = useState('');
  const [mcpClient, setMcpClient] = useState<McpClient>('claude');
  const [agentCopyState, setAgentCopyState] = useState<McpClient | ''>('');
  const setupGuideSteps = useMemo<GuidedTourStep[]>(() => [
    {
      target: 'settings-test-api',
      title: t('settings.llm.setupTour.title'),
      body: t('settings.llm.setupTour.body'),
    },
  ], [t]);

  const mcpConfigText = useMemo(() => {
    const config = agentAccess?.stdioConfig;
    if (!config?.command) return '';
    const stdioConfig = {
      type: 'stdio',
      command: config.command,
      args: config.args || [],
      env: config.env || {},
    };
    if (mcpClient === 'claude') return JSON.stringify(stdioConfig, null, 2);
    if (mcpClient === 'trae') return JSON.stringify({ mcpServers: { bossflow: stdioConfig } }, null, 2);
    const quote = (value: string) => JSON.stringify(value);
    const lines = [
      '[mcp_servers.bossflow]',
      `command = ${quote(config.command)}`,
      `args = [${(config.args || []).map(quote).join(', ')}]`,
      'startup_timeout_sec = 20',
      'tool_timeout_sec = 120',
      'default_tools_approval_mode = "writes"',
    ];
    const env = Object.entries(config.env || {});
    if (env.length) {
      lines.push('', '[mcp_servers.bossflow.env]');
      env.forEach(([key, value]) => lines.push(`${key} = ${quote(value)}`));
    }
    return lines.join('\n');
  }, [agentAccess, mcpClient]);

  const load = async () => {
    setError('');
    try {
      const current = await bossApi.getLlmSettings();
      setSettings(current);
      setApiBase(current.apiBase);
      setModel(current.model);
    } catch (loadError) {
      setError((loadError as Error).message);
    }
  };

  useEffect(() => { void load(); }, []);

  const loadAutomation = async (silent = false) => {
    if (!silent) setAutomationError('');
    try {
      const [projectList, automationState] = await Promise.all([
        bossApi.getProjects(),
        bossApi.getAutomation(),
      ]);
      setProjects(projectList.projects);
      setAutomation(automationState);
      setScheduleDraft((current) => current.project ? current : {
        ...current,
        project: projectList.defaultProject || projectList.projects[0] || '',
      });
    } catch (loadError) {
      if (!silent) setAutomationError((loadError as Error).message);
    }
  };

  useEffect(() => {
    void loadAutomation();
    const timer = window.setInterval(() => void loadAutomation(true), 5000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!scheduleDraft.project || scheduleDraft.keywordsText.trim() || scheduleDraft.citiesText.trim()) return;
    let cancelled = false;
    void bossApi.getConfig(scheduleDraft.project).then((config) => {
      if (cancelled) return;
      setScheduleDraft((current) => current.project !== config.project || current.keywordsText.trim() || current.citiesText.trim()
        ? current
        : {
            ...current,
            keywordsText: config.keywordsText,
            citiesText: config.citiesText,
            newJobTarget: config.newJobTarget,
            maxJobs: config.maxJobs,
          });
    }).catch((configError) => setAutomationError((configError as Error).message));
    return () => { cancelled = true; };
  }, [scheduleDraft.project, scheduleDraft.keywordsText, scheduleDraft.citiesText]);

  useEffect(() => {
    if (!scheduleDraft.project) {
      setScheduleProjectJobCount(0);
      return;
    }
    let cancelled = false;
    void bossApi.getConfig(scheduleDraft.project).then((config) => {
      if (!cancelled) setScheduleProjectJobCount(config.jobCount);
    }).catch(() => {
      if (!cancelled) setScheduleProjectJobCount(0);
    });
    return () => { cancelled = true; };
  }, [scheduleDraft.project]);

  const loadLoginStates = useCallback(async () => {
    if (!projects.length) return;
    const entries = await Promise.all(projects.map(async (project) => {
      try {
        return [project, await bossApi.getLoginState(project)] as const;
      } catch {
        return null;
      }
    }));
    setLoginStates(Object.fromEntries(entries.filter((entry): entry is readonly [string, LoginState] => Boolean(entry))));
  }, [projects]);

  const startLoginFromSettings = async () => {
    if (!scheduleDraft.project || loginBusy || automationBusy === 'login') return;
    setAutomationError('');
    setLoginActionMessage('');
    setAutomationBusy('login');
    try {
      const config = await bossApi.getConfig(scheduleDraft.project);
      await bossApi.startLogin({
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
      });
      loginPollStartedAt.current = Date.now();
      setLoginBusy(true);
      setLoginActionMessage(isZh
        ? '登录窗口已打开。请在其中完成登录，BossFlow 验证成功后会自动刷新此处状态。'
        : 'The login window is open. Complete sign-in there; BossFlow will refresh this status after verification.');
    } catch (loginError) {
      setAutomationError((loginError as Error).message);
    } finally {
      setAutomationBusy('');
    }
  };

  useEffect(() => {
    if (!loginBusy || !loginPollStartedAt.current) return undefined;
    const project = scheduleDraft.project;
    const timer = window.setInterval(async () => {
      try {
        const [task, state] = await Promise.all([
          bossApi.getTaskStatus(),
          bossApi.getLoginState(project),
        ]);
        setLoginStates((current) => ({ ...current, [project]: state }));
        if (!task.running) {
          setLoginBusy(false);
          setLoginActionMessage(state.canSchedule
            ? (isZh ? 'Cookie 已保存，可用于定时采集。' : 'Cookie saved and ready for scheduled collection.')
            : (isZh ? '未检测到可用 Cookie，请重新尝试并确认登录已完成。' : 'No usable Cookie was detected. Try again and complete sign-in.'));
        } else if (Date.now() - loginPollStartedAt.current > 10 * 60 * 1000) {
          setLoginBusy(false);
          setLoginActionMessage(isZh ? '等待登录超时，请刷新状态或重新尝试。' : 'Timed out waiting for login. Refresh or try again.');
        }
      } catch {
        // Keep waiting while the backend or browser is transitioning.
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [isZh, loginBusy, scheduleDraft.project]);

  useEffect(() => {
    void loadLoginStates();
    const timer = window.setInterval(() => void loadLoginStates(), 30000);
    return () => window.clearInterval(timer);
  }, [loadLoginStates]);

  const loadAgentAccess = useCallback(async () => {
    if (!window.bossflowDesktop) {
      setAgentLoading(false);
      return;
    }
    setAgentLoading(true);
    setAgentAccessError('');
    let timeout = 0;
    try {
      const timeoutPromise = new Promise<AgentAccess>((_resolve, reject) => {
        timeout = window.setTimeout(() => reject(new Error('MCP status request timed out')), 5000);
      });
      setAgentAccess(await Promise.race([window.bossflowDesktop.getAgentAccess(), timeoutPromise]));
    } catch (desktopError) {
      setAgentAccess(null);
      setAgentAccessError((desktopError as Error).message);
    } finally {
      window.clearTimeout(timeout);
      setAgentLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!window.bossflowDesktop) return;
    void window.bossflowDesktop.getSettings().then(setDesktopSettings).catch((desktopError) => {
      setAutomationError((desktopError as Error).message);
    });
    void loadAgentAccess();
  }, [loadAgentAccess]);

  const saveSchedule = async () => {
    if (!scheduleDraft.project) return;
    setAutomationBusy('save');
    setAutomationError('');
    try {
      if (editingScheduleId) await bossApi.updateAutomationSchedule(editingScheduleId, scheduleDraft);
      else await bossApi.createAutomationSchedule(scheduleDraft);
      setEditingScheduleId('');
      setScheduleEditorOpen(false);
      setScheduleDraft({ ...defaultSchedule, project: scheduleDraft.project });
      await loadAutomation(true);
      await loadLoginStates();
    } catch (saveError) {
      setAutomationError((saveError as Error).message);
    } finally {
      setAutomationBusy('');
    }
  };

  const editSchedule = (schedule: AutomationSchedule) => {
    setAutomationError('');
    setEditingScheduleId(schedule.id);
    setScheduleDraft(scheduleInput(schedule));
    setScheduleEditorOpen(true);
  };

  const createSchedule = () => {
    setAutomationError('');
    setEditingScheduleId('');
    setScheduleDraft({
      ...defaultSchedule,
      project: scheduleDraft.project || projects[0] || '',
    });
    setScheduleEditorOpen(true);
  };

  const closeScheduleEditor = () => {
    if (automationBusy === 'save') return;
    setEditingScheduleId('');
    setScheduleEditorOpen(false);
  };

  const toggleSchedule = async (schedule: AutomationSchedule) => {
    setAutomationBusy(schedule.id);
    setAutomationError('');
    try {
      await bossApi.updateAutomationSchedule(schedule.id, { ...scheduleInput(schedule), enabled: !schedule.enabled });
      await loadAutomation(true);
      await loadLoginStates();
    } catch (toggleError) {
      setAutomationError((toggleError as Error).message);
    } finally {
      setAutomationBusy('');
    }
  };

  const deleteSchedule = async (schedule: AutomationSchedule) => {
    if (!window.confirm(isZh ? `删除“${schedule.project}”的定时任务？` : `Delete the scheduled task for “${schedule.project}”?`)) return;
    setAutomationBusy(schedule.id);
    setAutomationError('');
    try {
      await bossApi.deleteAutomationSchedule(schedule.id);
      if (editingScheduleId === schedule.id) {
        setEditingScheduleId('');
        setScheduleDraft({ ...defaultSchedule, project: scheduleDraft.project });
      }
      await loadAutomation(true);
    } catch (deleteError) {
      setAutomationError((deleteError as Error).message);
    } finally {
      setAutomationBusy('');
    }
  };

  const runSchedule = async (schedule: AutomationSchedule) => {
    setAutomationBusy(schedule.id);
    setAutomationError('');
    try {
      await bossApi.runAutomationSchedule(schedule.id);
      await loadAutomation(true);
    } catch (runError) {
      setAutomationError((runError as Error).message);
    } finally {
      setAutomationBusy('');
    }
  };

  const updateDesktopSetting = async (key: keyof Omit<DesktopSettings, 'supported'>, value: boolean) => {
    if (!desktopSettings || !window.bossflowDesktop) return;
    setDesktopSaving(true);
    setAutomationError('');
    try {
      const next = await window.bossflowDesktop.setSettings({
        openAtLogin: desktopSettings.openAtLogin,
        startMinimized: desktopSettings.startMinimized,
        keepRunningInTray: desktopSettings.keepRunningInTray,
        [key]: value,
      });
      setDesktopSettings(next);
    } catch (desktopError) {
      setAutomationError((desktopError as Error).message);
    } finally {
      setDesktopSaving(false);
    }
  };

  const copyAgentConfig = async () => {
    if (!mcpConfigText) return;
    try {
      await navigator.clipboard.writeText(mcpConfigText);
      setAgentCopyState(mcpClient);
      window.setTimeout(() => setAgentCopyState(''), 1800);
    } catch (copyError) {
      setAutomationError((copyError as Error).message);
    }
  };

  const save = async () => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const saved = await bossApi.saveLlmSettings({ apiKey, apiBase, model });
      setSettings(saved);
      setApiKey('');
      setKeyVisible(false);
      onUpdated(saved);
      setMessage(t('settings.llm.saved'));
      return true;
    } catch (saveError) {
      setError((saveError as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const toggleKeyVisibility = async () => {
    if (keyVisible) {
      setKeyVisible(false);
      return;
    }
    if (!apiKey && settings?.configured) {
      setError('');
      try {
        const revealed = await bossApi.revealLlmApiKey();
        setApiKey(revealed.apiKey);
      } catch (revealError) {
        setError((revealError as Error).message);
        return;
      }
    }
    setKeyVisible(true);
  };

  const testConnection = async () => {
    setTesting(true);
    setError('');
    setMessage('');
    try {
      await bossApi.testLlmSettings({ apiKey, apiBase, model });
      setMessage(t('settings.llm.testSuccess'));
      if (returnToMatchingGuideAfterTest) {
        setSetupGuideError('');
        setSetupGuideOpen(true);
      }
    } catch (testError) {
      setError((testError as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const finishSetupGuide = async () => {
    setSetupGuideError('');
    if (!await save()) {
      setSetupGuideError(t('settings.llm.setupTour.saveFailed'));
      return;
    }
    setSetupGuideOpen(false);
    onReturnToMatchingGuide?.();
  };

  const selectedLoginState = loginStates[scheduleDraft.project];
  const selectedLoginLabel = selectedLoginState?.lastSavedAt
    ? (selectedLoginState.daysSinceSaved === 0
      ? (isZh ? '今天已保存' : 'Saved today')
      : (isZh ? `${selectedLoginState.daysSinceSaved} 天前保存` : `Saved ${selectedLoginState.daysSinceSaved} days ago`))
    : (isZh ? '尚未保存' : 'Not saved');
  const draftEstimate = useMemo(() => collectionEstimate({
    ...scheduleDraft,
    existingJobCount: scheduleProjectJobCount,
  }), [scheduleDraft, scheduleProjectJobCount]);
  const longSchedules = (automation?.schedules || []).filter(
    (schedule) => schedule.enabled
      && schedule.estimatedMinutes > (automation?.limits?.recommendedDailyMinutes || 300),
  );

  return (
    <div className="settings-page mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-zinc-100"><Settings2 size={20} />{t('settings.title')}</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-500">{t('settings.subtitle')}</p>
      </div>
      <section className="rounded-lg border border-zinc-800 bg-zinc-950">
        <div className="border-b border-zinc-800 p-5">
          <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-100"><KeyRound size={17} className="text-indigo-300" />{t('settings.llm.title')}</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-500">{t('settings.llm.description')}</p>
        </div>
        <div className="space-y-5 p-5">
          <div className={`settings-status rounded border px-3 py-2 text-sm ${settings?.configured ? 'settings-status--success border-emerald-900/60 bg-emerald-950/20 text-emerald-200' : 'settings-status--pending border-amber-900/60 bg-amber-950/20 text-amber-200'}`}>
            {settings?.configured ? t('settings.llm.configured') : t('settings.llm.notConfigured')}
          </div>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-200">{t('settings.llm.apiKey')}</span>
            <div className="flex gap-2">
              <input type={keyVisible ? 'text' : 'password'} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={settings?.configured ? settings.apiKeyMasked : t('settings.llm.apiKeyPlaceholder')} className="min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-indigo-500" />
              <button onClick={() => void toggleKeyVisibility()} className="inline-flex items-center gap-1.5 rounded border border-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900">
                {keyVisible ? <EyeOff size={15} /> : <Eye size={15} />}
                {keyVisible ? t('settings.llm.hideKey') : t('settings.llm.showKey')}
              </button>
            </div>
            <span className="mt-1.5 block text-xs text-zinc-600">{t('settings.llm.apiKeyHint')}</span>
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-200">{t('settings.llm.apiBase')}</span>
            <input value={apiBase} onChange={(event) => setApiBase(event.target.value)} placeholder="https://api.example.com/v1" className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-indigo-500" />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-200">{t('settings.llm.model')}</span>
            <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="deepseek-v4-flash" className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-indigo-500" />
          </label>
          {error && <p className="rounded border border-red-900/60 bg-red-950/20 px-3 py-2 text-sm text-red-200">{error}</p>}
          {message && <p className="rounded border border-emerald-900/60 bg-emerald-950/20 px-3 py-2 text-sm text-emerald-200">{message}</p>}
          <div className="flex justify-end gap-2">
            <button data-guide-target="settings-test-api" onClick={() => void testConnection()} disabled={testing || saving} className="inline-flex items-center gap-2 rounded border border-cyan-800 bg-cyan-950/20 px-4 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-950/40 disabled:cursor-not-allowed disabled:opacity-60"><PlugZap size={15} />{testing ? t('settings.llm.testing') : t('settings.llm.test')}</button>
            <button onClick={() => void save()} disabled={saving} className="inline-flex items-center gap-2 rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"><Save size={15} />{saving ? t('settings.saving') : t('settings.save')}</button>
          </div>
        </div>
      </section>
      <section className="rounded-lg border border-zinc-800 bg-zinc-950">
        <div className="border-b border-zinc-800 p-5">
          <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-100"><Server size={17} className="text-indigo-300" />MCP</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-500">{isZh ? '查看 BossFlow MCP Server 运行状态，并将它连接到支持 MCP 的工具。' : 'Check the BossFlow MCP Server and connect it to MCP-compatible tools.'}</p>
        </div>
        <div className="mcp-panel p-4 sm:p-5">
          {!window.bossflowDesktop && <div className="automation-empty">{isZh ? 'MCP Server 仅在 BossFlow 桌面应用中启用。' : 'The MCP Server is available in the BossFlow desktop app.'}</div>}
          {window.bossflowDesktop && agentLoading && !agentAccess && <div className="automation-empty">{isZh ? '正在检查 MCP Server…' : 'Checking the MCP Server…'}</div>}
          {agentAccessError && <div className="mcp-load-error"><span>{isZh ? `无法读取 MCP 状态：${agentAccessError}` : `Unable to read MCP status: ${agentAccessError}`}</span><button type="button" onClick={() => void loadAgentAccess()}>{isZh ? '重试' : 'Retry'}</button></div>}
          {agentAccess && <>
            <div className={`mcp-server-card is-${agentAccess.server.status}`}>
              <div className="mcp-server-main">
                <span className="mcp-server-icon"><Server size={18} /></span>
                <div>
                  <div className="mcp-server-title"><strong>{agentAccess.server.name}</strong><span><i />{agentAccess.server.status === 'running' ? (isZh ? '运行中' : 'Running') : agentAccess.server.status === 'disabled' ? (isZh ? '未启用' : 'Disabled') : (isZh ? '无法连接' : 'Unavailable')}</span></div>
                  <code>{agentAccess.server.endpoint || (isZh ? '暂无 Server 地址' : 'No server endpoint')}</code>
                </div>
              </div>
              <div className="mcp-server-meta">
                <span>{agentAccess.server.transport}</span>
                <span>{agentAccess.server.toolCount} Tools</span>
                <span>{agentAccess.server.resourceCount} Resources</span>
                <button type="button" onClick={() => void loadAgentAccess()} disabled={agentLoading}><RefreshCw size={14} className={agentLoading ? 'animate-spin' : ''} />{isZh ? '刷新' : 'Refresh'}</button>
              </div>
            </div>
            {!agentAccess.supported && <div className="automation-empty">{isZh ? '当前环境没有可用的 MCP 连接令牌，Server 无法供外部工具连接。' : 'No MCP access token is available in this environment.'}</div>}
            {agentAccess.supported && <>
              <div className="mcp-connect-heading"><div><strong>{isZh ? '连接工具' : 'Connect a tool'}</strong><p>{isZh ? '选择你使用的工具，按步骤添加同一个 BossFlow MCP Server。' : 'Choose a tool and follow the steps to add this BossFlow MCP Server.'}</p></div><span>{isZh ? '推荐使用 stdio，应用重启后无需更新端口' : 'stdio recommended; no port updates after restart'}</span></div>
              <div className="mcp-client-tabs" role="tablist" aria-label={isZh ? '选择 MCP 客户端' : 'Choose MCP client'}>
                {([['claude', 'Claude Code'], ['codex', 'Codex'], ['trae', 'Trae']] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={mcpClient === value} className={mcpClient === value ? 'is-active' : ''} onClick={() => setMcpClient(value)}>{label}</button>)}
              </div>
              <div className="mcp-client-guide">
                <div className="mcp-client-steps">
                  <strong>{mcpClient === 'claude' ? 'Claude Code' : mcpClient === 'codex' ? 'Codex' : 'Trae'} {isZh ? '配置步骤' : 'setup'}</strong>
                  {mcpClient === 'claude' && <ol><li>{isZh ? '保持 BossFlow 运行，在终端打开 Claude Code。' : 'Keep BossFlow running and open Claude Code in a terminal.'}</li><li>{isZh ? '运行 claude mcp add-json bossflow，并把右侧 JSON 作为配置；建议使用 --scope user。' : 'Run claude mcp add-json bossflow with the JSON shown here; user scope is recommended.'}</li><li>{isZh ? '运行 claude mcp get bossflow，或在会话中输入 /mcp 检查连接。' : 'Run claude mcp get bossflow, or enter /mcp in a session to verify.'}</li></ol>}
                  {mcpClient === 'codex' && <ol><li>{isZh ? '打开 Codex 设置 → MCP servers，或编辑 ~/.codex/config.toml。' : 'Open Codex Settings → MCP servers, or edit ~/.codex/config.toml.'}</li><li>{isZh ? '将右侧 TOML 追加到配置文件并保存。' : 'Append the TOML shown here and save the file.'}</li><li>{isZh ? '重启 Codex，然后通过 MCP servers 页面或 /mcp 检查状态。' : 'Restart Codex, then verify in MCP servers or with /mcp.'}</li></ol>}
                  {mcpClient === 'trae' && <ol><li>{isZh ? '在 Trae AI 对话面板右上角打开设置 → MCP。' : 'In Trae, open AI panel settings → MCP.'}</li><li>{isZh ? '选择“添加 → 手动添加 → 原始配置（JSON）”。' : 'Choose Add → Manual add → Raw configuration (JSON).'}</li><li>{isZh ? '粘贴右侧配置并确认，然后在 Builder with MCP 中检查 BossFlow。' : 'Paste the configuration, save it, then check BossFlow in Builder with MCP.'}</li></ol>}
                </div>
                <div className="mcp-config-card">
                  <div><span>{mcpClient === 'codex' ? 'config.toml' : 'MCP JSON'}</span><button type="button" onClick={() => void copyAgentConfig()}>{agentCopyState === mcpClient ? <Check size={14} /> : <Copy size={14} />}{agentCopyState === mcpClient ? (isZh ? '已复制' : 'Copied') : (isZh ? '复制配置' : 'Copy')}</button></div>
                  <pre><code>{mcpConfigText}</code></pre>
                </div>
              </div>
              <p className="mcp-security-note">{isZh ? '连接仅对当前 Windows 用户有效；外部工具使用期间需保持 BossFlow 运行。写入、采集和付费 LLM 工具仍会要求确认并记录审计日志。' : 'The connection is limited to the current Windows user. Keep BossFlow running; writes, collection, and paid LLM tools still require confirmation and are audited.'}</p>
            </>}
          </>}
        </div>
      </section>
      <section className="rounded-lg border border-zinc-800 bg-zinc-950">
        <div className="flex items-start justify-between gap-5 border-b border-zinc-800 p-5">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-100"><CalendarClock size={17} className="text-indigo-300" />{isZh ? '定时岗位采集' : 'Scheduled job collection'}</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-500">{isZh ? '每个计划保存独立的关键词、城市和岗位数量。计划共用串行队列，时间重叠时会依次执行。' : 'Each plan keeps its own keywords, cities, and job target. Overlapping plans run through one serial queue.'}</p>
          </div>
          <button type="button" className="automation-primary-button shrink-0" onClick={createSchedule} disabled={(automation?.schedules.length || 0) >= (automation?.limits?.maxSchedules || 10)}>
            <Plus size={15} />{isZh ? '新增计划' : 'New plan'}
          </button>
        </div>
        <div className="space-y-5 p-4 sm:p-5">
          <div className="automation-queue-summary">
            <span><Clock3 size={15} />{isZh ? '队列状态' : 'Queue'}</span>
            <strong>{automation?.queue.running ? (isZh ? '正在采集' : 'Collecting') : automation?.queue.queued ? (isZh ? `等待 ${automation.queue.queued} 项` : `${automation.queue.queued} waiting`) : (isZh ? '空闲' : 'Idle')}</strong>
            <small>{isZh ? '串行执行 · 不会同时启动两个采集任务' : 'Serial execution · never starts two collectors at once'}</small>
          </div>

          {selectedLoginState && (
            <div className={`automation-login-state is-${selectedLoginState.status}`}>
              <span><AlertTriangle size={15} /></span>
              <div>
                <strong>{isZh ? `${scheduleDraft.project} · 登录 Cookie ${selectedLoginLabel}` : `${scheduleDraft.project} · Login Cookie ${selectedLoginLabel}`}</strong>
                <p>{selectedLoginState.status === 'available'
                  ? (isZh ? '当前可用于定时采集；执行前仍会再次检查。' : 'Available for scheduled collection; it will be checked again before execution.')
                  : selectedLoginState.status === 'refresh_recommended'
                    ? (isZh ? `已超过 ${selectedLoginState.refreshRecommendedAfterDays} 天刷新建议，建议先重新登录，服务端仍可能提前使 Cookie 失效。` : `Older than the ${selectedLoginState.refreshRecommendedAfterDays}-day refresh recommendation. Sign in again before unattended use.`)
                    : (isZh ? '无法启动启用状态的定时任务。请在此处点击“登录 / 保存 Cookie”。' : 'An enabled schedule cannot start. Choose Login / Save Cookie here.')}</p>
                {selectedLoginState.earliestClientExpiryAt && <small>{isZh ? '浏览器记录的最早核心 Cookie 到期：' : 'Earliest core Cookie expiry: '}{new Date(selectedLoginState.earliestClientExpiryAt).toLocaleString(currentLanguage === 'zh' ? 'zh-CN' : 'en-US')}</small>}
                {loginActionMessage && <small>{loginActionMessage}</small>}
              </div>
              <div className="automation-login-state__actions">
                {selectedLoginState.status !== 'available' && <button type="button" onClick={() => void startLoginFromSettings()} disabled={loginBusy || automationBusy === 'login' || !scheduleDraft.project}>
                  <KeyRound size={14} />{automationBusy === 'login' ? (isZh ? '正在打开…' : 'Opening…') : loginBusy ? (isZh ? '等待登录…' : 'Waiting…') : selectedLoginState.status === 'refresh_recommended' ? (isZh ? '重新登录并更新 Cookie' : 'Refresh login Cookie') : (isZh ? '登录 / 保存 Cookie' : 'Login / Save Cookie')}
                </button>}
                <button type="button" onClick={() => void loadLoginStates()} disabled={loginBusy}>
                  <RefreshCw size={14} />{isZh ? '刷新状态' : 'Refresh'}
                </button>
              </div>
            </div>
          )}

          {automationError && <p className="rounded border border-red-900/60 bg-red-950/20 px-3 py-2 text-sm text-red-200">{automationError}</p>}

          <div className="automation-schedule-list">
            {automation?.schedules.length ? automation.schedules.map((schedule) => (
              <article key={schedule.id} className={!schedule.enabled ? 'is-disabled' : ''}>
                <button type="button" role="switch" aria-checked={schedule.enabled} aria-label={schedule.enabled ? (isZh ? '停用计划' : 'Disable plan') : (isZh ? '启用计划' : 'Enable plan')} className={`automation-switch ${schedule.enabled ? 'is-on' : ''}`} onClick={() => void toggleSchedule(schedule)} disabled={automationBusy === schedule.id}><span /></button>
                <div className="automation-schedule-main">
                  <div className="automation-schedule-title"><strong>{schedule.project}</strong><span className={schedule.estimatedMinutes > (automation?.limits?.recommendedDailyMinutes || 300) ? 'is-long' : ''}>{isZh ? `预计约 ${schedule.estimatedMinutes} 分钟` : `About ${schedule.estimatedMinutes} min`}</span></div>
                  <p>{schedule.cadence === 'daily' ? (isZh ? '每天' : 'Daily') : schedule.cadence === 'weekdays' ? (isZh ? '工作日' : 'Weekdays') : (isZh ? `每周 ${schedule.daysOfWeek.map((day) => '一二三四五六日'[day]).join('、')}` : `Weekly · ${schedule.daysOfWeek.join(', ')}`)} · {schedule.timeOfDay}</p>
                  <small>{schedule.keywordCount} {isZh ? '个关键词' : 'keywords'} · {schedule.cityCount} {isZh ? '个城市' : 'cities'} · {isZh ? '下次：' : 'Next: '}{new Date(schedule.nextRunAt).toLocaleString(currentLanguage === 'zh' ? 'zh-CN' : 'en-US')}</small>
                </div>
                <div className="automation-row-actions"><button title={isZh ? '立即运行' : 'Run now'} onClick={() => void runSchedule(schedule)} disabled={automationBusy === schedule.id || (loginStates[schedule.project] && !loginStates[schedule.project].canSchedule)}><Play size={15} /></button><button title={isZh ? '编辑' : 'Edit'} onClick={() => editSchedule(schedule)}><Pencil size={15} /></button><button title={isZh ? '删除' : 'Delete'} onClick={() => void deleteSchedule(schedule)} disabled={automationBusy === schedule.id}><Trash2 size={15} /></button></div>
              </article>
            )) : <div className="automation-empty">{isZh ? '还没有定时计划。先选择求职目标和执行时间。' : 'No scheduled plans yet. Choose a job target and run time to begin.'}</div>}
          </div>
          {!!longSchedules.length && <p className="automation-plan-warning is-strong">{isZh ? `${longSchedules.length} 个启用计划的单次预计采集时间超过 5 小时。不会阻止运行，但建议减少城市、关键词或目标岗位数。` : `${longSchedules.length} enabled plans are estimated to run longer than 5 hours each. They remain runnable, but reducing scope is recommended.`}</p>}

          {!!automation?.schedules.some((schedule) => schedule.enabled) && desktopSettings && !desktopSettings.keepRunningInTray && <p className="desktop-setting-warning">{isZh ? '已有启用的计划，但关闭窗口后应用会退出。若要在后台按时执行，请在下方开启“关闭窗口后在托盘运行”。' : 'A plan is enabled, but closing the window currently quits the app. Enable “Keep running in tray” below for reliable background runs.'}</p>}

          {!!automation?.runs.length && <div className="automation-history"><h3>{isZh ? '最近执行' : 'Recent runs'}</h3>{automation.runs.slice(0, 5).map((run) => <div key={run.id}><span className={`automation-run-status is-${run.status}`}>{run.status === 'succeeded' ? (isZh ? '成功' : 'Succeeded') : run.status === 'running' ? (isZh ? '运行中' : 'Running') : run.status === 'queued' ? (isZh ? '排队中' : 'Queued') : run.status === 'missed' ? (isZh ? '已错过' : 'Missed') : run.status === 'interrupted' ? (isZh ? '已中断' : 'Interrupted') : (isZh ? '失败' : 'Failed')}</span><strong>{run.project}</strong><small>{new Date(run.scheduledFor).toLocaleString(currentLanguage === 'zh' ? 'zh-CN' : 'en-US')}</small></div>)}</div>}
        </div>
      </section>

      {scheduleEditorOpen && (
        <div className="automation-dialog-backdrop" role="presentation" onMouseDown={closeScheduleEditor}>
          <section className="automation-dialog" role="dialog" aria-modal="true" aria-labelledby="automation-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h2 id="automation-dialog-title">{editingScheduleId ? (isZh ? '编辑定时采集计划' : 'Edit collection plan') : (isZh ? '新增定时采集计划' : 'New collection plan')}</h2>
                <p>{isZh ? '设置执行时间和此计划独立使用的采集范围。' : 'Set the schedule and the collection scope stored with this plan.'}</p>
              </div>
              <button type="button" onClick={closeScheduleEditor} disabled={automationBusy === 'save'} aria-label={isZh ? '关闭' : 'Close'}><X size={17} /></button>
            </header>
            <div className="automation-dialog__body">
              {automationError && <p className="mb-3 rounded border border-red-900/60 bg-red-950/20 px-3 py-2 text-sm text-red-200">{automationError}</p>}
              <div className="automation-editor">
                <div className="automation-form-grid">
                  <div className="automation-field">
                    <span>{isZh ? '求职目标' : 'Job target'}</span>
                    <CompactSelect
                      value={scheduleDraft.project}
                      options={projects.map((project) => ({ value: project, label: project }))}
                      onChange={(project) => setScheduleDraft({ ...scheduleDraft, project, keywordsText: '', citiesText: '' })}
                      ariaLabel={isZh ? '选择求职目标' : 'Select job target'}
                      placeholder={isZh ? '请选择求职目标' : 'Choose a job target'}
                    />
                  </div>
                  <div className="automation-field">
                    <span>{isZh ? '执行频率' : 'Frequency'}</span>
                    <CompactSelect
                      value={scheduleDraft.cadence}
                      options={[
                        { value: 'daily', label: isZh ? '每天' : 'Daily' },
                        { value: 'weekdays', label: isZh ? '工作日' : 'Weekdays' },
                        { value: 'weekly', label: isZh ? '每周' : 'Weekly' },
                      ]}
                      onChange={(cadence) => setScheduleDraft({ ...scheduleDraft, cadence, daysOfWeek: [] })}
                      ariaLabel={isZh ? '选择执行频率' : 'Select frequency'}
                    />
                  </div>
                  <label><span>{isZh ? '开始时间' : 'Start time'}</span><input type="time" value={scheduleDraft.timeOfDay} onChange={(event) => setScheduleDraft({ ...scheduleDraft, timeOfDay: event.target.value })} /></label>
                  <div className="automation-field">
                    <span>{isZh ? '错过后处理' : 'If missed'}</span>
                    <CompactSelect
                      value={scheduleDraft.misfirePolicy}
                      options={[
                        { value: 'run_once', label: isZh ? '启动后补跑一次' : 'Catch up once' },
                        { value: 'skip', label: isZh ? '跳过本次' : 'Skip this run' },
                      ]}
                      onChange={(misfirePolicy) => setScheduleDraft({ ...scheduleDraft, misfirePolicy })}
                      ariaLabel={isZh ? '选择错过后的处理方式' : 'Select missed-run policy'}
                    />
                  </div>
                </div>
                {scheduleDraft.cadence === 'weekly' && (
                  <div className="automation-weekdays" aria-label={isZh ? '每周执行日' : 'Weekly run days'}>
                    {(isZh ? ['一', '二', '三', '四', '五', '六', '日'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']).map((label, day) => <button key={label} type="button" className={scheduleDraft.daysOfWeek.includes(day) ? 'is-active' : ''} onClick={() => setScheduleDraft({ ...scheduleDraft, daysOfWeek: scheduleDraft.daysOfWeek.includes(day) ? scheduleDraft.daysOfWeek.filter((item) => item !== day) : [...scheduleDraft.daysOfWeek, day].sort() })}>{label}</button>)}
                  </div>
                )}
                <div className="automation-collection-scope">
                  <div className="automation-collection-scope__heading">
                    <div><strong>{isZh ? '此计划的采集范围' : 'Collection scope for this plan'}</strong><span>{isZh ? '新建时复制求职目标当前配置，保存后独立维护。' : 'The current target config is copied once and then stored independently.'}</span></div>
                    <b>{draftEstimate.estimatedMinutes
                      ? (isZh ? `预计约 ${draftEstimate.estimatedMinutes} 分钟` : `About ${draftEstimate.estimatedMinutes} min`)
                      : (isZh ? '请填写关键词和城市' : 'Add keywords and cities')}</b>
                  </div>
                  {draftEstimate.estimatedMinutes > (automation?.limits?.recommendedDailyMinutes || 300) && <p className="automation-plan-warning is-strong">{isZh ? '本计划单次预计超过 5 小时。可以继续保存，但建议缩小采集范围。' : 'This run is estimated to exceed 5 hours. You can save it, but reducing the scope is recommended.'}</p>}
                  <div className="automation-collection-scope__grid">
                    <KeywordInput
                      value={scheduleDraft.keywordsText}
                      onChange={(keywordsText) => setScheduleDraft({ ...scheduleDraft, keywordsText })}
                      label={isZh ? '采集关键词' : 'Keywords'}
                      addLabel={isZh ? '添加关键词' : 'Add keyword'}
                      inputPlaceholder={isZh ? '输入关键词后回车' : 'Type a keyword and press Enter'}
                      emptyLabel={isZh ? '还没有添加关键词' : 'No keywords added yet'}
                    />
                    <div className="automation-collection-limits">
                      <label><span>{isZh ? '获取新岗位数量' : 'New jobs target'}</span><input type="number" min={1} max={5000} value={scheduleDraft.newJobTarget} onChange={(event) => setScheduleDraft({ ...scheduleDraft, newJobTarget: Math.max(1, Number(event.target.value) || 1) })} /></label>
                      <label><span>{isZh ? '最大获取岗位数量' : 'Maximum jobs inspected'}</span><input type="number" min={1} max={5000} value={scheduleDraft.maxJobs} onChange={(event) => setScheduleDraft({ ...scheduleDraft, maxJobs: Math.max(1, Number(event.target.value) || 1) })} /></label>
                      <small>{isZh ? `${draftEstimate.keywordCount} 个关键词 × ${draftEstimate.cityCount} 个城市 = ${draftEstimate.combinationCount} 组；任一条件先满足即停止。预计查看 ${draftEstimate.estimatedListedJobs} 条列表、读取 ${draftEstimate.estimatedDetailJobs} 条详情，复用 ${draftEstimate.estimatedReusedJobs} 条已有岗位。` : `${draftEstimate.keywordCount} keywords × ${draftEstimate.cityCount} cities = ${draftEstimate.combinationCount} searches. The first reached limit stops collection; about ${draftEstimate.estimatedListedJobs} listings inspected, ${draftEstimate.estimatedDetailJobs} detail reads, and ${draftEstimate.estimatedReusedJobs} known jobs reused.`}</small>
                    </div>
                  </div>
                  <CitySelector value={scheduleDraft.citiesText} onChange={(citiesText) => setScheduleDraft({ ...scheduleDraft, citiesText })} showAdvanced={false} compact />
                </div>
                {scheduleDraft.misfirePolicy === 'run_once' && <label className="automation-delay"><span>{isZh ? '最长补跑延迟（分钟）' : 'Maximum catch-up delay (minutes)'}</span><input type="number" min={0} max={10080} value={scheduleDraft.maxDelayMinutes} onChange={(event) => setScheduleDraft({ ...scheduleDraft, maxDelayMinutes: Math.max(0, Number(event.target.value) || 0) })} /></label>}
              </div>
            </div>
            <footer>
              <button type="button" className="automation-secondary-button" onClick={closeScheduleEditor}>{isZh ? '取消' : 'Cancel'}</button>
              <button type="button" disabled={!scheduleDraft.project || !scheduleDraft.keywordsText.trim() || !scheduleDraft.citiesText.trim() || automationBusy === 'save' || (!editingScheduleId && (automation?.schedules.length || 0) >= (automation?.limits?.maxSchedules || 10)) || (scheduleDraft.enabled && selectedLoginState && !selectedLoginState.canSchedule) || (scheduleDraft.cadence === 'weekly' && scheduleDraft.daysOfWeek.length === 0)} className="automation-primary-button" onClick={() => void saveSchedule()}>{editingScheduleId ? <Save size={15} /> : <Plus size={15} />}{automationBusy === 'save' ? (isZh ? '保存中…' : 'Saving…') : editingScheduleId ? (isZh ? '保存计划' : 'Save plan') : (isZh ? '添加计划' : 'Add plan')}</button>
            </footer>
          </section>
        </div>
      )}

      <section className="rounded-lg border border-zinc-800 bg-zinc-950">
        <div className="border-b border-zinc-800 p-5">
          <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-100"><MonitorUp size={17} className="text-indigo-300" />{isZh ? '桌面应用' : 'Desktop app'}</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-500">{isZh ? '控制系统登录与关闭窗口时的行为。定时采集需要 BossFlow 在后台保持运行。' : 'Control login and window-close behavior. Scheduled collection requires BossFlow to keep running in the background.'}</p>
        </div>
        <div className="desktop-setting-list p-4 sm:p-5">
          {!desktopSettings && <div className="automation-empty">{isZh ? '这些选项仅在桌面应用中可用。' : 'These options are available in the desktop app.'}</div>}
          {desktopSettings && <>
            {([
              ['openAtLogin', isZh ? '开机后自动启动' : 'Launch at login', isZh ? '登录系统后自动启动 BossFlow。' : 'Start BossFlow automatically after you sign in.'],
              ['startMinimized', isZh ? '自动启动时最小化' : 'Start minimized', isZh ? '仅在自动启动时隐藏到托盘，不打断当前工作。' : 'Hide to the tray on automatic launch without interrupting your work.'],
              ['keepRunningInTray', isZh ? '关闭窗口后在托盘运行' : 'Keep running in tray', isZh ? '关闭主窗口不会退出，定时采集仍可按计划执行。' : 'Closing the main window keeps scheduled collection available.'],
            ] as const).map(([key, title, description]) => {
              const disabled = desktopSaving || (key === 'startMinimized' && !desktopSettings.keepRunningInTray);
              return <div key={key} className="desktop-setting-row"><span><strong>{title}</strong><small>{description}</small></span><button type="button" role="switch" aria-checked={desktopSettings[key]} aria-label={title} disabled={disabled} className={`desktop-switch ${desktopSettings[key] ? 'is-on' : ''}`} onClick={() => void updateDesktopSetting(key, !desktopSettings[key])}><span /></button></div>;
            })}
            {desktopSettings.openAtLogin && !desktopSettings.keepRunningInTray && <p className="desktop-setting-warning">{isZh ? '建议同时开启“关闭窗口后在托盘运行”，否则自动启动时无法保持隐藏。' : 'Enable “Keep running in tray” as well if you want automatic launches to stay minimized.'}</p>}
          </>}
        </div>
      </section>
      <section className="rounded-lg border border-zinc-800 bg-zinc-950">
        <div className="border-b border-zinc-800 p-5">
          <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-100"><Languages size={17} className="text-indigo-300" />{t('settings.interface.title')}</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-500">{t('settings.interface.description')}</p>
        </div>
        <div className="space-y-5 p-4 sm:p-5">
          <label className="settings-language-field">
            <span>
              <strong>{t('settings.interface.language')}</strong>
              <small>{t('settings.interface.languageDescription')}</small>
            </span>
            <select value={currentLanguage} onChange={(event) => void i18n.changeLanguage(event.target.value)}>
              <option value="zh">{t('settings.interface.languages.zh')}</option>
              <option value="en">{t('settings.interface.languages.en')}</option>
            </select>
          </label>
          <div className="border-t border-zinc-800 pt-5">
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-zinc-100">{t('theme.appearance')}</h3>
              <p className="mt-1 text-xs leading-5 text-zinc-500">{t('theme.appearanceDescription')}</p>
            </div>
            <ThemeOptions />
          </div>
        </div>
      </section>
      {setupGuideOpen && (
        <GuidedTour
          steps={setupGuideSteps}
          activeStep={0}
          onStepChange={() => undefined}
          onClose={() => { setSetupGuideError(''); setSetupGuideOpen(false); }}
          onFinish={() => { void finishSetupGuide(); }}
          finishing={saving}
          error={setupGuideError}
          nextLabel={t('settings.llm.setupTour.finish')}
          previousLabel={t('settings.llm.setupTour.finish')}
          finishLabel={saving ? t('settings.saving') : t('settings.llm.setupTour.finish')}
          skipLabel={t('settings.llm.setupTour.skip')}
          progressLabel={(current, total) => t('settings.llm.setupTour.progress', { current, total })}
        />
      )}
    </div>
  );
}
