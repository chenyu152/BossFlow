import { ArrowDownWideNarrow, BookOpenText, BrainCircuit, CheckCircle2, Circle, FileText, Loader2, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { JobWorkspace } from '../components/JobWorkspace';
import { useGreetingDraftEditor } from '../hooks/useGreetingDraftEditor';
import { useJobWorkspaceArtifacts } from '../hooks/useJobWorkspaceArtifacts';
import { useSelectedPipelineItem } from '../hooks/useSelectedPipelineItem';
import type {
  DecisionStatus,
  EvidenceClassification,
  EvidenceItem,
  EvidenceItemInput,
  EvidenceMutationResponse,
  EvidenceOverviewResponse,
  EvidenceTaskInput,
  GreetingDraftResponse,
  GreetingDraftStatus,
  InterviewPrepResponse,
  Job,
  PipelineReportResponse,
  PipelineResponse,
  ResumeNavigationTarget,
  ResumeSuggestionResponse,
} from '../types';
import { useAppTranslation } from '../i18n';

function getDecisionLabel(status: DecisionStatus, t: (key: string) => string): string {
  const map: Record<DecisionStatus, string> = {
    needs_llm: 'pipeline.decisionStatus.needs_llm',
    needs_review: 'pipeline.decisionStatus.needs_review',
    ready_to_greet: 'pipeline.decisionStatus.ready_to_greet',
    greeted: 'pipeline.decisionStatus.greeted',
    interviewing: 'pipeline.decisionStatus.interviewing',
    skipped: 'pipeline.decisionStatus.skipped',
    archived: 'pipeline.decisionStatus.archived',
  };
  return t(map[status] || status);
}

const STATUS_CLASSES: Record<DecisionStatus, { badge: string; active: string; idle: string }> = {
  needs_llm: {
    badge: 'border-sky-900/60 bg-sky-950/40 text-sky-300',
    active: 'border-sky-700 bg-sky-950/50 text-sky-200',
    idle: 'border-sky-950/70 text-sky-400 hover:bg-sky-950/30',
  },
  needs_review: {
    badge: 'border-amber-900/60 bg-amber-950/40 text-amber-300',
    active: 'border-amber-700 bg-amber-950/50 text-amber-200',
    idle: 'border-amber-950/70 text-amber-400 hover:bg-amber-950/30',
  },
  ready_to_greet: {
    badge: 'border-emerald-900/60 bg-emerald-950/40 text-emerald-300',
    active: 'border-emerald-700 bg-emerald-950/50 text-emerald-200',
    idle: 'border-emerald-950/70 text-emerald-400 hover:bg-emerald-950/30',
  },
  greeted: {
    badge: 'border-blue-900/60 bg-blue-950/40 text-blue-300',
    active: 'border-blue-700 bg-blue-950/50 text-blue-200',
    idle: 'border-blue-950/70 text-blue-400 hover:bg-blue-950/30',
  },
  interviewing: {
    badge: 'border-violet-900/60 bg-violet-950/40 text-violet-300',
    active: 'border-violet-700 bg-violet-950/50 text-violet-200',
    idle: 'border-violet-950/70 text-violet-400 hover:bg-violet-950/30',
  },
  skipped: {
    badge: 'border-red-900/60 bg-red-950/40 text-red-300',
    active: 'border-red-700 bg-red-950/50 text-red-200',
    idle: 'border-red-950/70 text-red-400 hover:bg-red-950/30',
  },
  archived: {
    badge: 'border-zinc-800 bg-zinc-900 text-zinc-400',
    active: 'border-zinc-700 bg-zinc-900 text-zinc-200',
    idle: 'border-zinc-800 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300',
  },
};

function statusBadgeClass(status: DecisionStatus) {
  return STATUS_CLASSES[status]?.badge || 'border-zinc-800 bg-zinc-900 text-zinc-300';
}

function statusButtonClass(status: DecisionStatus, active: boolean) {
  const classes = STATUS_CLASSES[status];
  if (!classes) return active ? 'border-indigo-700 bg-indigo-950/40 text-indigo-200' : 'border-zinc-800 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200';
  return active ? classes.active : classes.idle;
}

function MaterialBadge({ label, ready, tone = 'zinc' }: { label: string; ready: boolean; tone?: 'emerald' | 'indigo' | 'cyan' | 'zinc' }) {
  const readyClass = {
    emerald: 'border-emerald-900/60 bg-emerald-950/50 text-emerald-300',
    indigo: 'border-indigo-900/60 bg-indigo-950/50 text-indigo-300',
    cyan: 'border-cyan-900/60 bg-cyan-950/50 text-cyan-300',
    zinc: 'border-zinc-700 bg-zinc-800/70 text-zinc-200',
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${ready ? readyClass : 'border-zinc-800 bg-zinc-900/40 text-zinc-600'}`}>
      {ready ? <CheckCircle2 size={10} /> : <Circle size={10} />}
      {label}
    </span>
  );
}

export function Pipeline({
  pipeline,
  evidenceOverview,
  evidenceLoading,
  evidenceError,
  onClassifyEvidenceCoverage,
  onCreateEvidenceItem,
  onUpdateEvidenceItem,
  onConfirmEvidenceItem,
  onCreateEvidenceTask,
  onOpenPersonalResume,
  onRefresh,
  onLlmEvaluate,
  llmEvaluatingKeys,
  resumeSuggestingKeys,
  interviewPreparingKeys,
  sortByLlmScore,
  setSortByLlmScore,
  onLoadJobDetail,
  onLoadReport,
  onLoadGreetingDraft,
  onSaveGreetingDraft,
  onGenerateResumeSuggestions,
  onLoadResumeSuggestion,
  onGenerateInterviewPrep,
  onLoadInterviewPrep,
  onUpdateStatus,
  onDeleteItem,
  onOpenResumeMaterials,
  targetSourceKey,
  targetRequirementId,
  targetRequestId,
}: {
  pipeline: PipelineResponse | null;
  evidenceOverview: EvidenceOverviewResponse | null;
  evidenceLoading: boolean;
  evidenceError: string;
  onClassifyEvidenceCoverage: (
    requirementId: string,
    classification: EvidenceClassification,
    evidenceIds?: string[],
    rationale?: string,
    confidence?: number,
  ) => Promise<EvidenceMutationResponse | null>;
  onCreateEvidenceItem: (item: EvidenceItemInput) => Promise<EvidenceMutationResponse | null>;
  onUpdateEvidenceItem: (item: EvidenceItem) => Promise<EvidenceMutationResponse | null>;
  onConfirmEvidenceItem: (evidenceId: string) => Promise<EvidenceMutationResponse | null>;
  onCreateEvidenceTask: (task: EvidenceTaskInput) => Promise<EvidenceMutationResponse | null>;
  onOpenPersonalResume: () => void;
  onRefresh: () => void;
  onLlmEvaluate: (sourceKey: string) => void;
  llmEvaluatingKeys: string[];
  resumeSuggestingKeys: string[];
  interviewPreparingKeys: string[];
  sortByLlmScore: boolean;
  setSortByLlmScore: (value: boolean | ((current: boolean) => boolean)) => void;
  onLoadJobDetail: (project: string, jobId: number) => Promise<Job | null>;
  onLoadReport: (sourceKey: string) => Promise<PipelineReportResponse | null>;
  onLoadGreetingDraft: (sourceKey: string) => Promise<GreetingDraftResponse | null>;
  onSaveGreetingDraft: (sourceKey: string, editedText: string, status: GreetingDraftStatus) => Promise<GreetingDraftResponse | null>;
  onGenerateResumeSuggestions: (sourceKey: string) => Promise<ResumeSuggestionResponse | null>;
  onLoadResumeSuggestion: (sourceKey: string) => Promise<ResumeSuggestionResponse | null>;
  onGenerateInterviewPrep: (sourceKey: string, userNotes: string) => Promise<InterviewPrepResponse | null>;
  onLoadInterviewPrep: (sourceKey: string) => Promise<InterviewPrepResponse | null>;
  onUpdateStatus: (sourceKey: string, decisionStatus: string) => Promise<boolean>;
  onDeleteItem: (sourceKey: string) => Promise<boolean>;
  onOpenResumeMaterials: (target: ResumeNavigationTarget) => void;
  targetSourceKey?: string;
  targetRequirementId?: string;
  targetRequestId?: number;
}) {
  const { t } = useAppTranslation();

  const STATUS_OPTIONS: Array<{ value: DecisionStatus; label: string }> = useMemo(
    () => [
      { value: 'needs_llm', label: getDecisionLabel('needs_llm', t) },
      { value: 'needs_review', label: getDecisionLabel('needs_review', t) },
      { value: 'ready_to_greet', label: getDecisionLabel('ready_to_greet', t) },
      { value: 'greeted', label: getDecisionLabel('greeted', t) },
      { value: 'interviewing', label: getDecisionLabel('interviewing', t) },
      { value: 'skipped', label: getDecisionLabel('skipped', t) },
      { value: 'archived', label: getDecisionLabel('archived', t) },
    ],
    [t],
  );

  const STATUS_FILTERS: Array<{ value: 'all' | DecisionStatus; label: string }> = useMemo(
    () => [
      { value: 'all', label: t('jobs.allJobs') },
      ...STATUS_OPTIONS,
    ],
    [t, STATUS_OPTIONS],
  );

  const pending = pipeline?.pending || [];
  const processed = pipeline?.processed || [];
  const [statusFilter, setStatusFilter] = useState<'all' | DecisionStatus>('all');
  const evaluatingSet = new Set(llmEvaluatingKeys);
  const suggestingSet = new Set(resumeSuggestingKeys);
  const preparingSet = new Set(interviewPreparingKeys);
  const resetWorkspaceRef = useRef<() => void>(() => {});
  const initialSelectionAppliedRef = useRef(false);

  const resetWorkspace = useCallback(() => {
    resetWorkspaceRef.current();
  }, []);
  const revealTargetInAllStatuses = useCallback(() => {
    setStatusFilter('all');
  }, []);

  const {
    selectedSourceKey,
    selectedItem,
    selectedJob,
    detailLoading,
    selectItem,
    clearSelection,
  } = useSelectedPipelineItem({
    pending,
    onLoadJobDetail,
    onSelectionReset: resetWorkspace,
    onTargetSelected: revealTargetInAllStatuses,
    targetSourceKey,
    targetRequestId,
  });

  const {
    report,
    resumeSuggestion,
    interviewPrep,
    reportLoading,
    resumeLoading,
    interviewLoading,
    viewReport,
    closeReport,
    viewResumeSuggestion,
    closeResumeSuggestion,
    generateResumeSuggestion,
    viewInterviewPrep,
    closeInterviewPrep,
    generateInterviewPrep,
    clearArtifacts,
  } = useJobWorkspaceArtifacts({
    selectedItem,
    onLoadReport,
    onGenerateResumeSuggestions,
    onLoadResumeSuggestion,
    onGenerateInterviewPrep,
    onLoadInterviewPrep,
  });

  const {
    greetingDraft,
    greetingLoading,
    greetingSaving,
    saveGreetingDraft,
    clearGreetingDraft,
  } = useGreetingDraftEditor({
    selectedItem,
    onLoadGreetingDraft,
    onSaveGreetingDraft,
  });

  resetWorkspaceRef.current = () => {
    clearArtifacts();
    clearGreetingDraft();
  };

  const isSelectedResumeSuggesting = selectedItem ? suggestingSet.has(selectedItem.sourceKey) : false;
  const isSelectedInterviewPreparing = selectedItem ? preparingSet.has(selectedItem.sourceKey) : false;
  const isSelectedLlmEvaluating = selectedItem ? evaluatingSet.has(selectedItem.sourceKey) : false;

  const displayedPending = useMemo(() => {
    const filtered = statusFilter === 'all'
      ? pending
      : pending.filter((item) => item.decisionStatus === statusFilter);
    if (!sortByLlmScore) return filtered;
    return [...filtered].sort((a, b) => (b.llmScore ?? -1) - (a.llmScore ?? -1));
  }, [pending, sortByLlmScore, statusFilter]);

  useEffect(() => {
    if (initialSelectionAppliedRef.current || selectedSourceKey || !displayedPending.length) return;
    if (targetSourceKey && targetRequestId) return;
    initialSelectionAppliedRef.current = true;
    void selectItem(displayedPending[0]);
  }, [displayedPending, selectItem, selectedSourceKey, targetRequestId, targetSourceKey]);

  const riskText = (risk?: string) => {
    if (risk === 'matched') return t('pipeline.risk.ok');
    if (risk === 'near') return t('pipeline.risk.near');
    if (risk === 'risk') return t('pipeline.risk.risk');
    return t('pipeline.risk.unknown');
  };

  const changeStatus = async (sourceKey: string, decisionStatus: DecisionStatus) => {
    await onUpdateStatus(sourceKey, decisionStatus);
  };

  const deleteSelected = async () => {
    if (!selectedItem) return;
    const ok = window.confirm(t('pipeline.confirmDelete'));
    if (!ok) return;
    if (await onDeleteItem(selectedItem.sourceKey)) {
      clearSelection();
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">{t('pipeline.title')}</h2>
          <p className="text-xs text-zinc-500">
            {t('pipeline.pending', { n: pending.length.toLocaleString() })} / {t('pipeline.processed', { n: processed.length.toLocaleString() })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSortByLlmScore((value) => !value)}
            disabled={!pending.length}
            className={`inline-flex items-center gap-2 rounded border px-3 py-1.5 text-sm font-medium disabled:opacity-40 transition-colors ${sortByLlmScore ? 'border-emerald-800 bg-emerald-950/40 text-emerald-200' : 'border-zinc-800 text-zinc-300 hover:bg-zinc-900'}`}
          >
            <ArrowDownWideNarrow size={14} />
            {t('pipeline.llmSort')}
          </button>
          <button onClick={onRefresh} className="p-1.5 border border-zinc-800 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 transition-colors">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter.value}
            onClick={() => setStatusFilter(filter.value)}
            className={`rounded border px-2.5 py-1 text-xs font-medium transition-colors ${filter.value === 'all' ? (statusFilter === 'all' ? 'border-indigo-700 bg-indigo-950/40 text-indigo-200' : 'border-zinc-800 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200') : statusButtonClass(filter.value, statusFilter === filter.value)}`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/40">
        <aside className={`${selectedItem ? 'hidden lg:flex' : 'flex'} w-full shrink-0 flex-col border-r border-zinc-800 bg-zinc-950/70 lg:w-[23rem] xl:w-[26rem]`}>
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-zinc-100">{t('pipeline.title')}</div>
              <div className="mt-0.5 text-[11px] text-zinc-500">{t('pipeline.pending', { n: displayedPending.length.toLocaleString() })}</div>
            </div>
            {sortByLlmScore && (
              <span className="rounded border border-emerald-900/60 bg-emerald-950/30 px-2 py-1 text-[10px] font-medium text-emerald-300">
                {t('pipeline.llmSort')}
              </span>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {displayedPending.length ? (
            <div className="space-y-2">
              {displayedPending.map((item) => {
                const isLlmEvaluating = evaluatingSet.has(item.sourceKey);
                const materialReadyCount = [item.reportPath, item.resumeSuggestionPath, item.resumeDraftPath, item.interviewPrepPath].filter(Boolean).length;
                const isSelected = selectedSourceKey === item.sourceKey;
                return (
                  <button
                    key={item.sourceKey || item.raw}
                    type="button"
                    onClick={() => { void selectItem(item); }}
                    aria-pressed={isSelected}
                    className={`w-full rounded-md border p-3 text-left transition-colors ${isSelected ? 'border-indigo-700 bg-indigo-950/25 shadow-[inset_3px_0_0_0_rgb(79_70_229)]' : isLlmEvaluating ? 'border-emerald-900/60 bg-emerald-950/15 hover:bg-emerald-950/25' : 'border-zinc-800 bg-zinc-900/35 hover:border-zinc-700 hover:bg-zinc-900/70'}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-zinc-100" title={item.title}>{item.title}</div>
                        <div className="mt-1 truncate text-xs text-zinc-400" title={item.company}>{item.company}</div>
                      </div>
                      <span className={`shrink-0 rounded border px-2 py-1 text-[10px] ${statusBadgeClass(item.decisionStatus)}`}>
                        {getDecisionLabel(item.decisionStatus, t)}
                      </span>
                    </div>

                    <div className="mt-2 flex min-w-0 items-center gap-2 text-[11px] text-zinc-500">
                      <span className="truncate">{item.city || '-'}</span>
                      <span className="text-zinc-700">/</span>
                      <span className="shrink-0 font-medium text-emerald-400">{item.salary || '-'}</span>
                    </div>

                    <div className="mt-3 flex items-center gap-2">
                      <span className="rounded bg-zinc-800 px-2 py-1 text-[11px] font-medium text-zinc-200">
                        {t('pipeline.score')} {item.score != null ? item.score.toFixed(1) : '-'}
                      </span>
                      <span className={`rounded px-2 py-1 text-[11px] font-medium ${item.llmScore != null ? 'bg-emerald-950/60 text-emerald-300' : 'bg-zinc-900 text-zinc-600'}`}>
                        {isLlmEvaluating ? <Loader2 size={11} className="mr-1 inline animate-spin" /> : null}
                        {t('pipeline.llm')} {item.llmScore != null ? item.llmScore.toFixed(1) : '-'}
                      </span>
                      <span className="ml-auto text-[10px] text-zinc-500">{materialReadyCount}/4 {t('pipeline.materials')}</span>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-1">
                      <MaterialBadge label={t('pipeline.materialShort.llm')} ready={Boolean(item.reportPath)} tone="emerald" />
                      <MaterialBadge label={t('pipeline.materialShort.resumeSuggestion')} ready={Boolean(item.resumeSuggestionPath)} tone="indigo" />
                      <MaterialBadge label={t('pipeline.materialShort.resumeDraft')} ready={Boolean(item.resumeDraftPath)} tone="indigo" />
                      <MaterialBadge label={t('pipeline.materialShort.interviewPrep')} ready={Boolean(item.interviewPrepPath)} tone="cyan" />
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-zinc-500">
              {t('pipeline.noMatch')}
            </div>
          )}
          </div>
        </aside>

        {selectedItem && (
          <JobWorkspace
            item={selectedItem}
            evidenceOverview={evidenceOverview}
            evidenceLoading={evidenceLoading}
            evidenceError={evidenceError}
            onClassifyEvidenceCoverage={onClassifyEvidenceCoverage}
            onCreateEvidenceItem={onCreateEvidenceItem}
            onUpdateEvidenceItem={onUpdateEvidenceItem}
            onConfirmEvidenceItem={onConfirmEvidenceItem}
            onCreateEvidenceTask={onCreateEvidenceTask}
            onOpenPersonalResume={onOpenPersonalResume}
            targetRequirementId={targetRequirementId}
            targetRequestId={targetRequestId}
            job={selectedJob}
            detailLoading={detailLoading}
            statusOptions={STATUS_OPTIONS}
            onClose={clearSelection}
            onStatusChange={(status) => { void changeStatus(selectedItem.sourceKey, status); }}
            onDelete={deleteSelected}
            onLlmEvaluate={() => onLlmEvaluate(selectedItem.sourceKey)}
            isLlmEvaluating={isSelectedLlmEvaluating}
            onViewReport={viewReport}
            reportLoading={reportLoading}
            greetingDraft={greetingDraft}
            greetingLoading={greetingLoading}
            greetingSaving={greetingSaving}
            onSaveGreetingDraft={saveGreetingDraft}
            onGenerateResumeSuggestions={generateResumeSuggestion}
            onViewResumeSuggestion={viewResumeSuggestion}
            isResumeSuggesting={isSelectedResumeSuggesting}
            resumeLoading={resumeLoading}
            onGenerateInterviewPrep={generateInterviewPrep}
            onViewInterviewPrep={viewInterviewPrep}
            isInterviewPreparing={isSelectedInterviewPreparing}
            interviewLoading={interviewLoading}
            onOpenResumeMaterials={() => onOpenResumeMaterials({
              sourceKey: selectedItem.sourceKey,
              jobId: selectedItem.jobId,
              company: selectedItem.company,
              title: selectedItem.title,
              city: selectedItem.city,
            })}
            layout="embedded"
          />
        )}
        {!selectedItem && (
          <div className="hidden min-w-0 flex-1 items-center justify-center bg-zinc-950/30 p-8 text-center lg:flex">
            <div className="max-w-sm">
              <BookOpenText className="mx-auto text-zinc-700" size={30} />
              <div className="mt-3 text-sm font-medium text-zinc-300">{t('resume.selectJob')}</div>
              <div className="mt-1 text-xs leading-relaxed text-zinc-600">{t('pipeline.noMatch')}</div>
            </div>
          </div>
        )}
      </div>

      {pipeline?.path && (
        <div className="mt-3 text-xs text-zinc-600 truncate">
          {t('pipeline.sourceFile', { path: pipeline.path })}
        </div>
      )}

      {report && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6 py-5"
          onClick={closeReport}
        >
          <div
            className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-zinc-800 px-5 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <BookOpenText size={16} className="text-emerald-400" />
                  <h3 className="truncate text-base font-semibold text-zinc-100">{report.title || t('pipeline.report', { id: report.reportId })}</h3>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                  {report.reportId && <span>{t('pipeline.report', { id: report.reportId })}</span>}
                  <span className="max-w-3xl truncate">{report.reportPath}</span>
                </div>
              </div>
              <button
                onClick={closeReport}
                className="rounded border border-zinc-800 p-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            <div className="overflow-auto px-8 py-6">
              <article className="max-w-none text-sm leading-7 text-zinc-300 [&_h1]:mb-5 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-zinc-100 [&_h2]:mb-3 [&_h2]:mt-8 [&_h2]:border-b [&_h2]:border-zinc-800 [&_h2]:pb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-zinc-100 [&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:font-semibold [&_h3]:text-zinc-100 [&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_strong]:text-zinc-100 [&_code]:rounded [&_code]:bg-zinc-900 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-emerald-300 [&_pre]:my-4 [&_pre]:overflow-auto [&_pre]:rounded [&_pre]:border [&_pre]:border-zinc-800 [&_pre]:bg-zinc-900 [&_pre]:p-4 [&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-zinc-800 [&_th]:bg-zinc-900 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-zinc-100 [&_td]:border [&_td]:border-zinc-800 [&_td]:px-3 [&_td]:py-2 [&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-emerald-700 [&_blockquote]:pl-4 [&_blockquote]:text-zinc-400">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {report.content}
                </ReactMarkdown>
              </article>
            </div>
          </div>
        </div>
      )}

      {resumeSuggestion && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6 py-5"
          onClick={closeResumeSuggestion}
        >
          <div
            className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-zinc-800 px-5 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <FileText size={16} className="text-indigo-400" />
                  <h3 className="truncate text-base font-semibold text-zinc-100">
                    {t('resume.suggestions', { id: resumeSuggestion.resumeSuggestionId })}
                  </h3>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                  <span className="max-w-3xl truncate">{resumeSuggestion.suggestionPath}</span>
                </div>
              </div>
              <button
                onClick={closeResumeSuggestion}
                className="rounded border border-zinc-800 p-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            <div className="overflow-auto px-8 py-6">
              <article className="max-w-none text-sm leading-7 text-zinc-300 [&_h1]:mb-5 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-zinc-100 [&_h2]:mb-3 [&_h2]:mt-8 [&_h2]:border-b [&_h2]:border-zinc-800 [&_h2]:pb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-zinc-100 [&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:font-semibold [&_h3]:text-zinc-100 [&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_strong]:text-zinc-100 [&_code]:rounded [&_code]:bg-zinc-900 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-indigo-300 [&_pre]:my-4 [&_pre]:overflow-auto [&_pre]:rounded [&_pre]:border [&_pre]:border-zinc-800 [&_pre]:bg-zinc-900 [&_pre]:p-4 [&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-zinc-800 [&_th]:bg-zinc-900 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-zinc-100 [&_td]:border [&_td]:border-zinc-800 [&_td]:px-3 [&_td]:py-2 [&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-indigo-700 [&_blockquote]:pl-4 [&_blockquote]:text-zinc-400">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {resumeSuggestion.content}
                </ReactMarkdown>
              </article>
            </div>
          </div>
        </div>
      )}

      {interviewPrep && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6 py-5"
          onClick={closeInterviewPrep}
        >
          <div
            className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-zinc-800 px-5 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <BrainCircuit size={16} className="text-cyan-400" />
                  <h3 className="truncate text-base font-semibold text-zinc-100">
                    {t('pipeline.interviewPrepTitle', { id: interviewPrep.interviewPrepId })}
                  </h3>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                  <span className="max-w-3xl truncate">{interviewPrep.prepPath}</span>
                </div>
              </div>
              <button
                onClick={closeInterviewPrep}
                className="rounded border border-zinc-800 p-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            <div className="overflow-auto px-8 py-6">
              <article className="max-w-none text-sm leading-7 text-zinc-300 [&_h1]:mb-5 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-zinc-100 [&_h2]:mb-3 [&_h2]:mt-8 [&_h2]:border-b [&_h2]:border-zinc-800 [&_h2]:pb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-zinc-100 [&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:font-semibold [&_h3]:text-zinc-100 [&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_strong]:text-zinc-100 [&_code]:rounded [&_code]:bg-zinc-900 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-cyan-300 [&_pre]:my-4 [&_pre]:overflow-auto [&_pre]:rounded [&_pre]:border [&_pre]:border-zinc-800 [&_pre]:bg-zinc-900 [&_pre]:p-4 [&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-zinc-800 [&_th]:bg-zinc-900 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-zinc-100 [&_td]:border [&_td]:border-zinc-800 [&_td]:px-3 [&_td]:py-2 [&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-cyan-700 [&_blockquote]:pl-4 [&_blockquote]:text-zinc-400">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {interviewPrep.content}
                </ReactMarkdown>
              </article>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
