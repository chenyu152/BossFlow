import { BookOpenText, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAppTranslation } from '../i18n';

type DescriptionSection = {
  title: string;
  items: string[];
};

const HEADING_LABELS: Record<string, string> = {
  岗位职责: '岗位职责',
  工作职责: '岗位职责',
  职位描述: '岗位职责',
  工作内容: '岗位职责',
  职责描述: '岗位职责',
  核心职责: '岗位职责',
  任职要求: '任职要求',
  岗位要求: '任职要求',
  任职资格: '任职要求',
  任职条件: '任职要求',
  职位要求: '任职要求',
  加分项: '加分项',
  优先条件: '加分项',
  优先考虑: '加分项',
  福利待遇: '其他信息',
  职位亮点: '其他信息',
  其他: '其他信息',
};

const HEADING_RE = /[【\[\(（「『]?(岗位职责|工作职责|职位描述|工作内容|职责描述|核心职责|任职要求|岗位要求|任职资格|任职条件|职位要求|加分项|优先条件|优先考虑|福利待遇|职位亮点|其他)[】\]\)）」』]?/g;
const NUMBER_RE = /(?:^|\s)(?:\d{1,2}\s*[、.．)）]|[（(]\s*\d{1,2}\s*[)）])/g;

function cleanText(text: string) {
  return text
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n+/g, ' ')
    .trim();
}

function cleanItem(text: string) {
  return text
    .replace(/^[\s:：;；,，、.。\-【】\[\]「」『』]+/, '')
    .replace(/[\s:：;；,，、.。\-【】\[\]「」『』]+$/, '')
    .trim();
}

function sectionTitleForIntro(text: string) {
  if (/^(工作地点|工作城市|办公地点|base)(?=[:：\s]|$)/i.test(text.trim())) return '基本信息';
  return 'Description';
}

function hasContent(text: string) {
  return /[\p{L}\p{N}]/u.test(text);
}

function splitNumberedItems(text: string) {
  const normalized = cleanItem(cleanText(text));
  if (!normalized) return [];

  const matches = [...normalized.matchAll(NUMBER_RE)];
  if (!matches.length) {
    return normalized
      .split(/(?<=[。；;])\s+/)
      .map(cleanItem)
      .filter((item) => item && hasContent(item));
  }

  const items: string[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const start = matches[index].index ?? 0;
    const end = matches[index + 1]?.index ?? normalized.length;
    const raw = normalized.slice(start, end);
    const item = cleanItem(raw.replace(/^\s*(?:\d{1,2}\s*[、.．)）]|[（(]\s*\d{1,2}\s*[)）])\s*/, ''));
    if (item && hasContent(item)) items.push(item);
  }

  const prefix = cleanItem(normalized.slice(0, matches[0].index ?? 0));
  return prefix && hasContent(prefix) ? [prefix, ...items] : items;
}

function mergeSection(sections: DescriptionSection[], title: string, body: string) {
  const items = splitNumberedItems(body);
  if (!items.length) return;

  const existing = sections.find((section) => section.title === title);
  if (existing) existing.items.push(...items);
  else sections.push({ title, items });
}

function parseDescription(text: string): DescriptionSection[] {
  const normalized = cleanText(text);
  if (!normalized) return [];

  const matches = [...normalized.matchAll(HEADING_RE)];
  if (!matches.length) {
    return [{ title: 'Description', items: splitNumberedItems(normalized) }];
  }

  const sections: DescriptionSection[] = [];
  const firstHeadingIndex = matches[0].index ?? 0;
  const intro = normalized.slice(0, firstHeadingIndex).trim();
  if (intro) mergeSection(sections, sectionTitleForIntro(intro), intro);

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const rawTitle = match[1] || match[0];
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? normalized.length;
    mergeSection(sections, HEADING_LABELS[rawTitle] || rawTitle, normalized.slice(start, end));
  }

  return sections.length ? sections : [{ title: 'Description', items: [normalized] }];
}

function DescriptionContent({ sections, compact = false }: { sections: DescriptionSection[]; compact?: boolean }) {
  const visibleSections = compact
    ? sections.map((section) => ({ ...section, items: section.items.slice(0, 4) }))
    : sections;

  return (
    <div className="space-y-4">
      {visibleSections.map((section) => (
        <section key={section.title} className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{section.title}</h4>
          <ol className="space-y-2">
            {section.items.map((item, index) => (
              <li key={`${section.title}-${index}`} className="flex gap-2 text-sm leading-6 text-zinc-300">
                <span className="mt-0.5 flex h-5 min-w-5 items-center justify-center rounded bg-zinc-800 text-[10px] font-medium text-zinc-500">
                  {index + 1}
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

export function JobDescription({ text }: { text?: string }) {
  const { t } = useAppTranslation();
  const [open, setOpen] = useState(false);
  const sections = useMemo(() => parseDescription(text || ''), [text]);
  const itemCount = sections.reduce((sum, section) => sum + section.items.length, 0);
  const hasMore = itemCount > 6 || sections.length > 2;

  if (!text?.trim()) {
    return (
      <div>
        <div className="mb-1 text-xs text-zinc-500">{t('jobs.description')}</div>
        <div className="rounded border border-zinc-800/50 bg-zinc-900/50 p-3 text-sm text-zinc-500">
          {t('jobs.noDescriptionLoaded')}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="text-xs text-zinc-500">{t('jobs.description')}</div>
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          <BookOpenText size={13} />
          {t('jobs.viewFullJd')}
        </button>
      </div>
      <div className="rounded border border-zinc-800/50 bg-zinc-900/50 p-3">
        <DescriptionContent sections={sections.slice(0, 2)} compact />
        {hasMore && (
          <button
            onClick={() => setOpen(true)}
            className="mt-3 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {t('jobs.showAllItems', { count: itemCount })}
          </button>
        )}
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6 py-5"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4 border-b border-zinc-800 px-5 py-4">
              <div className="flex min-w-0 items-center gap-2">
                <BookOpenText size={16} className="text-indigo-400" />
                <h3 className="truncate text-base font-semibold text-zinc-100">{t('jobs.jobDetails')}</h3>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded border border-zinc-800 p-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            <div className="overflow-auto px-8 py-6">
              <DescriptionContent sections={sections} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
