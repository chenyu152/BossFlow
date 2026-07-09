# BossFlow

本地优先的 AI 求职工作台。从 Boss 直聘发现岗位、AI 评估匹配度、定制简历、准备面试——全流程在本地完成，数据归你所有。

## 设计原则

- **本地优先** — 简历、报告、面试材料全部存为可读 Markdown/JSON 文件，不绑定任何云服务
- **人在回路** — 打招呼、简历覆盖、故事沉淀等关键动作必须用户确认，AI 只做建议不做决定
- **可审计** — AI 生成内容应逐步沉淀结构化证据来源（JD / 简历 / 用户确认），不凭空编造
- **Web + Agent 同源** — Web 控制台和未来的 Claude Code Agent skill 共享同一套后端服务和数据文件
- **分层限速** — Boss 直聘请求串行限速，AI 分析可并行

## 核心工作流

```
发现岗位 → 筛选去重 → Pipeline 队列 → 粗筛打分 → LLM 精评 → 定制简历 → 面试准备
  ↑                                                              ↓
爬虫采集                                                    故事库沉淀
```

1. **岗位发现** — 从 Boss 直聘按关键词+城市采集，支持标准/贪婪/滚动三种抓取模式
2. **粗筛过滤** — 按分类规则、黑名单、最低薪资、相关性关键词自动过滤
3. **Pipeline 管理** — 待处理队列，状态流转围绕候选推进，不与招聘核验状态混用
4. **AI 评估** — 规则引擎粗筛（薪资/经验/学历信号）+ LLM 精评（岗位匹配报告）
5. **简历定制** — LLM 生成修改建议 → 用户逐条确认 → 生成岗位定制 Markdown 简历草稿
6. **面试准备** — 生成公司岗位面试文档 + 故事库维护 + 故事草稿提取，故事库优先支持自由素材沉淀，再结构化为 STAR+R

## 技术栈

| 层 | 技术 |
|---|---|
| **后端** | Python 3 / FastAPI / Uvicorn / Pydantic |
| **爬虫** | DrissionPage（Chrome CDP 协议，API 拦截模式） |
| **前端** | React 18 / TypeScript / Tailwind CSS v4 / Vite |
| **AI** | DeepSeek API（可替换为其他 OpenAI 兼容模型） |
| **数据** | SQLite（岗位索引） + Markdown/JSON（报告、简历、配置） |
| **国际化** | i18next + react-i18next（中/英切换，默认跟随浏览器语言） |

## 目录结构

```
BossFlow/
├── backend/                 # FastAPI 后端
│   ├── app.py               # 路由入口（~45 个 API 端点）
│   ├── services/            # 业务逻辑
│   │   ├── crawler_service.py   # 爬虫任务管理
│   │   ├── job_service.py       # 岗位查询/导出
│   │   ├── pipeline_service.py  # Pipeline 队列 CRUD
│   │   ├── evaluation_service.py    # 规则引擎粗筛
│   │   ├── llm_evaluation_service.py # LLM 精评
│   │   ├── resume_service.py    # 简历建议/定制
│   │   ├── interview_service.py # 面试准备/故事库
│   │   ├── project_service.py   # 多项目配置
│   │   └── task_service.py      # 长任务状态
│   ├── schemas/             # Pydantic 数据模型
│   └── storage/             # 文件路径管理
│
├── bossspider-web/          # React 前端
│   ├── src/
│   │   ├── App.tsx              # 主布局 + 语言切换器
│   │   ├── main.tsx             # 入口
│   │   ├── api.ts               # API 客户端
│   │   ├── types.ts             # TypeScript 类型
│   │   ├── constants.ts         # 城市/策略配置
│   │   ├── i18n/                # 国际化（中/英）
│   │   ├── hooks/               # useBossSpider 核心 Hook
│   │   ├── pages/               # 9 个页面
│   │   │   ├── Dashboard.tsx    # 仪表盘
│   │   │   ├── Scope.tsx        # 采集范围
│   │   │   ├── Rules.tsx        # 清洗规则
│   │   │   ├── Jobs.tsx         # 数据浏览
│   │   │   ├── Pipeline.tsx     # Pipeline 队列
│   │   │   ├── Resume.tsx       # 简历工作台
│   │   │   ├── Interview.tsx    # 面试准备
│   │   │   ├── Story.tsx        # STAR+R 故事库
│   │   │   └── Logs.tsx         # 运行日志
│   │   ├── components/          # 通用组件
│   │   └── styles/              # 样式
│   └── package.json
│
├── crawler/                  # Boss 直聘爬虫核心
│   ├── boss.py               # BossCrawler 类（Chrome 自动化）
│   ├── pipeline.py           # 数据清洗/去重/分类
│   ├── db.py                 # SQLite 读写
│   ├── config.py             # 配置加载
│   └── config/keywords.json  # 默认关键词
│
├── projects/                 # 多项目实例
│   └── {project_name}/
│       ├── config.json       # 项目配置
│       ├── jobs_data.db      # 岗位 SQLite
│       └── crawl_partial.json# 中断恢复
│
├── data/                     # 共享数据
│   └── pipeline.md           # Pipeline 队列（Markdown + 元数据注释）
│
├── reports/jobs/             # LLM 岗位评估报告
├── output/resumes/           # 定制简历输出
├── output/interview-prep/    # 面试准备文档
├── data/interview-prep/      # 故事库/题库
├── cv.md                     # 基础简历（需自行创建，参考 cv.example.md）
├── profile.yml               # 求职偏好配置
├── .env                      # API Key 等环境变量
├── requirements.txt          # Python 依赖
├── ARCHITECTURE.md           # 架构设计文档
├── HANDOFF.md                # 开发交接文档
└── DESIGN_PROMPT.md          # 设计需求文档
```

