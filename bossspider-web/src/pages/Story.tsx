import { BookOpenText, CheckCircle2, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppTranslation } from '../i18n';
import { emptyStory } from '../storyUtils';
import type { InterviewStory, InterviewStoryBankResponse, InterviewStoryDraft, InterviewStoryDraftsResponse } from '../types';

type StoryMode = 'drafts' | 'confirmed';
const STORY_DRAFT_TRANSFER_KEY = 'bossspider:story-draft-transfer';

function newDraftFromStory(story: InterviewStory): InterviewStoryDraft {
  const now = new Date().toISOString();
  return {
    ...story,
    draftId: `draft-${Date.now()}`,
    status: 'needs_confirmation',
    sourceKey: '',
    sourceLabel: story.source || 'Interview prep',
    prepPath: '',
    createdAt: now,
    updatedAt: now,
  };
}

function storyFromDraft(draft: InterviewStoryDraft): InterviewStory {
  return {
    id: draft.id,
    title: draft.title,
    theme: draft.theme,
    source: draft.source,
    tags: draft.tags,
    situation: draft.situation,
    task: draft.task,
    action: draft.action,
    result: draft.result,
    reflection: draft.reflection,
  };
}

function emptyDraft(): InterviewStoryDraft {
  return newDraftFromStory(emptyStory());
}

function visibleDrafts(drafts: InterviewStoryDraft[]) {
  return drafts.filter((draft) => draft.status !== 'dismissed' && draft.status !== 'promoted');
}

function statusLabel(t: (key: string) => string, status: InterviewStoryDraft['status']) {
  if (status === 'ready') return t('story.ready');
  if (status === 'editing') return t('story.editing');
  if (status === 'promoted') return t('story.promoted');
  if (status === 'dismissed') return t('story.dismissed');
  return t('story.needsConfirmation');
}

