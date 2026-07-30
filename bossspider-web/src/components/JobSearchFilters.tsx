import { RotateCcw, SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { bossApi } from '../api';
import { useAppTranslation } from '../i18n';
import type {
  JobSearchFilterKey,
  JobSearchFilters as JobSearchFiltersValue,
  SearchFilterOption,
  SearchFilterOptionsResponse,
} from '../types';

export const EMPTY_JOB_SEARCH_FILTERS: JobSearchFiltersValue = {
  position: '',
  jobType: '',
  salary: '',
  experience: '',
  degree: '',
  industry: '',
  scale: '',
  stage: '',
};

const FIELD_ORDER: JobSearchFilterKey[] = [
  'position',
  'jobType',
  'salary',
  'experience',
  'degree',
  'industry',
  'scale',
  'stage',
];

const ENGLISH_LABELS: Record<JobSearchFilterKey, string> = {
  position: 'Job category',
  jobType: 'Employment type',
  salary: 'Salary',
  experience: 'Experience',
  degree: 'Education',
  industry: 'Company industry',
  scale: 'Company size',
  stage: 'Funding stage',
};

function groupedOptions(options: SearchFilterOption[]) {
  const plain: SearchFilterOption[] = [];
  const groups = new Map<string, SearchFilterOption[]>();
  options.forEach((option) => {
    if (!option.group) {
      plain.push(option);
      return;
    }
    const group = groups.get(option.group) || [];
    group.push(option);
    groups.set(option.group, group);
  });
  return { plain, groups: [...groups.entries()] };
}

export function JobSearchFilters({
  value,
  onChange,
  compact = false,
}: {
  value: JobSearchFiltersValue;
  onChange: (value: JobSearchFiltersValue) => void;
  compact?: boolean;
}) {
  const { i18n } = useAppTranslation();
  const isZh = (i18n.resolvedLanguage || i18n.language).startsWith('zh');
  const [metadata, setMetadata] = useState<SearchFilterOptionsResponse | null>(null);
  const [error, setError] = useState('');
  const activeCount = useMemo(
    () => FIELD_ORDER.filter((key) => Boolean(value[key])).length,
    [value],
  );

  useEffect(() => {
    let cancelled = false;
    void bossApi.getSearchFilterOptions()
      .then((response) => {
        if (!cancelled) setMetadata(response);
      })
      .catch((loadError) => {
        if (!cancelled) setError((loadError as Error).message);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <section className={`job-search-filters${compact ? ' job-search-filters--compact' : ''}`}>
      <header>
        <div>
          <span><SlidersHorizontal size={15} /></span>
          <div>
            <strong>{isZh ? 'BOSS 搜索筛选' : 'BOSS search filters'}</strong>
            <small>{isZh
              ? '采集前先在 BOSS 搜索页缩小范围；不选择的项目保持“不限”。'
              : 'Narrow the BOSS search before collection. Unselected fields remain unrestricted.'}</small>
          </div>
        </div>
        <div className="job-search-filters__actions">
          {activeCount > 0 && <b>{isZh ? `已选 ${activeCount} 项` : `${activeCount} active`}</b>}
          <button
            type="button"
            onClick={() => onChange({ ...EMPTY_JOB_SEARCH_FILTERS })}
            disabled={!activeCount}
          >
            <RotateCcw size={13} />{isZh ? '恢复不限' : 'Reset'}
          </button>
        </div>
      </header>

      <div className="job-search-filters__grid">
        {FIELD_ORDER.map((key) => {
          const field = metadata?.fields[key];
          const options = field?.options || [];
          const grouped = groupedOptions(options);
          const currentMissing = Boolean(value[key]) && !options.some((option) => option.value === value[key]);
          return (
            <label key={key}>
              <span>{isZh ? (field?.label || '加载中…') : ENGLISH_LABELS[key]}</span>
              <select
                value={value[key]}
                onChange={(event) => onChange({ ...value, [key]: event.target.value })}
                disabled={!metadata}
              >
                {!metadata && <option value="">{isZh ? '正在读取选项…' : 'Loading options…'}</option>}
                {currentMissing && <option value={value[key]}>{value[key]}</option>}
                {grouped.plain.map((option) => (
                  <option key={`${key}-${option.value || 'all'}`} value={option.value}>{option.label}</option>
                ))}
                {grouped.groups.map(([group, groupOptions]) => (
                  <optgroup key={`${key}-${group}`} label={group}>
                    {groupOptions.map((option) => (
                      <option key={`${key}-${option.value}`} value={option.value}>{option.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          );
        })}
      </div>
      {error && <p>{isZh ? '筛选选项暂时无法加载，请稍后重试。' : 'Filter options could not be loaded. Try again later.'}</p>}
    </section>
  );
}
