import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  ClipboardCheck,
  FileCheck2,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { useAppTranslation } from '../i18n';
import type {
  EvidenceItem,
  EvidenceItemInput,
  EvidenceItemStatus,
  EvidenceMutationResponse,
  EvidenceOverviewResponse,
  EvidenceSourceRef,
  EvidenceTask,
  EvidenceTaskStatus,
} from '../types';

type WorkspaceMode = 'evidence' | 'tasks';
type EvidenceDraft = Pick<EvidenceItem, 'title' | 'evidenceType' | 'summary' | 'userRole' | 'actions' | 'results' | 'sourceRefs' | 'tags'>;

const EMPTY_DRAFT: EvidenceDraft = {
  title: '',
  evidenceType: 'fact',
  summary: '',
  userRole: '',
  actions: [],
  results: [],
  sourceRefs: [],
  tags: [],
};

const splitLines = (value: string) => value.split('\n').map((item) => item.trim()).filter(Boolean);
const splitTags = (value: string) => value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);

export function Evidence({
  overview,
  loading,
  error,
  onRefresh,
  onCreateEvidenceItem,
  onUpdateEvidenceItem,
  onConfirmEvidenceItem,
  onUpdateEvidenceTask,
  targetTaskId,
  targetRequestId,
}: {
  overview: EvidenceOverviewResponse | null;
  loading: boolean;
  error: string;
  onRefresh: () => void;
  onCreateEvidenceItem: (item: EvidenceItemInput) => Promise<EvidenceMutationResponse | null>;
  onUpdateEvidenceItem: (item: EvidenceItem) => Promise<EvidenceMutationResponse | null>;
  onConfirmEvidenceItem: (evidenceId: string) => Promise<EvidenceMutationResponse | null>;
  onUpdateEvidenceTask: (taskId: string, status: EvidenceTaskStatus, completionEvidenceIds?: string[]) => Promise<EvidenceMutationResponse | null>;
  targetTaskId?: string;
  targetRequestId?: number;
}) {
  const { i18n } = useAppTranslation();
  const isZh = (i18n.resolvedLanguage || i18n.language).startsWith('zh');
  const copy = isZh ? {
    eyebrow: '材料准备', title: '证据与任务', description: '集中维护已确认的职业事实，并跟进岗位要求产生的证据任务。',
    evidence: '职业证据', tasks: '证据任务', refresh: '刷新', create: '新增证据', search: '搜索标题、摘要或标签',
    allStatus: '全部状态', emptyEvidence: '还没有职业证据。可从候选岗位确认事实，或在此新建。', emptyTasks: '当前没有证据任务。',
    confirmed: '已确认', draft: '草稿', rejected: '已否决', archived: '已归档',
    evidenceTitle: '证据标题', evidenceType: '证据类型', summary: '事实摘要', userRole: '你的职责', actions: '关键行动',
    results: '结果与影响', tags: '标签', sources: '来源依据', sourceType: '来源类型', sourceRef: '文件或引用位置', sourceQuote: '原文摘录',
    addSource: '添加来源', save: '保存修改', saveDraft: '保存草稿', confirm: '确认事实', saving: '保存中…',
    editHint: '确认并不锁死内容；后续仍可修改，但修改应继续保持事实准确。', selectEvidence: '从左侧选择一条证据查看和修改。',
    linkedRequirements: '关联岗位要求', noRequirement: '未关联岗位要求', updated: '更新于',
    taskStatus: '任务状态', taskPriority: '优先级', recommendedAction: '建议行动', affectedJobs: '影响岗位', completionEvidence: '完成依据',
    taskSave: '更新任务', selectTask: '从左侧选择一项任务查看处理建议。', noCompletionEvidence: '暂无已确认证据，可先完成或确认一条职业证据。',
    pending: '待处理', in_progress: '进行中', completed: '已完成', dismissed: '已忽略', high: '高', medium: '中', low: '低',
    confirmTaskHint: '将任务标记为完成时，建议至少绑定一条已确认证据。', validationTitle: '请先填写证据标题。', saved: '已保存',
  } : {
    eyebrow: 'Prepare materials', title: 'Evidence & tasks', description: 'Maintain confirmed career facts and track evidence work generated from job requirements.',
    evidence: 'Career evidence', tasks: 'Evidence tasks', refresh: 'Refresh', create: 'New evidence', search: 'Search titles, summaries, or tags',
    allStatus: 'All statuses', emptyEvidence: 'No career evidence yet. Confirm facts from a candidate role or create one here.', emptyTasks: 'No evidence tasks right now.',
    confirmed: 'Confirmed', draft: 'Draft', rejected: 'Rejected', archived: 'Archived',
    evidenceTitle: 'Evidence title', evidenceType: 'Evidence type', summary: 'Fact summary', userRole: 'Your role', actions: 'Key actions',
    results: 'Results and impact', tags: 'Tags', sources: 'Source references', sourceType: 'Source type', sourceRef: 'File or location', sourceQuote: 'Source excerpt',
    addSource: 'Add source', save: 'Save changes', saveDraft: 'Save draft', confirm: 'Confirm fact', saving: 'Saving…',
    editHint: 'Confirmation does not lock the item; it remains editable, but changes should stay factually accurate.', selectEvidence: 'Select evidence on the left to view and edit it.',
    linkedRequirements: 'Linked requirements', noRequirement: 'No linked requirements', updated: 'Updated',
    taskStatus: 'Task status', taskPriority: 'Priority', recommendedAction: 'Recommended action', affectedJobs: 'Affected jobs', completionEvidence: 'Completion evidence',
    taskSave: 'Update task', selectTask: 'Select a task on the left to review its recommended action.', noCompletionEvidence: 'No confirmed evidence yet. Complete or confirm a career evidence item first.',
    pending: 'Pending', in_progress: 'In progress', completed: 'Completed', dismissed: 'Dismissed', high: 'High', medium: 'Medium', low: 'Low',
    confirmTaskHint: 'When completing a task, link at least one confirmed evidence item when possible.', validationTitle: 'Enter an evidence title first.', saved: 'Saved',
  };

  const [mode, setMode] = useState<WorkspaceMode>('evidence');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | EvidenceItemStatus>('all');
  const [selectedEvidenceId, setSelectedEvidenceId] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [draft, setDraft] = useState<EvidenceDraft>(EMPTY_DRAFT);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [taskStatus, setTaskStatus] = useState<EvidenceTaskStatus>('pending');
  const [completionEvidenceIds, setCompletionEvidenceIds] = useState<string[]>([]);

  const requirementsById = useMemo(() => new Map((overview?.requirements || []).map((item) => [item.requirementId, item])), [overview?.requirements]);
  const evidenceItems = overview?.evidenceItems || [];
  const tasks = overview?.tasks || [];
  const selectedEvidence = evidenceItems.find((item) => item.evidenceId === selectedEvidenceId) || null;
  const selectedTask = tasks.find((item) => item.taskId === selectedTaskId) || null;
  const confirmedItems = evidenceItems.filter((item) => item.status === 'confirmed');

  const filteredEvidence = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return evidenceItems.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (!needle) return true;
      return [item.title, item.summary, item.userRole, ...item.tags].join(' ').toLocaleLowerCase().includes(needle);
    });
  }, [evidenceItems, query, statusFilter]);

  const filteredTasks = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return tasks.filter((task) => {
      const requirement = requirementsById.get(task.requirementId);
      return !needle || [requirement?.label || '', task.recommendedAction, ...task.affectedSourceKeys].join(' ').toLocaleLowerCase().includes(needle);
    });
  }, [query, requirementsById, tasks]);

  useEffect(() => {
    if (selectedEvidence) {
      setDraft({
        title: selectedEvidence.title,
        evidenceType: selectedEvidence.evidenceType,
        summary: selectedEvidence.summary,
        userRole: selectedEvidence.userRole,
        actions: selectedEvidence.actions,
        results: selectedEvidence.results,
        sourceRefs: selectedEvidence.sourceRefs,
        tags: selectedEvidence.tags,
      });
      setCreating(false);
      setFeedback('');
    }
  }, [selectedEvidence]);

  useEffect(() => {
    if (!selectedTask) return;
    setTaskStatus(selectedTask.status);
    setCompletionEvidenceIds(selectedTask.completionEvidenceIds || []);
    setFeedback('');
  }, [selectedTask]);

  useEffect(() => {
    if (!targetTaskId) return;
    setMode('tasks');
    setSelectedTaskId(targetTaskId);
  }, [targetRequestId, targetTaskId]);

  const startCreate = () => {
    setMode('evidence');
    setSelectedEvidenceId('');
    setDraft(EMPTY_DRAFT);
    setCreating(true);
    setFeedback('');
  };

  const saveEvidence = async () => {
    if (!draft.title.trim()) {
      setFeedback(copy.validationTitle);
      return;
    }
    setBusy(true);
    setFeedback('');
    try {
      const result = selectedEvidence
        ? await onUpdateEvidenceItem({ ...selectedEvidence, ...draft, title: draft.title.trim() })
        : await onCreateEvidenceItem({ ...draft, title: draft.title.trim(), requirementIds: [] });
      if (result?.item) {
        setSelectedEvidenceId(result.item.evidenceId);
        setCreating(false);
        setFeedback(copy.saved);
      }
    } finally {
      setBusy(false);
    }
  };

  const confirmEvidence = async () => {
    if (!selectedEvidence || selectedEvidence.status === 'confirmed') return;
    setBusy(true);
    try {
      const result = await onConfirmEvidenceItem(selectedEvidence.evidenceId);
      if (result) setFeedback(copy.confirmed);
    } finally {
      setBusy(false);
    }
  };

  const saveTask = async () => {
    if (!selectedTask) return;
    setBusy(true);
    try {
      const result = await onUpdateEvidenceTask(selectedTask.taskId, taskStatus, completionEvidenceIds);
      if (result) setFeedback(copy.saved);
    } finally {
      setBusy(false);
    }
  };

  const updateSource = (index: number, field: keyof EvidenceSourceRef, value: string) => {
    setDraft((current) => ({
      ...current,
      sourceRefs: current.sourceRefs.map((source, sourceIndex) => sourceIndex === index ? { ...source, [field]: value } : source),
    }));
  };

  const statusLabel = (status: EvidenceItemStatus | EvidenceTaskStatus) => copy[status as keyof typeof copy] || status;
  const counts = overview?.counts;

  return (
    <div className="evidence-page">
      <header className="evidence-page__header">
        <div>
          <div className="evidence-page__eyebrow"><ShieldCheck size={15} />{copy.eyebrow}</div>
          <h1>{copy.title}</h1>
          <p>{copy.description}</p>
        </div>
        <div className="evidence-page__header-actions">
          <button type="button" className="evidence-button evidence-button--secondary" onClick={onRefresh} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />{copy.refresh}
          </button>
          <button type="button" className="evidence-button evidence-button--primary" onClick={startCreate}><Plus size={15} />{copy.create}</button>
        </div>
      </header>

      <div className="evidence-page__summary" aria-label={copy.title}>
        <div><FileCheck2 size={16} /><span>{copy.evidence}</span><strong>{counts?.evidenceItems || 0}</strong></div>
        <div><CheckCircle2 size={16} /><span>{copy.confirmed}</span><strong>{counts?.confirmedEvidenceItems || 0}</strong></div>
        <div><ClipboardCheck size={16} /><span>{copy.tasks}</span><strong>{counts?.pendingTasks || 0}</strong></div>
      </div>

      {error && <div className="evidence-page__error">{error}</div>}

      <section className="evidence-workspace">
        <aside className="evidence-workspace__sidebar">
          <div className="evidence-workspace__tabs">
            <button type="button" onClick={() => setMode('evidence')} className={mode === 'evidence' ? 'is-active' : ''}>{copy.evidence}<span>{evidenceItems.length}</span></button>
            <button type="button" onClick={() => setMode('tasks')} className={mode === 'tasks' ? 'is-active' : ''}>{copy.tasks}<span>{tasks.length}</span></button>
          </div>
          <div className="evidence-workspace__filters">
            <label className="evidence-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.search} /></label>
            {mode === 'evidence' && (
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | EvidenceItemStatus)}>
                <option value="all">{copy.allStatus}</option><option value="confirmed">{copy.confirmed}</option><option value="draft">{copy.draft}</option><option value="rejected">{copy.rejected}</option><option value="archived">{copy.archived}</option>
              </select>
            )}
          </div>
          <div className="evidence-workspace__list">
            {loading && !overview ? <div className="evidence-workspace__empty"><Loader2 size={18} className="animate-spin" /></div> : mode === 'evidence' ? (
              filteredEvidence.length ? filteredEvidence.map((item) => (
                <button type="button" key={item.evidenceId} className={`evidence-list-card${selectedEvidenceId === item.evidenceId ? ' is-active' : ''}`} onClick={() => { setSelectedEvidenceId(item.evidenceId); setCreating(false); }}>
                  <div className="evidence-list-card__top"><strong>{item.title || item.evidenceId}</strong><span className={`evidence-status evidence-status--${item.status}`}>{statusLabel(item.status)}</span></div>
                  <p>{item.summary || copy.noRequirement}</p>
                  <div className="evidence-list-card__meta"><span>{item.evidenceType}</span><span>{item.tags.slice(0, 2).join(' · ')}</span></div>
                </button>
              )) : <div className="evidence-workspace__empty">{copy.emptyEvidence}</div>
            ) : filteredTasks.length ? filteredTasks.map((task) => {
              const requirement = requirementsById.get(task.requirementId);
              return (
                <button type="button" key={task.taskId} className={`evidence-list-card${selectedTaskId === task.taskId ? ' is-active' : ''}`} onClick={() => setSelectedTaskId(task.taskId)}>
                  <div className="evidence-list-card__top"><strong>{requirement?.label || task.requirementId}</strong><span className={`evidence-status evidence-status--${task.status}`}>{statusLabel(task.status)}</span></div>
                  <p>{task.recommendedAction}</p>
                  <div className="evidence-list-card__meta"><span>{copy[task.priorityBand]}</span><span>{task.estimatedEffortBand || task.timeBudget}</span></div>
                </button>
              );
            }) : <div className="evidence-workspace__empty">{copy.emptyTasks}</div>}
          </div>
        </aside>

        <main className="evidence-workspace__detail">
          {mode === 'evidence' ? (selectedEvidence || creating ? (
            <div className="evidence-editor">
              <div className="evidence-editor__heading">
                <div><span>{selectedEvidence ? selectedEvidence.evidenceId : copy.create}</span><h2>{selectedEvidence?.title || copy.create}</h2></div>
                {selectedEvidence && <span className={`evidence-status evidence-status--${selectedEvidence.status}`}>{statusLabel(selectedEvidence.status)}</span>}
              </div>
              <div className="evidence-form-grid">
                <label className="evidence-field evidence-field--wide"><span>{copy.evidenceTitle}</span><input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} /></label>
                <label className="evidence-field"><span>{copy.evidenceType}</span><select value={draft.evidenceType} onChange={(event) => setDraft((current) => ({ ...current, evidenceType: event.target.value as EvidenceItem['evidenceType'] }))}><option value="fact">Fact</option><option value="project">Project</option><option value="metric">Metric</option><option value="artifact">Artifact</option><option value="story">Story</option></select></label>
                <label className="evidence-field"><span>{copy.tags}</span><input value={draft.tags.join(', ')} onChange={(event) => setDraft((current) => ({ ...current, tags: splitTags(event.target.value) }))} /></label>
                <label className="evidence-field evidence-field--wide"><span>{copy.summary}</span><textarea rows={3} value={draft.summary} onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value }))} /></label>
                <label className="evidence-field evidence-field--wide"><span>{copy.userRole}</span><textarea rows={2} value={draft.userRole} onChange={(event) => setDraft((current) => ({ ...current, userRole: event.target.value }))} /></label>
                <label className="evidence-field"><span>{copy.actions}</span><textarea rows={5} value={draft.actions.join('\n')} onChange={(event) => setDraft((current) => ({ ...current, actions: splitLines(event.target.value) }))} /></label>
                <label className="evidence-field"><span>{copy.results}</span><textarea rows={5} value={draft.results.join('\n')} onChange={(event) => setDraft((current) => ({ ...current, results: splitLines(event.target.value) }))} /></label>
              </div>
              <div className="evidence-sources">
                <div className="evidence-sources__heading"><div><strong>{copy.sources}</strong><span>{copy.editHint}</span></div><button type="button" onClick={() => setDraft((current) => ({ ...current, sourceRefs: [...current.sourceRefs, { type: 'file', ref: '', quote: '' }] }))}><Plus size={14} />{copy.addSource}</button></div>
                {draft.sourceRefs.map((source, index) => (
                  <div className="evidence-source-row" key={index}>
                    <input aria-label={copy.sourceType} value={source.type} placeholder={copy.sourceType} onChange={(event) => updateSource(index, 'type', event.target.value)} />
                    <input aria-label={copy.sourceRef} value={source.ref} placeholder={copy.sourceRef} onChange={(event) => updateSource(index, 'ref', event.target.value)} />
                    <textarea aria-label={copy.sourceQuote} rows={2} value={source.quote} placeholder={copy.sourceQuote} onChange={(event) => updateSource(index, 'quote', event.target.value)} />
                    <button type="button" aria-label="Remove" onClick={() => setDraft((current) => ({ ...current, sourceRefs: current.sourceRefs.filter((_, sourceIndex) => sourceIndex !== index) }))}>×</button>
                  </div>
                ))}
              </div>
              {selectedEvidence && (
                <div className="evidence-linked"><strong>{copy.linkedRequirements}</strong><div>{(selectedEvidence.requirementIds || []).length ? selectedEvidence.requirementIds?.map((id) => <span key={id}>{requirementsById.get(id)?.label || id}</span>) : <small>{copy.noRequirement}</small>}</div></div>
              )}
              <div className="evidence-editor__footer">
                <span>{feedback}</span>
                <div>
                  {selectedEvidence && selectedEvidence.status !== 'confirmed' && <button type="button" className="evidence-button evidence-button--secondary" onClick={() => void confirmEvidence()} disabled={busy}><Check size={15} />{copy.confirm}</button>}
                  <button type="button" className="evidence-button evidence-button--primary" onClick={() => void saveEvidence()} disabled={busy}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}{selectedEvidence ? copy.save : copy.saveDraft}</button>
                </div>
              </div>
            </div>
          ) : <div className="evidence-workspace__placeholder"><ShieldCheck size={32} /><p>{copy.selectEvidence}</p></div>) : selectedTask ? (
            <div className="evidence-editor evidence-task-detail">
              <div className="evidence-editor__heading"><div><span>{selectedTask.taskId}</span><h2>{requirementsById.get(selectedTask.requirementId)?.label || selectedTask.requirementId}</h2></div><span className={`evidence-status evidence-status--${selectedTask.status}`}>{statusLabel(selectedTask.status)}</span></div>
              <div className="evidence-task-detail__facts">
                <div><span>{copy.taskPriority}</span><strong>{copy[selectedTask.priorityBand]}</strong></div><div><span>{copy.taskStatus}</span><strong>{statusLabel(selectedTask.status)}</strong></div>
                <div><span>{copy.affectedJobs}</span><strong>{selectedTask.affectedSourceKeys.length}</strong></div><div><span>Effort</span><strong>{selectedTask.estimatedEffortBand || selectedTask.timeBudget || '-'}</strong></div>
              </div>
              <section className="evidence-task-detail__action"><span>{copy.recommendedAction}</span><p>{selectedTask.recommendedAction || '-'}</p></section>
              <label className="evidence-field"><span>{copy.taskStatus}</span><select value={taskStatus} onChange={(event) => setTaskStatus(event.target.value as EvidenceTaskStatus)}><option value="pending">{copy.pending}</option><option value="in_progress">{copy.in_progress}</option><option value="completed">{copy.completed}</option><option value="dismissed">{copy.dismissed}</option></select></label>
              <section className="evidence-task-completion"><div><strong>{copy.completionEvidence}</strong><span>{copy.confirmTaskHint}</span></div>{confirmedItems.length ? confirmedItems.map((item) => <label key={item.evidenceId}><input type="checkbox" checked={completionEvidenceIds.includes(item.evidenceId)} onChange={(event) => setCompletionEvidenceIds((current) => event.target.checked ? [...current, item.evidenceId] : current.filter((id) => id !== item.evidenceId))} /><span><strong>{item.title}</strong><small>{item.summary}</small></span></label>) : <p>{copy.noCompletionEvidence}</p>}</section>
              <div className="evidence-editor__footer"><span>{feedback}</span><button type="button" className="evidence-button evidence-button--primary" onClick={() => void saveTask()} disabled={busy}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}{copy.taskSave}</button></div>
            </div>
          ) : <div className="evidence-workspace__placeholder"><ClipboardCheck size={32} /><p>{copy.selectTask}</p></div>}
        </main>
      </section>
    </div>
  );
}
