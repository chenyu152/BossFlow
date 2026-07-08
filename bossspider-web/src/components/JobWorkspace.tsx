import {
  BookOpenText,
  BrainCircuit,
  CheckCircle2,
  Circle,
  Clipboard,
  FileText,
  Loader2,
  MessageSquareText,
  Save,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useAppTranslation } from '../i18n';
import { DetailItem } from './DetailItem';
import { JobDescription } from './JobDescription';
import type { DecisionStatus, GreetingDraft, GreetingDraftStatus, Job, PipelineItem } from '../types';

type WorkspaceTab = 'overview' | 'info' | 'evaluation' | 'materials' | 'interview' | 'records';

type StatusOption = {
  value: DecisionStatus;
  label: string;
};

type JobWorkspaceProps = {
  item: PipelineItem;
  job: Job | null;
  detailLoading: boolean;
  statusOptions: StatusOption[];
  onClose: () => void;
  onStatusChange: (status: DecisionStatus) => void;
  onDelete: () => void;
  onLlmEvaluate: () => void;
  isLlmEvaluating: boolean;
  onViewReport: () => void;
  reportLoading: boolean;
  greetingDraft: GreetingDraft | null;
  greetingLoading: boolean;
  greetingSaving: boolean;
  onSaveGreetingDraft: (editedText: string, status: GreetingDraftStatus) => Promise<unknown>;
  onGenerateResumeSuggestions: () => void;
  onViewResumeSuggestion: () => void;
  isResumeSuggesting: boolean;
  resumeLoading: boolean;
  onGenerateInterviewPrep: () => void;
  onViewInterviewPrep: () => void;
  isInterviewPreparing: boolean;
  interviewLoading: boolean;
};

const MATERIAL_TONES = {
  llm: 'border-emerald-900/60 bg-emerald-950/40 text-emerald-300',
  resume: 'border-indigo-900/60 bg-indigo-950/40 text-indigo-300',
  interview: 'border-cyan-900/60 bg-cyan-950/40 text-cyan-300',
  missing: 'border-zinc-800 bg-zinc-900/50 text-zinc-500',
};

const STATUS_CLASSES: Record<DecisionStatus, { active: string; idle: string }> = {
  needs_llm: {
    active: 'border-sky-700 bg-sky-950/50 text-sky-200',
    idle: 'border-sky-950/70 text-sky-400 hover:bg-sky-950/30',
  },
  needs_review: {
    active: 'border-amber-700 bg-amber-950/50 text-amber-200',
    idle: 'border-amber-950/70 text-amber-400 hover:bg-amber-950/30',
  },
  ready_to_greet: {
    active: 'border-emerald-700 bg-emerald-950/50 text-emerald-200',
    idle: 'border-emerald-950/70 text-emerald-400 hover:bg-emerald-950/30',
  },
  greeted: {
    active: 'border-blue-700 bg-blue-950/50 text-blue-200',
    idle: 'border-blue-950/70 text-blue-400 hover:bg-blue-950/30',
  },
  skipped: {
    active: 'border-red-700 bg-red-950/50 text-red-200',
    idle: 'border-red-950/70 text-red-400 hover:bg-red-950/30',
  },
};

function statusButtonClass(status: DecisionStatus, active: boolean) {
  const classes = STATUS_CLASSES[status];
  return active ? classes.active : classes.idle;
}

function MaterialPill({
  label,
  ready,
  tone,
}: {
  label: string;
  ready: boolean;
  tone: 'llm' | 'resume' | 'interview';
}) {
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium ${ready ? MATERIAL_TONES[tone] : MATERIAL_TONES.missing}`}>
      {ready ? <CheckCircle2 size={11} /> : <Circle size={11} />}
      {label}
    </span>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 rounded border border-zinc-800 bg-zinc-950 p-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h4>
      {children}
    </section>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  tone = 'zinc',
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'emerald' | 'indigo' | 'cyan' | 'zinc';
}) {
  const classes = {
    emerald: 'border-emerald-900/70 bg-emerald-950/40 text-emerald-200 hover:bg-emerald-900/40',
    indigo: 'border-indigo-900/70 bg-indigo-950/40 text-indigo-200 hover:bg-indigo-900/40',
    cyan: 'border-cyan-900/70 bg-cyan-950/40 text-cyan-200 hover:bg-cyan-900/40',
    zinc: 'border-zinc-800 text-zinc-300 hover:bg-zinc-900',
  }[tone];

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-2 rounded border px-3 py-2 text-xs font-medium transition-colors disabled:cursor-wait disabled:opacity-60 ${classes}`}
    >
      {children}
    </button>
  );
}

