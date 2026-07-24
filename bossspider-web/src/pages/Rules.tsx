import { CircleHelp, Plus, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { GuidedTour, type GuidedTourStep } from '../components/GuidedTour';
import { useAppTranslation } from '../i18n';
import type { ConfigPatch, ConfigPayload } from '../types';

function splitLines(value: string) {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function uniqueTerms(values: string[]) {
  const seen = new Set<string>();
  return values.map((item) => item.trim()).filter((item) => {
    const key = item.toLocaleLowerCase();
    if (!item || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function joinTerms(values: string[]) {
  return uniqueTerms(values).join('\n');
}

function Section({ title, desc, children, className = '' }: { title: string; desc?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-md border border-[var(--border-subtle)] bg-[var(--surface-panel)] ${className}`}>
      <div className="border-b border-[var(--border-subtle)] px-4 py-3">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h2>
        {desc && <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">{desc}</p>}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function KeywordEditor({ title, note, values, draft, setDraft, onAdd, onRemove }: {
  title: string;
  note: string;
  values: string[];
  draft: string;
  setDraft: (value: string) => void;
  onAdd: () => void;
  onRemove: (value: string) => void;
}) {
  return (
    <section className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-panel)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-[var(--text-primary)]">{title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">{note}</p>
        </div>
        <span className="rounded-full bg-[var(--surface-subtle)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">{values.length}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {values.map((value) => (
          <span key={value} className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs text-blue-700 dark:border-indigo-900/60 dark:bg-indigo-950/30 dark:text-indigo-200">
            {value}
            <button type="button" aria-label={`删除 ${value}`} onClick={() => onRemove(value)} className="text-blue-500 hover:text-blue-800 dark:text-indigo-400 dark:hover:text-white"><X size={12} /></button>
          </span>
        ))}
        {!values.length && <span className="text-xs text-[var(--text-muted)]">—</span>}
      </div>
      <div className="mt-3 flex gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); onAdd(); } }}
          placeholder="输入后回车添加"
          className="min-w-0 flex-1 rounded border border-[var(--border-input)] bg-[var(--surface-input)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)]"
        />
        <button type="button" onClick={onAdd} className="inline-flex items-center gap-1 rounded border border-[var(--action-primary)] bg-[var(--surface-selected)] px-3 py-2 text-sm text-[var(--action-primary)] hover:bg-[var(--surface-hover)]"><Plus size={14} />添加</button>
      </div>
    </section>
  );
}

export function Rules({
  config,
  updateConfig,
  onSave,
  autoStartGuide = false,
  onAutoStartGuideHandled,
  onGuideComplete,
}: {
  config: ConfigPayload;
  updateConfig: (patch: ConfigPatch) => void;
  onSave: (patch?: ConfigPatch) => void | Promise<unknown>;
  autoStartGuide?: boolean;
  onAutoStartGuideHandled?: () => void;
  onGuideComplete?: () => void;
}) {
  const { t } = useAppTranslation();
  const [targetDraft, setTargetDraft] = useState('');
  const [blacklistDraft, setBlacklistDraft] = useState('');
  const [guideStep, setGuideStep] = useState<number | null>(null);

  const targetKeywords = useMemo(() => uniqueTerms(splitLines(config.relevanceText)), [config.relevanceText]);
  const blacklistKeywords = useMemo(() => uniqueTerms(splitLines(config.blacklistText)), [config.blacklistText]);
  const guideSteps = useMemo<GuidedTourStep[]>(() => [
    { target: 'matching-filter-rules', title: t('rules.tour.filterTitle'), body: t('rules.tour.filterBody') },
    { target: 'matching-save-rules', title: t('rules.tour.saveTitle'), body: t('rules.tour.saveBody') },
  ], [t]);

  const updateTerms = (field: 'relevanceText' | 'blacklistText', values: string[]) => updateConfig({ [field]: joinTerms(values) });
  const addTerm = (field: 'relevanceText' | 'blacklistText', draft: string, clear: (value: string) => void) => {
    const term = draft.trim();
    if (!term) return;
    updateTerms(field, [...splitLines(field === 'relevanceText' ? config.relevanceText : config.blacklistText), term]);
    clear('');
  };

  const finishGuide = () => {
    setGuideStep(null);
    onGuideComplete?.();
  };

  useEffect(() => {
    if (!autoStartGuide) return;
    onAutoStartGuideHandled?.();
    setGuideStep(0);
  }, [autoStartGuide, onAutoStartGuideHandled]);

  return (
    <div className="rules-page flex h-full flex-col">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">{t('rules.title')}</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">{t('rules.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setGuideStep(0)} className="inline-flex items-center gap-1.5 rounded border border-[var(--border-input)] px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"><CircleHelp size={14} />{t('rules.help')}</button>
          <button type="button" data-guide-target="matching-save-rules" onClick={() => void onSave()} className="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">{t('rules.saveRules')}</button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
          <div data-guide-target="matching-filter-rules" className="space-y-5">
            <KeywordEditor title={t('rules.targetKeywords')} note={t('rules.targetKeywordsHint')} values={targetKeywords} draft={targetDraft} setDraft={setTargetDraft} onAdd={() => addTerm('relevanceText', targetDraft, setTargetDraft)} onRemove={(value) => updateTerms('relevanceText', targetKeywords.filter((item) => item.toLocaleLowerCase() !== value.toLocaleLowerCase()))} />
            <KeywordEditor title={t('rules.excludeKeywords')} note={t('rules.excludeIfTitleMatches')} values={blacklistKeywords} draft={blacklistDraft} setDraft={setBlacklistDraft} onAdd={() => addTerm('blacklistText', blacklistDraft, setBlacklistDraft)} onRemove={(value) => updateTerms('blacklistText', blacklistKeywords.filter((item) => item.toLocaleLowerCase() !== value.toLocaleLowerCase()))} />
          </div>
          <Section title={t('rules.sortingTitle')} desc={t('rules.sortingDesc')}>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm text-[var(--text-secondary)]">{t('rules.minimumSalaryPreference')}<input type="number" min="0" value={config.minSalary} onChange={(event) => updateConfig({ minSalary: Number(event.target.value) })} className="mt-2 w-full rounded border border-[var(--border-input)] bg-[var(--surface-input)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)]" /><span className="mt-1 block text-xs text-[var(--text-muted)]">{t('rules.minSalaryHint')}</span></label>
              <label className="block text-sm text-[var(--text-secondary)]">{t('rules.experienceGapPreference')}<select value={config.experienceGapYears} onChange={(event) => updateConfig({ experienceGapYears: Number(event.target.value) })} className="mt-2 w-full rounded border border-[var(--border-input)] bg-[var(--surface-input)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)]"><option value={0}>{t('rules.experienceGapStrict')}</option><option value={1}>{t('rules.experienceGapOne')}</option><option value={2}>{t('rules.experienceGapTwo')}</option></select><span className="mt-1 block text-xs text-[var(--text-muted)]">{t('rules.experienceGapSortHint')}</span></label>
            </div>
          </Section>
      </div>

      {guideStep !== null && <GuidedTour steps={guideSteps} activeStep={guideStep} onStepChange={setGuideStep} onClose={() => setGuideStep(null)} onFinish={finishGuide} finishing={false} error="" nextLabel={t('rules.tour.next')} previousLabel={t('rules.tour.previous')} finishLabel={t('rules.tour.finish')} skipLabel={t('rules.tour.skip')} progressLabel={(current, total) => t('rules.tour.progress', { current, total })} />}
    </div>
  );
}
