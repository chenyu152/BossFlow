import { BookOpenText, BrainCircuit, FileText, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { InterviewItem, InterviewPrepResponse, InterviewStoryBankResponse } from '../types';

function markdownArticleClass() {
  return 'max-w-none text-sm leading-7 text-zinc-300 [&_h1]:mb-5 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-zinc-100 [&_h2]:mb-3 [&_h2]:mt-8 [&_h2]:border-b [&_h2]:border-zinc-800 [&_h2]:pb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-zinc-100 [&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:font-semibold [&_h3]:text-zinc-100 [&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_strong]:text-zinc-100 [&_code]:rounded [&_code]:bg-zinc-900 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-cyan-300 [&_pre]:my-4 [&_pre]:overflow-auto [&_pre]:rounded [&_pre]:border [&_pre]:border-zinc-800 [&_pre]:bg-zinc-900 [&_pre]:p-4 [&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-zinc-800 [&_th]:bg-zinc-900 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-zinc-100 [&_td]:border [&_td]:border-zinc-800 [&_td]:px-3 [&_td]:py-2';
}

export function Interview({
  items,
  preparingKeys,
  onRefresh,
  onLoadStoryBank,
  onLoadPrep,
  onGeneratePrep,
}: {
  items: InterviewItem[];
  preparingKeys: string[];
  onRefresh: () => void;
  onLoadStoryBank: () => Promise<InterviewStoryBankResponse | null>;
  onLoadPrep: (sourceKey: string) => Promise<InterviewPrepResponse | null>;
  onGeneratePrep: (sourceKey: string, userNotes: string) => Promise<InterviewPrepResponse | null>;
}) {
  const [selectedKey, setSelectedKey] = useState('');
  const [storyBank, setStoryBank] = useState<InterviewStoryBankResponse | null>(null);
  const [prep, setPrep] = useState<InterviewPrepResponse | null>(null);
  const [userNotes, setUserNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const preparingSet = new Set(preparingKeys);

  const selectedItem = useMemo(
    () => items.find((item) => item.sourceKey === selectedKey) || items[0] || null,
    [items, selectedKey],
  );
  const isPreparing = selectedItem ? preparingSet.has(selectedItem.sourceKey) : false;

  useEffect(() => {
    if (!selectedKey && items[0]) setSelectedKey(items[0].sourceKey);
  }, [items, selectedKey]);

  useEffect(() => {
    let cancelled = false;
    const loadStoryBank = async () => {
      const data = await onLoadStoryBank();
      if (!cancelled) setStoryBank(data);
    };
    void loadStoryBank();
    return () => {
      cancelled = true;
    };
  }, [onLoadStoryBank]);

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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Interview</h2>
          <p className="text-xs text-zinc-500">
            {items.length.toLocaleString()} jobs with evaluation or resume materials
          </p>
        </div>
        <button
          onClick={onRefresh}
          className="inline-flex items-center gap-2 rounded border border-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-900"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden rounded-md border border-zinc-800 bg-zinc-900/20">
        <aside className="w-80 shrink-0 overflow-y-auto border-r border-zinc-800 bg-zinc-950">
          {items.length ? items.map((item) => (
            <button
              key={item.sourceKey}
              onClick={() => setSelectedKey(item.sourceKey)}
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
              No interview-ready jobs yet. Generate an LLM report or resume suggestions from Pipeline first.
            </div>
          )}
        </aside>

        <main className="grid min-w-0 flex-1 grid-cols-[minmax(340px,0.42fr)_minmax(480px,0.58fr)] overflow-hidden">
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
                  <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3 text-sm font-semibold text-zinc-100">
                    <BookOpenText size={14} className="text-cyan-400" />
                    Story Bank
                  </div>
                  <div className="space-y-3 p-4">
                    <div className="break-all rounded border border-zinc-800 bg-zinc-900/50 p-3 text-[10px] text-zinc-500">
                      {storyBank?.path || 'Loading story bank...'}
                    </div>
                    {storyBank?.stories.length ? (
                      <div className="space-y-2">
                        {storyBank.stories.map((story) => (
                          <div key={`${story.theme}-${story.title}`} className="rounded border border-zinc-800 bg-zinc-900/40 p-3">
                            <div className="text-sm font-medium text-zinc-100">{story.title}</div>
                            <div className="mt-1 text-xs text-zinc-500">{story.theme || 'General'}{story.source ? ` · ${story.source}` : ''}</div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {story.tags.map((tag) => (
                                <span key={tag} className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300">{tag}</span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded border border-dashed border-zinc-800 bg-zinc-900/30 p-4 text-sm leading-relaxed text-zinc-500">
                        Story bank is empty. You can add STAR+R stories to the Markdown file above; generated prep will still use cv.md and mark missing stories.
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <div className="mb-1 text-xs text-zinc-500">Prep notes</div>
                  <textarea
                    value={userNotes}
                    onChange={(event) => setUserNotes(event.target.value)}
                    placeholder="补充面试轮次、已知面试官、想重点准备或避开的内容..."
                    className="h-28 w-full resize-none rounded border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-300 outline-none focus:border-cyan-600"
                  />
                </div>

                <button
                  onClick={generatePrep}
                  disabled={isPreparing}
                  className="inline-flex items-center gap-2 rounded bg-cyan-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isPreparing ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                  Generate interview prep
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
              <BrainCircuit size={14} className="text-cyan-400" />
              Interview Prep
            </div>
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-zinc-500">
                <Loader2 size={14} className="animate-spin" />
                Loading prep
              </div>
            ) : prep ? (
              <div className="space-y-3">
                <div className="break-all rounded border border-zinc-800 bg-zinc-950 p-3 text-[10px] text-zinc-500">
                  {prep.prepPath}
                </div>
                <article className={markdownArticleClass()}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{prep.content}</ReactMarkdown>
                </article>
              </div>
            ) : selectedItem?.interviewPrepPath ? (
              <div className="text-sm text-zinc-500">Loading existing prep...</div>
            ) : (
              <div className="rounded border border-dashed border-zinc-800 bg-zinc-950 p-5 text-sm leading-relaxed text-zinc-500">
                <div className="mb-2 flex items-center gap-2 font-medium text-zinc-300">
                  <FileText size={14} />
                  No interview prep yet
                </div>
                Generate a Markdown prep doc from the JD, LLM report, resume draft, cv.md, and story bank. Company web research and mock interview mode are reserved for the next phases.
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
