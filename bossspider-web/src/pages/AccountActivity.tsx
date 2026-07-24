import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, ExternalLink, Loader2, RefreshCw, Search, ShieldAlert, Upload } from 'lucide-react';
import { bossApi } from '../api';
import { useAppTranslation } from '../i18n';
import type { AccountActivityDataChange, AccountActivityItem, AccountActivityTab, LoginState } from '../types';

const tabs: { value: AccountActivityTab; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'communicated', label: '沟通过' },
  { value: 'applied', label: '已投递' },
  { value: 'interview', label: '面试' },
  { value: 'favorited', label: '收藏' },
];

const eventLabels: Record<string, string> = { communicated: '沟通过', applied: '已投递', interview: '面试', favorited: '收藏' };

function formatTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
}

function badgeTone(value: string) {
  if (value === 'matched') return 'account-activity-badge account-activity-badge--matched';
  if (value === 'mismatched') return 'account-activity-badge account-activity-badge--mismatched';
  return 'account-activity-badge account-activity-badge--uncertain';
}

function matchLabel(value: string) {
  return value === 'matched' ? '匹配目标' : value === 'mismatched' ? '不匹配' : '信息不足';
}

function loginStatusLabel(state: LoginState | null, checking: boolean, failed: boolean) {
  if (checking) return '检查中…';
  if (failed || !state) return '无法确认';
  if (state.status === 'available') return '可用';
  if (state.status === 'refresh_recommended') return '建议刷新';
  if (state.status === 'expired') return '已过期';
  return '未保存 Cookie';
}

