import { BookOpenText, BrainCircuit, ExternalLink, FileText, Loader2, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { EvidenceDetailDrawer } from '../components/EvidenceDetailDrawer';
import { useAppTranslation } from '../i18n';
import { extractStoryDraftsFromPrep } from '../storyUtils';
import type { EvidenceOverviewResponse, InterviewItem, InterviewPrepResponse, InterviewStory, InterviewStoryBankResponse, InterviewStoryDraft, InterviewStoryDraftsResponse } from '../types';

type PrepStoryStatus = 'new' | 'draft' | 'promoted' | 'dismissed';

type PrepStoryRow = {
  draft: InterviewStory;
  draftId: string;
  status: PrepStoryStatus;
  existingDraft?: InterviewStoryDraft;
};

function markdownArticleClass() {
  return 'max-w-none text-sm leading-7 text-zinc-300 [&_h1]:mb-5 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-zinc-100 [&_h2]:mb-3 [&_h2]:mt-8 [&_h2]:border-b [&_h2]:border-zinc-800 [&_h2]:pb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-zinc-100 [&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:font-semibold [&_h3]:text-zinc-100 [&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_strong]:text-zinc-100 [&_code]:rounded [&_code]:bg-zinc-900 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-cyan-300 [&_pre]:my-4 [&_pre]:overflow-auto [&_pre]:rounded [&_pre]:border [&_pre]:border-zinc-800 [&_pre]:bg-zinc-900 [&_pre]:p-4 [&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-zinc-800 [&_th]:bg-zinc-900 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-zinc-100 [&_td]:border [&_td]:border-zinc-800 [&_td]:px-3 [&_td]:py-2';
}

function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function normalizeStoryKeyPart(value?: string) {
  return (value || '').trim().toLowerCase();
}

function prepStoryDraftId(sourceKey: string, prepPath: string, draft: InterviewStory) {
  return `prep-story-${stableHash([
    sourceKey,
    prepPath,
    normalizeStoryKeyPart(draft.theme),
    normalizeStoryKeyPart(draft.title),
  ].join('|'))}`;
}

function samePrepStory(draft: InterviewStoryDraft, sourceKey: string, prepPath: string, story: InterviewStory, draftId: string) {
  if (draft.draftId === draftId) return true;
  return (
    draft.sourceKey === sourceKey
    && draft.prepPath === prepPath
    && normalizeStoryKeyPart(draft.theme) === normalizeStoryKeyPart(story.theme)
    && normalizeStoryKeyPart(draft.title) === normalizeStoryKeyPart(story.title)
  );
}

function storyExistsInBank(storyBank: InterviewStoryBankResponse | null, draft: InterviewStory) {
  return Boolean(storyBank?.stories.some((story) => (
    normalizeStoryKeyPart(story.theme) === normalizeStoryKeyPart(draft.theme)
    && normalizeStoryKeyPart(story.title) === normalizeStoryKeyPart(draft.title)
  )));
}

function evidenceCitationMarkdown(content: string) {
  return content.replace(/【证据：(ev-[a-zA-Z0-9-]+)】/g, (_match, evidenceId) => (
    `[【证据：${evidenceId}】](evidence:${evidenceId})`
  ));
}

export function Interview({
  items,
  evidenceOverview,
  preparingKeys,
  selectedKey,
  onSelectedKeyChange,
  onRefresh,
  onLoadStoryBank,
  onLoadStoryDrafts,
  onSaveStoryDrafts,
  onOpenStory,
  onOpenStoryDraft,
  onLoadPrep,
  onGeneratePrep,
}: {
  items: InterviewItem[];
  evidenceOverview: EvidenceOverviewResponse | null;
  preparingKeys: string[];
  selectedKey: string;
  onSelectedKeyChange: (sourceKey: string) => void;
  onRefresh: () => void;
  onLoadStoryBank: () => Promise<InterviewStoryBankResponse | null>;
  onLoadStoryDrafts: () => Promise<InterviewStoryDraftsResponse | null>;
  onSaveStoryDrafts: (drafts: InterviewStoryDraft[]) => Promise<InterviewStoryDraftsResponse | null>;
  onOpenStory: () => void;
  onOpenStoryDraft: (draftId: string) => void;
  onLoadPrep: (sourceKey: string) => Promise<InterviewPrepResponse | null>;
  onGeneratePrep: (sourceKey: string, userNotes: string) => Promise<InterviewPrepResponse | null>;
}) {
  const { t } = useAppTranslation();
  const [storyBank, setStoryBank] = useState<InterviewStoryBankResponse | null>(null);
  const [storyDraftStore, setStoryDraftStore] = useState<InterviewStoryDraftsResponse | null>(null);
  const [prep, setPrep] = useState<InterviewPrepResponse | null>(null);
  const [userNotes, setUserNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedEvidenceId, setSelectedEvidenceId] = useState('');
  const preparingSet = new Set(preparingKeys);

  const selectedItem = useMemo(
    () => items.find((item) => item.sourceKey === selectedKey) || items[0] || null,
    [items, selectedKey],
  );
  const isPreparing = selectedItem ? preparingSet.has(selectedItem.sourceKey) : false;
  const evidenceContext = prep?.evidenceContext;
  const selectedEvidence = useMemo(
    () => (evidenceOverview?.evidenceItems || []).find((evidence) => evidence.evidenceId === selectedEvidenceId) || null,
    [evidenceOverview?.evidenceItems, selectedEvidenceId],
  );
  const jobLabels = useMemo(
    () => new Map(items.map((item) => [item.sourceKey, `${item.company} · ${item.title}`])),
    [items],
  );
  const renderedPrepContent = useMemo(() => evidenceCitationMarkdown(prep?.content || ''), [prep?.content]);
  const prepStoryDrafts = useMemo(() => extractStoryDraftsFromPrep(prep?.content || ''), [prep]);
  const prepStoryRows = useMemo<PrepStoryRow[]>(() => {
    if (!selectedItem || !prep) return [];
    return prepStoryDrafts.map((draft) => {
      const draftId = prepStoryDraftId(selectedItem.sourceKey, prep.prepPath, draft);
      const existingDraft = storyDraftStore?.drafts.find((item) => samePrepStory(item, selectedItem.sourceKey, prep.prepPath, draft, draftId));
      const status: PrepStoryStatus = existingDraft?.status === 'promoted' || storyExistsInBank(storyBank, draft)
        ? 'promoted'
        : existingDraft?.status === 'dismissed'
          ? 'dismissed'
          : existingDraft
            ? 'draft'
            : 'new';
      return { draft, draftId, status, existingDraft };
    }).filter((row) => row.status !== 'dismissed');
  }, [prep, prepStoryDrafts, selectedItem, storyBank, storyDraftStore?.drafts]);
  const actionablePrepStoryCount = prepStoryRows.filter((row) => row.status === 'new' || row.status === 'draft').length;
  const promotedPrepStoryCount = prepStoryRows.filter((row) => row.status === 'promoted').length;

  useEffect(() => {
    if (!selectedKey && items[0]) onSelectedKeyChange(items[0].sourceKey);
  }, [items, onSelectedKeyChange, selectedKey]);

  useEffect(() => {
    let cancelled = false;
    const loadStoryData = async () => {
      const [bank, drafts] = await Promise.all([onLoadStoryBank(), onLoadStoryDrafts()]);
      if (cancelled) return;
      setStoryBank(bank);
      setStoryDraftStore(drafts);
    };
    void loadStoryData();
    return () => {
      cancelled = true;
    };
  }, [onLoadStoryBank, onLoadStoryDrafts]);

  useEffect(() => {
    let cancelled = false;
    const loadPrep = async () => {
      setPrep(null);
      if (!selectedItem?.interviewPrepPath) return;
      setLoading(true);
      try {
        const data = await onLoadPrep(selectedItem.sourceKey);
        if (!cancelled) setPrep(data);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void loadPrep();
    return () => {
      cancelled = true;
    };
  }, [onLoadPrep, selectedItem]);

  const generatePrep = async () => {
    if (!selectedItem) return;
    const data = await onGeneratePrep(selectedItem.sourceKey, userNotes);
    if (data) setPrep(data);
  };

  const draftFromPrepStory = (row: PrepStoryRow, status: InterviewStoryDraft['status']): InterviewStoryDraft | null => {
    if (!selectedItem || !prep) return null;
    const now = new Date().toISOString();
    return {
      ...row.draft,
      draftId: row.draftId,
      status,
      sourceKey: selectedItem.sourceKey,
      sourceLabel: `${selectedItem.company} · ${selectedItem.title}`,
      prepPath: prep.prepPath,
      createdAt: row.existingDraft?.createdAt || now,
      updatedAt: now,
      promotedAt: row.existingDraft?.promotedAt || '',
      promotedStoryId: row.existingDraft?.promotedStoryId || '',
    };
  };

  const savePrepStoryDraft = async (nextDraft: InterviewStoryDraft) => {
    const existing = storyDraftStore?.drafts || [];
    const nextDrafts = existing.some((draft) => draft.draftId === nextDraft.draftId)
      ? existing.map((draft) => draft.draftId === nextDraft.draftId ? nextDraft : draft)
      : [...existing, nextDraft];
    const optimistic = {
      ok: storyDraftStore?.ok ?? true,
      path: storyDraftStore?.path || '',
      drafts: nextDrafts,
    };
    setStoryDraftStore(optimistic);
    const saved = await onSaveStoryDrafts(nextDrafts);
    if (saved) setStoryDraftStore(saved);
    return saved;
  };

  const openOrCreatePrepStoryDraft = async (row: PrepStoryRow) => {
    if (row.status === 'promoted' || row.status === 'dismissed') return;
    if (row.existingDraft) {
      onOpenStoryDraft(row.existingDraft.draftId);
      return;
    }
    const nextDraft = draftFromPrepStory(row, 'needs_confirmation');
    if (!nextDraft) return;
    const saved = await savePrepStoryDraft(nextDraft);
    if (saved) onOpenStoryDraft(nextDraft.draftId);
  };

  const dismissPrepStoryDraft = async (row: PrepStoryRow) => {
    if (row.status === 'promoted') return;
    if (!window.confirm(t('interview.confirmDeleteStoryDraft'))) return;
    const nextDraft = draftFromPrepStory(row, 'dismissed');
    if (!nextDraft) return;
    await savePrepStoryDraft(nextDraft);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">{t('interview.title')}</h2>
          <p className="text-xs text-zinc-500">
            {items.length.toLocaleString()} {t('interview.jobsWithMaterials')}
          </p>
        </div>
        <button
          onClick={onRefresh}
          className="inline-flex items-center gap-2 rounded border border-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-900"
        >
          <RefreshCw size={14} />
          {t('interview.refresh')}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden rounded-md border border-zinc-800 bg-zinc-900/20">
        <aside className="w-80 shrink-0 overflow-y-auto border-r border-zinc-800 bg-zinc-950">
          {items.length ? items.map((item) => (
            <button
              key={item.sourceKey}
              onClick={() => onSelectedKeyChange(item.sourceKey)}
              className={`block w-full border-b border-zinc-900 px-4 py-3 text-left transition-colors ${selectedItem?.sourceKey === item.sourceKey ? 'bg-zinc-800/60' : 'hover:bg-zinc-900/70'}`}
            >
              <div className="truncate text-sm font-medium text-zinc-100">{item.title}</div>
              <div className="mt-1 truncate text-xs text-zinc-500">{item.company} · {item.city || '-'}</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {item.reportPath && <span className="rounded bg-emerald-950/60 px-1.5 py-0.5 text-[10px] text-emerald-300">LLM report</span>}
                {item.resumeDraftPath && <span className="rounded bg-indigo-950/60 px-1.5 py-0.5 text-[10px] text-indigo-300">Resume</span>}
                {item.interviewPrepPath && <span className="rounded bg-cyan-950/60 px-1.5 py-0.5 text-[10px] text-cyan-300">Prep</span>}
                {item.llmScore && <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300">{item.llmScore.toFixed(1)}</span>}
              </div>
            </button>
          )) : (
            <div className="p-4 text-sm leading-relaxed text-zinc-500">
              {t('interview.noInterviewReady')}
            </div>
          )}
        </aside>

        <main className="grid min-w-0 flex-1 grid-cols-[minmax(340px,0.42fr)_minmax(480px,0.58fr)] overflow-hidden">
          <section className="min-w-0 overflow-y-auto border-r border-zinc-800 p-5">
            {selectedItem ? (
              <div className="space-y-5">
                <div>
                  <div className="text-xs text-zinc-500">{t('interview.targetJob')}</div>
                  <h3 className="mt-1 text-base font-semibold text-zinc-100">{selectedItem.title}</h3>
                  <div className="mt-1 text-sm text-zinc-400">{selectedItem.company} · {selectedItem.city || '-'} · {selectedItem.salary || '-'}</div>
                  {selectedItem.llmRecommendation && (
                    <div className="mt-3 rounded border border-emerald-900/50 bg-emerald-950/20 p-3 text-xs leading-relaxed text-zinc-300">
                      {selectedItem.llmRecommendation}
                    </div>
                  )}
                </div>

                <div className="rounded border border-zinc-800 bg-zinc-950">
                  <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3 text-sm font-semibold text-zinc-100">
                    <BrainCircuit size={14} className="text-emerald-400" />
                    {t('interview.evidenceBasis')}
                  </div>
                  {evidenceContext ? (
                    <div className="space-y-3 p-4 text-xs">
                      {evidenceContext.confirmedEvidence.length > 0 && (
                        <div>
                          <div className="mb-1.5 text-zinc-500">{t('interview.confirmedEvidence')}</div>
                          <div className="flex flex-wrap gap-1.5">
                            {evidenceContext.confirmedEvidence.map((evidence) => (
                              <button
                                type="button"
                                key={evidence.evidenceId}
                                onClick={() => setSelectedEvidenceId(evidence.evidenceId)}
                                title={[
                                  evidence.summary,
                                  ...Array.from(new Set(evidence.sourceRefs.map((ref) => ref.ref).filter(Boolean))).map((ref) => `来源：${ref}`),
                                ].filter(Boolean).join('\n')}
                                className="rounded border border-emerald-900/60 bg-emerald-950/25 px-2 py-1 text-left text-emerald-200 transition-colors hover:bg-emerald-950/50"
                              >
                                {evidence.evidenceId} · {evidence.title || t('interview.confirmedEvidence')}
                              </button>
                            ))}
                          </div>
                          <div className="mt-1.5 text-[10px] text-zinc-500">{t('interview.evidenceCitationHint')}</div>
                        </div>
                      )}
                      {evidenceContext.sourceVerifiedRequirements.length > 0 && (
                        <div>
                          <div className="mb-1.5 text-zinc-500">{t('interview.sourceVerifiedFacts')}</div>
                          <div className="flex flex-wrap gap-1.5">
                            {evidenceContext.sourceVerifiedRequirements.map((requirement) => (
                              <span
                                key={requirement.requirementId}
                                title={requirement.candidateEvidenceRefs.map((ref) => ref.quote).filter(Boolean).join('\n')}
                                className="rounded border border-cyan-900/60 bg-cyan-950/20 px-2 py-1 text-cyan-200"
                              >
                                {requirement.label}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {evidenceContext.pendingRequirements.length > 0 && (
                        <div className="rounded border border-amber-900/50 bg-amber-950/15 px-3 py-2 text-amber-100">
                          <span className="font-medium">{t('interview.pendingEvidence')}：{evidenceContext.pendingRequirements.length}</span>
                          <span className="ml-2 text-amber-200/80">{t('interview.evidencePendingHint')}</span>
                        </div>
                      )}
                      {!evidenceContext.confirmedEvidence.length && !evidenceContext.sourceVerifiedRequirements.length && !evidenceContext.pendingRequirements.length && (
                        <div className="text-zinc-500">{t('interview.evidenceUnavailable')}</div>
                      )}
                    </div>
                  ) : (
                    <div className="p-4 text-xs leading-relaxed text-zinc-500">{t('interview.evidenceUnavailable')}</div>
                  )}
                </div>

                <div className="rounded border border-zinc-800 bg-zinc-950">
                  <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                      <BookOpenText size={14} className="text-cyan-400" />
                      {t('interview.storyBank')}
                    </div>
                    <button
                      onClick={onOpenStory}
                      className="inline-flex items-center gap-1.5 rounded border border-zinc-800 px-2 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-900"
                    >
                      <ExternalLink size={12} />
                      {t('interview.openStory')}
                    </button>
                  </div>
                  <div className="space-y-3 p-4">
                    <div className="break-all rounded border border-zinc-800 bg-zinc-900/50 p-3 text-[10px] text-zinc-500">
                      {storyBank?.path || t('interview.loadingStoryBank')}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded border border-zinc-800 bg-zinc-900/40 p-3">
                        <div className="text-xl font-semibold text-zinc-100">{storyBank?.stories.length || 0}</div>
                        <div className="mt-1 text-xs text-zinc-500">{t('interview.confirmedStories')}</div>
                      </div>
                      <div className="rounded border border-zinc-800 bg-zinc-900/40 p-3">
                        <div className="text-xl font-semibold text-cyan-300">{actionablePrepStoryCount}/{prepStoryRows.length}</div>
                        <div className="mt-1 text-xs text-zinc-500">{t('interview.pendingStoriesInPrep')}</div>
                        {promotedPrepStoryCount > 0 && (
                          <div className="mt-1 text-[10px] text-emerald-300">{t('interview.promotedStoriesInPrep', { count: promotedPrepStoryCount })}</div>
                        )}
                      </div>
                    </div>
                    {prepStoryRows.length > 0 && (
                      <div className="rounded border border-zinc-800 bg-zinc-900/30 p-3">
                        <div className="mb-2 text-xs font-medium text-zinc-300">{t('interview.draftStories')}</div>
                        <div className="space-y-2">
                          {prepStoryRows.map((row) => {
                            const isGap = row.draft.tags.includes('gap') || row.draft.theme === '缺失故事';
                            const isMuted = row.status === 'promoted' || row.status === 'dismissed';
                            return (
                              <div
                                key={row.draftId}
                                className={`flex items-center justify-between gap-2 rounded border px-2.5 py-2 text-xs ${
                                  isMuted
                                    ? 'border-zinc-800 bg-zinc-950/60 text-zinc-500'
                                    : isGap
                                      ? 'border-amber-900/60 bg-amber-950/15 text-amber-100'
                                      : 'border-cyan-900/50 bg-cyan-950/10 text-cyan-100'
                                }`}
                              >
                                <div className="min-w-0">
                                  <div className="flex min-w-0 items-center gap-2">
                                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
                                      row.status === 'promoted'
                                        ? 'bg-emerald-950/70 text-emerald-300'
                                        : row.status === 'dismissed'
                                          ? 'bg-zinc-900 text-zinc-500'
                                          : row.status === 'draft'
                                            ? 'bg-amber-950/70 text-amber-300'
                                            : 'bg-cyan-950/70 text-cyan-300'
                                    }`}>
                                      {t(`interview.storyDraftStatuses.${row.status}`)}
                                    </span>
                                    <span className="truncate font-medium">{row.draft.title}</span>
                                  </div>
                                  <div className="mt-1 truncate text-[10px] text-zinc-500">{row.draft.theme || t('story.general')}</div>
                                </div>
                                <div className="flex shrink-0 items-center gap-1.5">
                                  {(row.status === 'new' || row.status === 'draft') && (
                                    <button
                                      type="button"
                                      onClick={() => { void openOrCreatePrepStoryDraft(row); }}
                                      className="rounded border border-cyan-900/60 px-2 py-1 text-[11px] text-cyan-200 transition-colors hover:bg-cyan-950/50"
                                    >
                                      {row.status === 'draft' ? t('interview.openStoryDraft') : t('interview.addStoryDraft')}
                                    </button>
                                  )}
                                  {row.status !== 'promoted' && row.status !== 'dismissed' && (
                                    <button
                                      type="button"
                                      onClick={() => { void dismissPrepStoryDraft(row); }}
                                      title={t('interview.deleteStoryDraft')}
                                      className="rounded border border-red-950/70 p-1 text-red-300 transition-colors hover:bg-red-950/40"
                                    >
                                      <Trash2 size={12} />
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <div className="mb-1 text-xs text-zinc-500">{t('interview.prepNotes')}</div>
                  <textarea
                    value={userNotes}
                    onChange={(event) => setUserNotes(event.target.value)}
                    placeholder={t('interview.prepPlaceholder')}
                    className="h-28 w-full resize-none rounded border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-300 outline-none focus:border-cyan-600"
                  />
                </div>

                <button
                  onClick={generatePrep}
                  disabled={isPreparing}
                  className="inline-flex items-center gap-2 rounded bg-cyan-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isPreparing ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                  {t('interview.generatePrep')}
                </button>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                {t('interview.selectJob')}
              </div>
            )}
          </section>

          <section className="min-w-0 overflow-y-auto p-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <BrainCircuit size={14} className="text-cyan-400" />
              {t('interview.interviewPrep')}
            </div>
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-zinc-500">
                <Loader2 size={14} className="animate-spin" />
                {t('interview.loadingPrep')}
              </div>
            ) : prep ? (
              <div className="space-y-3">
                <div className="break-all rounded border border-zinc-800 bg-zinc-950 p-3 text-[10px] text-zinc-500">
                  {prep.prepPath}
                </div>
                <article className={markdownArticleClass()}>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: ({ href, children }) => {
                        const evidenceId = href?.startsWith('evidence:') ? href.slice('evidence:'.length) : '';
                        if (evidenceId) {
                          return (
                            <button
                              type="button"
                              onClick={() => setSelectedEvidenceId(evidenceId)}
                              className="rounded border border-emerald-900/70 bg-emerald-950/30 px-1.5 py-0.5 text-emerald-200 transition-colors hover:bg-emerald-950/60"
                            >
                              {children}
                            </button>
                          );
                        }
                        return <a href={href} className="text-cyan-300 underline underline-offset-2">{children}</a>;
                      },
                    }}
                  >
                    {renderedPrepContent}
                  </ReactMarkdown>
                </article>
              </div>
            ) : selectedItem?.interviewPrepPath ? (
              <div className="text-sm text-zinc-500">{t('interview.loadingExistingPrep')}</div>
            ) : (
              <div className="rounded border border-dashed border-zinc-800 bg-zinc-950 p-5 text-sm leading-relaxed text-zinc-500">
                <div className="mb-2 flex items-center gap-2 font-medium text-zinc-300">
                  <FileText size={14} />
                  {t('interview.noPrepYetTitle')}
                </div>
                {t('interview.noPrepYetBody')}
              </div>
            )}
          </section>
        </main>
      </div>
      {selectedEvidence && (
        <EvidenceDetailDrawer
          evidence={selectedEvidence}
          overview={evidenceOverview}
          jobLabels={jobLabels}
          onClose={() => setSelectedEvidenceId('')}
        />
      )}
    </div>
  );
}