## 快速开始

### 环境要求

- Python 3.10+
- Node.js 18+
- Chrome 浏览器

### 1. 克隆项目

```bash
git clone git@github.com:chenyu152/BossFlow.git
cd BossFlow
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`，填入 DeepSeek API Key（LLM 精评、简历定制、面试准备等功能依赖此 Key）：

```env
DEEPSEEK_API_KEY=sk-your-key-here
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat
```

### 3. 创建基础简历（可选但推荐）

```bash
cp cv.example.md cv.md
# 编辑 cv.md，填入你的真实经历
```

### 4. 安装依赖

```bash
# Python
pip install -r requirements.txt

# 前端
cd bossspider-web
npm ci
cd ..
```

### 5. 启动服务

```bash
# 终端 1：后端
python -m uvicorn backend.app:app --reload --port 8000

# 终端 2：前端
cd bossspider-web
npm run dev -- --host 127.0.0.1 --port 5173
```

打开浏览器：

| 地址 | 说明 |
|------|------|
| `http://127.0.0.1:5173/` | Web 控制台 |
| `http://127.0.0.1:8000/docs` | API 文档（Swagger） |

## Web 控制台页面

| 页面 | 功能 |
|------|------|
| **Dashboard** | 岗位总览指标、爬虫启动/停止、策略选择、最近日志 |
| **Scope** | 编辑关键词、城市、抓取上限 |
| **Rules** | 编辑分类匹配规则、黑名单、最低薪资 |
| **Jobs** | 浏览 SQLite 岗位数据、搜索筛选、批量评分、导出 Excel |
| **Pipeline** | 候选岗位队列、粗筛打分、LLM 精评、推进状态流转、删除 |
| **Resume** | 查看 LLM 简历修改建议、勾选确认、生成岗位定制简历草稿 |
| **Interview** | 生成面试准备文档、查看故事库、提取故事草稿 |
| **Story** | STAR+R 故事库编辑（草稿 ↔ 已确认）、标签/场景/任务/行动/结果/反思 |
| **Logs** | 实时日志流、按级别筛选、自动滚动 |

## 爬虫使用

Web 控制台操作：**Dashboard** → 选择项目 → 配置 Scope/Rules → 点击 **Start Crawl**。

也支持命令行独立运行：

```bash
# 标准模式
python -m crawler.boss --config projects/agent

# 快速模式（随机抽样关键词）
python -m crawler.boss --config projects/agent --quick

# 滚动模式（目标 200 条）
python -m crawler.boss --config projects/agent --scroll 200

# 贪婪模式（翻到底）
python -m crawler.boss --config projects/agent --greedy --merge

# 仅登录保存 Cookie
python -m crawler.boss --config projects/agent --login

# 从中断文件恢复
python -m crawler.boss --config projects/agent --process-partial
```

## 多语言

前端支持中/英文切换。Header 右侧点击 `中` / `EN` 按钮即可切换，偏好保存在浏览器 localStorage 中。默认跟随浏览器语言，中文兜底。

## 隐私与安全

- `.env`、`cv.md`、`profile.yml`、`data/pipeline.md`、`reports/`、`output/` 均在 `.gitignore` 中，不会提交到 Git
- Boss 直聘打招呼不会自动执行；系统只保留草稿、复制和人工确认记录
- 岗位招聘状态只作为低频核验结果展示，不承诺实时同步；遇到登录、验证码或安全页时不做绕过
- AI 不会凭空编造工作经历、指标、学历等事实
- 项目源码审计默认跳过 `.env`、密钥、`node_modules` 等敏感文件

## 路线图

- [x] 爬虫 Web 控制台
- [x] Pipeline 队列 + 粗筛打分
- [x] LLM 精评 + 岗位匹配报告
- [x] 简历修改建议 + 定制简历草稿
- [x] 面试准备文档 + STAR+R 故事库
- [x] 中英文切换
- [x] Pipeline `schemaVersion` + 文件锁 + 迁移入口
- [x] 拆分候选推进状态和岗位招聘核验状态
- [ ] LLM 建议 evidence map：`claimId` / `risk` / `sources` / `userDecision`
- [ ] 岗位档案 API 和右侧工作区聚合
- [ ] 自由素材优先的故事库
- [ ] 面试模拟练习
- [ ] 面试复盘
- [ ] Boss 沟通辅助（草稿、复制、人工使用记录；不做默认代发）
- [ ] 题库管理
- [ ] PDF 简历渲染
- [ ] Claude Code Agent Skill 集成

## 参考文档

- [ARCHITECTURE.md](ARCHITECTURE.md) — 目标架构和分阶段建设路线
- [HANDOFF.md](HANDOFF.md) — 开发交接、已完成功能、建议下一步
- [DESIGN_PROMPT.md](DESIGN_PROMPT.md) — Web 控制台设计需求
