import { BookOpenText, CheckSquare, FileText, Loader2, RefreshCw, Square, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { EvidenceDetailDrawer } from '../components/EvidenceDetailDrawer';
import type { EvidenceOverviewResponse, ResumeDraftResponse, ResumeEvidenceClaim, ResumeItem, ResumeNavigationTarget, ResumeSuggestionResponse } from '../types';
import { useAppTranslation } from '../i18n';

type ParsedSuggestion = {
  id: string;
  text: string;
  risk: string;
};

type SuggestionRisk = 'safe' | 'needs_confirmation' | 'avoid_fabrication' | 'unknown';

function parseSuggestionItems(content: string): ParsedSuggestion[] {
  const items: ParsedSuggestion[] = [];
  let current: ParsedSuggestion | null = null;
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    const match = line.match(/^[-*]\s+\[[ xX]\]\s*(?:\*\*)?([SC]\d[\w-]*)(?:\*\*)?\s*[:：｜|]\s*(.+)$/i);
    if (!match) {
      if (current && /(?:风险级别|risk level)/i.test(line)) {
        const riskMatch = line.replace(/\*\*/g, '').match(/(?:风险级别|risk level)\s*[:：]\s*([^（(]+)/i);
        if (riskMatch) current.risk = riskMatch[1].trim();
      }
      continue;
    }
    const [, id, body] = match;
    const text = body
      .replace(/\*\*/g, '')
      .replace(/[｜|]/g, ' · ')
      .trim();
    const riskMatch = text.match(/(?:风险级别|risk level)\s*[:：]\s*([^（(]+)/i);
    const risk = riskMatch ? riskMatch[1].trim() : '';
    current = { id: id.toUpperCase(), text, risk };
    items.push(current);
  }
  return items;
}

function normalizeSuggestionRisk(value: string): SuggestionRisk {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'safe' || normalized === '安全') return 'safe';
  if (
    normalized === 'needs_confirmation'
    || normalized === 'needs_confirm'
    || normalized === '需确认'
    || normalized === '需要确认'
  ) return 'needs_confirmation';
  if (
    normalized === 'avoid_fabrication'
    || normalized === 'avoid'
    || normalized === '避免编造'
  ) return 'avoid_fabrication';
  return 'unknown';
}

function isEligibleForDraft(claim: ResumeEvidenceClaim | undefined, fallbackRisk: string, evidenceBindingVersion?: number) {
  if (normalizeSuggestionRisk(claim?.risk || fallbackRisk) !== 'safe') return false;
  if (!evidenceBindingVersion) return true;
  return Boolean(claim?.sourceVerified || claim?.evidenceIds?.length);
}

function defaultSelectedSuggestionIds(suggestion: ResumeSuggestionResponse | null) {
  const items = parseSuggestionItems(suggestion?.content || '');
  const evidenceById = new Map((suggestion?.evidenceMap || []).map((claim) => [claim.claimId, claim]));
  return new Set(
    items
      .filter((item) => isEligibleForDraft(evidenceById.get(item.id), item.risk, suggestion?.evidenceBindingVersion))
      .map((item) => item.id),
  );
}

function markdownArticleClass(accent: 'indigo' | 'emerald' = 'indigo') {
  const code = accent === 'emerald' ? 'text-emerald-300' : 'text-indigo-300';
  return `max-w-none text-sm leading-7 text-zinc-300 [&_h1]:mb-5 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-zinc-100 [&_h2]:mb-3 [&_h2]:mt-8 [&_h2]:border-b [&_h2]:border-zinc-800 [&_h2]:pb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-zinc-100 [&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:font-semibold [&_h3]:text-zinc-100 [&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_strong]:text-zinc-100 [&_code]:rounded [&_code]:bg-zinc-900 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:${code} [&_pre]:my-4 [&_pre]:overflow-auto [&_pre]:rounded [&_pre]:border [&_pre]:border-zinc-800 [&_pre]:bg-zinc-900 [&_pre]:p-4 [&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-zinc-800 [&_th]:bg-zinc-900 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-zinc-100 [&_td]:border [&_td]:border-zinc-800 [&_td]:px-3 [&_td]:py-2`;
}

function evidenceSourceLabel(type: string, t: (key: string) => string) {
  const normalized = type.trim().toLowerCase();
  if (normalized === 'cv') return t('resume.sourceCv');
  if (normalized === 'jd') return t('resume.sourceJd');
  if (normalized === 'profile') return t('resume.sourceProfile');
  if (normalized === 'report') return t('resume.sourceReport');
  return normalized.toUpperCase() || t('status.unknown');
}

function riskLabel(risk: string, t: (key: string) => string) {
  if (risk === 'safe') return t('resume.riskSafe');
  if (risk === 'needs_confirmation') return t('resume.riskNeedsConfirmation');
  if (risk === 'avoid_fabrication') return t('resume.riskAvoidFabrication');
  return risk || t('resume.riskSafe');
}

function normalizeTargetText(value?: string) {
  return (value || '').trim().toLowerCase();
}

function matchesResumeTarget(item: ResumeItem, target: ResumeNavigationTarget) {
  if (target.sourceKey && item.sourceKey === target.sourceKey) return true;
  if (target.jobId != null && item.jobId === target.jobId) return true;
  const targetCompany = normalizeTargetText(target.company);
  const targetTitle = normalizeTargetText(target.title);
  const targetCity = normalizeTargetText(target.city);
  if (!targetCompany || !targetTitle) return false;
  return (
    normalizeTargetText(item.company) === targetCompany
    && normalizeTargetText(item.title) === targetTitle
    && (!targetCity || normalizeTargetText(item.city) === targetCity)
  );
}

export function Resume({
  items,
  evidenceOverview,
  draftingKeys,
  onRefresh,
  onLoadSuggestion,
  onLoadDraft,
  onGenerateDraft,
  selectedSourceKey,
  selectedTarget,
  targetRequestId,
  onTargetApplied,
}: {
  items: ResumeItem[];
  evidenceOverview: EvidenceOverviewResponse | null;
  draftingKeys: string[];
  onRefresh: () => void;
  onLoadSuggestion: (sourceKey: string) => Promise<ResumeSuggestionResponse | null>;
  onLoadDraft: (sourceKey: string) => Promise<ResumeDraftResponse | null>;
  onGenerateDraft: (sourceKey: string, approvedSuggestionIds: string[], userNotes: string) => Promise<ResumeDraftResponse | null>;
  selectedSourceKey?: string;
  selectedTarget?: ResumeNavigationTarget | null;
  targetRequestId?: number;
  onTargetApplied?: () => void;
}) {
  const { t } = useAppTranslation();
  const [selectedKey, setSelectedKey] = useState('');
  const [suggestion, setSuggestion] = useState<ResumeSuggestionResponse | null>(null);
  const [draft, setDraft] = useState<ResumeDraftResponse | null>(null);
  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState<Set<string>>(new Set());
  const [selectedEvidenceId, setSelectedEvidenceId] = useState('');
  const [userNotes, setUserNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const appliedTargetRef = useRef('');
  const draftingSet = new Set(draftingKeys);

  const selectedItem = useMemo(
    () => items.find((item) => item.sourceKey === selectedKey) || items[0] || null,
    [items, selectedKey],
  );
  const parsedSuggestions = useMemo(() => parseSuggestionItems(suggestion?.content || ''), [suggestion]);
  const evidenceById = useMemo(
    () => new Map((suggestion?.evidenceMap || []).map((claim) => [claim.claimId, claim])),
    [suggestion?.evidenceMap],
  );
  const globalEvidenceById = useMemo(
    () => new Map((evidenceOverview?.evidenceItems || []).map((item) => [item.evidenceId, item])),
    [evidenceOverview?.evidenceItems],
  );
  const selectedEvidence = globalEvidenceById.get(selectedEvidenceId) || null;
  const jobLabels = useMemo(
    () => new Map(items.map((item) => [item.sourceKey, `${item.company} · ${item.title}`])),
    [items],
  );
  const allSelected = parsedSuggestions.length > 0 && parsedSuggestions.every((item) => selectedSuggestionIds.has(item.id));
  const draftEvidenceIds = useMemo(() => Array.from(new Set(
    (draft?.evidenceMap || [])
      .filter((claim) => claim.userDecision === 'approved')
      .flatMap((claim) => claim.evidenceIds || []),
  )), [draft?.evidenceMap]);
  const isDrafting = selectedItem ? draftingSet.has(selectedItem.sourceKey) : false;
  const hasNavigationTarget = Boolean(
    targetRequestId
    && (selectedTarget?.sourceKey || selectedTarget?.jobId || selectedTarget?.company || selectedTarget?.title || selectedSourceKey)
  );

  useEffect(() => {
    if (hasNavigationTarget) return;
    if (!selectedKey && items[0]) setSelectedKey(items[0].sourceKey);
  }, [hasNavigationTarget, items, selectedKey]);

  useEffect(() => {
    const target = selectedTarget || { sourceKey: selectedSourceKey };
    if ((!target.sourceKey && !target.jobId && !target.company && !target.title) || !targetRequestId) return;
    const targetKey = `${targetRequestId}:${target.sourceKey || target.jobId || `${target.company}:${target.title}:${target.city}`}`;
    if (appliedTargetRef.current === targetKey) return;
    const matchedItem = items.find((item) => matchesResumeTarget(item, target));
    if (!matchedItem) return;
    setSelectedKey(matchedItem.sourceKey);
    appliedTargetRef.current = targetKey;
    onTargetApplied?.();
  }, [items, onTargetApplied, selectedSourceKey, selectedTarget, targetRequestId]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!selectedItem) return;
      setLoading(true);
      setSuggestion(null);
      setDraft(null);
      setSelectedSuggestionIds(new Set());
      try {
        const suggestionData = selectedItem.resumeSuggestionPath
          ? await onLoadSuggestion(selectedItem.sourceKey)
          : null;
        if (cancelled) return;
        setSuggestion(suggestionData);
        setSelectedSuggestionIds(defaultSelectedSuggestionIds(suggestionData));
        if (selectedItem.resumeDraftPath) {
          const draftData = await onLoadDraft(selectedItem.sourceKey);
          if (!cancelled) setDraft(draftData);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [onLoadDraft, onLoadSuggestion, selectedItem]);

  const toggleSuggestion = (id: string) => {
    setSelectedSuggestionIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedSuggestionIds(allSelected ? new Set() : new Set(parsedSuggestions.map((item) => item.id)));
  };

  const generateDraft = async () => {
    if (!selectedItem) return;
    const data = await onGenerateDraft(selectedItem.sourceKey, Array.from(selectedSuggestionIds), userNotes);
    if (data) setDraft(data);
  };

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">{t('resume.title')}</h2>
          <p className="text-xs text-zinc-500">
            {items.length.toLocaleString()} {t('resume.jobsWithMaterials')}
          </p>
        </div>
        <button
          onClick={onRefresh}
          className="inline-flex items-center gap-2 rounded border border-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-300 hover:bg-zinc-900 transition-colors"
        >
          <RefreshCw size={14} />
          {t('resume.refresh')}
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden rounded-md border border-zinc-800 bg-zinc-900/20 flex">
        <aside className="w-80 shrink-0 border-r border-zinc-800 bg-zinc-950 overflow-y-auto">
          {items.length ? items.map((item) => (
            <button
              key={item.sourceKey}
              onClick={() => setSelectedKey(item.sourceKey)}
              className={`block w-full border-b border-zinc-900 px-4 py-3 text-left transition-colors ${selectedItem?.sourceKey === item.sourceKey ? 'bg-zinc-800/60' : 'hover:bg-zinc-900/70'}`}
            >
              <div className="truncate text-sm font-medium text-zinc-100">{item.title}</div>
              <div className="mt-1 truncate text-xs text-zinc-500">{item.company} · {item.city || '-'}</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {item.resumeSuggestionPath && <span className="rounded bg-indigo-950/60 px-1.5 py-0.5 text-[10px] text-indigo-300">{t('resume.suggestions')}</span>}
                {item.resumeDraftPath && <span className="rounded bg-emerald-950/60 px-1.5 py-0.5 text-[10px] text-emerald-300">{t('resume.draft')}</span>}
                {item.llmScore && <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300">{item.llmScore.toFixed(1)}</span>}
              </div>
            </button>
          )) : (
            <div className="p-4 text-sm text-zinc-500">
              {t('resume.noResumeSuggestions')}
            </div>
          )}
        </aside>

        <main className="grid min-w-0 flex-1 grid-cols-2 overflow-hidden">
          <section className="min-w-0 overflow-y-auto border-r border-zinc-800 p-5">
            {selectedItem ? (
              <div className="space-y-5">
                <div>
                  <div className="text-xs text-zinc-500">{t('resume.targetJob')}</div>
                  <h3 className="mt-1 text-base font-semibold text-zinc-100">{selectedItem.title}</h3>
                  <div className="mt-1 text-sm text-zinc-400">{selectedItem.company} · {selectedItem.city || '-'} · {selectedItem.salary || '-'}</div>
                  {selectedItem.llmRecommendation && (
                    <div className="mt-3 rounded border border-emerald-900/50 bg-emerald-950/20 p-3 text-xs leading-relaxed text-zinc-300">
                      {selectedItem.llmRecommendation}
                    </div>
                  )}
                </div>

                <div className="rounded border border-zinc-800 bg-zinc-950">
                  <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                      <BookOpenText size={14} className="text-indigo-400" />
                      {t('resume.suggestions')}
                    </div>
                    {parsedSuggestions.length > 0 && (
                      <button onClick={toggleAll} className="text-xs text-indigo-400 hover:text-indigo-300">
                        {allSelected ? t('resume.clearAll') : t('resume.selectAll')}
                      </button>
                    )}
                  </div>
                    {parsedSuggestions.length > 0 && (
                      <div className="border-b border-zinc-800/80 bg-zinc-950/40 px-4 py-2 text-[11px] leading-relaxed text-zinc-500">
                        {suggestion?.evidenceBindingVersion
                          ? t('resume.selectionPolicyConfirmedEvidence')
                          : t('resume.selectionPolicy')}
                    </div>
                  )}
                  <div className="p-4">
                    {loading ? (
                      <div className="flex items-center gap-2 text-sm text-zinc-500">
                        <Loader2 size={14} className="animate-spin" />
                        {t('resume.loadingMaterials')}
                      </div>
                    ) : parsedSuggestions.length ? (
                      <div className="space-y-2">
                        {parsedSuggestions.map((item) => {
                          const evidence = evidenceById.get(item.id);
                          const eligibleForDraft = isEligibleForDraft(evidence, item.risk, suggestion?.evidenceBindingVersion);
                          const linkedEvidence = (evidence?.evidenceIds || [])
                            .map((evidenceId) => globalEvidenceById.get(evidenceId))
                            .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
                          const sourceTypes = evidence
                            ? Array.from(new Set((evidence.sources || []).map((source) => evidenceSourceLabel(source.type, t))))
                            : [];
                          const sourceTitle = evidence?.sources?.length
                            ? evidence.sources.map((source) => `${evidenceSourceLabel(source.type, t)} · ${source.field || '-'}：${source.quote || '-'}`).join('\n')
                            : '';
                          const linkedEvidenceTitle = linkedEvidence.length
                            ? linkedEvidence.map((entry) => {
                              const sourceRefs = (entry.sourceRefs || [])
                                .map((source) => `${source.ref || source.type || '-'}：${source.quote || '-'}`)
                                .join('\n');
                              return `${entry.evidenceId} · ${entry.title}${sourceRefs ? `\n${sourceRefs}` : ''}`;
                            }).join('\n\n')
                            : '';
                          return (
                          <button
                            key={item.id}
                            onClick={() => toggleSuggestion(item.id)}
                            className="flex w-full gap-3 rounded border border-zinc-800 bg-zinc-900/40 p-3 text-left transition-colors hover:bg-zinc-900"
                          >
                            <span className="mt-0.5 text-indigo-400">
                              {selectedSuggestionIds.has(item.id) ? <CheckSquare size={15} /> : <Square size={15} />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-xs font-semibold text-zinc-100">{item.id}</span>
                              <span className="mt-1 block text-xs leading-relaxed text-zinc-400">{item.text}</span>
                              {evidence && (
                                <span className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-zinc-500">
                                  <span className="rounded border border-zinc-800 px-1.5 py-0.5">
                                    {t('resume.riskLabel', { risk: riskLabel(evidence.risk || item.risk, t) })}
                                  </span>
                                   <span className="rounded border border-zinc-800 px-1.5 py-0.5" title={sourceTitle}>
                                     {t('resume.evidenceFrom', { sources: sourceTypes.join(' + ') || t('status.unknown') })}
                                   </span>
                                   {evidence.sourceVerified && (
                                     <span className="rounded border border-emerald-900/70 bg-emerald-950/30 px-1.5 py-0.5 text-emerald-300">
                                       {t('resume.sourceVerified')}
                                     </span>
                                   )}
                                   {linkedEvidence.map((entry) => (
                                     <span
                                       key={entry.evidenceId}
                                       role="button"
                                       tabIndex={0}
                                       onClick={(event) => {
                                         event.stopPropagation();
                                         setSelectedEvidenceId(entry.evidenceId);
                                       }}
                                       onKeyDown={(event) => {
                                         if (event.key !== 'Enter' && event.key !== ' ') return;
                                         event.preventDefault();
                                         event.stopPropagation();
                                         setSelectedEvidenceId(entry.evidenceId);
                                       }}
                                       className="cursor-pointer rounded border border-cyan-900/70 bg-cyan-950/30 px-1.5 py-0.5 text-cyan-300 transition-colors hover:bg-cyan-950/60"
                                       title={linkedEvidenceTitle}
                                     >
                                       {t('resume.evidenceId', { id: entry.evidenceId })}
                                     </span>
                                   ))}
                                   {!eligibleForDraft && (
                                     <span className="rounded border border-amber-900/70 bg-amber-950/20 px-1.5 py-0.5 text-amber-300">
                                       {t('resume.supplementOnly')}
                                     </span>
                                   )}
                                 </span>
                              )}
                            </span>
                          </button>
                          );
                        })}
                      </div>
                    ) : suggestion ? (
                      <div className="space-y-3">
                        <div className="text-xs text-amber-300">{t('resume.noStructuredItems')}</div>
                        <article className={markdownArticleClass()}>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{suggestion.content}</ReactMarkdown>
                        </article>
                      </div>
                    ) : (
                      <div className="text-sm text-zinc-500">{t('resume.noSuggestions')}</div>
                    )}
                  </div>
                </div>

                <div>
                  <div className="mb-1 text-xs text-zinc-500">{t('resume.userNotes')}</div>
                  <textarea
                    value={userNotes}
                    onChange={(event) => setUserNotes(event.target.value)}
                    placeholder={t('resume.userNotesPlaceholder')}
                    className="h-28 w-full resize-none rounded border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-300 outline-none focus:border-indigo-600"
                  />
                </div>

                <button
                  onClick={generateDraft}
                  disabled={!selectedItem.resumeSuggestionPath || isDrafting}
                  className="inline-flex items-center gap-2 rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
                >
                  {isDrafting ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
                  {t('resume.generateResume')}
                </button>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                {t('resume.selectJob')}
              </div>
            )}
          </section>

          <section className="min-w-0 overflow-y-auto p-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <FileText size={14} className="text-emerald-400" />
              {t('resume.tailoredDraft')}
            </div>
            {draft ? (
              <div className="space-y-3">
                <div className="break-all rounded border border-zinc-800 bg-zinc-950 p-3 text-[10px] text-zinc-500">
                  {draft.draftPath}
                </div>
                {draftEvidenceIds.length > 0 && (
                  <div className="rounded border border-cyan-900/60 bg-cyan-950/15 p-3 text-xs text-zinc-300">
                    <div className="mb-2 font-medium text-cyan-200">{t('resume.draftEvidence')}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {draftEvidenceIds.map((evidenceId) => {
                        const evidence = globalEvidenceById.get(evidenceId);
                        const sourceRefs = (evidence?.sourceRefs || [])
                          .map((source) => `${source.ref || source.type || '-'}：${source.quote || '-'}`)
                          .join('\n');
                        return (
                          <button
                            key={evidenceId}
                            type="button"
                            onClick={() => setSelectedEvidenceId(evidenceId)}
                            className="rounded border border-cyan-900/70 px-1.5 py-0.5 text-[10px] text-cyan-200 transition-colors hover:bg-cyan-950/50"
                            title={`${evidence?.title || evidenceId}${sourceRefs ? `\n${sourceRefs}` : ''}`}
                          >
                            {t('resume.evidenceId', { id: evidenceId })}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <article className={markdownArticleClass('emerald')}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft.content}</ReactMarkdown>
                </article>
              </div>
            ) : selectedItem?.resumeDraftPath ? (
              <div className="text-sm text-zinc-500">{t('resume.loadingDraft')}</div>
            ) : (
              <div className="rounded border border-dashed border-zinc-800 bg-zinc-950 p-5 text-sm leading-relaxed text-zinc-500">
                {t('resume.noDraftYet')}
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
