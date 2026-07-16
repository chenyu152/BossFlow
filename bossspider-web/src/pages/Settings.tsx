import { CalendarClock, Check, ChevronDown, Clock3, Eye, EyeOff, KeyRound, Languages, MonitorUp, Pencil, Play, PlugZap, Plus, Save, Settings2, Trash2 } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { bossApi } from '../api';
import { GuidedTour, type GuidedTourStep } from '../components/GuidedTour';
import { ThemeOptions } from '../components/ThemePicker';
import { useAppTranslation } from '../i18n';
import type { AutomationResponse, AutomationSchedule, AutomationScheduleInput, DesktopSettings, LlmSettingsStatus } from '../types';

const defaultSchedule: AutomationScheduleInput = {
  project: '',
  enabled: true,
  cadence: 'daily',
  timeOfDay: '09:00',
  daysOfWeek: [],
  misfirePolicy: 'run_once',
  maxDelayMinutes: 360,
};

function scheduleInput(schedule: AutomationSchedule): AutomationScheduleInput {
  return {
    project: schedule.project,
    enabled: schedule.enabled,
    cadence: schedule.cadence,
    timeOfDay: schedule.timeOfDay,
    daysOfWeek: schedule.daysOfWeek,
    misfirePolicy: schedule.misfirePolicy,
    maxDelayMinutes: schedule.maxDelayMinutes,
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
  const [scheduleDraft, setScheduleDraft] = useState<AutomationScheduleInput>(defaultSchedule);
  const [editingScheduleId, setEditingScheduleId] = useState('');
  const [automationBusy, setAutomationBusy] = useState('');
  const [automationError, setAutomationError] = useState('');
  const [desktopSettings, setDesktopSettings] = useState<DesktopSettings | null>(null);
  const [desktopSaving, setDesktopSaving] = useState(false);
  const setupGuideSteps = useMemo<GuidedTourStep[]>(() => [
    {
      target: 'settings-test-api',
      title: t('settings.llm.setupTour.title'),
      body: t('settings.llm.setupTour.body'),
    },
  ], [t]);

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
    if (!window.bossflowDesktop) return;
    void window.bossflowDesktop.getSettings().then(setDesktopSettings).catch((desktopError) => {
      setAutomationError((desktopError as Error).message);
    });
  }, []);

  const saveSchedule = async () => {
    if (!scheduleDraft.project) return;
    setAutomationBusy('save');
    setAutomationError('');
    try {
      if (editingScheduleId) await bossApi.updateAutomationSchedule(editingScheduleId, scheduleDraft);
      else await bossApi.createAutomationSchedule(scheduleDraft);
      setEditingScheduleId('');
      setScheduleDraft({ ...defaultSchedule, project: scheduleDraft.project });
      await loadAutomation(true);
    } catch (saveError) {
      setAutomationError((saveError as Error).message);
    } finally {
      setAutomationBusy('');
    }
  };

  const editSchedule = (schedule: AutomationSchedule) => {
    setEditingScheduleId(schedule.id);
    setScheduleDraft(scheduleInput(schedule));
  };

  const toggleSchedule = async (schedule: AutomationSchedule) => {
    setAutomationBusy(schedule.id);
    setAutomationError('');
    try {
      await bossApi.updateAutomationSchedule(schedule.id, { ...scheduleInput(schedule), enabled: !schedule.enabled });
      await loadAutomation(true);
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
          <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-100"><CalendarClock size={17} className="text-indigo-300" />{isZh ? '定时岗位采集' : 'Scheduled job collection'}</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-500">{isZh ? '按求职目标创建采集计划。所有计划共用一个串行队列，同一时间触发时会依次执行，避免账号与浏览器会话冲突。' : 'Create collection plans per job target. All plans share one serial queue, so simultaneous triggers run one after another.'}</p>
        </div>
        <div className="space-y-5 p-4 sm:p-5">
          <div className="automation-queue-summary">
            <span><Clock3 size={15} />{isZh ? '队列状态' : 'Queue'}</span>
            <strong>{automation?.queue.running ? (isZh ? '正在采集' : 'Collecting') : automation?.queue.queued ? (isZh ? `等待 ${automation.queue.queued} 项` : `${automation.queue.queued} waiting`) : (isZh ? '空闲' : 'Idle')}</strong>
            <small>{isZh ? '串行执行 · 不会同时启动两个采集任务' : 'Serial execution · never starts two collectors at once'}</small>
          </div>

          <div className="automation-editor">
            <div className="automation-form-grid">
              <div className="automation-field">
                <span>{isZh ? '求职目标' : 'Job target'}</span>
                <CompactSelect
                  value={scheduleDraft.project}
                  options={projects.map((project) => ({ value: project, label: project }))}
                  onChange={(project) => setScheduleDraft({ ...scheduleDraft, project })}
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
            {scheduleDraft.misfirePolicy === 'run_once' && <label className="automation-delay"><span>{isZh ? '最长补跑延迟（分钟）' : 'Maximum catch-up delay (minutes)'}</span><input type="number" min={0} max={10080} value={scheduleDraft.maxDelayMinutes} onChange={(event) => setScheduleDraft({ ...scheduleDraft, maxDelayMinutes: Math.max(0, Number(event.target.value) || 0) })} /></label>}
            <div className="flex justify-end gap-2">
              {editingScheduleId && <button type="button" className="automation-secondary-button" onClick={() => { setEditingScheduleId(''); setScheduleDraft({ ...defaultSchedule, project: scheduleDraft.project }); }}>{isZh ? '取消编辑' : 'Cancel'}</button>}
              <button type="button" disabled={!scheduleDraft.project || automationBusy === 'save' || (scheduleDraft.cadence === 'weekly' && scheduleDraft.daysOfWeek.length === 0)} className="automation-primary-button" onClick={() => void saveSchedule()}>{editingScheduleId ? <Save size={15} /> : <Plus size={15} />}{editingScheduleId ? (isZh ? '保存计划' : 'Save plan') : (isZh ? '添加计划' : 'Add plan')}</button>
            </div>
          </div>

          {automationError && <p className="rounded border border-red-900/60 bg-red-950/20 px-3 py-2 text-sm text-red-200">{automationError}</p>}

          <div className="automation-schedule-list">
            {automation?.schedules.length ? automation.schedules.map((schedule) => (
              <article key={schedule.id} className={!schedule.enabled ? 'is-disabled' : ''}>
                <button type="button" role="switch" aria-checked={schedule.enabled} aria-label={schedule.enabled ? (isZh ? '停用计划' : 'Disable plan') : (isZh ? '启用计划' : 'Enable plan')} className={`automation-switch ${schedule.enabled ? 'is-on' : ''}`} onClick={() => void toggleSchedule(schedule)} disabled={automationBusy === schedule.id}><span /></button>
                <div><strong>{schedule.project}</strong><p>{schedule.cadence === 'daily' ? (isZh ? '每天' : 'Daily') : schedule.cadence === 'weekdays' ? (isZh ? '工作日' : 'Weekdays') : (isZh ? `每周 ${schedule.daysOfWeek.map((day) => '一二三四五六日'[day]).join('、')}` : `Weekly · ${schedule.daysOfWeek.join(', ')}`)} · {schedule.timeOfDay}</p><small>{isZh ? '下次：' : 'Next: '}{new Date(schedule.nextRunAt).toLocaleString(currentLanguage === 'zh' ? 'zh-CN' : 'en-US')}</small></div>
                <div className="automation-row-actions"><button title={isZh ? '立即运行' : 'Run now'} onClick={() => void runSchedule(schedule)} disabled={automationBusy === schedule.id}><Play size={15} /></button><button title={isZh ? '编辑' : 'Edit'} onClick={() => editSchedule(schedule)}><Pencil size={15} /></button><button title={isZh ? '删除' : 'Delete'} onClick={() => void deleteSchedule(schedule)} disabled={automationBusy === schedule.id}><Trash2 size={15} /></button></div>
              </article>
            )) : <div className="automation-empty">{isZh ? '还没有定时计划。先选择求职目标和执行时间。' : 'No scheduled plans yet. Choose a job target and run time to begin.'}</div>}
          </div>

          {!!automation?.schedules.some((schedule) => schedule.enabled) && desktopSettings && !desktopSettings.keepRunningInTray && <p className="desktop-setting-warning">{isZh ? '已有启用的计划，但关闭窗口后应用会退出。若要在后台按时执行，请在下方开启“关闭窗口后在托盘运行”。' : 'A plan is enabled, but closing the window currently quits the app. Enable “Keep running in tray” below for reliable background runs.'}</p>}

          {!!automation?.runs.length && <div className="automation-history"><h3>{isZh ? '最近执行' : 'Recent runs'}</h3>{automation.runs.slice(0, 5).map((run) => <div key={run.id}><span className={`automation-run-status is-${run.status}`}>{run.status === 'succeeded' ? (isZh ? '成功' : 'Succeeded') : run.status === 'running' ? (isZh ? '运行中' : 'Running') : run.status === 'queued' ? (isZh ? '排队中' : 'Queued') : run.status === 'missed' ? (isZh ? '已错过' : 'Missed') : run.status === 'interrupted' ? (isZh ? '已中断' : 'Interrupted') : (isZh ? '失败' : 'Failed')}</span><strong>{run.project}</strong><small>{new Date(run.scheduledFor).toLocaleString(currentLanguage === 'zh' ? 'zh-CN' : 'en-US')}</small></div>)}</div>}
        </div>
      </section>

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
