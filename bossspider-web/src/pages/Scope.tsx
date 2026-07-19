import { CitySelector } from '../components/CitySelector';
import { NumberField } from '../components/NumberField';
import { useAppTranslation } from '../i18n';
import type { ConfigPatch, ConfigPayload } from '../types';
import { OptionToggle } from '../components/OptionToggle';
import { KeywordInput } from '../components/KeywordInput';
import { CircleHelp, Clock3, PlayCircle, RefreshCw } from 'lucide-react';
import { GuidedTour, type GuidedTourStep } from '../components/GuidedTour';
import { useEffect, useMemo, useState } from 'react';
import { collectionEstimate } from '../utils/collectionEstimate';

export function Scope({
  config,
  updateConfig,
  onSave,
  onReload,
  onLogin,
  onProcessPartial,
  autoStartGuide,
  onAutoStartGuideHandled,
  onGuideComplete,
}: {
  config: ConfigPayload;
  updateConfig: (patch: ConfigPatch) => void;
  onSave: () => void | Promise<unknown>;
  onReload: () => void;
  onLogin: () => void;
  onProcessPartial: () => void;
  autoStartGuide: boolean;
  onAutoStartGuideHandled: () => void;
  onGuideComplete: () => void;
}) {
  const { t, i18n } = useAppTranslation();
  const isZh = (i18n.resolvedLanguage || i18n.language).startsWith('zh');
  const [guideStep, setGuideStep] = useState<number | null>(null);
  const [guideSaving, setGuideSaving] = useState(false);
  const [guideError, setGuideError] = useState('');
  const guideSteps = useMemo<GuidedTourStep[]>(() => [
    { target: 'scope-keywords', title: t('scope.tour.keywordsTitle'), body: t('scope.tour.keywordsBody') },
    { target: 'scope-cities', title: t('scope.tour.citiesTitle'), body: t('scope.tour.citiesBody') },
    { target: 'scope-save', title: t('scope.tour.saveTitle'), body: t('scope.tour.saveBody') },
  ], [t]);
  const estimate = useMemo(() => collectionEstimate({
    keywordsText: config.keywordsText,
    citiesText: config.citiesText,
    newJobTarget: config.newJobTarget,
    maxJobs: config.maxJobs,
    existingJobCount: config.jobCount,
  }), [config.citiesText, config.jobCount, config.keywordsText, config.maxJobs, config.newJobTarget]);

  useEffect(() => {
    if (!autoStartGuide) return;
    setGuideError('');
    setGuideStep(0);
    onAutoStartGuideHandled();
  }, [autoStartGuide, onAutoStartGuideHandled]);

  const finishGuide = async () => {
    setGuideError('');
    setGuideSaving(true);
    try {
      const saved = await onSave();
      if (saved === null) {
        setGuideError(t('scope.tour.saveFailed'));
        return;
      }
      setGuideStep(null);
      onGuideComplete();
    } finally {
      setGuideSaving(false);
    }
  };

  const moveGuideStep = (nextStep: number) => {
    if (guideStep === 1 && nextStep > guideStep && !config.citiesText.trim()) {
      setGuideError(t('scope.tour.cityRequired'));
      return;
    }
    setGuideError('');
    setGuideStep(nextStep);
  };

  return (
    <div className="scope-page h-full flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold text-zinc-100">{t('scope.title')}</h1>
        <div className="flex gap-3">
          <button onClick={() => { setGuideError(''); setGuideStep(0); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border border-zinc-800 text-zinc-300 hover:bg-zinc-900 rounded transition-colors">
            <CircleHelp size={15} />
            {t('scope.help')}
          </button>
          <button onClick={onReload} className="px-4 py-1.5 text-sm font-medium border border-zinc-800 text-zinc-300 hover:bg-zinc-900 rounded transition-colors">{t('scope.reloadConfig')}</button>
          <button data-guide-target="scope-save" onClick={() => void onSave()} className="px-4 py-1.5 text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded transition-colors">{t('scope.saveConfig')}</button>
        </div>
      </div>

      <div className="scope-estimate">
        <span><Clock3 size={16} /></span>
        <div>
          <strong>{isZh ? '本次手动采集预计耗时' : 'Estimated manual collection time'}</strong>
          <small>{estimate.combinationCount
            ? (isZh
                ? `${estimate.keywordCount} 个关键词 × ${estimate.cityCount} 个城市，共 ${estimate.combinationCount} 组；预计读取 ${estimate.estimatedDetailJobs} 条详情，复用 ${estimate.estimatedReusedJobs} 条已有岗位`
                : `${estimate.keywordCount} keywords × ${estimate.cityCount} cities, ${estimate.combinationCount} searches; about ${estimate.estimatedDetailJobs} detail reads and ${estimate.estimatedReusedJobs} known jobs reused`)
            : (isZh ? '填写关键词和城市后显示估算' : 'Add keywords and cities to calculate an estimate')}</small>
        </div>
        <b>{estimate.estimatedMinutes
          ? (isZh ? `约 ${estimate.estimatedMinutes} 分钟` : `About ${estimate.estimatedMinutes} min`)
          : '—'}</b>
      </div>

      <div className="grid grid-cols-1 gap-5 flex-1 xl:grid-cols-2 xl:gap-6">
        <div className="space-y-6">
          <section className="scope-card border border-zinc-800 bg-zinc-900/30 rounded-md p-5">
            <h3 className="text-sm font-semibold text-zinc-100 mb-5 border-b border-zinc-800 pb-3">{t('scope.runConfig')}</h3>
            <div className="space-y-5">
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

          <div data-guide-target="scope-keywords" className="scope-field-group">
            <KeywordInput
              value={config.keywordsText}
              onChange={(keywordsText) => updateConfig({ keywordsText })}
              label={t('scope.keywords')}
              addLabel={isZh ? '添加关键词' : 'Add keyword'}
              inputPlaceholder={isZh ? '输入关键词后回车' : 'Type a keyword and press Enter'}
              emptyLabel={isZh ? '还没有添加关键词' : 'No keywords added yet'}
            />
          </div>

        </div>

        <div className="space-y-6">
          <div className="scope-card border border-zinc-800 bg-zinc-900/30 rounded-md p-5">
            <h3 className="text-sm font-semibold text-zinc-100 mb-5 border-b border-zinc-800 pb-3">{t('scope.scrapingLimits')}</h3>
            <div className="space-y-5">
              <NumberField label={t('scope.scrollTargetCount')} value={config.newJobTarget} onChange={(value) => updateConfig({ newJobTarget: value })} />
              <NumberField label={t('scope.maxScrollAttempts')} value={config.maxJobs} onChange={(value) => updateConfig({ maxJobs: value })} />
            </div>
          </div>

          <div data-guide-target="scope-cities" className="scope-card border border-zinc-800 bg-zinc-900/30 rounded-md p-5">
            <h3 className="text-sm font-semibold text-zinc-100 mb-5 border-b border-zinc-800 pb-3">{t('scope.cityConfig')}</h3>
            <CitySelector value={config.citiesText} onChange={(citiesText) => updateConfig({ citiesText })} />
          </div>
        </div>
      </div>
      {guideStep !== null && (
        <GuidedTour
          steps={guideSteps}
          activeStep={guideStep}
          onStepChange={moveGuideStep}
          onClose={() => { setGuideError(''); setGuideStep(null); }}
          onFinish={() => { void finishGuide(); }}
          finishing={guideSaving}
          error={guideError}
          nextLabel={t('scope.tour.next')}
          previousLabel={t('scope.tour.previous')}
          finishLabel={guideSaving ? t('scope.tour.saving') : t('scope.tour.finish')}
          skipLabel={t('scope.tour.skip')}
          progressLabel={(current, total) => t('scope.tour.progress', { current, total })}
        />
      )}
    </div>
  );
}
