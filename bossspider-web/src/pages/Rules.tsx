import { BrainCircuit, ChevronDown, Plus, Tags, Trash2, Wand2, X } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { bossApi } from '../api';
import { useAppTranslation } from '../i18n';
import type { ScoringKeywordSuggestionResponse } from '../types';
import type { ConfigPatch, ConfigPayload } from '../types';

type RulesTab = 'matching' | 'scoring';
type CategoryRules = Record<string, string[]>;
type ScoringRules = Record<string, any>;
type CustomScoringPreset = {
  id: string;
  name: string;
  createdAt: string;
  settings: ScoringRules;
};

function parseObject<T extends Record<string, any>>(value: string, fallback: T): T {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function stringify(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function cleanList(values: string[]) {
  return values.map((value) => value.trim()).filter(Boolean);
}

function uniqueName(base: string, used: Set<string>) {
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right) return false;
  if (!left || !right || typeof left !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => deepEqual(item, right[index]));
  }
  const leftObject = left as Record<string, unknown>;
  const rightObject = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftObject);
  const rightKeys = Object.keys(rightObject);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => deepEqual(leftObject[key], rightObject[key]));
}

function patchMatches(current: ScoringRules, patch: ScoringRules): boolean {
  return Object.entries(patch).every(([key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return patchMatches(current[key] || {}, value as ScoringRules);
    }
    return deepEqual(current[key], value);
  });
}

function presetButtonClass(active: boolean) {
  return [
    'rounded border p-3 text-left transition-colors',
    active
      ? 'border-indigo-500 bg-indigo-950/50 shadow-[0_0_0_1px_rgba(99,102,241,0.35)]'
      : 'border-zinc-800 bg-zinc-950 hover:border-indigo-700 hover:bg-indigo-950/20',
  ].join(' ');
}

function scoringPresetSettings(value: ScoringRules): ScoringRules {
  const { customPresets, keywordHints, ...settings } = structuredClone(value || {});
  return settings;
}

const SCORING_PRESETS: Array<{ key: string; patch: ScoringRules }> = [
  {
    key: 'balanced',
    patch: {
      weights: { coverage: 2, jdQuality: 0.45, salary: 0.35, experience: 0.75, education: 0.45 },
      jdQuality: { highLength: 600, midLength: 200, highSignal: 1, midSignal: 0.72, lowSignal: 0.45 },
      experience: { unknownSignal: 0.82, nearYears: 1, nearSignal: 0.72, riskSignal: 0.35, riskCap: 3.1 },
      education: { unknownSignal: 0.88, nearGap: 1, nearSignal: 0.7, riskSignal: 0.35, riskCap: 3.2 },
    },
  },
  {
    key: 'strict',
    patch: {
      weights: { coverage: 2.3, jdQuality: 0.35, salary: 0.2, experience: 1.05, education: 0.7 },
      jdQuality: { highLength: 700, midLength: 250, highSignal: 1, midSignal: 0.68, lowSignal: 0.4 },
      experience: { unknownSignal: 0.72, nearYears: 0.5, nearSignal: 0.65, riskSignal: 0.25, riskCap: 2.9 },
      education: { unknownSignal: 0.78, nearGap: 1, nearSignal: 0.62, riskSignal: 0.25, riskCap: 3 },
    },
  },
  {
    key: 'opportunity',
    patch: {
      weights: { coverage: 2.15, jdQuality: 0.5, salary: 0.45, experience: 0.55, education: 0.25 },
      jdQuality: { highLength: 500, midLength: 180, highSignal: 1, midSignal: 0.76, lowSignal: 0.5 },
      experience: { unknownSignal: 0.88, nearYears: 1.5, nearSignal: 0.78, riskSignal: 0.42, riskCap: 3.4 },
      education: { unknownSignal: 0.92, nearGap: 1, nearSignal: 0.78, riskSignal: 0.45, riskCap: 3.5 },
    },
  },
  {
    key: 'salary',
    patch: {
      weights: { coverage: 1.8, jdQuality: 0.4, salary: 0.85, experience: 0.75, education: 0.35 },
      jdQuality: { highLength: 600, midLength: 220, highSignal: 1, midSignal: 0.72, lowSignal: 0.45 },
      experience: { unknownSignal: 0.82, nearYears: 1, nearSignal: 0.72, riskSignal: 0.35, riskCap: 3.1 },
      education: { unknownSignal: 0.88, nearGap: 1, nearSignal: 0.7, riskSignal: 0.35, riskCap: 3.2 },
    },
  },
];

