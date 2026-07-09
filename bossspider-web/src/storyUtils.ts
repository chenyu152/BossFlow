import type { InterviewStory } from './types';

export const emptyStory = (title = ''): InterviewStory => ({
  id: `draft-${Date.now()}`,
  title,
  theme: '',
  source: '',
  tags: [],
  rawNote: '',
  format: 'freeform',
  structureStatus: 'needs_structuring',
  situation: '',
  task: '',
  action: '',
  result: '',
  reflection: '',
});

function splitMarkdownTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim().replace(/\*\*/g, ''));
}

function sectionLines(content: string, headingPattern: RegExp): string[] {
  const lines = content.split(/\r?\n/);
  const section: string[] = [];
  let inSection = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (headingPattern.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && /^##\s+/.test(line)) break;
    if (!inSection) continue;
    section.push(raw);
  }
  return section;
}

function bulletBody(line: string): string {
  return line
    .replace(/^[-*]\s+/, '')
    .replace(/^\*\*[^*]+\*\*[：:]\s*/, '')
    .trim();
}

export function extractStoryDraftsFromPrep(content: string): InterviewStory[] {
  const drafts: InterviewStory[] = [];

  for (const raw of sectionLines(content, /^##\s+C[.、\s]/)) {
    const line = raw.trim();
    if (!line.startsWith('|') || /^[-|\s]+$/.test(line) || line.includes('问题/能力点')) continue;
    const [theme, title, why, angle, risk] = splitMarkdownTableRow(line);
    if (!title || title === '推荐故事') continue;
    drafts.push({
      ...emptyStory(title),
      theme: theme || 'CV 可沉淀故事',
      source: '由面试准备 C. 故事库匹配生成，需用户确认',
      tags: [theme].filter(Boolean),
      situation: why ? `待确认匹配背景：${why}` : '',
      task: angle ? `待调整角度：${angle}` : '',
      action: title,
      result: '',
      reflection: risk ? `风险/需补证据：${risk}` : '',
    });
  }

  let current: InterviewStory | null = null;
  let currentGapBulletIndex = 0;
  for (const raw of sectionLines(content, /^##\s+D[.、\s]/)) {
    const line = raw.trim();
    const heading = line.match(/^###\s+\d+[.、]\s*(.+)$/);
    if (heading) {
      if (current) drafts.push(current);
      currentGapBulletIndex = 0;
      current = {
        ...emptyStory(heading[1].replace(/\*\*/g, '').trim()),
        theme: '缺失故事',
        source: '由面试准备 D. 缺失故事生成，需用户确认',
        tags: ['gap', heading[1].replace(/\*\*/g, '').trim()].filter(Boolean),
      };
      continue;
    }
    if (!current) continue;
    if (/^[-*]\s+/.test(line)) currentGapBulletIndex += 1;
    const body = bulletBody(line);
    const why = line.match(/^[-*]\s+\*\*为什么可能问\*\*[：:]\s*(.+)$/);
    const evidence = line.match(/^[-*]\s+\*\*可从哪些已有经历挖\*\*[：:]\s*(.+)$/);
    const facts = line.match(/^[-*]\s+\*\*需补充事实\*\*[：:]\s*(.+)$/);
    if (why || (currentGapBulletIndex === 1 && body)) current.situation = `为什么可能问：${(why?.[1] || body).trim()}`;
    if (evidence || (currentGapBulletIndex === 2 && body)) current.action = `可挖经历：${(evidence?.[1] || body).trim()}`;
    if (facts || (currentGapBulletIndex === 3 && body)) current.reflection = `需补充事实：${(facts?.[1] || body).trim()}`;
  }
  if (current) drafts.push(current);

  const seen = new Set<string>();
  return drafts.filter((draft) => {
    const key = `${draft.theme}|${draft.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return draft.title.length > 2;
  }).slice(0, 12);
}
