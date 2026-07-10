import {
  Bold,
  Code2,
  Columns2,
  Eye,
  Heading1,
  Heading2,
  Italic,
  Link,
  List,
  ListOrdered,
  Pencil,
  Quote,
} from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAppTranslation } from '../i18n';

type EditorMode = 'edit' | 'split' | 'preview';

const articleClass = 'mx-auto max-w-4xl text-sm leading-7 text-zinc-300 [&_h1]:mb-5 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-zinc-100 [&_h2]:mb-3 [&_h2]:mt-8 [&_h2]:border-b [&_h2]:border-zinc-800 [&_h2]:pb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-zinc-100 [&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:font-semibold [&_h3]:text-zinc-100 [&_p]:my-3 [&_a]:text-indigo-300 [&_a]:underline [&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-indigo-700 [&_blockquote]:pl-4 [&_blockquote]:text-zinc-400 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_strong]:text-zinc-100 [&_code]:rounded [&_code]:bg-zinc-900 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-indigo-300 [&_pre]:my-4 [&_pre]:overflow-auto [&_pre]:rounded [&_pre]:border [&_pre]:border-zinc-800 [&_pre]:bg-zinc-950 [&_pre]:p-4 [&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-zinc-800 [&_th]:bg-zinc-900 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-zinc-100 [&_td]:border [&_td]:border-zinc-800 [&_td]:px-3 [&_td]:py-2 [&_hr]:my-6 [&_hr]:border-zinc-800';

function ToolbarButton({ label, active = false, children, onClick }: {
  label: string;
  active?: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded transition-colors ${
        active
          ? 'bg-indigo-600 text-white'
          : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
      }`}
    >
      {children}
    </button>
  );
}

export function MarkdownEditor({
  value,
  onChange,
  onSave,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  onSave?: () => void;
  placeholder: string;
}) {
  const { t } = useAppTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<EditorMode>('split');
  const lineCount = value ? value.split('\n').length : 0;

  const replaceSelection = (before: string, after: string, fallback: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.slice(start, end) || fallback;
    const next = `${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`;
    onChange(next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  };

  const prefixSelection = (prefix: string, fallback: string, ordered = false) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    const lineEndIndex = value.indexOf('\n', end);
    const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
    const selected = value.slice(lineStart, lineEnd) || fallback;
    const formatted = selected
      .split('\n')
      .map((line, index) => `${ordered ? `${index + 1}. ` : prefix}${line}`)
      .join('\n');
    onChange(`${value.slice(0, lineStart)}${formatted}${value.slice(lineEnd)}`);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(lineStart, lineStart + formatted.length);
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && onSave) {
      event.preventDefault();
      onSave();
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      replaceSelection('  ', '', '');
    }
  };

  return (
    <div className="flex h-full min-h-[520px] flex-col overflow-hidden rounded border border-zinc-800 bg-zinc-950">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-900/70 px-2 py-1.5">
        <div className={`flex items-center gap-0.5 ${mode === 'preview' ? 'pointer-events-none opacity-40' : ''}`}>
          <ToolbarButton label={t('markdownEditor.heading1')} onClick={() => prefixSelection('# ', t('markdownEditor.headingPlaceholder'))}><Heading1 size={15} /></ToolbarButton>
          <ToolbarButton label={t('markdownEditor.heading2')} onClick={() => prefixSelection('## ', t('markdownEditor.headingPlaceholder'))}><Heading2 size={15} /></ToolbarButton>
          <span className="mx-1 h-5 w-px bg-zinc-800" />
          <ToolbarButton label={t('markdownEditor.bold')} onClick={() => replaceSelection('**', '**', t('markdownEditor.textPlaceholder'))}><Bold size={15} /></ToolbarButton>
          <ToolbarButton label={t('markdownEditor.italic')} onClick={() => replaceSelection('*', '*', t('markdownEditor.textPlaceholder'))}><Italic size={15} /></ToolbarButton>
          <ToolbarButton label={t('markdownEditor.quote')} onClick={() => prefixSelection('> ', t('markdownEditor.textPlaceholder'))}><Quote size={15} /></ToolbarButton>
          <span className="mx-1 h-5 w-px bg-zinc-800" />
          <ToolbarButton label={t('markdownEditor.bulletList')} onClick={() => prefixSelection('- ', t('markdownEditor.listPlaceholder'))}><List size={15} /></ToolbarButton>
          <ToolbarButton label={t('markdownEditor.numberedList')} onClick={() => prefixSelection('', t('markdownEditor.listPlaceholder'), true)}><ListOrdered size={15} /></ToolbarButton>
          <ToolbarButton label={t('markdownEditor.code')} onClick={() => replaceSelection('`', '`', t('markdownEditor.codePlaceholder'))}><Code2 size={15} /></ToolbarButton>
          <ToolbarButton label={t('markdownEditor.link')} onClick={() => replaceSelection('[', '](https://)', t('markdownEditor.linkPlaceholder'))}><Link size={15} /></ToolbarButton>
        </div>

        <div className="flex shrink-0 items-center rounded border border-zinc-800 bg-zinc-950 p-0.5">
          <ToolbarButton label={t('markdownEditor.edit')} active={mode === 'edit'} onClick={() => setMode('edit')}><Pencil size={14} /></ToolbarButton>
          <ToolbarButton label={t('markdownEditor.split')} active={mode === 'split'} onClick={() => setMode('split')}><Columns2 size={14} /></ToolbarButton>
          <ToolbarButton label={t('markdownEditor.preview')} active={mode === 'preview'} onClick={() => setMode('preview')}><Eye size={14} /></ToolbarButton>
        </div>
      </div>

      <div className={`grid min-h-0 flex-1 ${mode === 'split' ? 'lg:grid-cols-2' : 'grid-cols-1'}`}>
        {mode !== 'preview' && (
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            placeholder={placeholder}
            className={`min-h-[470px] w-full resize-none bg-zinc-950 p-5 font-mono text-sm leading-6 text-zinc-200 outline-none ${mode === 'split' ? 'border-b border-zinc-800 lg:border-b-0 lg:border-r' : ''}`}
          />
        )}

        {mode !== 'edit' && (
          <div className="min-h-[470px] overflow-auto bg-zinc-950/70 p-6">
            {value.trim() ? (
              <article className={articleClass}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
              </article>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-zinc-600">{t('markdownEditor.emptyPreview')}</div>
            )}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-[10px] text-zinc-500">
        <span>Markdown · GFM</span>
        <span>{t('markdownEditor.stats', { lines: lineCount, chars: value.length })}</span>
      </div>
    </div>
  );
}
