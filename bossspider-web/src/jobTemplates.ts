import type { ProjectTemplateSeed } from './types';

export type JobDirectionTemplate = {
  id: string;
  icon: 'sparkles' | 'product' | 'frontend' | 'backend' | 'data' | 'embedded';
  titleKey: string;
  descriptionKey: string;
  defaultName: string;
  categoryName: string;
  keywords: string[];
  scoringKeywords: string[];
};

export const JOB_DIRECTION_TEMPLATES: JobDirectionTemplate[] = [
  {
    id: 'ai-agent', icon: 'sparkles', titleKey: 'directions.templates.aiAgent.title', descriptionKey: 'directions.templates.aiAgent.description',
    defaultName: 'AI Agent 应用开发', categoryName: 'AI Agent / 大模型应用',
    keywords: ['AI Agent 开发工程师', '大模型应用开发工程师', '智能体开发工程师', 'LLM 应用工程师'],
    scoringKeywords: ['AI', 'Agent', 'LLM', 'RAG', 'LangChain', 'Python', '智能体', '大模型应用'],
  },
  {
    id: 'product', icon: 'product', titleKey: 'directions.templates.product.title', descriptionKey: 'directions.templates.product.description',
    defaultName: '产品经理', categoryName: '产品经理',
    keywords: ['产品经理', 'AI 产品经理', '策略产品经理', '平台产品经理'],
    scoringKeywords: ['产品经理', '需求分析', '产品规划', '数据分析', '用户研究', '原型设计', 'AI 产品'],
  },
  {
    id: 'frontend', icon: 'frontend', titleKey: 'directions.templates.frontend.title', descriptionKey: 'directions.templates.frontend.description',
    defaultName: '前端开发', categoryName: '前端开发',
    keywords: ['前端开发工程师', 'Web 前端工程师', 'React 开发工程师', 'Vue 开发工程师'],
    scoringKeywords: ['前端', 'TypeScript', 'JavaScript', 'React', 'Vue', 'CSS', '前端工程化'],
  },
  {
    id: 'backend', icon: 'backend', titleKey: 'directions.templates.backend.title', descriptionKey: 'directions.templates.backend.description',
    defaultName: '后端开发', categoryName: '后端开发',
    keywords: ['后端开发工程师', 'Java 开发工程师', 'Python 开发工程师', 'Golang 开发工程师'],
    scoringKeywords: ['后端', 'Java', 'Python', 'Go', '微服务', 'MySQL', 'Redis', '分布式系统'],
  },
  {
    id: 'data', icon: 'data', titleKey: 'directions.templates.data.title', descriptionKey: 'directions.templates.data.description',
    defaultName: '数据分析与数据科学', categoryName: '数据分析 / 数据科学',
    keywords: ['数据分析师', '数据科学家', '商业分析师', 'BI 工程师'],
    scoringKeywords: ['数据分析', 'SQL', 'Python', '数据科学', '机器学习', 'BI', '统计分析'],
  },
  {
    id: 'embedded', icon: 'embedded', titleKey: 'directions.templates.embedded.title', descriptionKey: 'directions.templates.embedded.description',
    defaultName: '嵌入式软件', categoryName: '嵌入式 / IoT',
    keywords: ['嵌入式软件工程师', '嵌入式开发工程师', '单片机开发工程师', 'IoT 开发工程师'],
    scoringKeywords: ['嵌入式', 'C/C++', 'STM32', 'FreeRTOS', 'Linux', '单片机', 'IoT', '通信协议'],
  },
];

export function buildTemplateSeed(template: JobDirectionTemplate | undefined, name: string, citiesText: string): ProjectTemplateSeed {
  const keywords = template?.keywords ?? [name];
  const scoringKeywords = template?.scoringKeywords ?? [];
  return {
    keywordsText: keywords.join('\n'),
    citiesText,
    catRulesText: template ? JSON.stringify({ [template.categoryName]: keywords }, null, 2) : '{}',
    relevanceText: scoringKeywords.length > 0 ? scoringKeywords.join('\n') : keywords.join('\n'),
    blacklistText: '',
    scoringKeywords,
  };
}
