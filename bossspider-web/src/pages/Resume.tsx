import { BookOpenText, CheckSquare, FileText, Loader2, RefreshCw, Square, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ResumeDraftResponse, ResumeItem, ResumeSuggestionResponse } from '../types';

type ParsedSuggestion = {
  id: string;
  text: string;
  risk: string;
};

function parseSuggestionItems(content: string): ParsedSuggestion[] {
  const items: ParsedSuggestion[] = [];
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    const match = line.match(/^[-*]\s+\[[ xX]\]\s*(?:\*\*)?(S[\w-]+)(?:\*\*)?\s*[｜|]\s*(.+)$/);
    if (!match) continue;
    const [, id, body] = match;
    const text = body.replace(/\*\*/g, '').trim();
    const parts = text.split(/[｜|]/).map((part) => part.trim()).filter(Boolean);
    const risk = (parts[parts.length - 1] || '').replace(/[（）()]/g, '');
    items.push({ id, text, risk });
  }
  return items;
}

function markdownArticleClass(accent: 'indigo' | 'emerald' = 'indigo') {
  const code = accent === 'emerald' ? 'text-emerald-300' : 'text-indigo-300';
  return `max-w-none text-sm leading-7 text-zinc-300 [&_h1]:mb-5 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-zinc-100 [&_h2]:mb-3 [&_h2]:mt-8 [&_h2]:border-b [&_h2]:border-zinc-800 [&_h2]:pb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-zinc-100 [&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:font-semibold [&_h3]:text-zinc-100 [&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_strong]:text-zinc-100 [&_code]:rounded [&_code]:bg-zinc-900 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:${code} [&_pre]:my-4 [&_pre]:overflow-auto [&_pre]:rounded [&_pre]:border [&_pre]:border-zinc-800 [&_pre]:bg-zinc-900 [&_pre]:p-4 [&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-zinc-800 [&_th]:bg-zinc-900 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-zinc-100 [&_td]:border [&_td]:border-zinc-800 [&_td]:px-3 [&_td]:py-2`;
}