export function AccountActivity({ project, profileProject, onAddToPipeline, onDataChanged, onOpenLoginSettings, taskRunning }: { project: string; profileProject: string; onAddToPipeline: (jobIds: number[]) => Promise<void>; onDataChanged?: (change: AccountActivityDataChange) => void | Promise<void>; onOpenLoginSettings: () => void; taskRunning: boolean }) {
  const { t } = useAppTranslation();
  const [tab, setTab] = useState<AccountActivityTab>('all');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [newOnly, setNewOnly] = useState(false);
  const [matchStatus, setMatchStatus] = useState('all');
  const [importStatus, setImportStatus] = useState('all');
  const [jobStatus, setJobStatus] = useState('all');
  const [items, setItems] = useState<AccountActivityItem[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(0);
  const [tabCounts, setTabCounts] = useState<Partial<Record<AccountActivityTab, number>>>({});
  const [account, setAccount] = useState<{ displayName: string; lastSyncAt: string | null } | null>(null);
  const [summary, setSummary] = useState({ new: 0, matched: 0, closed: 0 });
  const [sync, setSync] = useState<{ status: string; error: string } | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [busyImport, setBusyImport] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loginState, setLoginState] = useState<LoginState | null>(null);
  const [loginChecking, setLoginChecking] = useState(Boolean(profileProject));
  const [loginCheckFailed, setLoginCheckFailed] = useState(false);
  const syncPreviousRunIdRef = useRef(0);
  const syncCompletionNotifiedRef = useRef(false);

  const refreshLoginState = useCallback(async () => {
    if (!profileProject) {
      setLoginState(null);
      setLoginCheckFailed(true);
      setLoginChecking(false);
      return null;
    }
    setLoginChecking(true);
    setLoginCheckFailed(false);
    try {
      const result = await bossApi.getLoginState(profileProject);
      setLoginState(result);
      return result;
    } catch (cause) {
      setLoginState(null);
      setLoginCheckFailed(true);
      setError((cause as Error).message);
      return null;
    } finally {
      setLoginChecking(false);
    }
  }, [profileProject]);

  useEffect(() => {
    void refreshLoginState();
  }, [refreshLoginState]);

  const load = useCallback(async (background = false) => {
    if (!project) return null;
    if (!background) setLoading(true);
    setError('');
    try {
      const result = await bossApi.getAccountActivity(project, tab, page, 30, search, newOnly, { profileProject, matchStatus, importStatus, jobStatus });
      setItems(result.items);
      setTotal(result.total);
      setPages(result.pages);
      setTabCounts(result.tabs || {});
      setAccount(result.account ? { displayName: result.account.displayName, lastSyncAt: result.account.lastSyncAt } : null);
      setSummary(result.summary || { new: 0, matched: 0, closed: 0 });
      setSync(result.sync ? { status: result.sync.status, error: result.sync.error } : null);
      return result;
    } catch (cause) {
      setError((cause as Error).message);
      return null;
    } finally {
      if (!background) setLoading(false);
    }
  }, [importStatus, jobStatus, matchStatus, newOnly, page, profileProject, project, search, tab]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!syncing) return undefined;
    let cancelled = false;
    const poll = async () => {
      const result = await load(true);
      if (cancelled || !result?.sync) return;
      const runId = result.sync.runId || 0;
      const terminal = new Set(['succeeded', 'incomplete', 'failed']).has(result.sync.status);
      if (!terminal || runId <= syncPreviousRunIdRef.current || syncCompletionNotifiedRef.current) return;
      syncCompletionNotifiedRef.current = true;
      setSyncing(false);
      if (result.sync.status !== 'succeeded') await refreshLoginState();
      await onDataChanged?.({ kind: 'sync' });
    };
    const timer = window.setInterval(() => { void poll(); }, 1200);
    const stop = window.setTimeout(() => setSyncing(false), 15000);
    return () => { cancelled = true; window.clearInterval(timer); window.clearTimeout(stop); };
  }, [load, onDataChanged, refreshLoginState, syncing]);

  const selectableItems = useMemo(() => items.filter((item) => item.closedStatus !== 'closed' && item.relevance !== 'mismatched'), [items]);
  const selectedItems = useMemo(() => items.filter((item) => selected.has(item.id)), [items, selected]);
  const allSelectableSelected = selectableItems.length > 0 && selectableItems.every((item) => selected.has(item.id));
  const loginUnavailable = loginChecking || loginCheckFailed || !loginState?.canSchedule;
  const browserActionsDisabled = taskRunning || syncing || busyImport || loginUnavailable;
  const actionDisabledReason = taskRunning
    ? '当前采集、登录或同步任务正在使用 BOSS 浏览器'
    : loginUnavailable
      ? '请先确认 BOSS 登录状态并保存 Cookie'
      : undefined;
  const toggle = (id: number) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const startSync = async () => {
    setError(''); setNotice(''); setSyncing(true);
    syncPreviousRunIdRef.current = sync?.runId || 0;
    syncCompletionNotifiedRef.current = false;
    try {
      const result = await bossApi.startAccountActivitySync({ project, profileProject, matchProject: project });
      setNotice(result.message || '同步任务已加入队列');
    } catch (cause) {
      setSyncing(false); setError((cause as Error).message); void refreshLoginState();
    }
  };

  const importSelected = async (mode: 'library' | 'candidate') => {
    if (!selectedItems.length) return;
    const uncertain = selectedItems.some((item) => item.relevance === 'uncertain');
    if (uncertain && !window.confirm('所选岗位中有信息不足的记录，仍要导入吗？')) return;
    setBusyImport(true); setError(''); setNotice('');
    try {
      const result = await bossApi.importAccountActivity({ project, matchProject: project, profileProject, accountJobIds: selectedItems.map((item) => item.id), mode, allowUncertain: uncertain });
      if (mode === 'candidate' && result.projectJobIds.length) await onAddToPipeline(result.projectJobIds);
      await onDataChanged?.({ kind: 'import', mode });
      setSelected(new Set());
      setNotice(result.failed.length ? `已导入 ${result.imported} 个岗位；${result.failed.map((item) => item.reason).join('；')}` : `已导入 ${result.imported} 个岗位`);
      await load();
    } catch (cause) {
      setError((cause as Error).message); void refreshLoginState();
    } finally { setBusyImport(false); }
  };

  return (
    <section className="account-activity-page h-full overflow-auto p-4 lg:p-6">
      <div className="mx-auto max-w-[1500px] space-y-3">
        <header className="account-activity-header">
          <div>
            <h1>{t('accountActivity.title', { defaultValue: 'BOSS 求职记录' })}</h1>
            <div className="account-activity-meta"><span>登录账号：{account?.displayName || '当前 BOSS 账号'}</span><span className={`account-activity-login-status is-${loginState?.status || (loginChecking ? 'checking' : 'missing')}`}>● {loginStatusLabel(loginState, loginChecking, loginCheckFailed)}</span><span>匹配目标：<strong>{project || '-'}</strong></span><span>上次同步：{formatTime(account?.lastSyncAt)}</span></div>
          </div>
          <button type="button" onClick={startSync} disabled={browserActionsDisabled} title={actionDisabledReason} className="account-activity-sync"><RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />{syncing ? '同步中…' : '同步记录'}</button>
        </header>

        {loginUnavailable ? <div className="account-activity-login-alert account-activity-login-alert--error"><ShieldAlert size={18} /><div><strong>{loginChecking ? '正在检查 BOSS 登录状态' : '登录已失效/未保存 Cookie'}</strong><span>{loginChecking ? '正在确认指定账号 Profile，页面内容仍可查看。' : '导入新岗位无法获取完整 JD，请先登录并保存 Cookie。'}</span></div><button type="button" onClick={onOpenLoginSettings}>前往系统设置</button></div> : loginState?.status === 'refresh_recommended' ? <div className="account-activity-login-alert account-activity-login-alert--warning"><ShieldAlert size={18} /><div><strong>建议刷新 BOSS 登录</strong><span>当前 Cookie 仍可用，但已达到刷新建议时间。</span></div><button type="button" onClick={onOpenLoginSettings}>前往系统设置</button></div> : null}

        <div className="account-activity-summary"><span>新同步 <b>{summary.new}</b></span><span>匹配目标 <b>{summary.matched}</b></span><span>已关闭 <b>{summary.closed}</b></span><span className="account-activity-summary__status">{sync ? `同步状态：${sync.status}` : '尚未同步'}</span></div>

        <div className="account-activity-toolbar">
          <div className="account-activity-tabs" role="tablist" aria-label="BOSS 求职记录分类">
            {tabs.map((item) => <button key={item.value} type="button" role="tab" aria-selected={tab === item.value} onClick={() => { setTab(item.value); setPage(1); setSelected(new Set()); }} className={tab === item.value ? 'is-active' : ''}>{item.label}<span>{tabCounts[item.value] ?? 0}</span></button>)}
          </div>
          <div className="account-activity-filters">
            <label className="account-activity-search"><Search size={15} /><input aria-label="搜索岗位、公司或城市" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="搜索岗位、公司或城市" /></label>
            <label className="account-activity-check"><input type="checkbox" checked={newOnly} onChange={(event) => { setNewOnly(event.target.checked); setPage(1); }} />只看新增</label>
            <select aria-label="匹配状态" value={matchStatus} onChange={(event) => { setMatchStatus(event.target.value); setPage(1); }}><option value="all">匹配状态：全部</option><option value="matched">匹配目标</option><option value="uncertain">信息不足</option><option value="mismatched">不匹配</option></select>
            <select aria-label="入库状态" value={importStatus} onChange={(event) => { setImportStatus(event.target.value); setPage(1); }}><option value="all">入库状态：全部</option><option value="imported">已入库</option><option value="pending">未入库</option></select>
            <select aria-label="岗位状态" value={jobStatus} onChange={(event) => { setJobStatus(event.target.value); setPage(1); }}><option value="all">岗位状态：全部</option><option value="open">有效</option><option value="closed">已关闭</option></select>
          </div>
        </div>

        {(error || ((sync?.status === 'failed' || sync?.status === 'incomplete') && sync.error)) && <div className="account-activity-alert account-activity-alert--error"><ShieldAlert size={17} /><span>{error || sync?.error}</span></div>}
        {notice && <div className="account-activity-alert account-activity-alert--success"><Check size={17} /><span>{notice}</span></div>}

        {selectedItems.length > 0 && <div className="account-activity-bulk"><span>已选择 {selectedItems.length} 条记录</span><div><button type="button" disabled={browserActionsDisabled} title={actionDisabledReason} onClick={() => void importSelected('library')}><Upload size={14} />仅导入岗位库</button><button type="button" disabled={browserActionsDisabled} title={actionDisabledReason} onClick={() => void importSelected('candidate')} className="is-primary">{busyImport ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}导入并加入候选</button><button type="button" onClick={() => setSelected(new Set())}>取消选择</button></div></div>}

        <div className="account-activity-table-wrap">
          {loading && !items.length ? <div className="account-activity-skeleton" aria-label="正在加载 BOSS 求职记录">{Array.from({ length: 8 }).map((_, index) => <div key={index} />)}</div> : <table className="account-activity-table"><thead><tr><th className="account-activity-select"><input type="checkbox" aria-label="选择当前页可导入记录" disabled={!selectableItems.length} checked={allSelectableSelected} onChange={(event) => setSelected(event.target.checked ? new Set(selectableItems.map((item) => item.id)) : new Set())} /></th><th>岗位 / 公司</th><th>BOSS 记录</th><th>城市 / 薪资</th><th>与当前目标</th><th>入库 / 候选</th><th>最近同步</th><th>详情</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} className={item.closedStatus === 'closed' ? 'is-closed' : ''}><td className="account-activity-select"><input type="checkbox" aria-label={`选择 ${item.title || '岗位'}`} disabled={item.closedStatus === 'closed' || item.relevance === 'mismatched'} checked={selected.has(item.id)} onChange={() => toggle(item.id)} /></td><td><div className="account-activity-job-title">{item.title || '未命名岗位'}{item.isNew && <span className="account-activity-new">新增</span>}</div><div className="account-activity-company">{item.company || '未知公司'}</div></td><td><div className="account-activity-events">{item.eventTypes.map((event) => <span key={event}>{eventLabels[event] || event}</span>)}</div><div className="account-activity-muted">首次：{formatTime(item.firstSeenAt)}</div></td><td><div>{item.city || '未知城市'}</div><div className="account-activity-muted">{item.salary || '-'}</div></td><td><span className={badgeTone(item.relevance)}>{matchLabel(item.relevance)}</span><div className="account-activity-muted">{item.reason}</div></td><td><div>{item.imported ? '已入库' : '未入库'}</div><div className="account-activity-muted">{item.candidate ? '已加入候选' : item.closedStatus === 'closed' ? '岗位已关闭' : '-'}</div></td><td className="account-activity-muted">{formatTime(item.lastSeenAt)}</td><td>{item.detailUrl ? <a href={item.detailUrl} target="_blank" rel="noreferrer" aria-label={`查看 ${item.title || '岗位'} 详情`} className="account-activity-detail"><ExternalLink size={14} />查看</a> : '-'}</td></tr>)}</tbody></table>}
          {!loading && !items.length && <div className="account-activity-empty">{sync ? `当前筛选下暂无记录（最近同步：${sync.status}）` : '暂无 BOSS 求职记录，请点击“同步记录”开始。'}</div>}
          {loading && items.length > 0 && <div className="account-activity-local-loading"><Loader2 size={14} className="animate-spin" />正在按 {project} 的入库规则判断…</div>}
        </div>

        <footer className="account-activity-pagination"><span>共 {total} 条 · 第 {page} / {Math.max(pages, 1)} 页</span><div><button type="button" aria-label="上一页" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={15} /></button><button type="button" aria-label="下一页" disabled={page >= pages || loading} onClick={() => setPage((value) => value + 1)}><ChevronRight size={15} /></button></div></footer>
      </div>
    </section>
  );
}
