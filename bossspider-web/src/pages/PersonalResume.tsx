import {
  AlertTriangle,
  Check,
  CheckCircle2,
  CircleHelp,
  FileInput,
  FileText,
  Loader2,
  RefreshCw,
  Save,
  Sparkles,
  X,
} from 'lucide-react';
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { bossApi } from '../api';
import { MarkdownEditor } from '../components/MarkdownEditor';
import { GuidedTour, type GuidedTourStep } from '../components/GuidedTour';
import { useAppTranslation } from '../i18n';
import type {
  CvDocumentResponse,
  ProficiencyLevel,
  ResumeCapabilityImportPreview,
  ResumeCapabilityImportSelection,
  ResumeDraftResponse,
  ResumeItem,
} from '../types';

const checkKeys = [
  'hasContent',
  'hasYears',
  'hasEducation',
  'hasSkills',
  'hasProjects',
  'hasExperience',
] as const;

type EditorTarget = { kind: 'base' } | { kind: 'tailored'; item: ResumeItem };

export function PersonalResume({
  project,
  items,
  onRefreshItems,
  onLoadDraft,
  onSaveDraft,
  onDirtyChange,
  onOpenCapabilityProfile,
  autoStartGuide = false,
  onAutoStartGuideHandled,
}: {
  project: string;
  items: ResumeItem[];
  onRefreshItems: () => void;
  onLoadDraft: (sourceKey: string) => Promise<ResumeDraftResponse | null>;
  onSaveDraft: (sourceKey: string, content: string) => Promise<ResumeDraftResponse | null>;
  onDirtyChange: (dirty: boolean) => void;
  onOpenCapabilityProfile?: () => void;
  autoStartGuide?: boolean;
  onAutoStartGuideHandled?: () => void;
}) {
  const { t } = useAppTranslation();
  const importInputRef = useRef<HTMLInputElement>(null);
  const [cvDocument, setCvDocument] = useState<CvDocumentResponse | null>(null);
  const [target, setTarget] = useState<EditorTarget>({ kind: 'base' });
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [activePath, setActivePath] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [guideStep, setGuideStep] = useState<number | null>(null);
  const [parseStatus, setParseStatus] = useState<'idle' | 'processing' | 'done' | 'failed'>('idle');
  const [capabilityPreview, setCapabilityPreview] = useState<ResumeCapabilityImportPreview | null>(null);
  const [capabilitySelections, setCapabilitySelections] = useState<Record<string, ResumeCapabilityImportSelection>>({});
  const [capabilityPreviewLoading, setCapabilityPreviewLoading] = useState(false);
  const [capabilityApplying, setCapabilityApplying] = useState(false);
  const [capabilitySyncError, setCapabilitySyncError] = useState('');
  const [showCapabilityProfileLink, setShowCapabilityProfileLink] = useState(false);
  const parsePollRef = useRef<ReturnType<typeof setInterval>>();

  const tailoredItems = useMemo(
    () => items.filter((item) => Boolean(item.resumeDraftPath)),
    [items],
  );
  const dirty = content !== savedContent;
  const completedChecks = cvDocument
    ? checkKeys.filter((key) => cvDocument.checks[key]).length
    : 0;
  const selectedCapabilityCount = Object.values(capabilitySelections).filter((item) => item.selected).length;

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => () => {
    onDirtyChange(false);
    if (parsePollRef.current) clearInterval(parsePollRef.current);
  }, [onDirtyChange]);

  useEffect(() => () => {
    if (parsePollRef.current) clearInterval(parsePollRef.current);
  }, []);

  // 恢复解析状态（切换页面后回来继续轮询）
  useEffect(() => {
    let cancelled = false;
    const checkAndPoll = async () => {
      try {
        const status = await bossApi.getParseStatus();
        if (cancelled) return;
        if (status.status === 'processing') {
          setParseStatus('processing');
          setMessage(t('personalResume.parsePdf.parsing'));
          const poll = setInterval(async () => {
            try {
              const s = await bossApi.getParseStatus();
              if (cancelled) { clearInterval(poll); return; }
              if (s.status === 'done') {
                clearInterval(poll);
                parsePollRef.current = undefined;
                setParseStatus('done');
                setContent(s.result || '');
                setMessage(t('personalResume.parsePdf.parseSuccess'));
              } else if (s.status === 'failed') {
                clearInterval(poll);
                parsePollRef.current = undefined;
                setParseStatus('failed');
                setError(t('personalResume.parsePdf.parseFailed', { error: s.error || 'Unknown error' }));
              }
            } catch {
              clearInterval(poll);
              parsePollRef.current = undefined;
            }
          }, 2000);
          parsePollRef.current = poll;
        } else if (status.status === 'done') {
          setParseStatus('done');
          setContent(status.result || '');
          setMessage(t('personalResume.parsePdf.parseSuccess'));
        }
      } catch {
        // ignore — service not available
      }
    };
    void checkAndPoll();
    return () => {
      cancelled = true;
      if (parsePollRef.current) clearInterval(parsePollRef.current);
    };
  }, [t]);

  useEffect(() => {
    if (!autoStartGuide) return;
    setGuideStep(0);
    onAutoStartGuideHandled?.();
  }, [autoStartGuide, onAutoStartGuideHandled]);

  const guideSteps = useMemo<GuidedTourStep[]>(() => [
    { target: 'personal-resume-import', title: t('personalResume.tour.importTitle'), body: t('personalResume.tour.importBody') },
    { target: 'personal-resume-editor', title: t('personalResume.tour.editorTitle'), body: t('personalResume.tour.editorBody') },
    { target: 'personal-resume-save', title: t('personalResume.tour.saveTitle'), body: t('personalResume.tour.saveBody') },
  ], [t]);

  const loadBaseResume = async () => {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const data = await bossApi.getCvDocument(project);
      setCvDocument(data);
      setTarget({ kind: 'base' });
      setContent(data.content || '');
      setSavedContent(data.content || '');
      setActivePath(data.path);
    } catch (loadError) {
      setError(t('personalResume.loadFailed', { error: (loadError as Error).message }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadBaseResume();
    onRefreshItems();
  }, [project]);

  const confirmDiscard = () => !dirty || window.confirm(t('personalResume.unsavedSwitchConfirm'));

  const selectBaseResume = () => {
    if (target.kind === 'base' || !confirmDiscard()) return;
    void loadBaseResume();
  };

  const loadTailoredResume = async (item: ResumeItem) => {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const data = await onLoadDraft(item.sourceKey);
      if (!data) return;
      setTarget({ kind: 'tailored', item });
      setContent(data.content || '');
      setSavedContent(data.content || '');
      setActivePath(data.draftPath);
    } finally {
      setLoading(false);
    }
  };

  const selectTailoredResume = (item: ResumeItem) => {
    if (target.kind === 'tailored' && target.item.sourceKey === item.sourceKey) return;
    if (!confirmDiscard()) return;
    void loadTailoredResume(item);
  };

  const refreshCurrent = () => {
    if (!confirmDiscard()) return;
    if (target.kind === 'base') void loadBaseResume();
    else void loadTailoredResume(target.item);
  };

  const saveCurrent = async () => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      if (target.kind === 'base') {
        const data = await bossApi.saveCvDocument(project, content);
        setCvDocument(data);
        setContent(data.content || '');
        setSavedContent(data.content || '');
        setActivePath(data.path);
        setMessage(t('personalResume.baseSaved'));
      } else {
        const data = await onSaveDraft(target.item.sourceKey, content);
        if (!data) return;
        setContent(data.content || '');
        setSavedContent(data.content || '');
        setActivePath(data.draftPath);
        setMessage(t('personalResume.tailoredSaved'));
      }
    } catch (saveError) {
      setError(t('personalResume.saveFailed', { error: (saveError as Error).message }));
    } finally {
      setSaving(false);
    }
  };

  const openCapabilitySync = async () => {
    if (dirty) {
      setError(t('personalResume.capabilitySync.saveFirst'));
      return;
    }
    setCapabilityPreviewLoading(true);
    setError('');
    setCapabilitySyncError('');
    setShowCapabilityProfileLink(false);
    try {
      const preview = await bossApi.previewCvCapabilityImport(project);
      setCapabilityPreview(preview);
      setCapabilitySelections(Object.fromEntries(preview.proposals.map((proposal) => [
        proposal.proposalId,
        {
          proposalId: proposal.proposalId,
          selected: proposal.selected,
          label: proposal.label,
          userProficiency: proposal.userProficiency,
        },
      ])));
    } catch (syncError) {
      setError(t('personalResume.capabilitySync.previewFailed', { error: (syncError as Error).message }));
    } finally {
      setCapabilityPreviewLoading(false);
    }
  };

  const updateCapabilitySelection = (
    proposalId: string,
    patch: Partial<ResumeCapabilityImportSelection>,
  ) => {
    setCapabilitySelections((current) => ({
      ...current,
      [proposalId]: { ...current[proposalId], ...patch },
    }));
  };

  const applyCapabilitySync = async () => {
    if (!capabilityPreview || selectedCapabilityCount === 0) return;
    setCapabilityApplying(true);
    setError('');
    try {
      const result = await bossApi.applyCvCapabilityImport(
        project,
        capabilityPreview.sourceRevision,
        Object.values(capabilitySelections),
      );
      setCapabilityPreview(null);
      setCapabilitySelections({});
      setMessage(t('personalResume.capabilitySync.applied', { count: result.imported.length }));
      setShowCapabilityProfileLink(true);
    } catch (syncError) {
      setCapabilitySyncError(t('personalResume.capabilitySync.applyFailed', { error: (syncError as Error).message }));
    } finally {
      setCapabilityApplying(false);
    }
  };

  const createFromTemplate = async () => {
    if (!confirmDiscard()) return;
    setLoading(true);
    setError('');
    setMessage('');
    try {
      await bossApi.createCvFromTemplate(project);
      await loadBaseResume();
      setMessage(t('personalResume.templateCreated'));
    } catch (createError) {
      setError(t('personalResume.templateFailed', { error: (createError as Error).message }));
      setLoading(false);
    }
  };

  const importResumeFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!confirmDiscard()) return;
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (extension === 'pdf' || file.type === 'application/pdf') {
      await parsePdfFile(file);
      return;
    }
    if (extension !== 'md' && extension !== 'txt') {
      setError(t('personalResume.importUnsupported'));
      return;
    }
    try {
      const imported = await file.text();
      setContent(imported);
      setError('');
      setMessage(t('personalResume.importReady', { name: file.name }));
    } catch (importError) {
      setError(t('personalResume.importFailed', { error: (importError as Error).message }));
    }
  };

  const parsePdfFile = async (file: File) => {
    setError('');
    setMessage(t('personalResume.parsePdf.parsing'));
    setParseStatus('processing');
    try {
      await bossApi.parsePdfResume(file);
      const poll = setInterval(async () => {
        try {
          const status = await bossApi.getParseStatus();
          if (status.status === 'done') {
            clearInterval(poll);
            parsePollRef.current = undefined;
            setParseStatus('done');
            setContent(status.result || '');
            setMessage(t('personalResume.parsePdf.parseSuccess'));
          } else if (status.status === 'failed') {
            clearInterval(poll);
            parsePollRef.current = undefined;
            setParseStatus('failed');
            setError(t('personalResume.parsePdf.parseFailed', { error: status.error || 'Unknown error' }));
          }
        } catch (pollError) {
          clearInterval(poll);
          parsePollRef.current = undefined;
          setParseStatus('failed');
          setError(t('personalResume.parsePdf.parseFailed', { error: (pollError as Error).message }));
        }
      }, 2000);
      parsePollRef.current = poll;
    } catch (uploadError) {
      setParseStatus('failed');
      setError(t('personalResume.parsePdf.parseFailed', { error: (uploadError as Error).message }));
    }
  };

  const title = target.kind === 'base'
    ? t('personalResume.baseTitle')
    : `${target.item.company} · ${target.item.title}`;

  return (
    <div className="personal-resume-page flex h-full min-h-0 flex-col gap-4">
      <div className="flex shrink-0 items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">{t('personalResume.title')}</h1>
          <p className="mt-1 text-sm text-zinc-500">{t('personalResume.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {dirty && <span className="text-xs text-amber-300">{t('personalResume.unsaved')}</span>}
          <button
            onClick={() => setGuideStep(0)}
            className="inline-flex items-center gap-1.5 rounded border border-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900"
          >
            <CircleHelp size={14} />
            {t('personalResume.help')}
          </button>
          <button
            onClick={refreshCurrent}
            disabled={loading || saving}
            className="inline-flex items-center gap-2 rounded border border-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900 disabled:opacity-50"
          >
            <RefreshCw size={14} />
            {t('personalResume.refresh')}
          </button>
          <button
            data-guide-target="personal-resume-save"
            onClick={() => void saveCurrent()}
            disabled={!dirty || loading || saving}
            className="inline-flex items-center gap-2 rounded bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? t('personalResume.saving') : t('personalResume.save')}
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="min-h-0 space-y-4 overflow-y-auto pr-1">
          <section className="rounded-md border border-zinc-800 bg-zinc-950">
            <button
              onClick={selectBaseResume}
              className={`w-full p-4 text-left transition-colors ${target.kind === 'base' ? 'bg-indigo-950/30' : 'hover:bg-zinc-900/60'}`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 font-medium text-zinc-100">
                  <FileText size={15} className="text-indigo-400" />
                  {t('personalResume.baseTitle')}
                </span>
                <span className="text-xs text-zinc-500">{completedChecks}/{checkKeys.length}</span>
              </div>
              <p className="mt-1 text-xs text-zinc-500">cv.md</p>
            </button>

            <div className="border-t border-zinc-800 p-4">
              {!cvDocument ? (
                <div className="text-xs text-zinc-500">{t('personalResume.checking')}</div>
              ) : (
                <div className="space-y-2">
                  {checkKeys.map((key) => {
                    const passed = cvDocument.checks[key];
                    return (
                      <div key={key} className="flex items-center justify-between gap-3 text-xs">
                        <span className="text-zinc-400">{t(`personalResume.checks.${key}`)}</span>
                        {passed
                          ? <CheckCircle2 size={14} className="text-emerald-400" />
                          : <span className="text-amber-300">{t('personalResume.missing')}</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          <section className="rounded-md border border-zinc-800 bg-zinc-950">
            <div className="border-b border-zinc-800 px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-zinc-100">{t('personalResume.tailoredTitle')}</h2>
                <span className="text-xs text-zinc-500">{tailoredItems.length}</span>
              </div>
              <p className="mt-1 text-xs text-zinc-500">{t('personalResume.tailoredSubtitle')}</p>
            </div>
            <div className="max-h-[360px] overflow-y-auto p-2">
              {tailoredItems.length ? tailoredItems.map((item) => {
                const active = target.kind === 'tailored' && target.item.sourceKey === item.sourceKey;
                return (
                  <button
                    key={item.sourceKey}
                    onClick={() => selectTailoredResume(item)}
                    className={`mb-1 w-full rounded border px-3 py-2.5 text-left transition-colors ${
                      active
                        ? 'border-indigo-800 bg-indigo-950/30'
                        : 'border-transparent hover:border-zinc-800 hover:bg-zinc-900/60'
                    }`}
                  >
                    <div className="truncate text-sm font-medium text-zinc-200">{item.title}</div>
                    <div className="mt-1 truncate text-xs text-zinc-500">{item.company} · {item.city}</div>
                  </button>
                );
              }) : (
                <div className="p-3 text-xs leading-relaxed text-zinc-500">{t('personalResume.noTailored')}</div>
              )}
            </div>
          </section>
        </aside>

        <section className="flex min-h-0 flex-col rounded-md border border-zinc-800 bg-zinc-950">
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-zinc-800 px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-[10px] ${target.kind === 'base' ? 'bg-indigo-950 text-indigo-300' : 'bg-emerald-950 text-emerald-300'}`}>
                  {target.kind === 'base' ? t('personalResume.baseBadge') : t('personalResume.tailoredBadge')}
                </span>
                <h2 className="truncate text-sm font-semibold text-zinc-100">{title}</h2>
              </div>
              <div className="mt-1 truncate text-[11px] text-zinc-600" title={activePath}>{activePath || '-'}</div>
            </div>

            {target.kind === 'base' && (
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => void openCapabilitySync()}
                  disabled={loading || saving || capabilityPreviewLoading || !cvDocument?.exists}
                  className="inline-flex items-center gap-2 rounded border border-indigo-400/40 bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-500/15 disabled:cursor-not-allowed disabled:opacity-50 dark:text-indigo-200"
                  title={dirty ? t('personalResume.capabilitySync.saveFirst') : undefined}
                >
                  {capabilityPreviewLoading
                    ? <Loader2 size={13} className="animate-spin" />
                    : <Sparkles size={13} />}
                  {t('personalResume.capabilitySync.button')}
                </button>
                <input
                  ref={importInputRef}
                  type="file"
                  accept=".md,.txt,.pdf,text/markdown,text/plain,application/pdf"
                  onChange={(event) => void importResumeFile(event)}
                  className="hidden"
                />
                <button
                  data-guide-target="personal-resume-import"
                  onClick={() => importInputRef.current?.click()}
                  disabled={loading || parseStatus === 'processing'}
                  className="inline-flex items-center gap-2 rounded border border-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900 disabled:opacity-50"
                >
                  {parseStatus === 'processing' ? <Loader2 size={13} className="animate-spin" /> : <FileInput size={13} />}
                  {parseStatus === 'processing' ? t('personalResume.parsePdf.parsing') : t('personalResume.import')}
                </button>
                {!cvDocument?.exists && cvDocument?.canCreateFromTemplate && (
                  <button
                    onClick={() => void createFromTemplate()}
                    disabled={loading}
                    className="inline-flex items-center gap-2 rounded border border-amber-800 bg-amber-950/20 px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-950/40 disabled:opacity-50"
                  >
                    <FileText size={13} />
                    {t('personalResume.createTemplate')}
                  </button>
                )}
              </div>
            )}
          </div>

          {target.kind === 'base' && (
            <div className="flex shrink-0 items-start gap-2 border-b border-zinc-800 bg-zinc-900/30 px-4 py-2 text-xs text-zinc-500">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-400" />
              <span>{t('personalResume.importHint')}</span>
            </div>
          )}

          {(error || message) && (
            <div className={`mx-4 mt-3 flex shrink-0 items-center gap-2 rounded border px-3 py-2 text-xs ${
              error
                ? 'border-red-900/60 bg-red-950/20 text-red-300'
                : 'border-emerald-900/60 bg-emerald-950/20 text-emerald-300'
              }`}>
              {error ? <AlertTriangle size={14} /> : <Check size={14} />}
              <span className="min-w-0 flex-1">{error || message}</span>
              {!error && showCapabilityProfileLink && onOpenCapabilityProfile && (
                <button
                  type="button"
                  onClick={onOpenCapabilityProfile}
                  className="shrink-0 rounded border border-emerald-700/60 px-2.5 py-1 font-medium text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-200"
                >
                  {t('personalResume.capabilitySync.viewProfile')}
                </button>
              )}
            </div>
          )}

          <div data-guide-target="personal-resume-editor" className="min-h-0 flex-1 p-4">
            {loading ? (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-zinc-500">
                <Loader2 size={16} className="animate-spin" />
                {t('personalResume.loading')}
              </div>
            ) : (
              <MarkdownEditor
                value={content}
                onChange={(nextContent) => {
                  setContent(nextContent);
                  setMessage('');
                }}
                onSave={dirty ? () => { void saveCurrent(); } : undefined}
                placeholder={t('personalResume.editorPlaceholder')}
              />
            )}
          </div>
        </section>
      </div>
      {guideStep !== null && (
        <GuidedTour
          steps={guideSteps}
          activeStep={guideStep}
          onStepChange={setGuideStep}
          onClose={() => setGuideStep(null)}
          nextLabel={t('personalResume.tour.next')}
          previousLabel={t('personalResume.tour.previous')}
          finishLabel={t('personalResume.tour.finish')}
          skipLabel={t('personalResume.tour.skip')}
          progressLabel={(current, total) => t('personalResume.tour.progress', { current, total })}
        />
      )}
      {capabilityPreview && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-zinc-950/55 p-6 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="capability-sync-title"
        >
          <div className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-950">
            <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-6 py-5 dark:border-zinc-800">
              <div>
                <div className="flex items-center gap-2">
                  <Sparkles size={18} className="text-indigo-500" />
                  <h2 id="capability-sync-title" className="text-lg font-semibold text-zinc-950 dark:text-zinc-100">
                    {t('personalResume.capabilitySync.title')}
                  </h2>
                </div>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  {t('personalResume.capabilitySync.subtitle')}
                </p>
              </div>
              <button
                onClick={() => {
                  setCapabilityPreview(null);
                  setCapabilitySyncError('');
                }}
                disabled={capabilityApplying}
                className="rounded-md border border-zinc-200 p-2 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-900"
                aria-label={t('personalResume.capabilitySync.close')}
              >
                <X size={16} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 border-b border-zinc-200 bg-zinc-50 px-6 py-3 sm:grid-cols-5 dark:border-zinc-800 dark:bg-zinc-900/40">
              {([
                ['total', capabilityPreview.counts.total],
                ['new', capabilityPreview.counts.new],
                ['merge', capabilityPreview.counts.merge],
                ['alreadyImported', capabilityPreview.counts.alreadyImported],
                ['needsReview', capabilityPreview.counts.needsReview],
              ] as const).map(([key, value]) => (
                <div key={key} className="rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
                  <div className="text-[11px] text-zinc-500">{t(`personalResume.capabilitySync.counts.${key}`)}</div>
                  <div className="mt-0.5 text-lg font-semibold text-zinc-950 dark:text-zinc-100">{value}</div>
                </div>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              {capabilityPreview.proposals.length ? (
                <div className="space-y-3">
                  {capabilityPreview.proposals.map((proposal) => {
                    const selection = capabilitySelections[proposal.proposalId];
                    const disabled = proposal.action === 'already_imported';
                    return (
                      <div
                        key={proposal.proposalId}
                        className={`rounded-lg border p-4 transition-colors ${
                          selection?.selected
                            ? 'border-indigo-300 bg-indigo-50/70 dark:border-indigo-700 dark:bg-indigo-950/20'
                            : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={Boolean(selection?.selected)}
                            disabled={disabled}
                            onChange={(event) => updateCapabilitySelection(proposal.proposalId, { selected: event.target.checked })}
                            className="mt-1 h-4 w-4 rounded border-zinc-300 accent-indigo-600"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                proposal.action === 'new'
                                  ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200'
                                  : proposal.action === 'merge'
                                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
                                    : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                              }`}>
                                {t(`personalResume.capabilitySync.actions.${proposal.action}`)}
                              </span>
                              <span className="text-[11px] text-zinc-500">
                                {t(`personalResume.capabilitySync.categories.${proposal.category}`, { defaultValue: proposal.category })}
                              </span>
                              <span className="text-[11px] text-zinc-400">
                                {Math.round(proposal.confidence * 100)}%
                              </span>
                            </div>
                            <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_190px]">
                              <label className="block">
                                <span className="mb-1 block text-[11px] text-zinc-500">
                                  {t('personalResume.capabilitySync.normalizedCapability')}
                                </span>
                                <input
                                  value={selection?.label || ''}
                                  disabled={disabled}
                                  onChange={(event) => updateCapabilitySelection(proposal.proposalId, { label: event.target.value })}
                                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                                />
                              </label>
                              <label className="block">
                                <span className="mb-1 block text-[11px] text-zinc-500">
                                  {t('personalResume.capabilitySync.proficiency')}
                                </span>
                                <select
                                  value={selection?.userProficiency || 'unspecified'}
                                  disabled={disabled || !proposal.proficiencyApplicable}
                                  onChange={(event) => updateCapabilitySelection(proposal.proposalId, {
                                    userProficiency: event.target.value as ProficiencyLevel,
                                  })}
                                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-indigo-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                                >
                                  {(['unspecified', 'awareness', 'familiar', 'working', 'proficient', 'expert'] as const).map((level) => (
                                    <option key={level} value={level}>
                                      {t(`personalResume.capabilitySync.levels.${level}`)}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </div>
                            <div className="mt-3 rounded-md bg-zinc-100 px-3 py-2 text-xs leading-relaxed text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                                {proposal.sourceRefs[0]?.heading || 'cv.md'}
                              </span>
                              <span className="mx-2 text-zinc-400">·</span>
                              {proposal.sourceRefs[0]?.quote}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-zinc-300 px-6 py-12 text-center text-sm text-zinc-500 dark:border-zinc-700">
                  {t('personalResume.capabilitySync.empty')}
                </div>
              )}
              {capabilityPreview.staleImports.length > 0 && (
                <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                  {t('personalResume.capabilitySync.stale', { count: capabilityPreview.staleImports.length })}
                </div>
              )}
              {capabilitySyncError && (
                <div className="mt-3 flex items-start gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-200">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>{capabilitySyncError}</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-4 border-t border-zinc-200 bg-zinc-50 px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900/40">
              <p className="text-xs text-zinc-500">{t('personalResume.capabilitySync.confirmHint')}</p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setCapabilityPreview(null);
                    setCapabilitySyncError('');
                  }}
                  disabled={capabilityApplying}
                  className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                >
                  {t('personalResume.capabilitySync.cancel')}
                </button>
                <button
                  onClick={() => void applyCapabilitySync()}
                  disabled={capabilityApplying || selectedCapabilityCount === 0}
                  className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {capabilityApplying && <Loader2 size={14} className="animate-spin" />}
                  {t('personalResume.capabilitySync.apply', { count: selectedCapabilityCount })}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