export function Resume({
  items,
  draftingKeys,
  onRefresh,
  onLoadSuggestion,
  onLoadDraft,
  onGenerateDraft,
}: {
  items: ResumeItem[];
  draftingKeys: string[];
  onRefresh: () => void;
  onLoadSuggestion: (sourceKey: string) => Promise<ResumeSuggestionResponse | null>;
  onLoadDraft: (sourceKey: string) => Promise<ResumeDraftResponse | null>;
  onGenerateDraft: (sourceKey: string, approvedSuggestionIds: string[], userNotes: string) => Promise<ResumeDraftResponse | null>;
}) {
  const [selectedKey, setSelectedKey] = useState('');
  const [suggestion, setSuggestion] = useState<ResumeSuggestionResponse | null>(null);
  const [draft, setDraft] = useState<ResumeDraftResponse | null>(null);
  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState<Set<string>>(new Set());
  const [userNotes, setUserNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const draftingSet = new Set(draftingKeys);

  const selectedItem = useMemo(
    () => items.find((item) => item.sourceKey === selectedKey) || items[0] || null,
    [items, selectedKey],
  );
  const parsedSuggestions = useMemo(() => parseSuggestionItems(suggestion?.content || ''), [suggestion]);
  const allSelected = parsedSuggestions.length > 0 && parsedSuggestions.every((item) => selectedSuggestionIds.has(item.id));
  const isDrafting = selectedItem ? draftingSet.has(selectedItem.sourceKey) : false;

  useEffect(() => {
    if (!selectedKey && items[0]) setSelectedKey(items[0].sourceKey);
  }, [items, selectedKey]);

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
        const parsed = parseSuggestionItems(suggestionData?.content || '');
        setSelectedSuggestionIds(new Set(parsed.map((item) => item.id)));
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
          <h2 className="text-lg font-semibold text-zinc-100">Resume</h2>
          <p className="text-xs text-zinc-500">
            {items.length.toLocaleString()} jobs with resume materials
          </p>
        </div>
        <button
          onClick={onRefresh}
          className="inline-flex items-center gap-2 rounded border border-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-300 hover:bg-zinc-900 transition-colors"
        >
          <RefreshCw size={14} />
          Refresh
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
                {item.resumeSuggestionPath && <span className="rounded bg-indigo-950/60 px-1.5 py-0.5 text-[10px] text-indigo-300">Suggestions</span>}
                {item.resumeDraftPath && <span className="rounded bg-emerald-950/60 px-1.5 py-0.5 text-[10px] text-emerald-300">Draft</span>}
                {item.llmScore && <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300">{item.llmScore.toFixed(1)}</span>}
              </div>
            </button>
          )) : (
            <div className="p-4 text-sm text-zinc-500">
              No resume suggestions yet. Generate suggestions from Pipeline first.
            </div>
          )}
        </aside>

        <main className="grid min-w-0 flex-1 grid-cols-2 overflow-hidden">
          <section className="min-w-0 overflow-y-auto border-r border-zinc-800 p-5">
            {selectedItem ? (
              <div className="space-y-5">
                <div>
                  <div className="text-xs text-zinc-500">Target job</div>
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
                      Suggestions
                    </div>
                    {parsedSuggestions.length > 0 && (
                      <button onClick={toggleAll} className="text-xs text-indigo-400 hover:text-indigo-300">
                        {allSelected ? 'Clear all' : 'Select all'}
                      </button>
                    )}
                  </div>
                  <div className="p-4">
                    {loading ? (
                      <div className="flex items-center gap-2 text-sm text-zinc-500">
                        <Loader2 size={14} className="animate-spin" />
                        Loading materials
                      </div>
                    ) : parsedSuggestions.length ? (
                      <div className="space-y-2">
                        {parsedSuggestions.map((item) => (
                          <button
                            key={item.id}
                            onClick={() => toggleSuggestion(item.id)}
                            className="flex w-full gap-3 rounded border border-zinc-800 bg-zinc-900/40 p-3 text-left hover:bg-zinc-900 transition-colors"
                          >
                            <span className="mt-0.5 text-indigo-400">
                              {selectedSuggestionIds.has(item.id) ? <CheckSquare size={15} /> : <Square size={15} />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-xs font-semibold text-zinc-100">{item.id}</span>
                              <span className="mt-1 block text-xs leading-relaxed text-zinc-400">{item.text}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : suggestion ? (
                      <div className="space-y-3">
                        <div className="text-xs text-amber-300">No structured S-items detected. Draft generation can still use the full suggestions.</div>
                        <article className={markdownArticleClass()}>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{suggestion.content}</ReactMarkdown>
                        </article>
                      </div>
                    ) : (
                      <div className="text-sm text-zinc-500">No suggestions found for this job.</div>
                    )}
                  </div>
                </div>

                <div>
                  <div className="mb-1 text-xs text-zinc-500">User notes</div>
                  <textarea
                    value={userNotes}
                    onChange={(event) => setUserNotes(event.target.value)}
                    placeholder="补充你确认过的事实、想强调的项目或需要避开的内容..."
                    className="h-28 w-full resize-none rounded border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-300 outline-none focus:border-indigo-600"
                  />
                </div>

                <button
                  onClick={generateDraft}
                  disabled={!selectedItem.resumeSuggestionPath || isDrafting}
                  className="inline-flex items-center gap-2 rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
                >
                  {isDrafting ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
                  Generate tailored resume
                </button>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                Select a job to start.
              </div>
            )}
          </section>

          <section className="min-w-0 overflow-y-auto p-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <FileText size={14} className="text-emerald-400" />
              Tailored Draft
            </div>
            {draft ? (
              <div className="space-y-3">
                <div className="break-all rounded border border-zinc-800 bg-zinc-950 p-3 text-[10px] text-zinc-500">
                  {draft.draftPath}
                </div>
                <article className={markdownArticleClass('emerald')}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft.content}</ReactMarkdown>
                </article>
              </div>
            ) : selectedItem?.resumeDraftPath ? (
              <div className="text-sm text-zinc-500">Loading existing draft...</div>
            ) : (
              <div className="rounded border border-dashed border-zinc-800 bg-zinc-950 p-5 text-sm leading-relaxed text-zinc-500">
                No tailored resume yet. Select suggestions and generate a Markdown draft.
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