export function Rules({
  mode,
  config,
  updateConfig,
  onSave,
}: {
  mode: RulesTab;
  config: ConfigPayload;
  updateConfig: (patch: ConfigPatch) => void;
  onSave: (patch?: ConfigPatch) => void | Promise<unknown>;
}) {
  const { t } = useAppTranslation();
  const [newCategoryName, setNewCategoryName] = useState('');
  const [categoryKeywordDrafts, setCategoryKeywordDrafts] = useState<Record<string, string>>({});
  const [fallbackDraft, setFallbackDraft] = useState('');
  const [blacklistDraft, setBlacklistDraft] = useState('');
  const [scoringKeywordDraft, setScoringKeywordDraft] = useState('');
  const [customPresetName, setCustomPresetName] = useState('');
  const [customPresetDialogOpen, setCustomPresetDialogOpen] = useState(false);
  const [scoringParamsOpen, setScoringParamsOpen] = useState(false);
  const [keywordSuggestions, setKeywordSuggestions] = useState<ScoringKeywordSuggestionResponse | null>(null);
  const [keywordSuggestionLoading, setKeywordSuggestionLoading] = useState(false);
  const [keywordSuggestionError, setKeywordSuggestionError] = useState('');

  const categoryRules = useMemo(
    () => parseObject<CategoryRules>(config.catRulesText, {}),
    [config.catRulesText],
  );
  const scoringRules = useMemo(
    () => parseObject<ScoringRules>(config.scoringRulesText, {}),
    [config.scoringRulesText],
  );

  const updateCategoryRules = (next: CategoryRules) => {
    const cleaned = Object.fromEntries(
      Object.entries(next)
        .map(([name, keywords]) => [name.trim(), cleanList(keywords || [])])
        .filter(([name]) => Boolean(name)),
    );
    updateConfig({ catRulesText: stringify(cleaned) });
  };

  const updateScoringRules = (next: ScoringRules) => {
    updateConfig({ scoringRulesText: stringify(next) });
  };

  const setScoringValue = (path: string[], value: number | string | string[]) => {
    const next = structuredClone(scoringRules);
    let cursor: Record<string, any> = next;
    for (const key of path.slice(0, -1)) {
      if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {};
      cursor = cursor[key];
    }
    cursor[path[path.length - 1]] = value;
    updateScoringRules(next);
  };

  const fallbackKeywords = useMemo(() => cleanList(config.relevanceText.split(/\r?\n/)), [config.relevanceText]);
  const blacklistKeywords = useMemo(() => cleanList(config.blacklistText.split(/\r?\n/)), [config.blacklistText]);
  const scoringKeywords = Array.isArray(scoringRules.keywordHints) ? scoringRules.keywordHints.map(String) : [];
  const customScoringPresets: CustomScoringPreset[] = Array.isArray(scoringRules.customPresets)
    ? scoringRules.customPresets.filter((item: any) => item && typeof item === 'object' && item.settings && item.name)
    : [];

  const addCategory = () => {
    const name = uniqueName(newCategoryName.trim() || t('rules.newCategory'), new Set(Object.keys(categoryRules)));
    updateCategoryRules({ ...categoryRules, [name]: [] });
    setNewCategoryName('');
  };

  const renameCategory = (oldName: string, nextName: string) => {
    const cleanName = nextName.trim();
    if (!cleanName || cleanName === oldName || categoryRules[cleanName]) return;
    const next: CategoryRules = {};
    for (const [name, keywords] of Object.entries(categoryRules)) {
      next[name === oldName ? cleanName : name] = keywords;
    }
    updateCategoryRules(next);
  };

  const addCategoryKeyword = (category: string) => {
    const keyword = (categoryKeywordDrafts[category] || '').trim();
    if (!keyword) return;
    updateCategoryRules({
      ...categoryRules,
      [category]: [...(categoryRules[category] || []), keyword],
    });
    setCategoryKeywordDrafts((current) => ({ ...current, [category]: '' }));
  };

  const updateLineList = (kind: 'fallback' | 'blacklist', values: string[]) => {
    const text = cleanList(values).join('\n');
    updateConfig(kind === 'fallback' ? { relevanceText: text } : { blacklistText: text });
  };

  const addLineKeyword = (kind: 'fallback' | 'blacklist') => {
    const value = (kind === 'fallback' ? fallbackDraft : blacklistDraft).trim();
    if (!value) return;
    const current = kind === 'fallback' ? fallbackKeywords : blacklistKeywords;
    updateLineList(kind, [...current, value]);
    if (kind === 'fallback') setFallbackDraft('');
    else setBlacklistDraft('');
  };

  const addScoringKeyword = () => {
    const keyword = scoringKeywordDraft.trim();
    if (!keyword) return;
    setScoringValue(['keywordHints'], [...scoringKeywords, keyword]);
    setScoringKeywordDraft('');
  };

  const applyScoringPreset = (patch: ScoringRules) => {
    updateScoringRules({
      ...scoringRules,
      ...patch,
      keywordHints: scoringRules.keywordHints,
    });
  };

  const scoringSnapshot = () => {
    return scoringPresetSettings(scoringRules);
  };

  const nextCustomPresetName = () => {
    const baseName = t('rules.customPresetDefaultBase');
    const usedNames = new Set(customScoringPresets.map((preset) => preset.name));
    let index = 1;
    while (usedNames.has(`${baseName}${index}`)) index += 1;
    return `${baseName}${index}`;
  };

  const openCustomPresetDialog = () => {
    setCustomPresetName(nextCustomPresetName());
    setCustomPresetDialogOpen(true);
  };

  const saveCustomPreset = async () => {
    const name = customPresetName.trim() || t('rules.customPresetFallbackName');
    const preset: CustomScoringPreset = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      createdAt: new Date().toISOString(),
      settings: scoringSnapshot(),
    };
    const nextScoringRules = {
      ...scoringRules,
      customPresets: [...customScoringPresets, preset],
    };
    const scoringRulesText = stringify(nextScoringRules);
    updateConfig({ scoringRulesText });
    const saved = await onSave({ scoringRulesText });
    if (saved === null) return;
    setCustomPresetName('');
    setCustomPresetDialogOpen(false);
  };

  const applyCustomPreset = (preset: CustomScoringPreset) => {
    updateScoringRules({
      ...scoringRules,
      ...scoringPresetSettings(preset.settings),
      keywordHints: scoringRules.keywordHints,
      customPresets: customScoringPresets,
    });
  };

  const deleteCustomPreset = (presetId: string) => {
    updateScoringRules({
      ...scoringRules,
      customPresets: customScoringPresets.filter((preset) => preset.id !== presetId),
    });
  };

  const activeCustomPresetId = customScoringPresets.find((preset) => deepEqual(scoringSnapshot(), scoringPresetSettings(preset.settings)))?.id;
  const activeBuiltInPresetKey = activeCustomPresetId
    ? ''
    : SCORING_PRESETS.find((preset) => patchMatches(scoringRules, preset.patch))?.key || '';

  const generateKeywordSuggestions = async () => {
    setKeywordSuggestionLoading(true);
    setKeywordSuggestionError('');
    try {
      setKeywordSuggestions(await bossApi.generateScoringKeywordSuggestions(config.project));
    } catch (error) {
      setKeywordSuggestionError((error as Error).message);
    } finally {
      setKeywordSuggestionLoading(false);
    }
  };

  const appendSuggestedKeywords = () => {
    if (!keywordSuggestions) return;
    const existing = new Set(scoringKeywords.map((item) => item.toLowerCase()));
    const next = [
      ...scoringKeywords,
      ...keywordSuggestions.keywords.filter((keyword) => !existing.has(keyword.toLowerCase())),
    ];
    setScoringValue(['keywordHints'], next);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">{t(mode === 'matching' ? 'rules.matchingTitle' : 'rules.scoringTitle')}</h1>
          <p className="mt-1 text-sm text-zinc-500">{t(mode === 'matching' ? 'rules.matchingSubtitle' : 'rules.scoringSubtitle')}</p>
        </div>
        <button
          onClick={() => void onSave()}
          className="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500"
        >
          {t('rules.saveRules')}
        </button>
      </div>

      {mode === 'matching' ? (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <section className="flex min-h-0 flex-col rounded-md border border-zinc-800 bg-zinc-950">
            <SectionHeader icon={<Tags size={15} />} title={t('rules.categoryRules')} desc={t('rules.categoryRulesDesc')} />
            <div className="flex items-center gap-2 border-b border-zinc-800 p-3">
              <input
                value={newCategoryName}
                onChange={(event) => setNewCategoryName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') addCategory();
                }}
                placeholder={t('rules.categoryNamePlaceholder')}
                className="min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-indigo-500"
              />
              <button onClick={addCategory} className="inline-flex items-center gap-1.5 rounded border border-indigo-900 bg-indigo-950/40 px-3 py-2 text-sm font-medium text-indigo-200 hover:bg-indigo-900/40">
                <Plus size={14} />
                {t('rules.addCategory')}
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
              {Object.entries(categoryRules).map(([category, keywords]) => (
                <div key={category} className="rounded border border-zinc-800 bg-zinc-900/30 p-3">
                  <div className="mb-3 flex items-center gap-2">
                    <input
                      value={category}
                      onChange={(event) => renameCategory(category, event.target.value)}
                      className="min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm font-medium text-zinc-100 outline-none focus:border-indigo-500"
                    />
                    <button
                      onClick={() => {
                        const next = { ...categoryRules };
                        delete next[category];
                        updateCategoryRules(next);
                      }}
                      className="rounded border border-red-900/60 p-1.5 text-red-300 hover:bg-red-950/30"
                      title={t('rules.deleteCategory')}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <KeywordInputs
                    values={keywords || []}
                    onChange={(values) => updateCategoryRules({ ...categoryRules, [category]: values })}
                    placeholder={t('rules.keywordPlaceholder')}
                  />
                  <div className="mt-3 flex gap-2">
                    <input
                      value={categoryKeywordDrafts[category] || ''}
                      onChange={(event) => setCategoryKeywordDrafts((current) => ({ ...current, [category]: event.target.value }))}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') addCategoryKeyword(category);
                      }}
                      placeholder={t('rules.addKeywordPlaceholder')}
                      className="min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-indigo-500"
                    />
                    <button onClick={() => addCategoryKeyword(category)} className="rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800">
                      {t('rules.addKeyword')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <aside className="space-y-5">
            <KeywordPanel
              title={t('rules.fallbackKeywords')}
              note={t('rules.ifCategoryNotMatched')}
              values={fallbackKeywords}
              draft={fallbackDraft}
              setDraft={setFallbackDraft}
              onAdd={() => addLineKeyword('fallback')}
              onChange={(values) => updateLineList('fallback', values)}
            />
            <KeywordPanel
              title={t('rules.blacklistKeywords')}
              note={t('rules.discardIfTitleMatches')}
              values={blacklistKeywords}
              draft={blacklistDraft}
              setDraft={setBlacklistDraft}
              onAdd={() => addLineKeyword('blacklist')}
              onChange={(values) => updateLineList('blacklist', values)}
            />
            <section className="rounded-md border border-zinc-800 bg-zinc-950 p-4">
              <label className="mb-2 block text-sm font-medium text-zinc-300">{t('rules.minSalary')}</label>
              <NumberSlider
                value={config.minSalary}
                min={0}
                max={80}
                step={1}
                suffix="K"
                onChange={(value) => updateConfig({ minSalary: value })}
              />
              <p className="mt-2 text-xs text-zinc-500">{t('rules.minSalaryHint')}</p>
            </section>
          </aside>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.85fr)]">
          <section className="space-y-4">
            <div className="space-y-4">
              <section className="rounded border border-zinc-800 bg-zinc-900/30 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-100">{t('rules.scoringPresets')}</h3>
                    <p className="mt-1 text-xs text-zinc-500">{t('rules.scoringPresetsDesc')}</p>
                  </div>
                  <button
                    onClick={openCustomPresetDialog}
                    className="inline-flex items-center gap-1.5 rounded border border-indigo-900 bg-indigo-950/40 px-3 py-1.5 text-xs font-medium text-indigo-200 hover:bg-indigo-900/40"
                  >
                    <Plus size={13} />
                    {t('rules.saveCustomPreset')}
                  </button>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-2 lg:grid-cols-2">
                  {SCORING_PRESETS.map((preset) => (
                    <button
                      key={preset.key}
                      onClick={() => applyScoringPreset(preset.patch)}
                      className={presetButtonClass(activeBuiltInPresetKey === preset.key)}
                    >
                      <div className="text-sm font-semibold text-zinc-100">{t(`rules.presets.${preset.key}.title`)}</div>
                      <div className="mt-1 text-xs leading-relaxed text-zinc-500">{t(`rules.presets.${preset.key}.desc`)}</div>
                    </button>
                  ))}
                  {customScoringPresets.map((preset) => (
                    <div key={preset.id} className={`${presetButtonClass(activeCustomPresetId === preset.id)} flex items-start justify-between gap-3`}>
                      <button onClick={() => applyCustomPreset(preset)} className="min-w-0 flex-1 text-left">
                        <div className="truncate text-sm font-semibold text-zinc-100">{preset.name}</div>
                        <div className="mt-1 text-xs text-zinc-500">{t('rules.customPresetSavedAt', { time: new Date(preset.createdAt).toLocaleString() })}</div>
                      </button>
                      <button
                        onClick={() => deleteCustomPreset(preset.id)}
                        className="rounded border border-zinc-800 p-1.5 text-zinc-500 hover:border-red-900 hover:text-red-300"
                        title={t('rules.deleteCustomPreset')}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                {!customScoringPresets.length && <p className="mt-3 text-xs text-zinc-600">{t('rules.noCustomPresets')}</p>}
              </section>

              <section className="rounded border border-zinc-800 bg-zinc-900/30">
                <button
                  onClick={() => setScoringParamsOpen((open) => !open)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-zinc-900/50"
                >
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-100">{t('rules.scoringParameters')}</h3>
                    <p className="mt-1 text-xs text-zinc-500">{t('rules.scoringParametersDesc')}</p>
                  </div>
                  <ChevronDown size={16} className={`shrink-0 text-zinc-500 transition-transform ${scoringParamsOpen ? 'rotate-180' : ''}`} />
                </button>
                {scoringParamsOpen && (
                  <div className="space-y-5 border-t border-zinc-800 p-4">
                    <FormulaCard scoringRules={scoringRules} />

                    <ScoringGroup title={t('rules.scoringWeights')} desc={t('rules.scoringWeightsDesc')}>
                      <NumberSlider label={t('rules.weightCoverage')} value={Number(scoringRules.weights?.coverage ?? 2)} min={0} max={3} step={0.05} onChange={(value) => setScoringValue(['weights', 'coverage'], value)} />
                      <NumberSlider label={t('rules.weightExperience')} value={Number(scoringRules.weights?.experience ?? 0.75)} min={0} max={2} step={0.05} onChange={(value) => setScoringValue(['weights', 'experience'], value)} />
                      <NumberSlider label={t('rules.weightEducation')} value={Number(scoringRules.weights?.education ?? 0.45)} min={0} max={2} step={0.05} onChange={(value) => setScoringValue(['weights', 'education'], value)} />
                      <NumberSlider label={t('rules.weightSalary')} value={Number(scoringRules.weights?.salary ?? 0.35)} min={0} max={2} step={0.05} onChange={(value) => setScoringValue(['weights', 'salary'], value)} />
                      <NumberSlider label={t('rules.weightJdQuality')} value={Number(scoringRules.weights?.jdQuality ?? 0.45)} min={0} max={2} step={0.05} onChange={(value) => setScoringValue(['weights', 'jdQuality'], value)} />
                    </ScoringGroup>

                    <ScoringGroup title={t('rules.jdQualityTitle')} desc={t('rules.jdQualityDesc')}>
                      <NumberSlider label={t('rules.highLength')} value={Number(scoringRules.jdQuality?.highLength ?? 600)} min={100} max={2000} step={50} suffix={t('rules.chars')} onChange={(value) => setScoringValue(['jdQuality', 'highLength'], value)} />
                      <NumberSlider label={t('rules.midLength')} value={Number(scoringRules.jdQuality?.midLength ?? 200)} min={50} max={1000} step={25} suffix={t('rules.chars')} onChange={(value) => setScoringValue(['jdQuality', 'midLength'], value)} />
                    </ScoringGroup>

                    <ScoringGroup title={t('rules.salaryTitle')} desc={t('rules.salaryDesc')}>
                      <NumberSlider label={t('rules.highAvgK')} value={Number(scoringRules.salary?.highAvgK ?? 25)} min={0} max={100} step={1} suffix="K" onChange={(value) => setScoringValue(['salary', 'highAvgK'], value)} />
                      <NumberSlider label={t('rules.midAvgK')} value={Number(scoringRules.salary?.midAvgK ?? 15)} min={0} max={80} step={1} suffix="K" onChange={(value) => setScoringValue(['salary', 'midAvgK'], value)} />
                    </ScoringGroup>

                    <ScoringGroup title={t('rules.riskCapsTitle')} desc={t('rules.riskCapsDesc')}>
                      <NumberSlider label={t('rules.experienceNearYears')} value={Number(scoringRules.experience?.nearYears ?? 1)} min={0} max={5} step={0.5} suffix={t('rules.years')} onChange={(value) => setScoringValue(['experience', 'nearYears'], value)} />
                      <NumberSlider label={t('rules.experienceRiskCap')} value={Number(scoringRules.experience?.riskCap ?? 3.1)} min={1} max={5} step={0.1} onChange={(value) => setScoringValue(['experience', 'riskCap'], value)} />
                      <NumberSlider label={t('rules.educationRiskCap')} value={Number(scoringRules.education?.riskCap ?? 3.2)} min={1} max={5} step={0.1} onChange={(value) => setScoringValue(['education', 'riskCap'], value)} />
                    </ScoringGroup>
                  </div>
                )}
              </section>
            </div>
          </section>

          <aside className="min-h-0 space-y-5 overflow-y-auto">
            <KeywordPanel
              title={t('rules.scoringKeywordHints')}
              note={t('rules.scoringKeywordHintsDesc')}
              values={scoringKeywords}
              draft={scoringKeywordDraft}
              setDraft={setScoringKeywordDraft}
              onAdd={addScoringKeyword}
              onChange={(values) => setScoringValue(['keywordHints'], cleanList(values))}
            />

            <section className="rounded-md border border-zinc-800 bg-zinc-950">
              <SectionHeader title={t('rules.aiKeywordSuggestions')} desc={t('rules.aiKeywordSuggestionsDesc')} icon={<BrainCircuit size={15} />} />
              <div className="space-y-3 p-4">
                <button
                  onClick={() => void generateKeywordSuggestions()}
                  disabled={keywordSuggestionLoading}
                  className="inline-flex items-center gap-2 rounded border border-cyan-900/70 bg-cyan-950/30 px-3 py-1.5 text-sm font-medium text-cyan-200 hover:bg-cyan-900/30 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Wand2 size={14} />
                  {keywordSuggestionLoading ? t('rules.generatingKeywords') : t('rules.generateKeywords')}
                </button>
                {keywordSuggestionError && <div className="rounded border border-red-900/60 bg-red-950/20 p-2 text-xs text-red-300">{keywordSuggestionError}</div>}
                {keywordSuggestions && (
                  <div className="space-y-3">
                    <div className="text-xs text-zinc-500">
                      {t('rules.keywordSuggestionMeta', { count: keywordSuggestions.sampleCount })}
                      {keywordSuggestions.rationale ? ` ${keywordSuggestions.rationale}` : ''}
                    </div>
                    <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto rounded border border-zinc-800 bg-zinc-900/40 p-3">
                      {keywordSuggestions.keywords.map((keyword) => (
                        <span key={keyword} className="rounded border border-cyan-900/60 bg-cyan-950/20 px-2 py-1 text-xs text-cyan-100">
                          {keyword}
                        </span>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={appendSuggestedKeywords} className="rounded border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800">
                        {t('rules.appendSuggestions')}
                      </button>
                      <button onClick={() => setScoringValue(['keywordHints'], keywordSuggestions.keywords)} className="rounded border border-indigo-900 bg-indigo-950/40 px-3 py-1.5 text-xs font-medium text-indigo-200 hover:bg-indigo-900/40">
                        {t('rules.replaceWithSuggestions')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          </aside>
        </div>
      )}

      {mode === 'scoring' && customPresetDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-lg border border-zinc-800 bg-zinc-950 p-4 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">{t('rules.saveCustomPresetDialogTitle')}</h2>
                <p className="mt-1 text-xs text-zinc-500">{t('rules.customPresetHint')}</p>
              </div>
              <button onClick={() => setCustomPresetDialogOpen(false)} className="rounded border border-zinc-800 p-1 text-zinc-500 hover:text-zinc-200">
                <X size={14} />
              </button>
            </div>
            <input
              autoFocus
              value={customPresetName}
              onChange={(event) => setCustomPresetName(event.target.value)}
              onKeyDown={(event) => {
                        if (event.key === 'Enter') void saveCustomPreset();
                if (event.key === 'Escape') setCustomPresetDialogOpen(false);
              }}
              className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-indigo-500"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setCustomPresetDialogOpen(false)} className="rounded border border-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900">
                {t('rules.cancel')}
              </button>
              <button onClick={() => void saveCustomPreset()} className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">
                {t('rules.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SectionHeader({ icon, title, desc }: { icon?: ReactNode; title: string; desc?: string }) {
  return (
    <div className="border-b border-zinc-800 px-4 py-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
        {icon && <span className="text-indigo-300">{icon}</span>}
        {title}
      </h2>
      {desc && <p className="mt-1 text-xs leading-relaxed text-zinc-500">{desc}</p>}
    </div>
  );
}

function FormulaCard({ scoringRules }: { scoringRules: ScoringRules }) {
  const { t } = useAppTranslation();
  const weights = scoringRules.weights || {};
  return (
    <section className="rounded border border-indigo-900/50 bg-indigo-950/20 p-4">
      <h3 className="text-sm font-semibold text-indigo-100">{t('rules.formulaTitle')}</h3>
      <p className="mt-1 text-xs leading-relaxed text-indigo-200/70">{t('rules.formulaDesc')}</p>
      <div className="mt-3 overflow-x-auto rounded border border-indigo-900/50 bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-200">
        score = clamp(1, 5, baseScore
        {' + '}coverage × {Number(weights.coverage ?? 2).toFixed(2)}
        {' + '}jdQuality × {Number(weights.jdQuality ?? 0.45).toFixed(2)}
        {' + '}salary × {Number(weights.salary ?? 0.35).toFixed(2)}
        {' + '}experience × {Number(weights.experience ?? 0.75).toFixed(2)}
        {' + '}education × {Number(weights.education ?? 0.45).toFixed(2)})
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-zinc-400 md:grid-cols-2">
        <div>{t('rules.formulaCoverage')}</div>
        <div>{t('rules.formulaJdQuality')}</div>
        <div>{t('rules.formulaSalary')}</div>
        <div>{t('rules.formulaCaps', {
          exp: Number(scoringRules.experience?.riskCap ?? 3.1).toFixed(1),
          edu: Number(scoringRules.education?.riskCap ?? 3.2).toFixed(1),
        })}</div>
      </div>
    </section>
  );
}

function KeywordInputs({ values, onChange, placeholder }: { values: string[]; onChange: (values: string[]) => void; placeholder: string }) {
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
      {values.map((keyword, index) => (
        <div key={`${keyword}-${index}`} className="flex items-center gap-1.5">
          <input
            value={keyword}
            onChange={(event) => {
              const next = [...values];
              next[index] = event.target.value;
              onChange(next);
            }}
            placeholder={placeholder}
            className="min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-indigo-500"
          />
          <button
            onClick={() => onChange(values.filter((_, itemIndex) => itemIndex !== index))}
            className="rounded border border-zinc-800 p-1.5 text-zinc-500 hover:border-red-900 hover:text-red-300"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

function KeywordPanel({
  title,
  note,
  values,
  draft,
  setDraft,
  onAdd,
  onChange,
}: {
  title: string;
  note: string;
  values: string[];
  draft: string;
  setDraft: (value: string) => void;
  onAdd: () => void;
  onChange: (values: string[]) => void;
}) {
  return (
    <section className="rounded-md border border-zinc-800 bg-zinc-950">
      <SectionHeader title={title} desc={note} />
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap gap-2">
          {values.length ? values.map((value, index) => (
            <span key={`${value}-${index}`} className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-300">
              {value}
              <button onClick={() => onChange(values.filter((_, itemIndex) => itemIndex !== index))} className="text-zinc-500 hover:text-red-300">
                ×
              </button>
            </span>
          )) : <span className="text-xs text-zinc-600">-</span>}
        </div>
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onAdd();
            }}
            className="min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-indigo-500"
          />
          <button onClick={onAdd} className="inline-flex items-center gap-1 rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800">
            <Plus size={13} />
          </button>
        </div>
      </div>
    </section>
  );
}

function ScoringGroup({ title, desc, children }: { title: string; desc: string; children: ReactNode }) {
  return (
    <section className="rounded border border-zinc-800 bg-zinc-900/30 p-4">
      <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
      <p className="mt-1 text-xs text-zinc-500">{desc}</p>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {children}
      </div>
    </section>
  );
}

function NumberSlider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  const displayValue = Number.isFinite(value) ? value : min;
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-xs font-medium text-zinc-400">{label}</span>}
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={displayValue}
          onChange={(event) => onChange(Number(event.target.value))}
          className="min-w-0 flex-1 accent-indigo-500"
        />
        <div className="flex w-24 items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5">
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={displayValue}
            onChange={(event) => onChange(Number(event.target.value || min))}
            className="w-full bg-transparent text-right text-sm text-zinc-100 outline-none"
          />
          {suffix && <span className="text-xs text-zinc-500">{suffix}</span>}
        </div>
      </div>
    </label>
  );
}
