import { Check, Plus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

function parseKeywords(value: string) {
  const seen = new Set<string>();
  return value
    .split(/\r?\n/)
    .map((keyword) => keyword.trim())
    .filter((keyword) => {
      if (!keyword) return false;
      const key = keyword.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function KeywordInput({
  value,
  onChange,
  label,
  addLabel,
  inputPlaceholder,
  emptyLabel,
  className = '',
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  addLabel: string;
  inputPlaceholder: string;
  emptyLabel: string;
  className?: string;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const keywords = useMemo(() => parseKeywords(value), [value]);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  const addKeyword = () => {
    const nextKeyword = draft.trim();
    if (!nextKeyword) {
      inputRef.current?.focus();
      return;
    }
    const exists = keywords.some((keyword) => keyword.toLocaleLowerCase() === nextKeyword.toLocaleLowerCase());
    if (!exists) onChange([...keywords, nextKeyword].join('\n'));
    setDraft('');
    setAdding(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const removeKeyword = (keywordToRemove: string) => {
    onChange(keywords.filter((keyword) => keyword !== keywordToRemove).join('\n'));
  };

  return (
    <div className={`keyword-input ${className}`.trim()}>
      <div className="keyword-input__header">
        <span className="keyword-input__label">{label}</span>
        <button
          type="button"
          className="keyword-input__add-toggle"
          onClick={() => {
            setAdding((current) => !current);
            setDraft('');
          }}
          aria-expanded={adding}
        >
          <Plus size={14} aria-hidden="true" />
          {addLabel}
        </button>
      </div>

      {adding && (
        <div className="keyword-input__editor">
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addKeyword();
              } else if (event.key === 'Escape') {
                setAdding(false);
                setDraft('');
              }
            }}
            placeholder={inputPlaceholder}
            aria-label={inputPlaceholder}
          />
          <button type="button" className="keyword-input__confirm" onClick={addKeyword} aria-label={addLabel}>
            <Check size={15} aria-hidden="true" />
          </button>
          <button type="button" className="keyword-input__cancel" onClick={() => { setAdding(false); setDraft(''); }} aria-label="Cancel">
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="keyword-input__list" aria-live="polite">
        {keywords.length > 0 ? keywords.map((keyword) => (
          <span className="keyword-input__pill" key={keyword}>
            <span>{keyword}</span>
            <button type="button" onClick={() => removeKeyword(keyword)} aria-label={`Remove ${keyword}`}>
              <X size={13} aria-hidden="true" />
            </button>
          </span>
        )) : <span className="keyword-input__empty">{emptyLabel}</span>}
      </div>
    </div>
  );
}
