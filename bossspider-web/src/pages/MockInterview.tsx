import {
  AlertTriangle,
  ArrowLeft,
  BookOpenText,
  CheckCircle2,
  Clock3,
  Flag,
  History,
  Lightbulb,
  Loader2,
  RotateCcw,
  Send,
  SkipForward,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { bossApi } from '../api';
import { useAppTranslation } from '../i18n';
import type {
  InterviewItem,
  MockInterviewDifficulty,
  MockInterviewMode,
  MockInterviewSession,
  MockInterviewSessionSummary,
} from '../types';

type WorkspaceView = 'setup' | 'session' | 'review' | 'history';

const DIMENSION_KEYS = ['relevance', 'evidence', 'specificity', 'structure', 'credibility', 'jobFit'] as const;

function currentTurn(session: MockInterviewSession | null) {
  if (!session?.currentTurnId) return null;
  return session.turns.find((turn) => turn.turnId === session.currentTurnId) || null;
}

function progress(session: MockInterviewSession | null) {
  if (!session) return 0;
  const completed = session.answeredCount + session.skippedCount;
  return Math.min(100, Math.round(completed / Math.max(session.turns.length, 1) * 100));
}

function answerHint(category: string, t: (key: string) => string) {
  if (category === 'project') return t('mockInterview.hints.project');
  if (category === 'behavioral') return t('mockInterview.hints.behavioral');
  if (category === 'technical') return t('mockInterview.hints.technical');
  if (category === 'credibility') return t('mockInterview.hints.credibility');
  if (category === 'candidate_questions') return t('mockInterview.hints.candidateQuestions');
  return t('mockInterview.hints.general');
}

export function MockInterview({
  initialView,
  project,
  item,
  onBack,
  onOpenStoryDraft,
}: {
  initialView: 'setup' | 'history';
  project: string;
  item: InterviewItem | null;
  onBack: () => void;
  onOpenStoryDraft: (draftId: string) => void;
}) {
  const { t } = useAppTranslation();
  const [view, setView] = useState<WorkspaceView>(initialView);
  const [mode, setMode] = useState<MockInterviewMode>('comprehensive');
  const [difficulty, setDifficulty] = useState<MockInterviewDifficulty>('auto');
  const [durationMinutes, setDurationMinutes] = useState<10 | 20 | 30>(20);
  const [userNotes, setUserNotes] = useState('');
  const [session, setSession] = useState<MockInterviewSession | null>(null);
  const [sessions, setSessions] = useState<MockInterviewSessionSummary[]>([]);
  const [answer, setAnswer] = useState('');
  const [assisted, setAssisted] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [selectedCandidates, setSelectedCandidates] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState('');
  const [streamPhase, setStreamPhase] = useState('');
  const [streamedQuestion, setStreamedQuestion] = useState('');
  const answerRef = useRef(answer);
  const activeTurn = useMemo(() => currentTurn(session), [session]);
  const sessionProgress = useMemo(() => progress(session), [session]);

  useEffect(() => {
    answerRef.current = answer;
  }, [answer]);

  useEffect(() => {
    setView(initialView);
    setError('');
    if (initialView === 'setup') {
      setSession(null);
      setAnswer('');
      setAssisted(false);
      setShowHint(false);
      setSelectedCandidates([]);
    }
    const loadHistory = async () => {
      setHistoryLoading(true);
      try {
        const data = await bossApi.getMockInterviewSessions(project);
        setSessions(data.sessions);
      } catch (cause) {
        setError((cause as Error).message);
      } finally {
        setHistoryLoading(false);
      }
    };
    void loadHistory();
  }, [initialView, project]);

  useEffect(() => {
    if (!activeTurn) {
      setAnswer('');
      setAssisted(false);
      setShowHint(false);
      return;
    }
    setAnswer(activeTurn.answerDraft || activeTurn.answer || '');
    setAssisted(activeTurn.assisted);
    setShowHint(activeTurn.assisted);
  }, [activeTurn?.turnId]);

  useEffect(() => {
    if (!session || !activeTurn || session.status !== 'in_progress') return;
    if (answer === (activeTurn.answerDraft || '') && assisted === activeTurn.assisted) return;
    const timer = window.setTimeout(() => {
      void bossApi.saveMockInterviewAnswerDraft(
        project,
        session.sessionId,
        activeTurn.turnId,
        answerRef.current,
        assisted,
      ).catch(() => {
        // The submitted answer path is authoritative. Draft saving is best-effort.
      });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [activeTurn, answer, assisted, project, session]);

  useEffect(() => {
    if (!session || session.status !== 'evaluating') return;
    const poll = window.setInterval(() => {
      void bossApi.getMockInterviewSession(project, session.sessionId).then((data) => {
        setSession(data.session);
        if (data.session.status === 'evaluated' || data.session.status === 'evaluation_failed') {
          setView('review');
          window.clearInterval(poll);
        }
      }).catch((cause) => {
        setError((cause as Error).message);
        window.clearInterval(poll);
      });
    }, 1500);
    return () => window.clearInterval(poll);
  }, [project, session?.sessionId, session?.status]);

  const startSession = async () => {
    if (!item) return;
    setLoading(true);
    setError('');
    try {
      const data = await bossApi.createMockInterviewSession({
        sourceKey: item.sourceKey,
        mode,
        difficulty,
        durationMinutes,
        userNotes,
      });
      setSession(data.session);
      setView('session');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const submitAnswer = async (skipped = false) => {
    if (!session || !activeTurn || (!skipped && !answer.trim())) return;
    const submittedTurnId = activeTurn.turnId;
    setLoading(true);
    setError('');
    try {
      setStreamPhase('answer_saved');
      setStreamedQuestion('');
      const data = skipped
        ? await bossApi.submitMockInterviewAnswer(
            project,
            session.sessionId,
            submittedTurnId,
            '',
            assisted,
            true,
          )
        : await bossApi.submitMockInterviewAnswerStream(
            project,
            session.sessionId,
            submittedTurnId,
            answer,
            assisted,
            false,
            {
              onStatus: setStreamPhase,
              onDelta: (text) => setStreamedQuestion((current) => current + text),
              onWarning: (message) => setError(message),
            },
          );
      setSession(data.session);
      setAnswer('');
      setAssisted(false);
      setShowHint(false);
      setStreamPhase('');
      setStreamedQuestion('');
    } catch (cause) {
      try {
        const refreshed = await bossApi.getMockInterviewSession(project, session.sessionId);
        const submittedTurn = refreshed.session.turns.find((turn) => turn.turnId === submittedTurnId);
        if (submittedTurn && submittedTurn.status !== 'pending') {
          setSession(refreshed.session);
          setAnswer('');
          setAssisted(false);
          setShowHint(false);
          setError(t('mockInterview.streamRecovered'));
        } else {
          setError((cause as Error).message);
        }
      } catch {
        setError((cause as Error).message);
      }
      setStreamPhase('');
      setStreamedQuestion('');
    } finally {
      setLoading(false);
    }
  };

  const finishSession = async () => {
    if (!session) return;
    setLoading(true);
    setError('');
    try {
      const data = await bossApi.completeMockInterviewSession(project, session.sessionId);
      setSession(data.session);
      setView(data.session.status === 'evaluated' || data.session.status === 'evaluation_failed' ? 'review' : 'session');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const openHistorySession = async (sessionId: string) => {
    setLoading(true);
    setError('');
    try {
      const data = await bossApi.getMockInterviewSession(project, sessionId);
      setSession(data.session);
      setSelectedCandidates([]);
      setView(
        data.session.status === 'evaluated' || data.session.status === 'evaluation_failed'
          ? 'review'
          : 'session',
      );
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const stageCandidates = async () => {
    if (!session || !selectedCandidates.length) return;
    setLoading(true);
    setError('');
    try {
      const data = await bossApi.stageMockInterviewStoryDrafts(project, session.sessionId, selectedCandidates);
      setSession(data.session);
      setSessions((current) => current.map((row) => (
        row.sessionId === data.session.sessionId
          ? { ...row, storyDraftIds: data.session.storyDraftIds }
          : row
      )));
      const firstDraft = data.drafts[0];
      if (firstDraft) onOpenStoryDraft(firstDraft.draftId);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const evaluation = session?.evaluation || null;
  const sessionId = session?.sessionId || '';
  const allCandidatesStaged = Boolean(
    evaluation?.storyCandidates.length
    && evaluation.storyCandidates.every((candidate) => (
      session?.storyDraftIds.includes(`mock-story-${sessionId}-${candidate.candidateId}`)
    )),
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-zinc-800 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-medium text-cyan-300">
              <Sparkles size={14} />
              {t('mockInterview.eyebrow')}
            </div>
            <h2 className="mt-1 truncate text-lg font-semibold text-zinc-100">
              {view === 'history'
                ? t('mockInterview.historyTitle')
                : session?.job.title || item?.title || t('mockInterview.title')}
            </h2>
            {(session?.job.company || item?.company) && (
              <div className="mt-1 truncate text-xs text-zinc-500">
                {session?.job.company || item?.company} · {session?.job.city || item?.city || '-'}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {view !== 'history' && (
              <button
                type="button"
                onClick={() => setView('history')}
                className="inline-flex items-center gap-2 rounded-md border border-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
              >
                <History size={15} />
                {t('mockInterview.history')}
              </button>
            )}
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-2 rounded-md border border-zinc-800 px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
            >
              <ArrowLeft size={16} />
              {t('mockInterview.backToPrep')}
            </button>
          </div>
        </header>

        {error && (
          <div className="mx-5 mt-4 flex shrink-0 items-start gap-2 rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-200">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {view === 'setup' && (
            <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_320px]">
              <section className="space-y-5">
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/35 p-4">
                  <div className="text-sm font-semibold text-zinc-100">{t('mockInterview.setupTitle')}</div>
                  <p className="mt-2 text-sm leading-6 text-zinc-400">{t('mockInterview.setupDescription')}</p>
                </div>

                <div>
                  <div className="mb-2 text-sm font-medium text-zinc-200">{t('mockInterview.mode')}</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(['comprehensive', 'project_deep_dive', 'behavioral', 'technical'] as MockInterviewMode[]).map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setMode(value)}
                        className={`rounded-lg border p-3 text-left transition-colors ${
                          mode === value
                            ? 'border-cyan-600 bg-cyan-950/35 text-cyan-100'
                            : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:bg-zinc-900'
                        }`}
                      >
                        <div className="text-sm font-medium">{t(`mockInterview.modes.${value}`)}</div>
                        <div className="mt-1 text-xs leading-5 text-zinc-500">{t(`mockInterview.modeDescriptions.${value}`)}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-zinc-200">{t('mockInterview.duration')}</span>
                    <select
                      value={durationMinutes}
                      onChange={(event) => setDurationMinutes(Number(event.target.value) as 10 | 20 | 30)}
                      className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-200 outline-none focus:border-cyan-600"
                    >
                      {[10, 20, 30].map((value) => (
                        <option key={value} value={value}>{t('mockInterview.minutes', { count: value })}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-zinc-200">{t('mockInterview.difficulty')}</span>
                    <select
                      value={difficulty}
                      onChange={(event) => setDifficulty(event.target.value as MockInterviewDifficulty)}
                      className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-200 outline-none focus:border-cyan-600"
                    >
                      {(['auto', 'basic', 'advanced', 'pressure'] as MockInterviewDifficulty[]).map((value) => (
                        <option key={value} value={value}>{t(`mockInterview.difficulties.${value}`)}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-zinc-200">{t('mockInterview.notes')}</span>
                  <textarea
                    value={userNotes}
                    onChange={(event) => setUserNotes(event.target.value)}
                    placeholder={t('mockInterview.notesPlaceholder')}
                    className="h-24 w-full resize-none rounded-md border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-200 outline-none focus:border-cyan-600"
                  />
                </label>
              </section>

              <aside className="space-y-4">
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/35 p-4">
                  <div className="text-sm font-semibold text-zinc-100">{t('mockInterview.contextTitle')}</div>
                  <ul className="mt-3 space-y-2 text-xs leading-5 text-zinc-400">
                    <li>{t('mockInterview.contextItems.jd')}</li>
                    <li>{t('mockInterview.contextItems.report')}</li>
                    <li>{t('mockInterview.contextItems.resume')}</li>
                    <li>{t('mockInterview.contextItems.evidence')}</li>
                    <li>{t('mockInterview.contextItems.stories')}</li>
                  </ul>
                </div>
                <button
                  type="button"
                  onClick={() => { void startSession(); }}
                  disabled={!item || loading}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-cyan-700 px-4 py-3 text-sm font-semibold text-white hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                  {loading ? t('mockInterview.generatingQuestions') : t('mockInterview.start')}
                </button>
              </aside>
            </div>
          )}

          {view === 'session' && session && (
            <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_300px]">
              <section className="flex min-h-0 flex-col border-zinc-800 lg:border-r">
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
                  {session.status === 'evaluating' ? (
                    <div className="flex min-h-80 flex-col items-center justify-center text-center">
                      <Loader2 size={32} className="animate-spin text-cyan-400" />
                      <div className="mt-4 text-base font-semibold text-zinc-100">{t('mockInterview.evaluating')}</div>
                      <p className="mt-2 max-w-lg text-sm leading-6 text-zinc-500">{t('mockInterview.evaluatingDescription')}</p>
                    </div>
                  ) : (
                    <div className="mx-auto max-w-3xl space-y-5">
                      {session.turns.filter((turn) => turn.status !== 'pending').map((turn) => (
                        <div key={turn.turnId} className="space-y-3">
                          <div className="flex items-start gap-3">
                            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-cyan-950 text-cyan-300">
                              <Sparkles size={15} />
                            </span>
                            <div className="max-w-[82%] rounded-2xl rounded-tl-sm border border-zinc-800 bg-zinc-900/65 px-4 py-3">
                              <div className="mb-1 text-[11px] font-medium text-cyan-400">
                                {turn.parentTurnId ? t('mockInterview.followUp') : t(`mockInterview.categories.${turn.category}`)}
                              </div>
                              <p className="text-sm leading-7 text-zinc-100">{turn.question}</p>
                            </div>
                          </div>
                          <div className="flex items-start justify-end gap-3">
                            <div className="max-w-[82%] rounded-2xl rounded-tr-sm bg-indigo-600 px-4 py-3 text-sm leading-7 text-white">
                              {turn.skipped ? t('mockInterview.skippedAnswer') : turn.answer}
                            </div>
                            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-indigo-950 text-indigo-300">
                              <UserRound size={15} />
                            </span>
                          </div>
                        </div>
                      ))}

                      {loading && activeTurn && (
                        <>
                          <div className="flex items-start justify-end gap-3">
                            <div className="max-w-[82%] rounded-2xl rounded-tr-sm bg-indigo-600 px-4 py-3 text-sm leading-7 text-white">
                              {answer || t('mockInterview.skippedAnswer')}
                            </div>
                            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-indigo-950 text-indigo-300">
                              <UserRound size={15} />
                            </span>
                          </div>
                          <div className="flex items-start gap-3" aria-live="polite">
                            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-cyan-950 text-cyan-300">
                              <Sparkles size={15} />
                            </span>
                            <div className="max-w-[82%] rounded-2xl rounded-tl-sm border border-cyan-900/60 bg-cyan-950/20 px-4 py-3">
                              <div className="flex items-center gap-2 text-xs text-cyan-300">
                                <Loader2 size={13} className="animate-spin" />
                                {t(`mockInterview.streamPhases.${streamPhase || 'analyzing'}`)}
                              </div>
                              {streamedQuestion && (
                                <p className="mt-2 text-sm leading-7 text-zinc-100">
                                  {streamedQuestion}
                                  <span className="ml-1 inline-block h-4 w-0.5 animate-pulse bg-cyan-400 align-middle" />
                                </p>
                              )}
                            </div>
                          </div>
                        </>
                      )}

                      {!loading && activeTurn && (
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-cyan-950 text-cyan-300">
                            <Sparkles size={15} />
                          </span>
                          <div className="max-w-[82%] rounded-2xl rounded-tl-sm border border-cyan-900/60 bg-cyan-950/20 px-4 py-3">
                            <div className="mb-1 text-[11px] font-medium text-cyan-400">
                              {activeTurn.parentTurnId ? t('mockInterview.followUp') : t(`mockInterview.categories.${activeTurn.category}`)}
                            </div>
                            <p className="text-base font-medium leading-7 text-zinc-100">{activeTurn.question}</p>
                          </div>
                        </div>
                      )}

                      {!activeTurn && session.status !== 'evaluating' && (
                        <div className="flex min-h-64 flex-col items-center justify-center text-center">
                          <CheckCircle2 size={36} className="text-emerald-400" />
                          <div className="mt-4 text-lg font-semibold text-zinc-100">{t('mockInterview.allQuestionsComplete')}</div>
                          <p className="mt-2 max-w-lg text-sm leading-6 text-zinc-500">{t('mockInterview.readyForEvaluation')}</p>
                          <button
                            type="button"
                            onClick={() => { void finishSession(); }}
                            disabled={loading}
                            className="mt-5 inline-flex items-center gap-2 rounded-md bg-cyan-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-cyan-600"
                          >
                            {loading ? <Loader2 size={15} className="animate-spin" /> : <Flag size={15} />}
                            {t('mockInterview.finishAndEvaluate')}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {activeTurn && session.status === 'in_progress' && (
                  <div className="shrink-0 border-t border-zinc-800 bg-zinc-950/95 px-5 py-4">
                    <div className="mx-auto max-w-3xl">
                      {showHint && (
                        <div className="mb-3 flex gap-2 rounded-md border border-amber-900/60 bg-amber-950/25 p-3 text-sm leading-6 text-amber-100">
                          <Lightbulb size={16} className="mt-1 shrink-0" />
                          <span>{answerHint(activeTurn.category, t)}</span>
                        </div>
                      )}
                      <textarea
                        value={answer}
                        onChange={(event) => setAnswer(event.target.value)}
                        disabled={loading}
                        placeholder={t('mockInterview.answerPlaceholder')}
                        className="h-28 w-full resize-none rounded-xl border border-zinc-800 bg-zinc-900/55 p-4 text-sm leading-6 text-zinc-100 outline-none focus:border-cyan-600 disabled:opacity-60"
                      />
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setShowHint(true);
                              setAssisted(true);
                            }}
                            disabled={loading}
                            className="inline-flex items-center gap-2 rounded-md border border-amber-900/60 px-3 py-2 text-sm text-amber-200 hover:bg-amber-950/30 disabled:opacity-50"
                          >
                            <Lightbulb size={15} />
                            {t('mockInterview.showHint')}
                          </button>
                          <span className="text-[11px] text-zinc-600">{t('mockInterview.autoSaving')}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => { void submitAnswer(true); }}
                            disabled={loading}
                            className="inline-flex items-center gap-2 rounded-md border border-zinc-800 px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-900 disabled:opacity-50"
                          >
                            <SkipForward size={15} />
                            {t('mockInterview.skip')}
                          </button>
                          <button
                            type="button"
                            onClick={() => { void submitAnswer(false); }}
                            disabled={loading || !answer.trim()}
                            className="inline-flex items-center gap-2 rounded-md bg-cyan-700 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {loading ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                            {t('mockInterview.submitAnswer')}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </section>

              <aside className="min-h-0 overflow-y-auto bg-zinc-900/20 p-4">
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                  <div className="flex items-center justify-between gap-3 text-xs text-zinc-400">
                    <span>{t('mockInterview.sessionProgress')}</span>
                    <span>{sessionProgress}%</span>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                    <div className="h-full rounded-full bg-cyan-500 transition-all" style={{ width: `${sessionProgress}%` }} />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-center text-[11px] text-zinc-500">
                    <div className="rounded bg-zinc-900 p-2">{t('mockInterview.answered', { count: session.answeredCount })}</div>
                    <div className="rounded bg-zinc-900 p-2">{t('mockInterview.followUps', { count: session.followUpCount })}</div>
                  </div>
                </div>
                <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                  <div className="text-sm font-semibold text-zinc-100">{t('mockInterview.sessionFocus')}</div>
                  <p className="mt-2 text-xs leading-6 text-zinc-400">{session.outline}</p>
                  <div className="mt-3 text-[11px] text-zinc-500">{t('mockInterview.minutes', { count: session.durationMinutes })}</div>
                </div>
                <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                  <div className="text-sm font-semibold text-zinc-100">{t('mockInterview.jobContext')}</div>
                  <div className="mt-3 text-sm font-medium text-zinc-200">{session.job.title}</div>
                  <div className="mt-1 text-xs leading-5 text-zinc-500">
                    {session.job.company} · {session.job.city || '-'} · {session.job.salary || '-'}
                  </div>
                </div>
                {session.status === 'in_progress' && session.answeredCount > 0 && (
                  <button
                    type="button"
                    onClick={() => { void finishSession(); }}
                    disabled={loading}
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md border border-zinc-800 px-3 py-2 text-xs text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300 disabled:opacity-50"
                  >
                    <Flag size={13} />
                    {t('mockInterview.finishEarly')}
                  </button>
                )}
              </aside>
            </div>
          )}

          {view === 'review' && session && (
            <div className="space-y-5 p-5">
              {!evaluation ? (
                <div className="flex min-h-80 flex-col items-center justify-center text-center">
                  <AlertTriangle size={32} className="text-amber-400" />
                  <div className="mt-4 text-base font-semibold text-zinc-100">{t('mockInterview.evaluationUnavailable')}</div>
                  <button
                    type="button"
                    onClick={() => { void finishSession(); }}
                    className="mt-4 inline-flex items-center gap-2 rounded-md border border-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
                  >
                    <RotateCcw size={15} />
                    {t('mockInterview.retryEvaluation')}
                  </button>
                </div>
              ) : (
                <>
                  <section className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                    <div className="flex flex-col items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/35 p-5 text-center">
                      <div className="text-4xl font-bold text-cyan-300">{evaluation.overallScore}</div>
                      <div className="mt-1 text-xs text-zinc-500">{t('mockInterview.overallScore')}</div>
                    </div>
                    <div className="rounded-lg border border-zinc-800 bg-zinc-900/35 p-5">
                      <div className="text-sm font-semibold text-zinc-100">{t('mockInterview.summary')}</div>
                      <p className="mt-2 text-sm leading-7 text-zinc-300">{evaluation.summary}</p>
                      {evaluation.fallback && (
                        <div className="mt-3 rounded border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">
                          {t('mockInterview.fallbackEvaluation')}
                        </div>
                      )}
                    </div>
                  </section>

                  <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {DIMENSION_KEYS.map((key) => (
                      <div key={key} className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <span className="text-zinc-400">{t(`mockInterview.dimensions.${key}`)}</span>
                          <span className="font-semibold text-zinc-100">{evaluation.dimensionScores[key] || 0}</span>
                        </div>
                        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                          <div
                            className="h-full rounded-full bg-cyan-500"
                            style={{ width: `${evaluation.dimensionScores[key] || 0}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </section>

                  <section className="grid gap-4 lg:grid-cols-2">
                    <div className="rounded-lg border border-emerald-900/40 bg-emerald-950/15 p-4">
                      <div className="text-sm font-semibold text-emerald-200">{t('mockInterview.strengths')}</div>
                      <ul className="mt-3 space-y-2 text-sm leading-6 text-zinc-300">
                        {evaluation.strengths.length
                          ? evaluation.strengths.map((value) => <li key={value}>· {value}</li>)
                          : <li className="text-zinc-500">{t('mockInterview.noStrengths')}</li>}
                      </ul>
                    </div>
                    <div className="rounded-lg border border-amber-900/40 bg-amber-950/15 p-4">
                      <div className="text-sm font-semibold text-amber-200">{t('mockInterview.improvements')}</div>
                      <ul className="mt-3 space-y-2 text-sm leading-6 text-zinc-300">
                        {evaluation.improvements.length
                          ? evaluation.improvements.map((value) => <li key={value}>· {value}</li>)
                          : <li className="text-zinc-500">{t('mockInterview.noImprovements')}</li>}
                      </ul>
                    </div>
                  </section>

                  <section className="rounded-lg border border-zinc-800 bg-zinc-900/20">
                    <div className="border-b border-zinc-800 px-4 py-3 text-sm font-semibold text-zinc-100">
                      {t('mockInterview.questionReview')}
                    </div>
                    <div className="divide-y divide-zinc-800">
                      {session.turns.filter((turn) => turn.answer).map((turn) => {
                        const feedback = evaluation.turnFeedback.find((value) => value.questionId === turn.questionId);
                        return (
                          <div key={turn.turnId} className="p-4">
                            <div className="text-sm font-medium leading-6 text-zinc-100">{turn.question}</div>
                            <div className="mt-2 rounded bg-zinc-950 p-3 text-sm leading-6 text-zinc-400">{turn.answer}</div>
                            {feedback && (
                              <div className="mt-3 grid gap-3 text-xs leading-5 text-zinc-400 md:grid-cols-2">
                                <div>
                                  <span className="font-medium text-emerald-300">{t('mockInterview.didWell')}</span>
                                  <div className="mt-1">{feedback.strengths?.join('；') || '-'}</div>
                                </div>
                                <div>
                                  <span className="font-medium text-amber-300">{t('mockInterview.missingInformation')}</span>
                                  <div className="mt-1">{feedback.missingInformation?.join('；') || '-'}</div>
                                </div>
                                <div>
                                  <span className="font-medium text-cyan-300">{t('mockInterview.possibleFollowUps')}</span>
                                  <div className="mt-1">{feedback.possibleFollowUps?.join('；') || '-'}</div>
                                </div>
                                <div>
                                  <span className="font-medium text-indigo-300">{t('mockInterview.betterStructure')}</span>
                                  <div className="mt-1">{feedback.betterStructure || '-'}</div>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  <section className="rounded-lg border border-zinc-800 bg-zinc-900/20">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
                      <div>
                        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                          <BookOpenText size={15} className="text-cyan-400" />
                          {t('mockInterview.storyCandidates')}
                        </div>
                        <div className="mt-1 text-xs text-zinc-500">{t('mockInterview.storyCandidateDescription')}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => { void stageCandidates(); }}
                        disabled={loading || !selectedCandidates.length || allCandidatesStaged}
                        className="inline-flex items-center gap-2 rounded-md bg-cyan-700 px-3 py-2 text-sm font-medium text-white hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {loading ? <Loader2 size={15} className="animate-spin" /> : <BookOpenText size={15} />}
                        {allCandidatesStaged ? t('mockInterview.allStaged') : t('mockInterview.stageSelected')}
                      </button>
                    </div>
                    <div className="divide-y divide-zinc-800">
                      {evaluation.storyCandidates.length ? evaluation.storyCandidates.map((candidate) => {
                        const stagedId = `mock-story-${session.sessionId}-${candidate.candidateId}`;
                        const staged = session.storyDraftIds.includes(stagedId);
                        const selected = selectedCandidates.includes(candidate.candidateId);
                        return (
                          <label key={candidate.candidateId} className="flex cursor-pointer gap-3 p-4 hover:bg-zinc-900/35">
                            <input
                              type="checkbox"
                              checked={selected || staged}
                              disabled={staged}
                              onChange={(event) => {
                                setSelectedCandidates((current) => (
                                  event.target.checked
                                    ? [...new Set([...current, candidate.candidateId])]
                                    : current.filter((value) => value !== candidate.candidateId)
                                ));
                              }}
                              className="mt-1"
                            />
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium text-zinc-100">{candidate.title}</span>
                                {candidate.assisted && (
                                  <span className="rounded bg-amber-950/60 px-1.5 py-0.5 text-[10px] text-amber-300">
                                    {t('mockInterview.assisted')}
                                  </span>
                                )}
                                {staged && (
                                  <span className="rounded bg-emerald-950/60 px-1.5 py-0.5 text-[10px] text-emerald-300">
                                    {t('mockInterview.staged')}
                                  </span>
                                )}
                              </div>
                              <p className="mt-2 text-sm leading-6 text-zinc-400">{candidate.rawNote}</p>
                              {(candidate.missingFields.length > 0 || candidate.contradictionFlags.length > 0) && (
                                <div className="mt-2 text-xs leading-5 text-amber-300">
                                  {[
                                    candidate.missingFields.length ? t('mockInterview.missingFieldsValue', { value: candidate.missingFields.join('、') }) : '',
                                    candidate.contradictionFlags.length ? t('mockInterview.contradictionsValue', { value: candidate.contradictionFlags.join('、') }) : '',
                                  ].filter(Boolean).join(' · ')}
                                </div>
                              )}
                            </div>
                          </label>
                        );
                      }) : (
                        <div className="p-5 text-sm text-zinc-500">{t('mockInterview.noStoryCandidates')}</div>
                      )}
                    </div>
                  </section>
                </>
              )}
            </div>
          )}

          {view === 'history' && (
            <div className="p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <p className="text-sm text-zinc-500">{t('mockInterview.historyDescription')}</p>
                {item && (
                  <button
                    type="button"
                    onClick={() => setView('setup')}
                    className="inline-flex items-center gap-2 rounded-md bg-cyan-700 px-3 py-2 text-sm font-medium text-white hover:bg-cyan-600"
                  >
                    <Sparkles size={15} />
                    {t('mockInterview.newSession')}
                  </button>
                )}
              </div>
              {historyLoading ? (
                <div className="flex min-h-64 items-center justify-center text-zinc-500">
                  <Loader2 size={24} className="animate-spin" />
                </div>
              ) : sessions.length ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {sessions.map((row) => (
                    <button
                      key={row.sessionId}
                      type="button"
                      onClick={() => { void openHistorySession(row.sessionId); }}
                      className="rounded-lg border border-zinc-800 bg-zinc-900/25 p-4 text-left hover:border-zinc-700 hover:bg-zinc-900/50"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-zinc-100">{row.job.title}</div>
                          <div className="mt-1 truncate text-xs text-zinc-500">{row.job.company} · {row.job.city || '-'}</div>
                        </div>
                        {row.overallScore != null && (
                          <span className="rounded bg-cyan-950/60 px-2 py-1 text-xs font-semibold text-cyan-300">{row.overallScore}</span>
                        )}
                      </div>
                      <div className="mt-4 flex flex-wrap gap-3 text-[11px] text-zinc-500">
                        <span className="inline-flex items-center gap-1"><Clock3 size={12} />{row.durationMinutes} min</span>
                        <span>{t(`mockInterview.modes.${row.mode}`)}</span>
                        <span>{t(`mockInterview.statuses.${row.status}`)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-zinc-800 text-center">
                  <History size={28} className="text-zinc-600" />
                  <div className="mt-3 text-sm font-medium text-zinc-300">{t('mockInterview.noHistory')}</div>
                  <div className="mt-1 text-xs text-zinc-600">{t('mockInterview.noHistoryDescription')}</div>
                </div>
              )}
            </div>
          )}
        </div>
    </div>
  );
}
