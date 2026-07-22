import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownWideNarrow, CheckSquare, Download, Funnel, ListPlus, Loader2, MoreHorizontal, Plus, RefreshCw, RotateCcw, Search, ShieldCheck, Square, Wand2, X } from 'lucide-react';
import { useAppTranslation } from '../i18n';
import { bossApi } from '../api';
import { DetailItem } from '../components/DetailItem';
import { JobDescription } from '../components/JobDescription';
import type { Job } from '../types';

function parseTime(value?: string) {
  if (!value) return 0;
  const parsed = Date.parse(value.replace(' ', 'T'));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function Jobs({
  project,
  jobs,
  total,
  search,
  setSearch,
  sortByScore,
  setSortByScore,
  onRefresh,
  onExport,
  onScoreJobs,
  onUpdateLiveStatus,
  scoringJobIds,
  taskRunning,
  selectedJobId,
  targetRequestId,
  onAddToPipeline,
}: {
  project: string;
  jobs: Job[];
  total: number;
  search: string;
  setSearch: (value: string) => void;
  sortByScore: boolean;
  setSortByScore: (value: boolean | ((current: boolean) => boolean)) => void;
  onRefresh: () => void;
  onExport: () => void;
  onScoreJobs: (jobIds: number[]) => void;
  onUpdateLiveStatus: (jobIds?: number[], limit?: number) => void;
  scoringJobIds: number[];
  taskRunning: boolean;
  selectedJobId?: number | null;
  targetRequestId?: number;
  onAddToPipeline: (jobs: Job[]) => void;
}) {
  const { t } = useAppTranslation();
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [cityFilter, setCityFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [scoreFilter, setScoreFilter] = useState('all');
  const [experienceFilter, setExperienceFilter] = useState('all');
  const [educationFilter, setEducationFilter] = useState('all');
  const [updateTimeSort, setUpdateTimeSort] = useState<'last_seen_desc' | 'last_seen_asc' | 'default'>('last_seen_desc');
  const [minAvgFilter, setMinAvgFilter] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addForm, setAddForm] = useState({ title: '', company: '', city: '', salary: '', exp: '', edu: '', desc: '', url: '' });
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
  const appliedTargetRef = useRef('');
  const pagedTargetRef = useRef('');
  const [dragRange, setDragRange] = useState<{ start: number; end: number } | null>(null);

  const cityOptions = useMemo(
    () => Array.from(new Set(jobs.map((job) => job.city).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [jobs],
  );
  const categoryOptions = useMemo(
    () => Array.from(new Set(jobs.flatMap((job) => job.cats.length ? job.cats : [job.tier]).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [jobs],
  );
  const hasActiveFilters = cityFilter !== 'all'
    || categoryFilter !== 'all'
    || scoreFilter !== 'all'
    || experienceFilter !== 'all'
    || educationFilter !== 'all'
    || updateTimeSort !== 'last_seen_desc'
    || Boolean(minAvgFilter);
  const activeFilterCount = [
    cityFilter !== 'all',
    categoryFilter !== 'all',
    scoreFilter !== 'all',
    experienceFilter !== 'all',
    educationFilter !== 'all',
    updateTimeSort !== 'last_seen_desc',
    Boolean(minAvgFilter),
  ].filter(Boolean).length;

  const observedStatusOf = (job: Job) => {
    if (job.recruitmentObservationStatus) return job.recruitmentObservationStatus;
    if (job.liveStatus === 'open') return 'open_observed';
    if (job.liveStatus === 'closed') return 'closed_observed';
    if (job.liveStatusRaw === 'login_required') return 'login_required';
    if (job.liveStatusRaw === 'captcha_required') return 'verification_required';
    if (job.liveStatusRaw === 'security_check') return 'security_check';
    if (job.liveStatus === 'unknown' || job.liveCheckedAt) return 'unknown_observed';
    return 'not_checked';
  };

  const shortTime = (value?: string) => {
    if (!value) return '';
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    if (match) return `${match[2]}-${match[3]} ${match[4]}:${match[5]}`;
    return value;
  };

  const filteredJobs = useMemo(() => {
    const minAvg = Number(minAvgFilter);
    return jobs.filter((job) => {
      if (cityFilter !== 'all' && job.city !== cityFilter) return false;
      const categories = job.cats.length ? job.cats : [job.tier];
      if (categoryFilter !== 'all' && !categories.includes(categoryFilter)) return false;
      if (experienceFilter !== 'all' && (job.experienceRisk || 'unknown') !== experienceFilter) return false;
      if (educationFilter !== 'all' && (job.educationRisk || 'unknown') !== educationFilter) return false;
      if (minAvgFilter && Number.isFinite(minAvg) && job.avg < minAvg) return false;
      if (scoreFilter === 'unscored' && job.score) return false;
      if (scoreFilter === 'high' && (job.score ?? 0) < 4.0) return false;
      if (scoreFilter === 'review' && ((job.score ?? 0) < 3.5 || (job.score ?? 0) >= 4.0)) return false;
      if (scoreFilter === 'weak' && ((job.score ?? 0) >= 3.5 || !job.score)) return false;
      return true;
    });
  }, [categoryFilter, cityFilter, educationFilter, experienceFilter, jobs, minAvgFilter, scoreFilter]);

  const displayJobs = useMemo(() => {
    if (sortByScore) return [...filteredJobs].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    if (updateTimeSort === 'last_seen_desc') return [...filteredJobs].sort((a, b) => parseTime(b.lastSeen) - parseTime(a.lastSeen));
    if (updateTimeSort === 'last_seen_asc') return [...filteredJobs].sort((a, b) => parseTime(a.lastSeen) - parseTime(b.lastSeen));
    return filteredJobs;
  }, [filteredJobs, sortByScore, updateTimeSort]);
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
    if (!selectedJobId || !targetRequestId) return;
    const targetKey = `${targetRequestId}:${selectedJobId}`;
    if (appliedTargetRef.current === targetKey) return;
    const job = jobs.find((item) => item.id === selectedJobId);
    if (!job) return;
    appliedTargetRef.current = targetKey;
    setCityFilter('all');
    setCategoryFilter('all');
    setScoreFilter('all');
    setExperienceFilter('all');
    setEducationFilter('all');
    setUpdateTimeSort('last_seen_desc');
    setMinAvgFilter('');
    setSelectedJob(job);
  }, [jobs, selectedJobId, targetRequestId]);

  useEffect(() => {
    if (!selectedJobId || !targetRequestId) return;
    const targetKey = `${targetRequestId}:${selectedJobId}`;
    if (pagedTargetRef.current === targetKey) return;
    const index = displayJobs.findIndex((job) => job.id === selectedJobId);
    if (index >= 0) {
      pagedTargetRef.current = targetKey;
      setPage(Math.floor(index / pageSize) + 1);
    }
  }, [displayJobs, pageSize, selectedJobId, targetRequestId]);

  useEffect(() => {
    if (selectedJob) {
      const updated = jobs.find((job) => job.id === selectedJob.id);
      setSelectedJob(updated || null);
    }
    setSelectedIds((current) => new Set([...current].filter((id) => jobs.some((job) => job.id === id))));
  }, [jobs, selectedJob]);

  useEffect(() => {
    setPage(1);
  }, [search, sortByScore, pageSize, cityFilter, categoryFilter, scoreFilter, experienceFilter, educationFilter, updateTimeSort, minAvgFilter]);

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

  const clearFilters = () => {
    setCityFilter('all');
    setCategoryFilter('all');
    setScoreFilter('all');
    setExperienceFilter('all');
    setEducationFilter('all');
    setUpdateTimeSort('last_seen_desc');
    setMinAvgFilter('');
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

  const liveStatusText = (job: Job) => {
    const status = observedStatusOf(job);
    if (status === 'closed_observed') return t('jobs.liveClosed');
    const seenAt = shortTime(job.lastSeen);
    return seenAt ? t('jobs.liveRecentlySeenWithTime', { time: seenAt }) : t('jobs.liveRecentlySeen');
  };

  const liveStatusClass = (job: Job) => {
    const status = observedStatusOf(job);
    if (status === 'closed_observed') return 'border-red-900/70 bg-red-950/40 text-red-300';
    if (job.lastSeen) return 'border-emerald-900/70 bg-emerald-950/40 text-emerald-300';
    return 'border-zinc-800 bg-zinc-900 text-zinc-500';
  };

  const liveStatusTitle = (job: Job) => {
    const observedAt = job.recruitmentObservedAt || job.liveCheckedAt;
    return [
      job.lastSeen ? `${t('jobs.lastSeenAt')} ${job.lastSeen}` : '',
      observedAt ? `${t('jobs.liveCheckedAt')} ${observedAt}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  };

  const updateAllLiveStatus = () => {
    if (!window.confirm(t('jobs.confirmUpdateAllLiveStatus'))) return;
    onUpdateLiveStatus(undefined);
  };

  const riskText = (risk?: string) => {
    if (risk === 'matched') return t('status.ok');
    if (risk === 'near') return t('status.near');
    if (risk === 'risk') return t('status.risk');
    return t('status.unknown');
  };

  return (
    <div className="jobs-page h-full flex flex-col relative">
      <div className="jobs-toolbar mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-2 text-zinc-500" size={14} />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') onRefresh(); }}
              placeholder={t('jobs.searchPlaceholder')}
              className="w-full bg-zinc-900/50 border border-zinc-800 rounded text-sm pl-8 pr-3 py-1.5 text-zinc-200 outline-none focus:border-indigo-500 transition-colors"
            />
          </div>
          <button onClick={onRefresh} className="p-1.5 border border-zinc-800 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 transition-colors">
            <RefreshCw size={14} />
          </button>
          <button onClick={() => setShowAddDialog(true)} className="inline-flex items-center gap-1.5 rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">
            <Plus size={14} />
            {t('jobs.addManual.button')}
          </button>
          <span className="text-xs text-zinc-500">
            {jobs.length >= total ? `${t('jobs.allJobs')} ${total.toLocaleString()}` : `${jobs.length.toLocaleString()} / ${total.toLocaleString()}`}
          </span>
          <button
            onClick={() => setFiltersOpen((value) => !value)}
            aria-pressed={filtersOpen}
            className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium border rounded transition-colors ${filtersOpen || hasActiveFilters ? 'border-indigo-700 bg-indigo-950/40 text-indigo-200' : 'border-zinc-800 text-zinc-300 hover:bg-zinc-900'}`}
          >
            <Funnel size={14} />
            {t('jobs.filters')}
            {activeFilterCount > 0 && <span className="text-indigo-100">({activeFilterCount})</span>}
          </button>
          <button
            onClick={() => onScoreJobs(visibleIds)}
            disabled={!visibleIds.length || scoringVisible}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium border border-zinc-800 text-zinc-300 hover:bg-zinc-900 disabled:opacity-40 rounded transition-colors"
          >
            {scoringVisible ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
            {t('jobs.scorePage')}
          </button>
          <button
            onClick={() => setSortByScore((value) => !value)}
            aria-pressed={sortByScore}
            className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium border rounded transition-colors ${sortByScore ? 'border-indigo-700 bg-indigo-950/40 text-indigo-200' : 'border-zinc-800 text-zinc-300 hover:bg-zinc-900'}`}
          >
            <ArrowDownWideNarrow size={14} />
            {t('jobs.scoreSort')}
          </button>
        </div>
        <details className="jobs-more-menu">
          <summary className="jobs-more-menu__trigger"><MoreHorizontal size={15} /><span>{t('more', { defaultValue: '更多' })}</span></summary>
          <div className="jobs-more-menu__panel">
            <button onClick={() => onScoreJobs(allIds)} disabled={!allIds.length || scoringAll}>
              {scoringAll ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}{t('jobs.scoreAll')}
            </button>
            <button onClick={updateAllLiveStatus} disabled={taskRunning}><ShieldCheck size={14} />{t('jobs.updateAllLiveStatus')}</button>
            <button onClick={onExport}><Download size={14} />{t('jobs.exportExcel')}</button>
          </div>
        </details>
      </div>

      {selectedJobs.length > 0 && (
        <div className="jobs-selection-bar">
          <div><CheckSquare size={15} /><strong>{selectedJobs.length}</strong><span>{t('jobs.selected')}</span></div>
          <div className="jobs-selection-bar__actions">
            <button onClick={() => onScoreJobs(selectedJobs.map((job) => job.id))} disabled={scoringSelected}>
              {scoringSelected ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}{t('jobs.scoreSelected')}
            </button>
            <button onClick={() => onUpdateLiveStatus(selectedJobs.map((job) => job.id))} disabled={taskRunning}><ShieldCheck size={14} />{t('jobs.updateSelectedLiveStatus')}</button>
            <button onClick={() => onAddToPipeline(selectedJobs)} className="jobs-selection-bar__primary"><ListPlus size={14} />{t('jobs.addSelected')}</button>
            <button onClick={() => setSelectedIds(new Set())}>{t('jobs.clear')}</button>
          </div>
        </div>
      )}

      {filtersOpen && (
        <div className="jobs-filterbar mb-3 flex flex-wrap items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/20 p-2 text-xs">
          <select
            value={cityFilter}
            onChange={(event) => setCityFilter(event.target.value)}
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-zinc-300 outline-none focus:border-indigo-600"
          >
            <option value="all">{t('jobs.allCities')}</option>
            {cityOptions.map((city) => <option key={city} value={city}>{city}</option>)}
          </select>
          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            className="max-w-48 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-zinc-300 outline-none focus:border-indigo-600"
          >
            <option value="all">{t('jobs.allCategories')}</option>
            {categoryOptions.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
          </select>
          <select
            value={scoreFilter}
            onChange={(event) => setScoreFilter(event.target.value)}
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-zinc-300 outline-none focus:border-indigo-600"
          >
            <option value="all">{t('jobs.allScores')}</option>
            <option value="high">{t('jobs.highFitFilter')}</option>
            <option value="review">{t('jobs.worthReviewingFilter')}</option>
            <option value="weak">{t('jobs.weakFilter')}</option>
            <option value="unscored">{t('jobs.unscored')}</option>
          </select>
          <select
            value={experienceFilter}
            onChange={(event) => setExperienceFilter(event.target.value)}
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-zinc-300 outline-none focus:border-indigo-600"
          >
            <option value="all">{t('jobs.allExp')}</option>
            <option value="matched">{t('jobs.expOk')}</option>
            <option value="near">{t('jobs.expNear')}</option>
            <option value="risk">{t('jobs.expRisk')}</option>
            <option value="unknown">{t('jobs.expUnknown')}</option>
          </select>
          <select
            value={educationFilter}
            onChange={(event) => setEducationFilter(event.target.value)}
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-zinc-300 outline-none focus:border-indigo-600"
          >
            <option value="all">{t('jobs.allEdu')}</option>
            <option value="matched">{t('jobs.eduOk')}</option>
            <option value="near">{t('jobs.eduNear')}</option>
            <option value="risk">{t('jobs.eduRisk')}</option>
            <option value="unknown">{t('jobs.eduUnknown')}</option>
          </select>
          <select
            value={updateTimeSort}
            onChange={(event) => setUpdateTimeSort(event.target.value as 'last_seen_desc' | 'last_seen_asc' | 'default')}
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-zinc-300 outline-none focus:border-indigo-600"
          >
            <option value="last_seen_desc">{t('jobs.updateSortNewest')}</option>
            <option value="last_seen_asc">{t('jobs.updateSortOldest')}</option>
            <option value="default">{t('jobs.updateSortDefault')}</option>
          </select>
          <input
            type="number"
            min="0"
            value={minAvgFilter}
            onChange={(event) => setMinAvgFilter(event.target.value)}
            placeholder={t('jobs.minAvgK')}
            className="w-24 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-zinc-300 outline-none focus:border-indigo-600"
          />
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="inline-flex items-center gap-1.5 rounded border border-zinc-800 px-2.5 py-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 transition-colors"
            >
              <RotateCcw size={13} />
              {t('jobs.clearFilters')}
            </button>
          )}
        </div>
      )}

      <div className="jobs-pagination mb-3 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-500">
        <div>
          {t('jobs.showing')} {displayJobs.length ? pageStart + 1 : 0}-{pageEnd} / {displayJobs.length.toLocaleString()}
          {hasActiveFilters && <span className="ml-2 text-zinc-400">{t('jobs.filteredFrom')} {jobs.length.toLocaleString()}</span>}
          {selectedJobs.length > 0 && <span className="ml-2 text-indigo-300">{t('jobs.selected')} {selectedJobs.length}</span>}
        </div>
        <div className="flex items-center gap-2">
          <span>{t('jobs.rows')}</span>
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
            {t('jobs.prev')}
          </button>
          <span>{t('jobs.page')} {safePage} / {totalPages}</span>
          <button
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            disabled={safePage >= totalPages}
            className="rounded border border-zinc-800 px-2 py-1 text-zinc-300 hover:bg-zinc-900 disabled:opacity-40"
          >
            {t('jobs.next')}
          </button>
        </div>
      </div>

      <div className="jobs-table-shell flex-1 min-h-0 border border-zinc-800 rounded-md bg-zinc-900/20 overflow-hidden flex">
        <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden">
          <table className="w-full table-fixed text-left text-xs select-none">
            <colgroup>
              <col className="w-[4%]" />
              <col className="w-[4%]" />
              <col className="w-[20%]" />
              <col className="w-[19%]" />
              <col className="w-[6%]" />
              <col className="w-[9%]" />
              <col className="w-[12%]" />
              <col className="w-[6%]" />
              <col className="w-[8%]" />
              <col className="w-[7%]" />
              <col className="w-[5%]" />
            </colgroup>
            <thead className="sticky top-0 bg-zinc-950 border-b border-zinc-800 shadow-sm z-10">
              <tr>
                <th className="font-medium text-zinc-400 w-12">
                  <button
                    onClick={toggleAllVisible}
                    className="flex h-full w-full items-center px-4 py-2.5 text-zinc-500 hover:bg-indigo-950/20 hover:text-zinc-200 transition-colors"
                    title={allVisibleSelected ? t('jobs.unselectVisibleJobs') : t('jobs.selectVisibleJobs')}
                  >
                    {allVisibleSelected ? <CheckSquare size={15} /> : <Square size={15} />}
                  </button>
                </th>
                <th className="px-4 py-2.5 font-medium text-zinc-400 w-16">{t('jobs.tableHeaders.number')}</th>
                <th className="px-4 py-2.5 font-medium text-zinc-400">{t('jobs.tableHeaders.title')}</th>
                <th className="px-4 py-2.5 font-medium text-zinc-400">{t('jobs.tableHeaders.company')}</th>
                <th className="px-4 py-2.5 font-medium text-zinc-400">{t('jobs.tableHeaders.city')}</th>
                <th className="px-4 py-2.5 font-medium text-zinc-400">{t('jobs.tableHeaders.salary')}</th>
                <th className="px-4 py-2.5 font-medium text-zinc-400">{t('jobs.tableHeaders.score')}</th>
                <th className="px-4 py-2.5 font-medium text-zinc-400">{t('jobs.tableHeaders.avgK')}</th>
                <th className="px-4 py-2.5 font-medium text-zinc-400">{t('jobs.tableHeaders.expEdu')}</th>
                <th className="px-4 py-2.5 font-medium text-zinc-400">{t('jobs.tableHeaders.liveStatus')}</th>
                <th className="px-4 py-2.5 font-medium text-zinc-400">{t('jobs.tableHeaders.category')}</th>
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
                  className={`jobs-table-row cursor-pointer transition-colors ${selectedJob?.id === job.id ? 'jobs-table-row--selected bg-zinc-800/60' : ''} ${isScoring ? 'jobs-table-row--processing bg-indigo-950/20' : ''} ${dragRange && index >= dragRange.start && index <= dragRange.end ? 'jobs-table-row--range bg-indigo-950/30' : ''}`}
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
                  <td className="px-4 py-2 text-zinc-500 font-mono" title={`${t('jobs.dbId')}: ${job.id}`}>{pageStart + index + 1}</td>
                  <td className="px-4 py-2 font-medium text-zinc-200 truncate" title={job.title}>{job.title}</td>
                  <td className="px-4 py-2 text-zinc-300 truncate" title={job.company}>{job.company}</td>
                  <td className="px-4 py-2 text-zinc-400 truncate" title={job.city}>{job.city}</td>
                  <td className="px-4 py-2 text-emerald-400 truncate" title={job.salary}>{job.salary}</td>
                  <td className="px-4 py-2">
                    {isScoring ? (
                      <span className="inline-flex items-center gap-1.5 rounded bg-indigo-950/60 px-2 py-1 text-indigo-300">
                        <Loader2 size={12} className="animate-spin" />
                        {t('jobs.scoring')}
                      </span>
                    ) : job.score ? (
                      <div className="space-y-1">
                        <span className={`jobs-fit-badge ${job.score >= 4.3 ? 'jobs-fit-badge--high' : job.score >= 3.5 ? 'jobs-fit-badge--review' : 'jobs-fit-badge--weak'}`}>
                          {job.score.toFixed(1)}
                          <span className="jobs-fit-badge__label">{job.fitLevel}</span>
                        </span>
                        <div className="text-[10px] text-zinc-500">
                          {t('pipeline.experience')} {riskText(job.experienceRisk)} / {t('pipeline.education')} {riskText(job.educationRisk)}
                        </div>
                      </div>
                    ) : (
                      <span className="text-zinc-600">-</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-zinc-400 truncate">{job.avg.toFixed(1)}</td>
                  <td className="px-4 py-2 text-zinc-400 truncate" title={`${job.exp} / ${job.edu}`}>{job.exp} / {job.edu}</td>
                  <td className="px-4 py-2 truncate">
                    <span className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] ${liveStatusClass(job)}`} title={liveStatusTitle(job)}>
                      {liveStatusText(job)}
                    </span>
                  </td>
                  <td className="px-4 py-2 truncate">
                    <span className="jobs-category-badge" title={job.cats[0] || job.tier || '-'}>{job.cats[0] || job.tier || '-'}</span>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {selectedJob && (
          <div className="w-[30rem] border-l border-zinc-800 bg-zinc-950 flex flex-col shrink-0">
            <div className="flex items-center justify-between p-4 border-b border-zinc-800">
              <h3 className="font-semibold text-zinc-100">{t('jobs.jobDetails')}</h3>
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
                {t('jobs.addToPipeline')}
              </button>
              <button
                onClick={() => onUpdateLiveStatus([selectedJob.id])}
                disabled={taskRunning}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium border border-cyan-900/70 text-cyan-200 hover:bg-cyan-950/40 disabled:opacity-40 rounded transition-colors"
              >
                <ShieldCheck size={15} />
                {t('jobs.updateLiveStatus')}
              </button>
              <div className="rounded border border-zinc-800 bg-zinc-900/50 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-500">{t('jobs.liveStatus')}</span>
                  <span className={`inline-flex rounded border px-2 py-1 text-xs ${liveStatusClass(selectedJob)}`}>{liveStatusText(selectedJob)}</span>
                </div>
                {selectedJob.lastSeen && (
                  <div className="mt-2 text-xs text-zinc-500">{t('jobs.lastSeenAt')} {selectedJob.lastSeen}</div>
                )}
                {(selectedJob.recruitmentObservedAt || selectedJob.liveCheckedAt) && (
                  <div className="mt-1 text-xs text-zinc-500">{t('jobs.liveCheckedAt')} {selectedJob.recruitmentObservedAt || selectedJob.liveCheckedAt}</div>
                )}
              </div>
              {selectedJob.score ? (
                <div className="rounded border border-zinc-800 bg-zinc-900/50 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-500">{t('jobs.scoreThisJob')}</span>
                    <span className="text-sm font-semibold text-zinc-100">{selectedJob.score.toFixed(1)} / 5.0</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-zinc-400">
                    <div>{t('jobs.coverage')} {selectedJob.coverage ?? 0}%</div>
                    <div>{t('jobs.jd')} {selectedJob.jdQuality ?? 0}%</div>
                    <div>{t('pipeline.experience')} {riskText(selectedJob.experienceRisk)}</div>
                    <div>{t('pipeline.education')} {riskText(selectedJob.educationRisk)}</div>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => onScoreJobs([selectedJob.id])}
                  disabled={scoringSet.has(selectedJob.id)}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium border border-zinc-800 text-zinc-300 hover:bg-zinc-900 disabled:opacity-40 rounded transition-colors"
                >
                  {scoringSet.has(selectedJob.id) ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
                  {t('jobs.scoreThisJob')}
                </button>
              )}
              <DetailItem label={t('jobs.tableHeaders.title')} value={selectedJob.title} strong />
              <div className="grid grid-cols-2 gap-4">
                <DetailItem label={t('jobs.tableHeaders.company')} value={selectedJob.company} />
                <DetailItem label={t('jobs.tableHeaders.city')} value={selectedJob.city} />
                <DetailItem label={t('jobs.tableHeaders.salary')} value={selectedJob.salary} accent />
                <DetailItem label={t('pipeline.avgSalary')} value={`${selectedJob.avg.toFixed(1)}k`} />
                <DetailItem label={t('pipeline.experience')} value={selectedJob.exp} />
                <DetailItem label={t('pipeline.education')} value={selectedJob.edu} />
              </div>
              <div>
                <div className="text-xs text-zinc-500 mb-1">{t('jobs.tableHeaders.category')}</div>
                <div className="flex flex-wrap gap-1.5">
                  {(selectedJob.cats.length ? selectedJob.cats : [selectedJob.tier]).map((cat) => (
                    <span key={cat} className="px-2 py-1 rounded bg-zinc-800 text-zinc-300 text-xs">{cat}</span>
                  ))}
                </div>
              </div>
              <JobDescription text={selectedJob.desc} />
              {selectedJob.url && (
                <div>
                  <a href={selectedJob.url} target="_blank" rel="noreferrer" className="text-xs text-indigo-400 hover:underline">
                    {t('jobs.viewOriginalLink')}
                  </a>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {showAddDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setShowAddDialog(false)}>
          <div className="w-full max-w-lg rounded-lg border border-zinc-800 bg-zinc-950 p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-zinc-100">{t('jobs.addManual.title')}</h3>
              <button onClick={() => setShowAddDialog(false)} className="text-zinc-400 hover:text-zinc-200"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1 col-span-2">
                  <span className="text-xs text-zinc-500">{t('jobs.addManual.titleLabel')}</span>
                  <input value={addForm.title} onChange={e => setAddForm({...addForm, title: e.target.value})} placeholder={t('jobs.addManual.titlePlaceholder')} className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-indigo-600" />
                </label>
                <label className="space-y-1 col-span-2">
                  <span className="text-xs text-zinc-500">{t('jobs.addManual.companyLabel')}</span>
                  <input value={addForm.company} onChange={e => setAddForm({...addForm, company: e.target.value})} placeholder={t('jobs.addManual.companyPlaceholder')} className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-indigo-600" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-zinc-500">{t('jobs.addManual.cityLabel')}</span>
                  <input value={addForm.city} onChange={e => setAddForm({...addForm, city: e.target.value})} placeholder={t('jobs.addManual.cityPlaceholder')} className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-indigo-600" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-zinc-500">{t('jobs.addManual.salaryLabel')}</span>
                  <input value={addForm.salary} onChange={e => setAddForm({...addForm, salary: e.target.value})} placeholder={t('jobs.addManual.salaryPlaceholder')} className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-indigo-600" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-zinc-500">{t('jobs.addManual.expLabel')}</span>
                  <input value={addForm.exp} onChange={e => setAddForm({...addForm, exp: e.target.value})} className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-indigo-600" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-zinc-500">{t('jobs.addManual.eduLabel')}</span>
                  <input value={addForm.edu} onChange={e => setAddForm({...addForm, edu: e.target.value})} className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-indigo-600" />
                </label>
              </div>
              <label className="space-y-1">
                <span className="text-xs text-zinc-500">{t('jobs.addManual.descLabel')}</span>
                <textarea value={addForm.desc} onChange={e => setAddForm({...addForm, desc: e.target.value})} rows={4} className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-indigo-600 resize-none" />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-zinc-500">{t('jobs.addManual.urlLabel')}</span>
                <input value={addForm.url} onChange={e => setAddForm({...addForm, url: e.target.value})} className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-indigo-600" />
              </label>
            </div>
            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => setShowAddDialog(false)} className="rounded border border-zinc-800 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900">{t('jobs.addManual.cancel')}</button>
              <button
                onClick={async () => {
                  if (!addForm.title.trim() || !addForm.company.trim()) return;
                  try {
                    await bossApi.createJob(project, addForm);
                    setShowAddDialog(false);
                    setAddForm({ title: '', company: '', city: '', salary: '', exp: '', edu: '', desc: '', url: '' });
                    onRefresh();
                  } catch (e) {
                    alert((e as Error).message);
                  }
                }}
                disabled={!addForm.title.trim() || !addForm.company.trim()}
                className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {t('jobs.addManual.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
