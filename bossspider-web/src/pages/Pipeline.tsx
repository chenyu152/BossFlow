import { ArrowDownWideNarrow, BookOpenText, FileText, Loader2, RefreshCw, Trash2, Wand2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { DetailItem } from '../components/DetailItem';
import { JobDescription } from '../components/JobDescription';
import type { DecisionStatus, Job, PipelineItem, PipelineReportResponse, PipelineResponse, ResumeSuggestionResponse } from '../types';

const DECISION_LABELS: Record<DecisionStatus, string> = {
  needs_llm: '待精评',
  needs_review: '待确认',
  ready_to_greet: '可打招呼',
  greeted: '已打招呼',
  skipped: '跳过',
};

const STATUS_OPTIONS: Array<{ value: DecisionStatus; label: string }> = [
  { value: 'needs_llm', label: '待精评' },
  { value: 'needs_review', label: '待确认' },
  { value: 'ready_to_greet', label: '可打招呼' },
  { value: 'greeted', label: '已打招呼' },
  { value: 'skipped', label: '跳过' },
];

const STATUS_FILTERS: Array<{ value: 'all' | DecisionStatus; label: string }> = [
  { value: 'all', label: 'All' },
  ...STATUS_OPTIONS,
];

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
  skipped: {
    badge: 'border-red-900/60 bg-red-950/40 text-red-300',
    active: 'border-red-700 bg-red-950/50 text-red-200',
    idle: 'border-red-950/70 text-red-400 hover:bg-red-950/30',
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

export function Pipeline({
  pipeline,
  onRefresh,
  onEvaluate,
  onScoreAll,
  onLlmEvaluate,
  llmEvaluatingKeys,
  resumeSuggestingKeys,
  sortByLlmScore,
  setSortByLlmScore,
  onLoadJobDetail,
  onLoadReport,
  onGenerateResumeSuggestions,
  onLoadResumeSuggestion,
  onUpdateStatus,
  onDeleteItem,
}: {
  pipeline: PipelineResponse | null;
  onRefresh: () => void;
  onEvaluate: (sourceKey: string) => void;
  onScoreAll: () => void;
  onLlmEvaluate: (sourceKey: string) => void;
  llmEvaluatingKeys: string[];
  resumeSuggestingKeys: string[];
  sortByLlmScore: boolean;
  setSortByLlmScore: (value: boolean | ((current: boolean) => boolean)) => void;
  onLoadJobDetail: (project: string, jobId: number) => Promise<Job | null>;
  onLoadReport: (sourceKey: string) => Promise<PipelineReportResponse | null>;
  onGenerateResumeSuggestions: (sourceKey: string) => Promise<ResumeSuggestionResponse | null>;
  onLoadResumeSuggestion: (sourceKey: string) => Promise<ResumeSuggestionResponse | null>;
  onUpdateStatus: (sourceKey: string, decisionStatus: string) => Promise<boolean>;
  onDeleteItem: (sourceKey: string) => Promise<boolean>;
}) {
  const pending = pipeline?.pending || [];
  const processed = pipeline?.processed || [];
  const [statusFilter, setStatusFilter] = useState<'all' | DecisionStatus>('all');
  const [selectedSourceKey, setSelectedSourceKey] = useState('');
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [report, setReport] = useState<PipelineReportResponse | null>(null);
  const [resumeSuggestion, setResumeSuggestion] = useState<ResumeSuggestionResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [resumeLoading, setResumeLoading] = useState(false);
  const evaluatingSet = new Set(llmEvaluatingKeys);
  const suggestingSet = new Set(resumeSuggestingKeys);

  const selectedItem = useMemo(
    () => pending.find((item) => item.sourceKey === selectedSourceKey) || null,
    [pending, selectedSourceKey],
  );
  const isSelectedResumeSuggesting = selectedItem ? suggestingSet.has(selectedItem.sourceKey) : false;

  const displayedPending = useMemo(() => {
    const filtered = statusFilter === 'all'
      ? pending
      : pending.filter((item) => item.decisionStatus === statusFilter);
    if (!sortByLlmScore) return filtered;
    return [...filtered].sort((a, b) => (b.llmScore ?? -1) - (a.llmScore ?? -1));
  }, [pending, sortByLlmScore, statusFilter]);

  useEffect(() => {
    if (selectedSourceKey && !selectedItem) {
      setSelectedSourceKey('');
      setSelectedJob(null);
      setReport(null);
      setResumeSuggestion(null);
    }
  }, [selectedItem, selectedSourceKey]);

  const riskText = (risk?: string) => {
    if (risk === 'matched') return 'ok';
    if (risk === 'near') return 'near';
    if (risk === 'risk') return 'risk';
    return 'unknown';
  };

  const selectItem = async (item: PipelineItem) => {
    setSelectedSourceKey(item.sourceKey);
    setSelectedJob(null);
    setReport(null);
    setResumeSuggestion(null);
    if (!item.project || !item.jobId) return;
    setDetailLoading(true);
    try {
      const job = await onLoadJobDetail(item.project, item.jobId);
      if (job) setSelectedJob(job);
    } finally {
      setDetailLoading(false);
    }
  };

  const viewReport = async () => {
    if (!selectedItem?.reportPath) return;
    if (report?.sourceKey === selectedItem.sourceKey) {
      setReport(null);
      return;
    }
    setReportLoading(true);
    try {
      const data = await onLoadReport(selectedItem.sourceKey);
      if (data) setReport(data);
    } finally {
      setReportLoading(false);
    }
  };

  const viewResumeSuggestion = async () => {
    if (!selectedItem?.resumeSuggestionPath) return;
    if (resumeSuggestion?.sourceKey === selectedItem.sourceKey) {
      setResumeSuggestion(null);
      return;
    }
    setResumeLoading(true);
    try {
      const data = await onLoadResumeSuggestion(selectedItem.sourceKey);
      if (data) setResumeSuggestion(data);
    } finally {
      setResumeLoading(false);
    }
  };

  const generateResumeSuggestion = async () => {
    if (!selectedItem) return;
    setResumeLoading(true);
    try {
      const data = await onGenerateResumeSuggestions(selectedItem.sourceKey);
      if (data) setResumeSuggestion(data);
    } finally {
      setResumeLoading(false);
    }
  };

  const changeStatus = async (sourceKey: string, decisionStatus: DecisionStatus) => {
    await onUpdateStatus(sourceKey, decisionStatus);
  };

  const deleteSelected = async () => {
    if (!selectedItem) return;
    const ok = window.confirm('Delete this pipeline item and its generated LLM report?');
    if (!ok) return;
    if (await onDeleteItem(selectedItem.sourceKey)) {
      setSelectedSourceKey('');
      setSelectedJob(null);
      setReport(null);
      setResumeSuggestion(null);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Pipeline</h2>
          <p className="text-xs text-zinc-500">
            Pending {pending.length.toLocaleString()} / Processed {processed.length.toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSortByLlmScore((value) => !value)}
            disabled={!pending.length}
            className={`inline-flex items-center gap-2 rounded border px-3 py-1.5 text-sm font-medium disabled:opacity-40 transition-colors ${sortByLlmScore ? 'border-emerald-800 bg-emerald-950/40 text-emerald-200' : 'border-zinc-800 text-zinc-300 hover:bg-zinc-900'}`}
          >
            <ArrowDownWideNarrow size={14} />
            LLM sort
          </button>
          <button
            onClick={onScoreAll}
            disabled={!pending.length}
            className="inline-flex items-center gap-2 rounded border border-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-300 hover:bg-zinc-900 disabled:opacity-40 transition-colors"
          >
            <Wand2 size={14} />
            Rescore pending
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

      <div className="border border-zinc-800 rounded-md bg-zinc-900/20 overflow-hidden flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden">
          {displayedPending.length ? (
            <table className="w-full table-fixed text-left text-xs">
              <colgroup>
                <col className="w-[7%]" />
                <col className="w-[14%]" />
                <col className="w-[20%]" />
                <col className="w-[5%]" />
                <col className="w-[8%]" />
                <col className="w-[11%]" />
                <col className="w-[18%]" />
                <col className="w-[6%]" />
                <col className="w-[11%]" />
              </colgroup>
              <thead className="sticky top-0 bg-zinc-950 border-b border-zinc-800 shadow-sm z-10">
                <tr>
                  <th className="px-4 py-2.5 font-medium text-zinc-400">Status</th>
                  <th className="px-4 py-2.5 font-medium text-zinc-400">Company</th>
                  <th className="px-4 py-2.5 font-medium text-zinc-400">Title</th>
                  <th className="px-4 py-2.5 font-medium text-zinc-400">City</th>
                  <th className="px-4 py-2.5 font-medium text-zinc-400">Salary</th>
                  <th className="px-4 py-2.5 font-medium text-zinc-400">Score</th>
                  <th className="px-4 py-2.5 font-medium text-zinc-400">LLM</th>
                  <th className="px-4 py-2.5 font-medium text-zinc-400">Added</th>
                  <th className="px-4 py-2.5 font-medium text-zinc-400 w-40">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {displayedPending.map((item) => {
                  const isLlmEvaluating = evaluatingSet.has(item.sourceKey);
                  return (
                    <tr
                      key={item.sourceKey || item.raw}
                      onClick={() => { void selectItem(item); }}
                      className={`${selectedSourceKey === item.sourceKey ? 'bg-zinc-800/60' : ''} ${isLlmEvaluating ? 'bg-emerald-950/15 hover:bg-emerald-950/25' : 'hover:bg-zinc-800/40'} cursor-pointer transition-colors`}
                    >
                      <td className="px-4 py-2">
                        <span className={`rounded border px-2 py-1 text-[10px] ${statusBadgeClass(item.decisionStatus)}`}>
                          {DECISION_LABELS[item.decisionStatus] || item.decisionStatus}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-zinc-200 font-medium truncate" title={item.company}>{item.company}</td>
                      <td className="px-4 py-2 text-zinc-300 truncate" title={item.title}>{item.title}</td>
                      <td className="px-4 py-2 text-zinc-400 truncate" title={item.city}>{item.city}</td>
                      <td className="px-4 py-2 text-emerald-400 truncate" title={item.salary}>{item.salary}</td>
                      <td className="px-4 py-2">
                        {item.score ? (
                          <div className="space-y-1">
                            <span className="inline-flex items-center gap-1.5 rounded bg-zinc-800 px-2 py-1 text-zinc-200">
                              {item.score.toFixed(1)}
                              <span className="text-[10px] text-zinc-500">{item.fitLevel}</span>
                            </span>
                            <div className="text-[10px] text-zinc-500">
                              Exp {riskText(item.experienceRisk)} / Edu {riskText(item.educationRisk)}
                            </div>
                          </div>
                        ) : (
                          <span className="text-zinc-600">-</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {isLlmEvaluating ? (
                          <div className="inline-flex items-center gap-2 rounded bg-emerald-950/60 px-2 py-1 text-emerald-300">
                            <Loader2 size={12} className="animate-spin" />
                            Generating
                          </div>
                        ) : item.reportPath ? (
                          <div className="min-w-0 space-y-1">
                            <span className="inline-flex items-center gap-1.5 rounded bg-emerald-950/60 px-2 py-1 text-emerald-300">
                              {item.llmScore ? item.llmScore.toFixed(1) : item.reportId}
                              <span className="text-[10px] text-emerald-500">{item.llmFitLevel || 'Report'}</span>
                            </span>
                            <div className="truncate text-[10px] text-zinc-500" title={item.llmRecommendation || item.reportPath}>
                              {item.llmRecommendation || item.reportPath}
                            </div>
                          </div>
                        ) : (
                          <span className="text-zinc-600">-</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-zinc-500 truncate" title={item.addedAt || '-'}>{item.addedAt || '-'}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              onEvaluate(item.sourceKey);
                            }}
                            className="inline-flex items-center gap-1.5 rounded border border-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
                          >
                            <Wand2 size={13} />
                            Score
                          </button>
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              onLlmEvaluate(item.sourceKey);
                            }}
                            disabled={isLlmEvaluating}
                            className="inline-flex items-center gap-1.5 rounded border border-emerald-900/70 bg-emerald-950/30 px-2.5 py-1 text-xs font-medium text-emerald-300 hover:bg-emerald-900/40 disabled:cursor-wait disabled:opacity-60 transition-colors"
                          >
                            {isLlmEvaluating ? (
                              <>
                                <Loader2 size={13} className="animate-spin" />
                                Generating
                              </>
                            ) : (
                              'LLM Eval'
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-zinc-500">
              No pipeline jobs match this filter.
            </div>
          )}
        </div>

        {selectedItem && (
          <div className="w-96 border-l border-zinc-800 bg-zinc-950 flex flex-col shrink-0">
            <div className="flex items-center justify-between p-4 border-b border-zinc-800">
              <h3 className="font-semibold text-zinc-100">Job Details</h3>
              <button onClick={() => setSelectedSourceKey('')} className="text-zinc-500 hover:text-zinc-300">
                <X size={16} />
              </button>
            </div>
            <div className="p-4 flex-1 overflow-y-auto space-y-5">
              <div className="grid grid-cols-2 gap-2">
                {STATUS_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => { void changeStatus(selectedItem.sourceKey, option.value); }}
                    className={`rounded border px-2.5 py-1.5 text-xs font-medium transition-colors ${statusButtonClass(option.value, selectedItem.decisionStatus === option.value)}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <button
                onClick={deleteSelected}
                className="w-full flex items-center justify-center gap-2 rounded border border-red-900/70 bg-red-950/20 px-3 py-2 text-sm font-medium text-red-300 hover:bg-red-950/40 transition-colors"
              >
                <Trash2 size={15} />
                Delete item and report
              </button>

              {detailLoading && (
                <div className="flex items-center gap-2 text-sm text-zinc-500">
                  <Loader2 size={14} className="animate-spin" />
                  Loading details
                </div>
              )}

              <DetailItem label="Title" value={selectedItem.title} strong />
              <div className="grid grid-cols-2 gap-4">
                <DetailItem label="Company" value={selectedItem.company} />
                <DetailItem label="City" value={selectedItem.city} />
                <DetailItem label="Salary" value={selectedItem.salary} accent />
                <DetailItem label="Avg Salary" value={`${(selectedJob?.avg ?? selectedItem.avg ?? 0).toFixed(1)}k`} />
                <DetailItem label="Experience" value={selectedJob?.exp || '-'} />
                <DetailItem label="Education" value={selectedJob?.edu || '-'} />
              </div>

              <div className="rounded border border-zinc-800 bg-zinc-900/50 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-500">Score</span>
                  <span className="text-sm font-semibold text-zinc-100">{selectedItem.score ? selectedItem.score.toFixed(1) : '-'} / 5.0</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-zinc-400">
                  <div>Coverage {selectedItem.coverage ?? 0}%</div>
                  <div>JD {selectedItem.jdQuality ?? 0}%</div>
                  <div>Exp {riskText(selectedItem.experienceRisk)}</div>
                  <div>Edu {riskText(selectedItem.educationRisk)}</div>
                </div>
              </div>

              {(selectedItem.reportPath || selectedItem.llmRecommendation) && (
                <div className="rounded border border-emerald-900/50 bg-emerald-950/20 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-emerald-500">LLM</span>
                    <span className="text-sm font-semibold text-emerald-200">{selectedItem.llmScore ? selectedItem.llmScore.toFixed(1) : selectedItem.reportId || '-'} / 5.0</span>
                  </div>
                  {selectedItem.llmFitLevel && <div className="text-xs text-emerald-400">{selectedItem.llmFitLevel}</div>}
                  {selectedItem.llmRecommendation && <div className="text-xs leading-relaxed text-zinc-300">{selectedItem.llmRecommendation}</div>}
                  {selectedItem.reportPath && (
                    <>
                      <div className="break-all text-[10px] text-zinc-500">{selectedItem.reportPath}</div>
                      <button
                        onClick={viewReport}
                        disabled={reportLoading}
                        className="inline-flex items-center gap-2 rounded border border-emerald-900/70 px-2.5 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-950/40 disabled:opacity-50 transition-colors"
                      >
                        {reportLoading ? <Loader2 size={13} className="animate-spin" /> : <BookOpenText size={13} />}
                        View report
                      </button>
                    </>
                  )}
                </div>
              )}

              <div className="rounded border border-indigo-900/50 bg-indigo-950/20 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-indigo-400">Resume</span>
                  {selectedItem.resumeSuggestionId && (
                    <span className="text-xs font-semibold text-indigo-200">{selectedItem.resumeSuggestionId}</span>
                  )}
                </div>
                <div className="text-xs leading-relaxed text-zinc-400">
                  Generate JD-specific resume suggestions first. This will not change cv.md.
                </div>
                {selectedItem.resumeSuggestedAt && (
                  <div className="text-[10px] text-zinc-500">Generated {selectedItem.resumeSuggestedAt}</div>
                )}
                {selectedItem.resumeSuggestionPath && (
                  <div className="break-all text-[10px] text-zinc-500">{selectedItem.resumeSuggestionPath}</div>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={generateResumeSuggestion}
                    disabled={isSelectedResumeSuggesting || resumeLoading}
                    className="inline-flex items-center gap-2 rounded border border-indigo-800/70 bg-indigo-950/40 px-2.5 py-1.5 text-xs font-medium text-indigo-200 hover:bg-indigo-900/40 disabled:cursor-wait disabled:opacity-60 transition-colors"
                  >
                    {isSelectedResumeSuggesting || resumeLoading ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
                    {selectedItem.resumeSuggestionPath ? 'Regenerate suggestions' : 'Generate suggestions'}
                  </button>
                  {selectedItem.resumeSuggestionPath && (
                    <button
                      onClick={viewResumeSuggestion}
                      disabled={resumeLoading}
                      className="inline-flex items-center gap-2 rounded border border-zinc-800 px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-900 disabled:opacity-50 transition-colors"
                    >
                      {resumeLoading ? <Loader2 size={13} className="animate-spin" /> : <BookOpenText size={13} />}
                      View suggestions
                    </button>
                  )}
                </div>
              </div>

              <div>
                <div className="text-xs text-zinc-500 mb-1">Category</div>
                <div className="flex flex-wrap gap-1.5">
                  {((selectedJob?.cats.length ? selectedJob.cats : [selectedJob?.tier || '-'])).map((cat) => (
                    <span key={cat} className="px-2 py-1 rounded bg-zinc-800 text-zinc-300 text-xs">{cat}</span>
                  ))}
                </div>
              </div>

              <JobDescription text={selectedJob?.desc} />

              {(selectedJob?.url || selectedItem.url) && (
                <a href={selectedJob?.url || selectedItem.url} target="_blank" rel="noreferrer" className="text-xs text-indigo-400 hover:underline">
                  View Original Link
                </a>
              )}
            </div>
          </div>
        )}
      </div>

      {pipeline?.path && (
        <div className="mt-3 text-xs text-zinc-600 truncate">
          Source file: {pipeline.path}
        </div>
      )}

      {report && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6 py-5"
          onClick={() => setReport(null)}
        >
          <div
            className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-zinc-800 px-5 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <BookOpenText size={16} className="text-emerald-400" />
                  <h3 className="truncate text-base font-semibold text-zinc-100">{report.title || `Report ${report.reportId}`}</h3>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                  {report.reportId && <span>Report {report.reportId}</span>}
                  <span className="max-w-3xl truncate">{report.reportPath}</span>
                </div>
              </div>
              <button
                onClick={() => setReport(null)}
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
          onClick={() => setResumeSuggestion(null)}
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
                    Resume Suggestions {resumeSuggestion.resumeSuggestionId}
                  </h3>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                  <span className="max-w-3xl truncate">{resumeSuggestion.suggestionPath}</span>
                </div>
              </div>
              <button
                onClick={() => setResumeSuggestion(null)}
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
    </div>
  );
}
