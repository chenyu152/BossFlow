import { Check, Laptop, Moon, Sun } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAppTranslation } from '../i18n';
import { type ThemeMode, useTheme } from '../theme';

const themeOptions: Array<{ value: ThemeMode; icon: typeof Laptop; labelKey: string; descriptionKey: string }> = [
  { value: 'system', icon: Laptop, labelKey: 'theme.system', descriptionKey: 'theme.systemDescription' },
  { value: 'dark', icon: Moon, labelKey: 'theme.dark', descriptionKey: 'theme.darkDescription' },
  { value: 'light', icon: Sun, labelKey: 'theme.light', descriptionKey: 'theme.lightDescription' },
];

export function ThemeOptions({ compact = false }: { compact?: boolean }) {
  const { t } = useAppTranslation();
  const { mode, setMode } = useTheme();

  return (
    <div className={compact ? 'theme-option-list' : 'theme-option-list theme-option-list--wide'} role="radiogroup" aria-label={t('theme.label')}>
      {themeOptions.map(({ value, icon: Icon, labelKey, descriptionKey }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={mode === value}
          onClick={() => setMode(value)}
          className={`theme-option ${mode === value ? 'theme-option--selected' : ''}`}
        >
          <span className="theme-option__preview" aria-hidden="true"><Icon size={14} /></span>
          <span className="min-w-0 flex-1 text-left">
            <span className="block text-xs font-medium">{t(labelKey)}</span>
            {!compact && <span className="mt-0.5 block text-[11px] leading-4 text-[var(--text-secondary)]">{t(descriptionKey)}</span>}
          </span>
          {mode === value && <Check size={15} className="shrink-0 text-[var(--action-primary)]" aria-hidden="true" />}
        </button>
      ))}
    </div>
  );
}

export function ThemePicker() {
  const { t } = useAppTranslation();
  const { mode, resolved } = useTheme();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeOnOutside = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  const TriggerIcon = resolved === 'dark' ? Moon : Sun;
  return (
    <div className="theme-picker" ref={panelRef}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('theme.label')}
        onClick={() => setOpen((value) => !value)}
        className="theme-picker__trigger"
      >
        <TriggerIcon size={16} aria-hidden="true" />
        <span className="min-w-0 flex-1 text-left">{t('theme.label')}</span>
        <span className="text-[10px] text-[var(--text-secondary)]">{t(`theme.${mode}`)}</span>
      </button>
      {open && (
        <div className="theme-picker__popover" role="dialog" aria-label={t('theme.label')}>
          <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">{t('theme.label')}</div>
          <ThemeOptions compact />
        </div>
      )}
    </div>
  );
}