export function JobWorkspace({
  item,
  job,
  detailLoading,
  statusOptions,
  onClose,
  onStatusChange,
  onDelete,
  onLlmEvaluate,
  isLlmEvaluating,
  onViewReport,
  reportLoading,
  greetingDraft,
  greetingLoading,
  greetingSaving,
  onSaveGreetingDraft,
  onGenerateResumeSuggestions,
  onViewResumeSuggestion,
  isResumeSuggesting,
  resumeLoading,
  onGenerateInterviewPrep,
  onViewInterviewPrep,
  isInterviewPreparing,
  interviewLoading,
}: JobWorkspaceProps) {
  const { t } = useAppTranslation();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('overview');
  const [greetingText, setGreetingText] = useState('');
  const materialReadyCount = [
    item.reportPath,
    item.resumeSuggestionPath,
    item.resumeDraftPath,
    item.interviewPrepPath,
  ].filter(Boolean).length;
  const averageSalary = (job?.avg ?? item.avg ?? 0).toFixed(1);
  const greetingSourceText = greetingDraft?.editedText || greetingDraft?.draftText || '';

  useEffect(() => {
    setGreetingText(greetingSourceText);
  }, [greetingDraft?.sourceKey, greetingDraft?.updatedAt, greetingSourceText]);

  const nextAction = useMemo(() => {
    if (!item.reportPath) return 'llm';
    if (!item.resumeSuggestionPath) return 'resume';
    if (!item.interviewPrepPath) return 'interview';
    if (item.decisionStatus === 'needs_review') return 'confirm';
    return 'review';
  }, [item.decisionStatus, item.interviewPrepPath, item.reportPath, item.resumeSuggestionPath]);

  const tabs: Array<{ value: WorkspaceTab; label: string }> = [
    { value: 'overview', label: t('jobWorkspace.tabs.overview') },
    { value: 'info', label: t('jobWorkspace.tabs.info') },
    { value: 'evaluation', label: t('jobWorkspace.tabs.evaluation') },
    { value: 'materials', label: t('jobWorkspace.tabs.materials') },
    { value: 'interview', label: t('jobWorkspace.tabs.interview') },
    { value: 'records', label: t('jobWorkspace.tabs.records') },
  ];

  const riskText = (risk?: string) => {
    if (risk === 'matched') return t('pipeline.risk.ok');
    if (risk === 'near') return t('pipeline.risk.near');
    if (risk === 'risk') return t('pipeline.risk.risk');
    return t('pipeline.risk.unknown');
  };

  const saveGreeting = (status: GreetingDraftStatus = 'edited') => {
    void onSaveGreetingDraft(greetingText, status);
  };

  const copyGreeting = async () => {
    if (!greetingText.trim()) return;
    await navigator.clipboard.writeText(greetingText);
    await onSaveGreetingDraft(greetingText, 'copied');
  };

  const greetingStatusLabel = greetingDraft
    ? t(`jobWorkspace.greetingStatuses.${greetingDraft.status}`)
    : t('jobWorkspace.greetingStatuses.draft');

  return (
    <div className="w-[42rem] shrink-0 border-l border-zinc-800 bg-zinc-950 flex flex-col">
      <div className="border-b border-zinc-800 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-indigo-300">{t('jobWorkspace.title')}</div>
            <h3 className="truncate text-base font-semibold text-zinc-100">{item.company} · {item.title}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              <span>{item.city || '-'}</span>
              <span>{item.salary || '-'}</span>
              <span>{t('pipeline.score')} {item.score ? item.score.toFixed(1) : '-'}</span>
              <span>{t('pipeline.llm')} {item.llmScore ? item.llmScore.toFixed(1) : '-'}</span>
            </div>
          </div>
          <button onClick={onClose} className="rounded border border-zinc-800 p-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <MaterialPill label={t('pipeline.material.llm')} ready={Boolean(item.reportPath)} tone="llm" />
          <MaterialPill label={t('pipeline.material.resumeSuggestion')} ready={Boolean(item.resumeSuggestionPath)} tone="resume" />
          <MaterialPill label={t('pipeline.material.resumeDraft')} ready={Boolean(item.resumeDraftPath)} tone="resume" />
          <MaterialPill label={t('pipeline.material.interviewPrep')} ready={Boolean(item.interviewPrepPath)} tone="interview" />
        </div>
      </div>

      <div className="border-b border-zinc-800 px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={`rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${
                activeTab === tab.value
                  ? 'bg-indigo-600 text-white'
                  : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'overview' && (
          <div className="space-y-4">
            <Section title={t('jobWorkspace.nextAction')}>
              <div className="rounded border border-zinc-800 bg-zinc-900/40 p-3">
                <div className="text-sm font-medium text-zinc-100">
                  {nextAction === 'llm' && t('jobWorkspace.nextActions.llm')}
                  {nextAction === 'resume' && t('jobWorkspace.nextActions.resume')}
                  {nextAction === 'interview' && t('jobWorkspace.nextActions.interview')}
                  {nextAction === 'confirm' && t('jobWorkspace.nextActions.confirm')}
                  {nextAction === 'review' && t('jobWorkspace.nextActions.review')}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {nextAction === 'llm' && (
                    <ActionButton onClick={onLlmEvaluate} disabled={isLlmEvaluating} tone="emerald">
                      {isLlmEvaluating && <Loader2 size={13} className="animate-spin" />}
                      {isLlmEvaluating ? t('pipeline.generating') : t('pipeline.llmEval')}
                    </ActionButton>
                  )}
                  {nextAction === 'resume' && (
                    <ActionButton onClick={onGenerateResumeSuggestions} disabled={isResumeSuggesting || resumeLoading} tone="indigo">
                      {isResumeSuggesting || resumeLoading ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
                      {t('pipeline.generateSuggestions')}
                    </ActionButton>
                  )}
                  {nextAction === 'interview' && (
                    <ActionButton onClick={onGenerateInterviewPrep} disabled={isInterviewPreparing || interviewLoading} tone="cyan">
                      {isInterviewPreparing || interviewLoading ? <Loader2 size={13} className="animate-spin" /> : <BrainCircuit size={13} />}
                      {t('pipeline.generateInterviewPrep')}
                    </ActionButton>
                  )}
                  {item.reportPath && (
                    <ActionButton onClick={onViewReport} disabled={reportLoading} tone="emerald">
                      {reportLoading ? <Loader2 size={13} className="animate-spin" /> : <BookOpenText size={13} />}
                      {t('pipeline.viewReport')}
                    </ActionButton>
                  )}
                </div>
              </div>
            </Section>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded border border-zinc-800 bg-zinc-950 p-3">
                <div className="text-xs text-zinc-500">{t('jobWorkspace.materialProgress')}</div>
                <div className="mt-2 text-2xl font-semibold text-zinc-100">{materialReadyCount}/4</div>
              </div>
              <div className="rounded border border-zinc-800 bg-zinc-950 p-3">
                <div className="text-xs text-zinc-500">{t('jobWorkspace.currentStatus')}</div>
                <div className="mt-2 text-sm font-medium text-zinc-100">
                  {statusOptions.find((option) => option.value === item.decisionStatus)?.label || item.decisionStatus}
                </div>
              </div>
            </div>

            <Section title={t('pipeline.materials')}>
              <div className="grid grid-cols-2 gap-2">
                <MaterialPill label={t('pipeline.material.llm')} ready={Boolean(item.reportPath)} tone="llm" />
                <MaterialPill label={t('pipeline.material.resumeSuggestion')} ready={Boolean(item.resumeSuggestionPath)} tone="resume" />
                <MaterialPill label={t('pipeline.material.resumeDraft')} ready={Boolean(item.resumeDraftPath)} tone="resume" />
                <MaterialPill label={t('pipeline.material.interviewPrep')} ready={Boolean(item.interviewPrepPath)} tone="interview" />
              </div>
            </Section>
          </div>
        )}

        {activeTab === 'info' && (
          <div className="space-y-4">
            {detailLoading && (
              <div className="flex items-center gap-2 text-sm text-zinc-500">
                <Loader2 size={14} className="animate-spin" />
                {t('pipeline.loadingDetails')}
              </div>
            )}
            <Section title={t('jobWorkspace.basicInfo')}>
              <DetailItem label={t('pipeline.jobTitle')} value={item.title} strong />
              <div className="grid grid-cols-2 gap-4">
                <DetailItem label={t('pipeline.company')} value={item.company} />
                <DetailItem label={t('pipeline.city')} value={item.city} />
                <DetailItem label={t('pipeline.salary')} value={item.salary} accent />
                <DetailItem label={t('pipeline.avgSalary')} value={`${averageSalary}k`} />
                <DetailItem label={t('pipeline.experience')} value={job?.exp || '-'} />
                <DetailItem label={t('pipeline.education')} value={job?.edu || '-'} />
              </div>
              {(job?.url || item.url) && (
                <a href={job?.url || item.url} target="_blank" rel="noreferrer" className="text-xs text-indigo-400 hover:underline">
                  {t('jobs.viewOriginalLink')}
                </a>
              )}
            </Section>
            <Section title={t('jobs.tableHeaders.category')}>
              <div className="flex flex-wrap gap-1.5">
                {((job?.cats.length ? job.cats : [job?.tier || '-'])).map((cat) => (
                  <span key={cat} className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300">{cat}</span>
                ))}
              </div>
            </Section>
            <JobDescription text={job?.desc} />
          </div>
        )}

        {activeTab === 'evaluation' && (
          <div className="space-y-4">
            <Section title={t('jobWorkspace.coarseEvaluation')}>
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-500">{t('pipeline.score')}</span>
                <span className="text-sm font-semibold text-zinc-100">{item.score ? item.score.toFixed(1) : '-'} / 5.0</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-zinc-400">
                <div>{t('pipeline.coverage', { n: item.coverage ?? 0 })}</div>
                <div>{t('pipeline.jdQuality', { n: item.jdQuality ?? 0 })}</div>
                <div>{t('pipeline.expRisk', { risk: riskText(item.experienceRisk) })}</div>
                <div>{t('pipeline.eduRisk', { risk: riskText(item.educationRisk) })}</div>
              </div>
            </Section>
            <Section title={t('jobWorkspace.llmEvaluation')}>
              <div className="flex items-center justify-between">
                <span className="text-xs text-emerald-500">{t('pipeline.llm')}</span>
                <span className="text-sm font-semibold text-emerald-200">{item.llmScore ? item.llmScore.toFixed(1) : item.reportId || '-'} / 5.0</span>
              </div>
              {item.llmFitLevel && <div className="text-xs text-emerald-400">{item.llmFitLevel}</div>}
              {item.llmRecommendation && <div className="text-xs leading-relaxed text-zinc-300">{item.llmRecommendation}</div>}
              {item.reportPath ? (
                <>
                  <div className="break-all text-[10px] text-zinc-500">{item.reportPath}</div>
                  <ActionButton onClick={onViewReport} disabled={reportLoading} tone="emerald">
                    {reportLoading ? <Loader2 size={13} className="animate-spin" /> : <BookOpenText size={13} />}
                    {t('pipeline.viewReport')}
                  </ActionButton>
                </>
              ) : (
                <ActionButton onClick={onLlmEvaluate} disabled={isLlmEvaluating} tone="emerald">
                  {isLlmEvaluating && <Loader2 size={13} className="animate-spin" />}
                  {isLlmEvaluating ? t('pipeline.generating') : t('pipeline.llmEval')}
                </ActionButton>
              )}
            </Section>
          </div>
        )}

        {activeTab === 'materials' && (
          <div className="space-y-4">
            <Section title={t('pipeline.material.resumeSuggestion')}>
              <div className="text-xs leading-relaxed text-zinc-400">{t('pipeline.resumeHint')}</div>
              {item.resumeSuggestedAt && <div className="text-[10px] text-zinc-500">{t('pipeline.generatedAt', { date: item.resumeSuggestedAt })}</div>}
              {item.resumeSuggestionPath && <div className="break-all text-[10px] text-zinc-500">{item.resumeSuggestionPath}</div>}
              <div className="flex flex-wrap gap-2">
                <ActionButton onClick={onGenerateResumeSuggestions} disabled={isResumeSuggesting || resumeLoading} tone="indigo">
                  {isResumeSuggesting || resumeLoading ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
                  {item.resumeSuggestionPath ? t('pipeline.regenerateSuggestions') : t('pipeline.generateSuggestions')}
                </ActionButton>
                {item.resumeSuggestionPath && (
                  <ActionButton onClick={onViewResumeSuggestion} disabled={resumeLoading}>
                    {resumeLoading ? <Loader2 size={13} className="animate-spin" /> : <BookOpenText size={13} />}
                    {t('pipeline.viewSuggestions')}
                  </ActionButton>
                )}
              </div>
            </Section>
            <Section title={t('pipeline.material.resumeDraft')}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-zinc-500">{item.resumeDraftPath ? t('pipeline.ready') : t('pipeline.notReady')}</span>
                <MaterialPill label={item.resumeDraftPath ? t('pipeline.ready') : t('pipeline.notReady')} ready={Boolean(item.resumeDraftPath)} tone="resume" />
              </div>
              {item.resumeDraftedAt && <div className="text-[10px] text-zinc-500">{t('pipeline.generatedAt', { date: item.resumeDraftedAt })}</div>}
              {item.resumeDraftPath && <div className="break-all text-[10px] text-zinc-500">{item.resumeDraftPath}</div>}
            </Section>
            <Section title={t('jobWorkspace.greeting')}>
              {greetingLoading ? (
                <div className="flex items-center gap-2 text-sm text-zinc-500">
                  <Loader2 size={14} className="animate-spin" />
                  {t('jobWorkspace.loadingGreeting')}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                      <MessageSquareText size={14} className="text-emerald-400" />
                      <span>{t('jobWorkspace.greetingStatus', { status: greetingStatusLabel })}</span>
                    </div>
                    {greetingDraft?.updatedAt && (
                      <span className="text-[10px] text-zinc-600">{t('story.updatedAt')}: {greetingDraft.updatedAt}</span>
                    )}
                  </div>
                  <textarea
                    value={greetingText}
                    onChange={(event) => setGreetingText(event.target.value)}
                    placeholder={t('jobWorkspace.greetingEmpty')}
                    className="min-h-44 w-full resize-y rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm leading-6 text-zinc-200 outline-none transition-colors placeholder:text-zinc-600 focus:border-emerald-800"
                  />
                  {!greetingSourceText.trim() && (
                    <div className="text-xs leading-relaxed text-zinc-500">{t('jobWorkspace.greetingEmptyHint')}</div>
                  )}
                  {greetingDraft?.sourceReportPath && (
                    <div className="break-all text-[10px] text-zinc-600">{greetingDraft.sourceReportPath}</div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <ActionButton
                      onClick={() => saveGreeting('edited')}
                      disabled={greetingSaving || !greetingDraft}
                      tone="emerald"
                    >
                      {greetingSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                      {t('jobWorkspace.saveGreeting')}
                    </ActionButton>
                    <ActionButton
                      onClick={copyGreeting}
                      disabled={greetingSaving || !greetingDraft || !greetingText.trim()}
                    >
                      <Clipboard size={13} />
                      {t('jobWorkspace.copyGreeting')}
                    </ActionButton>
                    <ActionButton
                      onClick={() => saveGreeting('sent')}
                      disabled={greetingSaving || !greetingDraft || !greetingText.trim()}
                      tone="cyan"
                    >
                      <Send size={13} />
                      {t('jobWorkspace.markGreetingSent')}
                    </ActionButton>
                  </div>
                </div>
              )}
            </Section>
          </div>
        )}

        {activeTab === 'interview' && (
          <div className="space-y-4">
            <Section title={t('pipeline.material.interviewPrep')}>
              <div className="text-xs leading-relaxed text-zinc-400">{t('pipeline.interviewPrepHint')}</div>
              {item.interviewPreparedAt && <div className="text-[10px] text-zinc-500">{t('pipeline.generatedAt', { date: item.interviewPreparedAt })}</div>}
              {item.interviewPrepPath && <div className="break-all text-[10px] text-zinc-500">{item.interviewPrepPath}</div>}
              <div className="flex flex-wrap gap-2">
                <ActionButton onClick={onGenerateInterviewPrep} disabled={isInterviewPreparing || interviewLoading} tone="cyan">
                  {isInterviewPreparing || interviewLoading ? <Loader2 size={13} className="animate-spin" /> : <BrainCircuit size={13} />}
                  {item.interviewPrepPath ? t('pipeline.regenerateInterviewPrep') : t('pipeline.generateInterviewPrep')}
                </ActionButton>
                {item.interviewPrepPath && (
                  <ActionButton onClick={onViewInterviewPrep} disabled={interviewLoading}>
                    {interviewLoading ? <Loader2 size={13} className="animate-spin" /> : <BookOpenText size={13} />}
                    {t('pipeline.viewInterviewPrep')}
                  </ActionButton>
                )}
              </div>
            </Section>
            <Section title={t('jobWorkspace.storyMatch')}>
              <div className="text-sm text-zinc-500">{t('jobWorkspace.storyPlaceholder')}</div>
            </Section>
          </div>
        )}

        {activeTab === 'records' && (
          <div className="space-y-4">
            <Section title={t('jobWorkspace.statusFlow')}>
              <div className="grid grid-cols-2 gap-2">
                {statusOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => onStatusChange(option.value)}
                    className={`rounded border px-2.5 py-1.5 text-xs font-medium transition-colors ${statusButtonClass(option.value, item.decisionStatus === option.value)}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </Section>
            <Section title={t('jobWorkspace.timeline')}>
              <div className="space-y-2 text-xs text-zinc-400">
                <div className="flex justify-between gap-3"><span>{t('pipeline.added')}</span><span className="text-right text-zinc-300">{item.addedAt || '-'}</span></div>
                <div className="flex justify-between gap-3"><span>{t('pipeline.material.llm')}</span><span className="text-right text-zinc-300">{item.evaluatedAt || '-'}</span></div>
                <div className="flex justify-between gap-3"><span>{t('pipeline.material.resumeSuggestion')}</span><span className="text-right text-zinc-300">{item.resumeSuggestedAt || '-'}</span></div>
                <div className="flex justify-between gap-3"><span>{t('pipeline.material.resumeDraft')}</span><span className="text-right text-zinc-300">{item.resumeDraftedAt || '-'}</span></div>
                <div className="flex justify-between gap-3"><span>{t('pipeline.material.interviewPrep')}</span><span className="text-right text-zinc-300">{item.interviewPreparedAt || '-'}</span></div>
              </div>
            </Section>
            <button
              onClick={onDelete}
              className="flex w-full items-center justify-center gap-2 rounded border border-red-900/70 bg-red-950/20 px-3 py-2 text-sm font-medium text-red-300 hover:bg-red-950/40 transition-colors"
            >
              <Trash2 size={15} />
              {t('pipeline.deleteItem')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
