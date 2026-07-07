import { BookOpenText, BrainCircuit, FileText, Loader2, Plus, RefreshCw, Save, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { InterviewItem, InterviewPrepResponse, InterviewStory, InterviewStoryBankResponse } from '../types';

function markdownArticleClass() {
  return 'max-w-none text-sm leading-7 text-zinc-300 [&_h1]:mb-5 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-zinc-100 [&_h2]:mb-3 [&_h2]:mt-8 [&_h2]:border-b [&_h2]:border-zinc-800 [&_h2]:pb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-zinc-100 [&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:font-semibold [&_h3]:text-zinc-100 [&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_strong]:text-zinc-100 [&_code]:rounded [&_code]:bg-zinc-900 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-cyan-300 [&_pre]:my-4 [&_pre]:overflow-auto [&_pre]:rounded [&_pre]:border [&_pre]:border-zinc-800 [&_pre]:bg-zinc-900 [&_pre]:p-4 [&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-zinc-800 [&_th]:bg-zinc-900 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-zinc-100 [&_td]:border [&_td]:border-zinc-800 [&_td]:px-3 [&_td]:py-2';
}

const emptyStory = (title = ''): InterviewStory => ({
  id: `draft-${Date.now()}`,
  title,
  theme: '',
  source: '',
  tags: [],
  situation: '',
  task: '',
  action: '',
  result: '',
  reflection: '',
});

function splitMarkdownTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim().replace(/\*\*/g, ''));
}

function sectionLines(content: string, headingPattern: RegExp): string[] {
  const lines = content.split(/\r?\n/);
  const section: string[] = [];
  let inSection = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (headingPattern.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && /^##\s+/.test(line)) break;
    if (!inSection) continue;
    section.push(raw);
  }
  return section;
}