export function Story({
  onLoadStoryBank,
  onSaveStoryBank,
  onLoadStoryDrafts,
  onSaveStoryDrafts,
  incomingDraft,
  onIncomingDraftConsumed,
}: {
  onLoadStoryBank: () => Promise<InterviewStoryBankResponse | null>;
  onSaveStoryBank: (stories: InterviewStory[]) => Promise<InterviewStoryBankResponse | null>;
  onLoadStoryDrafts: () => Promise<InterviewStoryDraftsResponse | null>;
  onSaveStoryDrafts: (drafts: InterviewStoryDraft[]) => Promise<InterviewStoryDraftsResponse | null>;
  incomingDraft?: InterviewStory | null;
  onIncomingDraftConsumed?: () => void;
}) {
  const { t } = useAppTranslation();
  const [mode, setMode] = useState<StoryMode>('drafts');
  const [storyBank, setStoryBank] = useState<InterviewStoryBankResponse | null>(null);
  const [draftStore, setDraftStore] = useState<InterviewStoryDraftsResponse | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [storyDraft, setStoryDraft] = useState<InterviewStory>(emptyStory());
  const [draftMeta, setDraftMeta] = useState<InterviewStoryDraft>(emptyDraft());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pendingIncomingDraftId, setPendingIncomingDraftId] = useState('');
  const pendingIncomingDraftRef = useRef<InterviewStoryDraft | null>(null);

  const stories = storyBank?.stories || [];
  const drafts = useMemo(() => visibleDrafts(draftStore?.drafts || []), [draftStore]);
  const activeList = mode === 'drafts' ? drafts : stories;

  const queueIncomingDraft = (story: InterviewStory) => {
    const draft = newDraftFromStory(story);
    pendingIncomingDraftRef.current = draft;
    setMode('drafts');
    setPendingIncomingDraftId(draft.draftId);
    setStoryDraft(storyFromDraft(draft));
    setDraftMeta(draft);
    setDirty(false);
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [bank, draftData] = await Promise.all([onLoadStoryBank(), onLoadStoryDrafts()]);
        if (cancelled) return;
        setStoryBank(bank);
        setDraftStore(draftData);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [onLoadStoryBank, onLoadStoryDrafts]);

  useEffect(() => {
    if (pendingIncomingDraftId) return;
    if (mode === 'drafts') {
      const draft = drafts[selectedIndex];
      setDraftMeta(draft ? { ...draft, tags: [...draft.tags] } : emptyDraft());
      setStoryDraft(draft ? storyFromDraft(draft) : emptyStory());
    } else {
      const story = stories[selectedIndex];
      setStoryDraft(story ? { ...story, tags: [...story.tags] } : emptyStory());
      setDraftMeta(emptyDraft());
    }
    setDirty(false);
  }, [drafts, mode, pendingIncomingDraftId, selectedIndex, stories]);

  useEffect(() => {
    if (!incomingDraft || pendingIncomingDraftRef.current) return;
    window.sessionStorage.removeItem(STORY_DRAFT_TRANSFER_KEY);
    onIncomingDraftConsumed?.();
    queueIncomingDraft(incomingDraft);
  }, [incomingDraft, onIncomingDraftConsumed]);

  useEffect(() => {
    if (incomingDraft || pendingIncomingDraftRef.current) return;
    const raw = window.sessionStorage.getItem(STORY_DRAFT_TRANSFER_KEY);
    if (!raw) return;
    window.sessionStorage.removeItem(STORY_DRAFT_TRANSFER_KEY);
    try {
      queueIncomingDraft(JSON.parse(raw) as InterviewStory);
    } catch {
      // Ignore malformed handoff data.
    }
  }, [incomingDraft]);

  useEffect(() => {
    const draft = pendingIncomingDraftRef.current;
    if (!draft || !draftStore) return;
    pendingIncomingDraftRef.current = null;

    const persistIncomingDraft = async () => {
      const existing = draftStore.drafts || [];
      const next = existing.some((item) => item.draftId === draft.draftId)
        ? existing.map((item) => item.draftId === draft.draftId ? draft : item)
        : [...existing, draft];
      const optimisticStore = { ...draftStore, drafts: next };

      setDraftStore(optimisticStore);
      const optimisticVisible = visibleDrafts(next);
      const optimisticIndex = optimisticVisible.findIndex((item) => item.draftId === draft.draftId);
      setSelectedIndex(optimisticIndex >= 0 ? optimisticIndex : Math.max(0, optimisticVisible.length - 1));

      const saved = await onSaveStoryDrafts(next);
      if (saved) {
        setDraftStore(saved);
        const visible = visibleDrafts(saved.drafts);
        const savedIndex = visible.findIndex((item) => item.draftId === draft.draftId);
        setSelectedIndex(savedIndex >= 0 ? savedIndex : Math.max(0, visible.length - 1));
      }
      setPendingIncomingDraftId('');
    };
    void persistIncomingDraft();
  }, [draftStore, onSaveStoryDrafts]);

  const switchMode = (nextMode: StoryMode) => {
    setMode(nextMode);
    setSelectedIndex(0);
  };

  const updateStoryDraft = (patch: Partial<InterviewStory>) => {
    setStoryDraft((current) => ({ ...current, ...patch }));
    setDirty(true);
  };

  const updateDraftStatus = (status: InterviewStoryDraft['status']) => {
    setDraftMeta((current) => ({ ...current, status }));
    setDirty(true);
  };

  const addItem = () => {
    if (mode === 'drafts') {
      const draft = emptyDraft();
      const next = [...(draftStore?.drafts || []), draft];
      setDraftStore((current) => current ? { ...current, drafts: next } : current);
      setSelectedIndex(drafts.length);
      setStoryDraft(storyFromDraft(draft));
      setDraftMeta(draft);
    } else {
      const next = [...stories, emptyStory()];
      setStoryBank((current) => current ? { ...current, stories: next } : current);
      setSelectedIndex(next.length - 1);
      setStoryDraft(next[next.length - 1]);
    }
    setDirty(true);
  };

  const saveDrafts = async (nextDrafts: InterviewStoryDraft[]) => {
    const data = await onSaveStoryDrafts(nextDrafts);
    if (data) setDraftStore(data);
    return data;
  };

  const saveStories = async (nextStories: InterviewStory[]) => {
    const data = await onSaveStoryBank(nextStories);
    if (data) setStoryBank(data);
    return data;
  };

  const saveCurrent = async () => {
    setSaving(true);
    try {
      if (mode === 'drafts') {
        const current = {
          ...draftMeta,
          ...storyDraft,
          status: draftMeta.status === 'needs_confirmation' ? 'editing' : draftMeta.status,
        };
        const next = (draftStore?.drafts || []).length
          ? (draftStore?.drafts || []).map((draft) => draft.draftId === draftMeta.draftId ? current : draft)
          : [current];
        const data = await saveDrafts(next);
        if (data) {
          const visible = data.drafts.filter((draft) => draft.status !== 'dismissed' && draft.status !== 'promoted');
          const nextIndex = Math.max(0, visible.findIndex((draft) => draft.draftId === current.draftId));
          setSelectedIndex(nextIndex);
        }
      } else {
        const next = stories.length
          ? stories.map((story, index) => index === selectedIndex ? storyDraft : story)
          : [storyDraft];
        const data = await saveStories(next);
        if (data) setSelectedIndex(Math.min(selectedIndex, Math.max(0, data.stories.length - 1)));
      }
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  const deleteCurrent = async () => {
    setSaving(true);
    try {
      if (mode === 'drafts') {
        const next = (draftStore?.drafts || []).map((draft) => (
          draft.draftId === draftMeta.draftId ? { ...draft, status: 'dismissed' as const } : draft
        ));
        await saveDrafts(next);
      } else {
        const next = stories.filter((_, index) => index !== selectedIndex);
        await saveStories(next);
      }
      setSelectedIndex(Math.max(0, selectedIndex - 1));
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  const promoteDraft = async () => {
    if (mode !== 'drafts' || !storyDraft.title.trim()) return;
    setSaving(true);
    try {
      const nextStories = [...stories, storyDraft];
      const savedBank = await saveStories(nextStories);
      if (!savedBank) return;
      const nextDrafts = (draftStore?.drafts || []).map((draft) => (
        draft.draftId === draftMeta.draftId ? { ...draft, ...storyDraft, status: 'promoted' as const } : draft
      ));
      await saveDrafts(nextDrafts);
      setMode('confirmed');
      setSelectedIndex(Math.max(0, nextStories.length - 1));
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  const selectedTitle = mode === 'drafts'
    ? draftMeta.title || t('story.untitledDraft')
    : storyDraft.title || t('story.untitledStory');

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">{t('story.title')}</h2>
          <p className="text-xs text-zinc-500">
            {drafts.length.toLocaleString()} {t('story.draftsCount')} / {stories.length.toLocaleString()} {t('story.confirmedCount')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={addItem}
            className="inline-flex items-center gap-2 rounded border border-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-900"
          >
            <Plus size={14} />
            {mode === 'drafts' ? t('story.newDraft') : t('story.newStory')}
          </button>
          <button
            onClick={saveCurrent}
            disabled={saving || !storyDraft.title.trim()}
            className="inline-flex items-center gap-2 rounded bg-cyan-700 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {mode === 'drafts' ? t('story.saveDraft') : t('story.saveStory')}
          </button>
          {mode === 'drafts' && (
            <button
              onClick={promoteDraft}
              disabled={saving || !storyDraft.title.trim()}
              className="inline-flex items-center gap-2 rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CheckCircle2 size={14} />
              {t('story.promote')}
            </button>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden rounded-md border border-zinc-800 bg-zinc-900/20">
        <aside className="w-80 shrink-0 overflow-y-auto border-r border-zinc-800 bg-zinc-950 p-4">
          <div className="mb-3 grid grid-cols-2 rounded border border-zinc-800 bg-zinc-900/50 p-1">
            <button
              onClick={() => switchMode('drafts')}
              className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${mode === 'drafts' ? 'bg-cyan-700 text-white' : 'text-zinc-400 hover:bg-zinc-900'}`}
            >
              {t('story.drafts')} {drafts.length}
            </button>
            <button
              onClick={() => switchMode('confirmed')}
              className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${mode === 'confirmed' ? 'bg-cyan-700 text-white' : 'text-zinc-400 hover:bg-zinc-900'}`}
            >
              {t('story.confirmed')} {stories.length}
            </button>
          </div>
          <div className="mb-3 break-all rounded border border-zinc-800 bg-zinc-900/50 p-3 text-[10px] text-zinc-500">
            {mode === 'drafts' ? draftStore?.path || t('story.loadingDrafts') : storyBank?.path || t('story.loadingStories')}
          </div>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              <Loader2 size={14} className="animate-spin" />
              {t('story.loadingStoriesShort')}
            </div>
          ) : activeList.length ? (
            <div className="space-y-2">
              {activeList.map((item, index) => {
                const draft = mode === 'drafts' ? item as InterviewStoryDraft : null;
                return (
                  <button
                    key={item.id || `${item.theme}-${item.title}-${index}`}
                    onClick={() => setSelectedIndex(index)}
                    className={`block w-full rounded border px-3 py-3 text-left transition-colors ${index === selectedIndex ? 'border-cyan-700 bg-cyan-950/30 text-cyan-200' : 'border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:bg-zinc-900'}`}
                  >
                    <div className="truncate text-sm font-medium">{item.title || t('story.untitled')}</div>
                    <div className="mt-1 truncate text-xs text-zinc-500">{item.theme || t('story.general')}</div>
                    {draft && (
                      <div className="mt-2 inline-flex rounded bg-amber-950/50 px-1.5 py-0.5 text-[10px] text-amber-300">
                        {statusLabel(t, draft.status)}
                      </div>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {item.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300">{tag}</span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded border border-dashed border-zinc-800 bg-zinc-900/30 p-4 text-sm leading-relaxed text-zinc-500">
              {mode === 'drafts'
                ? t('story.noDraftsYet')
                : t('story.storyBankEmpty')}
            </div>
          )}
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <BookOpenText size={15} className="text-cyan-400" />
              {mode === 'drafts' ? t('story.draftEditor') : t('story.starEditor')}
            </div>
            <div className="truncate text-xs text-zinc-500">{selectedTitle}</div>
          </div>

          {mode === 'drafts' && (
            <div className="mb-4 flex max-w-5xl flex-wrap items-center gap-2 rounded border border-zinc-800 bg-zinc-950 p-3">
              <span className="text-xs text-zinc-500">{t('story.statusLabel')}</span>
              {(['needs_confirmation', 'editing', 'ready'] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => updateDraftStatus(status)}
                  className={`rounded px-2 py-1 text-xs transition-colors ${draftMeta.status === status ? 'bg-amber-900/70 text-amber-200' : 'border border-zinc-800 text-zinc-400 hover:bg-zinc-900'}`}
                >
                  {statusLabel(t, status)}
                </button>
              ))}
            </div>
          )}

          <div className="grid max-w-5xl grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-xs uppercase text-zinc-500">{t('story.titleField')}</span>
              <input
                value={storyDraft.title}
                onChange={(event) => updateStoryDraft({ title: event.target.value })}
                className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-cyan-600"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs uppercase text-zinc-500">{t('story.themeField')}</span>
              <input
                value={storyDraft.theme}
                onChange={(event) => updateStoryDraft({ theme: event.target.value })}
                className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-cyan-600"
              />
            </label>
            <label className="col-span-2 space-y-1">
              <span className="text-xs uppercase text-zinc-500">{t('story.tagsField')}</span>
              <input
                value={storyDraft.tags.join(', ')}
                onChange={(event) => updateStoryDraft({ tags: event.target.value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean) })}
                placeholder={t('story.tagsPlaceholder')}
                className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-cyan-600"
              />
            </label>
            <label className="col-span-2 space-y-1">
              <span className="text-xs uppercase text-zinc-500">{t('story.sourceField')}</span>
              <input
                value={storyDraft.source}
                onChange={(event) => updateStoryDraft({ source: event.target.value })}
                className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-cyan-600"
              />
            </label>
            {([
              ['situation', t('story.sSituation')],
              ['task', t('story.tTask')],
              ['action', t('story.aAction')],
              ['result', t('story.rResult')],
              ['reflection', t('story.reflection')],
            ] as [string, string][]).map(([key, label]) => (
              <label key={key} className="col-span-2 space-y-1">
                <span className="text-xs uppercase text-zinc-500">{label}</span>
                <textarea
                  value={String(storyDraft[key as keyof InterviewStory] || '')}
                  onChange={(event) => updateStoryDraft({ [key]: event.target.value } as Partial<InterviewStory>)}
                  className="h-24 w-full resize-none rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm leading-relaxed text-zinc-200 outline-none focus:border-cyan-600"
                />
              </label>
            ))}
          </div>

          <div className="mt-5 flex max-w-5xl items-center justify-between">
            <div className="text-xs text-zinc-500">
              {dirty ? t('story.unsavedChanges') : t('story.savedVersion')}
            </div>
            <button
              onClick={deleteCurrent}
              disabled={saving || !activeList.length}
              className="inline-flex items-center gap-2 rounded border border-red-950/70 px-3 py-1.5 text-sm text-red-300 transition-colors hover:bg-red-950/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 size={14} />
              {mode === 'drafts' ? t('story.dismiss') : t('story.delete')}
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}
