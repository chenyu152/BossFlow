import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CITY_OPTIONS, POPULAR_CITY_OPTIONS } from '../constants';
import { useAppTranslation } from '../i18n';
import { hasCity, parseCitiesText, toggleCity } from '../utils';

export function CitySelector({
  value,
  onChange,
  showAdvanced = true,
  compact = false,
}: {
  value: string;
  onChange: (value: string) => void;
  showAdvanced?: boolean;
  compact?: boolean;
}) {
  const { t } = useAppTranslation();
  const [query, setQuery] = useState('');
  const [browseAll, setBrowseAll] = useState(false);
  const selected = useMemo(() => parseCitiesText(value), [value]);
  const visibleCities = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (normalized) {
      return CITY_OPTIONS.filter((city) => city.name.toLowerCase().includes(normalized) || city.code.includes(normalized));
    }
    return browseAll ? CITY_OPTIONS : POPULAR_CITY_OPTIONS;
  }, [browseAll, query]);

  return (
    <div className={`city-selector${compact ? ' city-selector--compact' : ''}`}>
      <div className="city-selector__summary">
        <div>
          <strong>{t('scope.citySelector.selected', { count: selected.length })}</strong>
          <span>{t('scope.citySelector.available', { count: CITY_OPTIONS.length })}</span>
        </div>
        {selected.length > 0 && (
          <div className="city-selector__selected-list">
            {selected.map((city) => (
              <button
                type="button"
                key={city.name}
                onClick={() => onChange(toggleCity(value, city))}
                title={t('scope.citySelector.remove', { name: city.name })}
              >
                <span>{city.name}</span><X size={12} />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="city-selector__search">
        <Search size={15} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('scope.citySelector.searchPlaceholder')}
          aria-label={t('scope.citySelector.searchPlaceholder')}
        />
        {query && <button type="button" onClick={() => setQuery('')} aria-label={t('scope.citySelector.clearSearch')}><X size={14} /></button>}
      </div>

      <div className="city-selector__list-header">
        <span>{query ? t('scope.citySelector.searchResults') : browseAll ? t('scope.citySelector.allCities') : t('scope.citySelector.popularCities')}</span>
        {!query && (
          <button type="button" onClick={() => setBrowseAll((current) => !current)}>
            {browseAll ? t('scope.citySelector.showPopular') : t('scope.citySelector.browseAll')}
            {browseAll ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        )}
      </div>

      <div className={`city-selector__options${browseAll || query ? ' city-selector__options--scroll' : ''}`}>
        {visibleCities.map((city) => {
          const isSelected = hasCity(value, city.name);
          return (
            <button
              type="button"
              key={city.name}
              onClick={() => onChange(toggleCity(value, city))}
              aria-pressed={isSelected}
              className={isSelected ? 'city-selector__option city-selector__option--selected' : 'city-selector__option'}
            >
              <span>{city.name}</span>
              {(browseAll || query) && <small>{city.code}</small>}
            </button>
          );
        })}
        {visibleCities.length === 0 && <p className="city-selector__empty">{t('scope.citySelector.noResults')}</p>}
      </div>

      {showAdvanced && (
        <details className="city-selector__advanced">
          <summary>{t('scope.citySelector.advanced')}</summary>
          <p>{t('scope.citySelector.advancedHint')}</p>
          <textarea value={value} onChange={(event) => onChange(event.target.value)} spellCheck={false} />
        </details>
      )}
    </div>
  );
}
