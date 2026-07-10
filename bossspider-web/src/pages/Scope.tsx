import { CITY_OPTIONS, STRATEGIES } from '../constants';
import { NumberField } from '../components/NumberField';
import { useAppTranslation } from '../i18n';
import { hasCity, toggleCity } from '../utils';
import type { ConfigPatch, ConfigPayload } from '../types';
import { OptionToggle } from '../components/OptionToggle';
import { StrategyCard } from '../components/StrategyCard';
import { PlayCircle, RefreshCw } from 'lucide-react';

export function Scope({
  config,
  updateConfig,
  onSave,
  onReload,
  onLogin,
  onProcessPartial,
}: {
  config: ConfigPayload;
  updateConfig: (patch: ConfigPatch) => void;
  onSave: () => void | Promise<unknown>;
  onReload: () => void;
  onLogin: () => void;
  onProcessPartial: () => void;
}) {
  const { t } = useAppTranslation();
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold text-zinc-100">{t('scope.title')}</h1>
        <div className="flex gap-3">
          <button onClick={onReload} className="px-4 py-1.5 text-sm font-medium border border-zinc-800 text-zinc-300 hover:bg-zinc-900 rounded transition-colors">{t('scope.reloadConfig')}</button>
          <button onClick={() => void onSave()} className="px-4 py-1.5 text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded transition-colors">{t('scope.saveConfig')}</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-8 flex-1">
        <div className="space-y-6">
          <section className="border border-zinc-800 bg-zinc-900/30 rounded-md p-5">
            <h3 className="text-sm font-semibold text-zinc-100 mb-5 border-b border-zinc-800 pb-3">{t('scope.runConfig')}</h3>
            <div className="space-y-5">
              <div>
                <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-zinc-500">{t('scope.strategy')}</label>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                  {STRATEGIES.map((strategy, index) => {
                    const disabled = index !== 2;
                    return (
                      <StrategyCard
                        key={strategy.title}
                        title={strategy.title}
                        desc={t(strategy.descKey)}
                        active={config.strategyIndex === index}
                        disabled={disabled}
                        disabledReason={disabled ? t('scope.strategyDisabledHint') : undefined}
                        onClick={() => updateConfig({ strategyIndex: index })}
                      />
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-zinc-500">{t('scope.options')}</label>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                  <OptionToggle label={t('scope.headless')} active={config.headlessMode} onToggle={() => updateConfig({ headlessMode: !config.headlessMode })} />
                  <OptionToggle label={t('scope.autoSqlite')} active={config.autoSqlite} onToggle={() => updateConfig({ autoSqlite: !config.autoSqlite })} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 border-t border-zinc-800 pt-4">
                <button onClick={onLogin} className="inline-flex items-center justify-center gap-2 rounded bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-700 transition-colors">
                  <PlayCircle size={14} />
                  {t('scope.loginSaveCookie')}
                </button>
                <button onClick={onProcessPartial} className="inline-flex items-center justify-center gap-2 rounded border border-zinc-800 px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-900 transition-colors">
                  <RefreshCw size={14} />
                  {t('scope.recoverPartial')}
                </button>
              </div>
            </div>
          </section>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2 flex items-center justify-between">
              {t('scope.keywords')}
              <span className="text-xs text-zinc-500 font-normal">{t('scope.onePerLine')}</span>
            </label>
            <textarea
              className="w-full h-32 bg-zinc-900/50 border border-zinc-800 rounded-md p-3 text-sm text-zinc-200 focus:border-indigo-500 outline-none font-mono resize-none"
              value={config.keywordsText}
              onChange={(event) => updateConfig({ keywordsText: event.target.value })}
            />
          </div>

        </div>

        <div className="space-y-6">
          <div className="border border-zinc-800 bg-zinc-900/30 rounded-md p-5">
            <h3 className="text-sm font-semibold text-zinc-100 mb-5 border-b border-zinc-800 pb-3">{t('scope.scrapingLimits')}</h3>
            <div className="space-y-5">
              <NumberField label={t('scope.standardPagination')} value={config.maxPages} onChange={(value) => updateConfig({ maxPages: value })} />
              <NumberField label={t('scope.scrollTargetCount')} value={config.scrollTarget} onChange={(value) => updateConfig({ scrollTarget: value })} />
              <NumberField label={t('scope.maxScrollAttempts')} value={config.scrollMax} onChange={(value) => updateConfig({ scrollMax: value })} />
            </div>
          </div>

          <div className="border border-zinc-800 bg-zinc-900/30 rounded-md p-5">
            <h3 className="text-sm font-semibold text-zinc-100 mb-5 border-b border-zinc-800 pb-3">{t('scope.cityConfig')}</h3>
            <label className="block text-sm font-medium text-zinc-300 mb-2">{t('scope.citiesQuickSelect')}</label>
            <div className="flex flex-wrap gap-2 mb-4">
              {CITY_OPTIONS.map((city) => {
                const selected = hasCity(config.citiesText, city.name);
                return (
                  <button
                    key={city.name}
                    onClick={() => updateConfig({ citiesText: toggleCity(config.citiesText, city) })}
                    className={`px-2.5 py-1 text-xs border rounded transition-colors ${selected ? 'border-indigo-500 bg-indigo-950/30 text-indigo-300' : 'border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}
                  >
                    {city.name}
                  </button>
                );
              })}
            </div>
            <label className="block text-sm font-medium text-zinc-300 mb-2 flex items-center justify-between">
              {t('scope.cityCodes')}
              <span className="text-xs text-zinc-500 font-normal">{t('scope.namecode')}</span>
            </label>
            <textarea
              className="w-full h-40 bg-zinc-950/70 border border-zinc-800 rounded-md p-3 text-sm text-zinc-200 focus:border-indigo-500 outline-none font-mono resize-none"
              value={config.citiesText}
              onChange={(event) => updateConfig({ citiesText: event.target.value })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