function extractStoryDraftsFromPrep(content: string): InterviewStory[] {
  const drafts: InterviewStory[] = [];

  for (const raw of sectionLines(content, /^##\s+C[.、\s]/)) {
    const line = raw.trim();
    if (!line.startsWith('|') || /^[-|\s]+$/.test(line) || line.includes('问题/能力点')) continue;
    const [theme, title, why, angle, risk] = splitMarkdownTableRow(line);
    if (!title || title === '推荐故事') continue;
    drafts.push({
      ...emptyStory(title),
      theme: theme || 'CV 可沉淀故事',
      source: '由面试准备 C. 故事库匹配生成，需用户确认',
      tags: [theme].filter(Boolean),
      situation: why ? `待确认匹配背景：${why}` : '',
      task: angle ? `待调整角度：${angle}` : '',
      action: title,
      result: '',
      reflection: risk ? `风险/需补证据：${risk}` : '',
    });
  }

  let current: InterviewStory | null = null;
  for (const raw of sectionLines(content, /^##\s+D[.、\s]/)) {
    const line = raw.trim();
    const heading = line.match(/^###\s+\d+[.、]\s*(.+)$/);
    if (heading) {
      if (current) drafts.push(current);
      current = {
        ...emptyStory(heading[1].replace(/\*\*/g, '').trim()),
        theme: '缺失故事',
        source: '由面试准备 D. 缺失故事生成，需用户确认',
        tags: ['gap', heading[1].replace(/\*\*/g, '').trim()].filter(Boolean),
      };
      continue;
    }
    if (!current) continue;
    const why = line.match(/^[-*]\s+\*\*为什么可能问\*\*[：:]\s*(.+)$/);
    const evidence = line.match(/^[-*]\s+\*\*可从哪些已有经历挖\*\*[：:]\s*(.+)$/);
    const facts = line.match(/^[-*]\s+\*\*需补充事实\*\*[：:]\s*(.+)$/);
    if (why) current.situation = `为什么可能问：${why[1].trim()}`;
    if (evidence) current.action = `可挖经历：${evidence[1].trim()}`;
    if (facts) current.reflection = `需补充事实：${facts[1].trim()}`;
  }
  if (current) drafts.push(current);

  const seen = new Set<string>();
  return drafts.filter((draft) => {
    const key = `${draft.theme}|${draft.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return draft.title.length > 2;
  }).slice(0, 12);
}

export function Interview({
  items,
  preparingKeys,
  onRefresh,
  onLoadStoryBank,
  onSaveStoryBank,
  onLoadPrep,
  onGeneratePrep,
}: {
  items: InterviewItem[];
  preparingKeys: string[];
  onRefresh: () => void;
  onLoadStoryBank: () => Promise<InterviewStoryBankResponse | null>;
  onSaveStoryBank: (stories: InterviewStory[]) => Promise<InterviewStoryBankResponse | null>;
  onLoadPrep: (sourceKey: string) => Promise<InterviewPrepResponse | null>;
  onGeneratePrep: (sourceKey: string, userNotes: string) => Promise<InterviewPrepResponse | null>;
}) {
  const [selectedKey, setSelectedKey] = useState('');
  const [storyBank, setStoryBank] = useState<InterviewStoryBankResponse | null>(null);
  const [prep, setPrep] = useState<InterviewPrepResponse | null>(null);
  const [userNotes, setUserNotes] = useState('');
  const [selectedStoryIndex, setSelectedStoryIndex] = useState(0);
  const [storyDraft, setStoryDraft] = useState<InterviewStory>(emptyStory());
  const [storyDirty, setStoryDirty] = useState(false);
  const [storySaving, setStorySaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const preparingSet = new Set(preparingKeys);

  const selectedItem = useMemo(
    () => items.find((item) => item.sourceKey === selectedKey) || items[0] || null,
    [items, selectedKey],
  );
  const isPreparing = selectedItem ? preparingSet.has(selectedItem.sourceKey) : false;
  const stories = storyBank?.stories || [];
  const prepStoryDrafts = useMemo(() => extractStoryDraftsFromPrep(prep?.content || ''), [prep]);

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
    const story = stories[selectedStoryIndex];
    setStoryDraft(story ? { ...story, tags: [...story.tags] } : emptyStory());
    setStoryDirty(false);
  }, [selectedStoryIndex, stories]);

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

  const updateStoryDraft = (patch: Partial<InterviewStory>) => {
    setStoryDraft((current) => ({ ...current, ...patch }));
    setStoryDirty(true);
  };

  const addStory = (story?: Partial<InterviewStory> | string) => {
    const draft = typeof story === 'string'
      ? { ...emptyStory(story), theme: story ? '待补充' : '', source: selectedItem ? `${selectedItem.company} · ${selectedItem.title}` : '' }
      : { ...emptyStory(), source: selectedItem ? `${selectedItem.company} · ${selectedItem.title}` : '', ...(story || {}) };
    const next = [...stories, draft];
    setStoryBank((current) => current ? { ...current, stories: next } : current);
    setSelectedStoryIndex(next.length - 1);
    setStoryDirty(true);
  };

  const deleteStory = () => {
    if (!stories.length) return;
    const next = stories.filter((_, index) => index !== selectedStoryIndex);
    setStoryBank((current) => current ? { ...current, stories: next } : current);
    setSelectedStoryIndex(Math.max(0, selectedStoryIndex - 1));
    setStoryDirty(true);
  };

  const saveStoryBank = async () => {
    const next = stories.length
      ? stories.map((story, index) => index === selectedStoryIndex ? storyDraft : story)
      : [storyDraft];
    setStorySaving(true);
    try {
      const data = await onSaveStoryBank(next);
      if (data) {
        setStoryBank(data);
        setSelectedStoryIndex(Math.min(selectedStoryIndex, Math.max(0, data.stories.length - 1)));
        setStoryDirty(false);
      }
    } finally {
      setStorySaving(false);
    }
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
                  <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                      <BookOpenText size={14} className="text-cyan-400" />
                      Story Bank
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => addStory()}
                        className="inline-flex items-center gap-1.5 rounded border border-zinc-800 px-2 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-900"
                      >
                        <Plus size={12} />
                        New
                      </button>
                      <button
                        onClick={saveStoryBank}
                        disabled={storySaving || !storyDraft.title.trim()}
                        className="inline-flex items-center gap-1.5 rounded bg-cyan-700 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {storySaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                        Save
                      </button>
                    </div>
                  </div>
                  <div className="space-y-3 p-4">
                    <div className="break-all rounded border border-zinc-800 bg-zinc-900/50 p-3 text-[10px] text-zinc-500">
                      {storyBank?.path || 'Loading story bank...'}
                    </div>

                    {stories.length ? (
                      <div className="flex gap-3">
                        <div className="w-40 shrink-0 space-y-1">
                          {stories.map((story, index) => (
                            <button
                              key={story.id || `${story.theme}-${story.title}-${index}`}
                              onClick={() => setSelectedStoryIndex(index)}
                              className={`block w-full rounded border px-2 py-2 text-left text-xs transition-colors ${index === selectedStoryIndex ? 'border-cyan-700 bg-cyan-950/30 text-cyan-200' : 'border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:bg-zinc-900'}`}
                            >
                              <div className="truncate font-medium">{story.title || 'Untitled story'}</div>
                              <div className="mt-0.5 truncate text-[10px] text-zinc-500">{story.theme || 'General'}</div>
                            </button>
                          ))}
                        </div>
                        <div className="min-w-0 flex-1 space-y-3">
                          <div className="grid grid-cols-2 gap-2">
                            <label className="space-y-1">
                              <span className="text-[10px] uppercase text-zinc-500">Title</span>
                              <input
                                value={storyDraft.title}
                                onChange={(event) => updateStoryDraft({ title: event.target.value })}
                                className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-cyan-600"
                              />
                            </label>
                            <label className="space-y-1">
                              <span className="text-[10px] uppercase text-zinc-500">Theme</span>
                              <input
                                value={storyDraft.theme}
                                onChange={(event) => updateStoryDraft({ theme: event.target.value })}
                                className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-cyan-600"
                              />
                            </label>
                          </div>
                          <label className="block space-y-1">
                            <span className="text-[10px] uppercase text-zinc-500">Tags</span>
                            <input
                              value={storyDraft.tags.join(', ')}
                              onChange={(event) => updateStoryDraft({ tags: event.target.value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean) })}
                              placeholder="ownership, ambiguity, collaboration"
                              className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-cyan-600"
                            />
                          </label>
                          <label className="block space-y-1">
                            <span className="text-[10px] uppercase text-zinc-500">Source</span>
                            <input
                              value={storyDraft.source}
                              onChange={(event) => updateStoryDraft({ source: event.target.value })}
                              className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-cyan-600"
                            />
                          </label>
                          {[
                            ['situation', 'S - Situation'],
                            ['task', 'T - Task'],
                            ['action', 'A - Action'],
                            ['result', 'R - Result'],
                            ['reflection', 'Reflection'],
                          ].map(([key, label]) => (
                            <label key={key} className="block space-y-1">
                              <span className="text-[10px] uppercase text-zinc-500">{label}</span>
                              <textarea
                                value={String(storyDraft[key as keyof InterviewStory] || '')}
                                onChange={(event) => updateStoryDraft({ [key]: event.target.value } as Partial<InterviewStory>)}
                                className="h-16 w-full resize-none rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs leading-relaxed text-zinc-200 outline-none focus:border-cyan-600"
                              />
                            </label>
                          ))}
                          <div className="flex items-center justify-between">
                            <div className="text-[10px] text-zinc-500">
                              {storyDirty ? 'Unsaved changes' : 'Saved version loaded'}
                            </div>
                            <button
                              onClick={deleteStory}
                              className="inline-flex items-center gap-1.5 rounded border border-red-950/70 px-2 py-1 text-xs text-red-300 transition-colors hover:bg-red-950/30"
                            >
                              <Trash2 size={12} />
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded border border-dashed border-zinc-800 bg-zinc-900/30 p-4 text-sm leading-relaxed text-zinc-500">
                        Story bank is empty. Add a STAR+R story here, then save it to Markdown for future interview prep.
                      </div>
                    )}

                    {prepStoryDrafts.length > 0 && (
                      <div className="rounded border border-zinc-800 bg-zinc-900/30 p-3">
                        <div className="mb-2 text-xs font-medium text-zinc-300">Draft stories from this prep</div>
                        <div className="flex flex-wrap gap-1.5">
                          {prepStoryDrafts.map((draft) => (
                            <button
                              key={`${draft.theme}-${draft.title}`}
                              onClick={() => addStory(draft)}
                              className="rounded border border-zinc-800 px-2 py-1 text-[10px] text-zinc-300 transition-colors hover:border-cyan-700 hover:text-cyan-200"
                              title={draft.theme}
                            >
                              + {draft.title}
                            </button>
                          ))}
                        </div>
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
