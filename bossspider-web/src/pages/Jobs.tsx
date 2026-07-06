import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownWideNarrow, CheckSquare, Download, ListPlus, Loader2, RefreshCw, Search, Square, Wand2, X } from 'lucide-react';
import { DetailItem } from '../components/DetailItem';
import type { Job } from '../types';

export function Jobs({
  jobs,
  total,
  search,
  setSearch,
  sortByScore,
  setSortByScore,
  onRefresh,
  onExport,
  onScoreJobs,
  scoringJobIds,
  onAddToPipeline,
}: {
  jobs: Job[];
  total: number;
  search: string;
  setSearch: (value: string) => void;
  sortByScore: boolean;
  setSortByScore: (value: boolean | ((current: boolean) => boolean)) => void;
  onRefresh: () => void;
  onExport: () => void;
  onScoreJobs: (jobIds: number[]) => void;
  scoringJobIds: number[];
  onAddToPipeline: (jobs: Job[]) => void;
}) {
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const dragStateRef = useRef<{
    active: boolean;
    anchorIndex: number;
    baseIds: Set<number>;
    moved: boolean;
    mode: 'add' | 'remove';
  }>({
    active: false,
    anchorIndex: -1,
    baseIds: new Set(),
    moved: false,
    mode: 'add',
  });
  const suppressRowClickRef = useRef(false);
  const [dragRange, setDragRange] = useState<{ start: number; end: number } | null>(null);

  const displayJobs = useMemo(() => {
    if (!sortByScore) return jobs;
    return [...jobs].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  }, [jobs, sortByScore]);
  const totalPages = Math.max(1, Math.ceil(displayJobs.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const pageEnd = Math.min(pageStart + pageSize, displayJobs.length);
  const pageJobs = displayJobs.slice(pageStart, pageEnd);
  const selectedJobs = jobs.filter((job) => selectedIds.has(job.id));
  const allVisibleSelected = pageJobs.length > 0 && pageJobs.every((job) => selectedIds.has(job.id));
  const visibleIds = pageJobs.map((job) => job.id);
  const allIds = displayJobs.map((job) => job.id);
  const scoringSet = new Set(scoringJobIds);
  const scoringVisible = visibleIds.some((id) => scoringSet.has(id));
  const scoringAll = allIds.some((id) => scoringSet.has(id));
  const scoringSelected = selectedJobs.some((job) => scoringSet.has(job.id));

  useEffect(() => {
    if (selectedJob) {
      const updated = jobs.find((job) => job.id === selectedJob.id);
      setSelectedJob(updated || null);
    }
    setSelectedIds((current) => new Set([...current].filter((id) => jobs.some((job) => job.id === id))));
  }, [jobs, selectedJob]);

  useEffect(() => {
    setPage(1);
  }, [search, sortByScore, pageSize]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  useEffect(() => {
    const stopDrag = () => {
      const drag = dragStateRef.current;
      if (!drag.active) return;
      if (drag.moved) {
        suppressRowClickRef.current = true;
        window.setTimeout(() => {
          suppressRowClickRef.current = false;
        }, 0);
      }
      dragStateRef.current = { active: false, anchorIndex: -1, baseIds: new Set(), moved: false, mode: 'add' };
      setDragRange(null);
    };

    window.addEventListener('mouseup', stopDrag);
    return () => window.removeEventListener('mouseup', stopDrag);
  }, []);

  const toggleJob = (jobId: number) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) pageJobs.forEach((job) => next.delete(job.id));
      else pageJobs.forEach((job) => next.add(job.id));
      return next;
    });
  };

  const isInteractiveTarget = (target: EventTarget | null) => (
    target instanceof HTMLElement
    && Boolean(target.closest('button, a, input, select, textarea'))
  );

  const beginRowDrag = (event: React.MouseEvent, index: number) => {
    if (event.button !== 0 || isInteractiveTarget(event.target)) return;
    event.preventDefault();
    const job = pageJobs[index];
    dragStateRef.current = {
      active: true,
      anchorIndex: index,
      baseIds: new Set(selectedIds),
      moved: false,
      mode: job && selectedIds.has(job.id) ? 'remove' : 'add',
    };
  };

  const beginSelectionDrag = (event: React.MouseEvent, index: number) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    event.preventDefault();
    const job = pageJobs[index];
    dragStateRef.current = {
      active: true,
      anchorIndex: index,
      baseIds: new Set(selectedIds),
      moved: false,
      mode: job && selectedIds.has(job.id) ? 'remove' : 'add',
    };
  };

  const updateRowDrag = (index: number) => {
    const drag = dragStateRef.current;
    if (!drag.active || drag.anchorIndex < 0) return;
    if (index === drag.anchorIndex && !drag.moved) return;
    drag.moved = true;
    const start = Math.min(drag.anchorIndex, index);
    const end = Math.max(drag.anchorIndex, index);
    setDragRange({ start, end });
    setSelectedIds(() => {
      const next = new Set(drag.baseIds);
      for (let cursor = start; cursor <= end; cursor += 1) {
        const job = pageJobs[cursor];
        if (!job) continue;
        if (drag.mode === 'add') next.add(job.id);
        else next.delete(job.id);
      }
      return next;
    });
  };

  const toggleSelectionCell = (event: React.MouseEvent, jobId: number) => {
    event.stopPropagation();
    if (suppressRowClickRef.current) return;
    toggleJob(jobId);
  };

  const openJobDetails = (job: Job) => {
    if (suppressRowClickRef.current) return;
    setSelectedJob(job);
  };

  const riskText = (risk?: string) => {
    if (risk === 'matched') return 'ok';
    if (risk === 'near') return 'near';
    if (risk === 'risk') return 'risk';
    return 'unknown';
  };

  return (
    <div className="h-full flex flex-col relative">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-2 text-zinc-500" size={14} />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') onRefresh(); }}
              placeholder="Search title, company..."
              className="w-full bg-zinc-900/50 border border-zinc-800 rounded text-sm pl-8 pr-3 py-1.5 text-zinc-200 outline-none focus:border-indigo-500 transition-colors"
            />
          </div>
          <button onClick={onRefresh} className="p-1.5 border border-zinc-800 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 transition-colors">
            <RefreshCw size={14} />
          </button>
          <span className="text-xs text-zinc-500">
            {jobs.length >= total ? `All ${total.toLocaleString()}` : `${jobs.length.toLocaleString()} / ${total.toLocaleString()}`}
          </span>
          <button
            onClick={() => onScoreJobs(visibleIds)}
            disabled={!visibleIds.length || scoringVisible}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium border border-zinc-800 text-zinc-300 hover:bg-zinc-900 disabled:opacity-40 rounded transition-colors"
          >
            {scoringVisible ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
            Score page
          </button>
          <button
            onClick={() => onScoreJobs(allIds)}
            disabled={!allIds.length || scoringAll}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium border border-zinc-800 text-zinc-300 hover:bg-zinc-900 disabled:opacity-40 rounded transition-colors"
          >
            {scoringAll ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
            Score all
          </button>
          <button
            onClick={() => onScoreJobs(selectedJobs.map((job) => job.id))}
            disabled={!selectedJobs.length || scoringSelected}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium border border-zinc-800 text-zinc-300 hover:bg-zinc-900 disabled:opacity-40 rounded transition-colors"
          >
            {scoringSelected ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
            Score selected
          </button>
          <button
            onClick={() => setSortByScore((value) => !value)}
            className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium border rounded transition-colors ${sortByScore ? 'border-indigo-700 bg-indigo-950/40 text-indigo-200' : 'border-zinc-800 text-zinc-300 hover:bg-zinc-900'}`}
          >
            <ArrowDownWideNarrow size={14} />
            Score sort
          </button>
          <button
            onClick={() => onAddToPipeline(selectedJobs)}
            disabled={!selectedJobs.length}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:hover:bg-indigo-600 text-white rounded transition-colors"
          >
            <ListPlus size={14} />
            Add selected
            {selectedJobs.length > 0 && <span className="text-indigo-100">({selectedJobs.length})</span>}
          </button>
          {selectedJobs.length > 0 && (
            <button onClick={() => setSelectedIds(new Set())} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
              Clear
            </button>
          )}
        </div>
        <button onClick={onExport} className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium border border-zinc-800 text-zinc-300 hover:bg-zinc-900 rounded transition-colors">
          <Download size={14} />
          Export Excel
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-500">
        <div>
          Showing {displayJobs.length ? pageStart + 1 : 0}-{pageEnd} / {displayJobs.length.toLocaleString()}
          {selectedJobs.length > 0 && <span className="ml-2 text-indigo-300">Selected {selectedJobs.length}</span>}
        </div>
        <div className="flex items-center gap-2">
          <span>Rows</span>
          <select
            value={pageSize}
            onChange={(event) => setPageSize(Number(event.target.value))}
            className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 outline-none focus:border-indigo-600"
          >
            {[100, 200, 500].map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
          <button
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={safePage <= 1}
            className="rounded border border-zinc-800 px-2 py-1 text-zinc-300 hover:bg-zinc-900 disabled:opacity-40"
          >
            Prev
          </button>
          <span>Page {safePage} / {totalPages}</span>
          <button
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            disabled={safePage >= totalPages}
            className="rounded border border-zinc-800 px-2 py-1 text-zinc-300 hover:bg-zinc-900 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 border border-zinc-800 rounded-md bg-zinc-900/20 overflow-hidden flex">
        <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden">
          <table className="w-full table-fixed text-left text-xs select-none">
            <colgroup>
              <col className="w-[4%]" />
              <col className="w-[4%]" />
              <col className="w-[22%]" />
              <col className="w-[22%]" />
              <col className="w-[7%]" />
              <col className="w-[10%]" />
              <col className="w-[12%]" />
              <col className="w-[6%]" />
              <col className="w-[8%]" />
              <col className="w-[5%]" />
            </colgroup>
            <thead className="sticky top-0 bg-zinc-950 border-b border-zinc-800 shadow-sm z-10">
              <tr>
                <th className="font-medium text-zinc-400 w-12">
                  <button
                    onClick={toggleAllVisible}
                    className="flex h-full w-full items-center px-4 py-2.5 text-zinc-500 hover:bg-indigo-950/20 hover:text-zinc-200 transition-colors"
                    title={allVisibleSelected ? 'Unselect visible jobs' : 'Select visible jobs'}
                  >
                    {allVisibleSelected ? <CheckSquare size={15} /> : <Square size={15} />}
                  </button>
                </th>
                <th className="px-4 py-2.5 font-medium text-zinc-400 w-16">#</th>
                <th className="px-4 py-2.5 font-medium text-zinc-400">Title</th>
                <th className="px-4 py-2.5 font-medium text-zinc-400">Company</th>
                <th className="px-4 py-2.5 font-medium text-zinc-400">City</th>
                <th className="px-4 py-2.5 font-medium text-zinc-400">Salary</th>
                <th className="px-4 py-2.5 font-medium text-zinc-400">Score</th>
                <th className="px-4 py-2.5 font-medium text-zinc-400">Avg K</th>
                <th className="px-4 py-2.5 font-medium text-zinc-400">Exp / Edu</th>
                <th className="px-4 py-2.5 font-medium text-zinc-400">Category</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {pageJobs.map((job, index) => {
                const isScoring = scoringSet.has(job.id);
                return (
                <tr
                  key={job.id}
                  onMouseDown={(event) => beginRowDrag(event, index)}
                  onMouseEnter={() => updateRowDrag(index)}
                  onClick={() => openJobDetails(job)}
                  className={`hover:bg-zinc-800/40 cursor-pointer transition-colors ${selectedJob?.id === job.id ? 'bg-zinc-800/60' : ''} ${isScoring ? 'bg-indigo-950/20' : ''} ${dragRange && index >= dragRange.start && index <= dragRange.end ? 'bg-indigo-950/30' : ''}`}
                >
                  <td
                    onMouseDown={(event) => beginSelectionDrag(event, index)}
                    onMouseEnter={() => updateRowDrag(index)}
                    onClick={(event) => toggleSelectionCell(event, job.id)}
                    className="px-4 py-2 text-zinc-500 hover:bg-indigo-950/25 hover:text-indigo-300 cursor-pointer transition-colors"
                    title={selectedIds.has(job.id) ? 'Unselect job' : 'Select job'}
                  >
                    <span
                      className="inline-flex text-zinc-500 transition-colors"
                      title={selectedIds.has(job.id) ? 'Unselect job' : 'Select job'}
                    >
                      {selectedIds.has(job.id) ? <CheckSquare size={15} className="text-indigo-400" /> : <Square size={15} />}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-zinc-500 font-mono" title={`DB ID: ${job.id}`}>{pageStart + index + 1}</td>
                  <td className="px-4 py-2 font-medium text-zinc-200 truncate" title={job.title}>{job.title}</td>
                  <td className="px-4 py-2 text-zinc-300 truncate" title={job.company}>{job.company}</td>
                  <td className="px-4 py-2 text-zinc-400 truncate" title={job.city}>{job.city}</td>
                  <td className="px-4 py-2 text-emerald-400 truncate" title={job.salary}>{job.salary}</td>
                  <td className="px-4 py-2">
                    {isScoring ? (
                      <span className="inline-flex items-center gap-1.5 rounded bg-indigo-950/60 px-2 py-1 text-indigo-300">
                        <Loader2 size={12} className="animate-spin" />
                        Scoring
                      </span>
                    ) : job.score ? (
                      <div className="space-y-1">
                        <span className="inline-flex items-center gap-1.5 rounded bg-zinc-800 px-2 py-1 text-zinc-200">
                          {job.score.toFixed(1)}
                          <span className="text-[10px] text-zinc-500">{job.fitLevel}</span>
                        </span>
                        <div className="text-[10px] text-zinc-500">
                          Exp {riskText(job.experienceRisk)} / Edu {riskText(job.educationRisk)}
                        </div>
                      </div>
                    ) : (
                      <span className="text-zinc-600">-</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-zinc-400 truncate">{job.avg.toFixed(1)}</td>
                  <td className="px-4 py-2 text-zinc-400 truncate" title={`${job.exp} / ${job.edu}`}>{job.exp} / {job.edu}</td>
                  <td className="px-4 py-2 truncate">
                    <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[10px] uppercase tracking-wider" title={job.cats[0] || job.tier || '-'}>{job.cats[0] || job.tier || '-'}</span>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {selectedJob && (
          <div className="w-80 border-l border-zinc-800 bg-zinc-950 flex flex-col shrink-0">
            <div className="flex items-center justify-between p-4 border-b border-zinc-800">
              <h3 className="font-semibold text-zinc-100">Job Details</h3>
              <button onClick={() => setSelectedJob(null)} className="text-zinc-500 hover:text-zinc-300">
                <X size={16} />
              </button>
            </div>
            <div className="p-4 flex-1 overflow-y-auto space-y-5">
              <button
                onClick={() => onAddToPipeline([selectedJob])}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded transition-colors"
              >
                <ListPlus size={15} />
                Add to Pipeline
              </button>
              {selectedJob.score ? (
                <div className="rounded border border-zinc-800 bg-zinc-900/50 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-500">Score</span>
                    <span className="text-sm font-semibold text-zinc-100">{selectedJob.score.toFixed(1)} / 5.0</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-zinc-400">
                    <div>Coverage {selectedJob.coverage ?? 0}%</div>
                    <div>JD {selectedJob.jdQuality ?? 0}%</div>
                    <div>Exp {riskText(selectedJob.experienceRisk)}</div>
                    <div>Edu {riskText(selectedJob.educationRisk)}</div>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => onScoreJobs([selectedJob.id])}
                  disabled={scoringSet.has(selectedJob.id)}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium border border-zinc-800 text-zinc-300 hover:bg-zinc-900 disabled:opacity-40 rounded transition-colors"
                >
                  {scoringSet.has(selectedJob.id) ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
                  Score this job
                </button>
              )}
              <DetailItem label="Title" value={selectedJob.title} strong />
              <div className="grid grid-cols-2 gap-4">
                <DetailItem label="Company" value={selectedJob.company} />
                <DetailItem label="City" value={selectedJob.city} />
                <DetailItem label="Salary" value={selectedJob.salary} accent />
                <DetailItem label="Avg Salary" value={`${selectedJob.avg.toFixed(1)}k`} />
                <DetailItem label="Experience" value={selectedJob.exp} />
                <DetailItem label="Education" value={selectedJob.edu} />
              </div>
              <div>
                <div className="text-xs text-zinc-500 mb-1">Category</div>
                <div className="flex flex-wrap gap-1.5">
                  {(selectedJob.cats.length ? selectedJob.cats : [selectedJob.tier]).map((cat) => (
                    <span key={cat} className="px-2 py-1 rounded bg-zinc-800 text-zinc-300 text-xs">{cat}</span>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs text-zinc-500 mb-1">Description</div>
                <div className="text-sm text-zinc-400 leading-relaxed bg-zinc-900/50 p-3 rounded border border-zinc-800/50 whitespace-pre-wrap">
                  {selectedJob.desc || 'No description.'}
                </div>
              </div>
              {selectedJob.url && (
                <div>
                  <a href={selectedJob.url} target="_blank" rel="noreferrer" className="text-xs text-indigo-400 hover:underline">
                    View Original Link
                  </a>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
