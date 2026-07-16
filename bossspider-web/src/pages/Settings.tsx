import { Eye, EyeOff, KeyRound, PlugZap, Save, Settings2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { bossApi } from '../api';
import { GuidedTour, type GuidedTourStep } from '../components/GuidedTour';
import { ThemeOptions } from '../components/ThemePicker';
import { useAppTranslation } from '../i18n';
import type { LlmSettingsStatus } from '../types';

export function Settings({
  onUpdated,
  returnToMatchingGuideAfterTest = false,
  onReturnToMatchingGuide,
}: {
  onUpdated: (settings: LlmSettingsStatus) => void;
  returnToMatchingGuideAfterTest?: boolean;
  onReturnToMatchingGuide?: () => void;
}) {
  const { t } = useAppTranslation();
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
    <div className="settings-page mx-auto max-w-3xl space-y-6">
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
          <h2 className="text-base font-semibold text-zinc-100">{t('theme.appearance')}</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-500">{t('theme.appearanceDescription')}</p>
        </div>
        <div className="p-4 sm:p-5"><ThemeOptions /></div>
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
