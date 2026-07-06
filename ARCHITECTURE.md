# BossSpider New Architecture

本文档描述 `new/` 目录下 BossSpider 的目标产品形态和技术架构。原则是：Web 控制台和 agent skills 共用同一套后端服务、数据契约和本地文件，不为不同入口重复实现业务逻辑。

## 1. 产品定位

BossSpider 不再只是 Boss 直聘爬虫配置工具，而是一个本地优先的求职工作台。

核心工作流：

1. 发现岗位：从 Boss 直聘搜索、推荐、历史数据中获取岗位。
2. 筛选岗位：对岗位去重、过滤、入队，形成待评估列表。
3. 评估岗位：基于 JD、个人简历、求职目标和可选项目证据生成岗位匹配报告。
4. 准备材料：生成定制简历、打招呼草稿、面试准备内容，所有用户可见材料都先由用户确认。
5. Boss 沟通：查看个人资料、已投递、面试邀请、沟通列表，打招呼必须由用户确认后发送。
6. 面试准备和复盘：维护故事库、题库、公司岗位准备文档和面试后复盘。

## 2. 设计原则

### 本地优先

用户数据优先保存在 `new/` 内的可读文件中。Web UI、后端服务和 agent skills 都读写这些文件。

数据库可以作为索引、缓存或爬虫结果存储，但不应成为唯一真相来源。

### 人在回路

以下动作必须要求用户确认：

- 发送 Boss 打招呼。
- 覆盖基础简历。
- 生成或保存定制简历最终版本。
- 将 AI 生成内容标记为已使用或已发送。
- 从项目源码中提取的事实进入简历或面试故事库。

### 可审计

AI 生成结果需要保留来源：

- 来自 JD 的证据。
- 来自 `cv.md` 的证据。
- 来自项目源码审计的证据。
- 用户确认过的事实。

### 分层限速

Boss 直聘请求层应串行、限速、可暂停、可恢复。AI 分析层可以并行。

这意味着：

- 爬虫和 Boss API 不做激进并发。
- 岗位评估、简历草稿、面试材料生成可以使用 worker 并行。

### Web 和 skills 同源

Web 只负责交互体验。Skills 只负责 agent 入口和操作说明。两者都调用同一套 backend service 或本地命令，不各自实现业务逻辑。

## 3. 目标目录结构

```text
new/
  backend/
    app.py
    services/
      crawler_service.py
      boss_api_service.py
      job_service.py
      evaluation_service.py
      resume_service.py
      interview_service.py
      task_service.py
    schemas/
      common.py
      jobs.py
      applications.py
      resumes.py
      interviews.py
    storage/
      paths.py
      markdown_store.py
      sqlite_store.py
      json_store.py

  bossspider-web/
    src/
      api/
      components/
      hooks/
      pages/
      types/

  crawler/
    boss.py
    pipeline.py
    db.py
    config.py

  boss_api/
    client.py
    auth.py
    constants.py

  analysis/
    evaluate_job.py
    tailor_resume.py
    project_evidence.py
    interview_prep.py
    pdf_render.py

  .agents/
    skills/
      bossspider/
        SKILL.md
        modes/
          scan.md
          evaluate.md
          batch.md
          tailor.md
          greet.md
          tracker.md
          interview-prep.md

  data/
    pipeline.md
    applications.md
    boss-sync.json
    scan-history.tsv
    job-index.sqlite

  reports/
    jobs/
    projects/

  output/
    resumes/
    pdf/
    greetings/

  interview-prep/
    story-bank.md
    question-bank.md
    retracted-claims.md
    sessions/

  projects/
  cv.md
  profile.yml
  README.md
  ARCHITECTURE.md
```

当前不需要一次性创建所有目录。每次新增功能时，只引入该功能需要的最小目录和文件。

## 4. 核心数据契约

### `cv.md`

基础简历。所有简历定制、岗位匹配、面试故事建议都以它为默认候选人事实来源。

禁止 AI 自动覆盖该文件。若要更新，需要先生成修改建议或新版本，再由用户确认。

### `profile.yml`

求职偏好和长期配置。

建议字段：

```yaml
candidate:
  name:
  target_roles: []
  target_cities: []
  salary_expectation:

boss:
  request_delay_seconds: 1.5
  max_greet_per_session: 10

evaluation:
  auto_resume_threshold: 4.0
  auto_interview_prep_threshold: 4.0

resume:
  default_format: markdown
  pdf_page_size: A4
```

### `data/pipeline.md`

岗位待处理队列。用于保存从爬虫、Boss API、手动录入或 agent 添加的岗位。

建议形态：

```md
# Pipeline

## Pending

- [ ] Company | Role | City | URL

## Processed

- [x] Company | Role | Score | Report
```

### `data/applications.md`

求职状态追踪表。记录已评估、已打招呼、已沟通、已投递、面试、拒绝、放弃等状态。

建议列：

- Date
- Company
- Role
- Source
- Score
- Status
- BossStatus
- Greeting
- Resume
- Report
- Notes

### `reports/jobs/`

岗位评估报告。每个岗位一份 Markdown，并可配套 JSON 摘要。

报告应包含：

- 岗位基本信息。
- JD 摘要。
- 匹配评分。
- 简历证据映射。
- 缺口和风险。
- Boss 沟通建议。
- 是否建议生成定制简历。
- 面试准备触发建议。

### `output/resumes/`

定制简历输出目录。每份定制简历应关联一个岗位评估报告。

### `output/greetings/`

打招呼草稿和发送记录。发送记录应区分：

- Drafted
- Approved
- Sent
- Failed
- Skipped

### `interview-prep/story-bank.md`

长期故事库。用于沉淀 STAR+R 故事。

故事应尽量包含：

- 场景。
- 任务。
- 行动。
- 结果。
- 反思。
- 适合回答的问题类型。
- 证据来源。

## 5. 后端模块边界

### `crawler_service`

负责现有 BossSpider 爬虫流程：

- 加载项目配置。
- 启动爬取任务。
- 登录任务。
- 停止任务。
- 写入项目 SQLite。
- 读取日志。

它主要服务当前 Web 爬虫控制台。

### `boss_api_service`

负责 Boss 直聘账号相关能力，参考 `boss-cli` 的实现能力：

- 登录状态检测。
- 个人资料。
- 已投递。
- 面试邀请。
- 沟通列表。
- 搜索和推荐岗位。
- 岗位详情。
- 打招呼。

打招呼接口需要设计成两步：

1. `prepare_greeting`：生成草稿或确认信息，不发送。
2. `send_greeting`：仅在用户确认后发送。

### `job_service`

负责岗位数据归一化：

- 从爬虫 SQLite 读取岗位。
- 从 Boss API 返回值读取岗位。
- 去重。
- 入队 `data/pipeline.md`。
- 写入 `data/scan-history.tsv`。
- 查询岗位详情。

### `evaluation_service`

负责岗位评估：

- 读取 JD、`cv.md`、`profile.yml`、项目证据。
- 生成岗位评分和报告。
- 将报告写入 `reports/jobs/`。
- 将状态写入 `data/applications.md`。

可支持并行 worker，但 worker 只处理 AI 分析，不直接请求 Boss。

### `resume_service`

负责简历：

- 读取基础简历。
- 生成针对岗位的修改建议。
- 生成定制 Markdown。
- 生成 PDF。
- 管理定制版本。

所有对 `cv.md` 的更新必须走用户确认。

### `interview_service`

负责面试准备：

- 生成公司岗位准备文档。
- 管理故事库。
- 管理题库。
- 生成模拟面试计划。
- 写入面试复盘和 session transcript。

### `task_service`

统一管理长任务：

- 爬虫任务。
- Boss API 同步任务。
- 批量评估任务。
- 简历生成任务。
- PDF 生成任务。

Web 和 skills 都通过任务状态查询进度，而不是直接依赖某个终端窗口。

## 6. Web 页面规划

### Dashboard

显示当前求职工作台总览：

- 今日新增岗位。
- Pipeline 待评估数量。
- 已评估数量。
- 高分岗位数量。
- 待确认打招呼数量。
- 面试准备事项。
- 当前运行任务。

### Discovery

岗位发现页面：

- 爬虫项目选择。
- 搜索关键词和城市。
- 过滤规则。
- 爬虫启动、登录、停止。
- 最近日志。

当前 `Dashboard`、`Scope`、`Rules`、`Jobs`、`Logs` 可以逐步并入该工作区。

### Inbox

岗位待处理页面：

- 待评估岗位列表。
- 批量选择。
- 去重提示。
- 加入评估队列。
- 跳过或归档。

### Evaluation

岗位评估页面：

- 评估报告。
- 分数和理由。
- 简历匹配证据。
- 缺口。
- 推荐动作。
- 生成定制简历入口。
- 生成打招呼草稿入口。

### Resume

简历工作台：

- 基础简历。
- 定制简历版本。
- 修改建议。
- 版本对比。
- PDF 输出。

### Boss Connect

Boss 账号和沟通页面：

- 登录状态。
- 个人资料。
- 已投递。
- 面试邀请。
- 沟通列表。
- 待确认打招呼。
- 已发送记录。

### Interview

面试准备页面：

- 面试岗位。
- 公司岗位准备文档。
- 故事库。
- 题库。
- 模拟面试和复盘记录。

### Settings

配置页面：

- 模型配置。
- Boss 限速配置。
- 文件路径。
- 评估阈值。
- PDF 设置。

## 7. Skills 规划

`new/.agents/skills/bossspider/SKILL.md` 应改造成 router，而不是少量固定命令。

建议 mode：

- `scan`：发现岗位，写入 pipeline。
- `pipeline`：处理 `data/pipeline.md`。
- `evaluate`：评估单个 JD 或岗位。
- `batch`：并行评估多个已抓取 JD。
- `tailor`：为某岗位生成定制简历草稿。
- `greet`：生成 Boss 打招呼草稿或准备确认信息。
- `tracker`：查看和更新应用状态。
- `boss`：查看 Boss 个人资料、已投递、面试邀请、沟通列表。
- `interview-prep`：生成公司岗位面试准备。
- `interview/practice`：模拟面试。
- `interview/debrief`：面试后复盘。

Skill 不应直接复制 Web 业务逻辑。它应该调用 backend service、Python module 或同一套本地文件契约。

## 8. 参考项目迁移策略

### 来自 career-ops

优先迁移思想：

- mode router。
- 本地文件作为主数据。
- Pipeline inbox。
- 并行评估 worker。
- 报告编号和并发写入保护。
- 人在回路。
- 面试故事库、题库、复盘。

不直接照搬：

- 邮件投递流程。
- 国外 ATS 表单自动填写流程。
- cover letter 优先的工作流。

BossSpider 应把核心动作改成：

- 打招呼草稿。
- Boss 沟通跟踪。
- 定制简历。
- 面试准备。

### 来自 boss-cli

优先迁移实现能力：

- auth 和 cookie 管理。
- BossClient 请求封装。
- 结构化输出 envelope。
- 搜索、推荐、详情。
- 个人资料、已投递、面试邀请、沟通列表。
- 打招呼接口。
- 限速和 session refresh。

不直接照搬：

- CLI 交互形态。
- 默认批量打招呼体验。
- 招聘方模式。

## 9. 安全边界

### Boss 直聘动作

以下动作不能默认自动执行：

- 打招呼。
- 批量打招呼。
- 修改 Boss 在线资料。
- 自动发送聊天消息。

### 项目源码读取

项目证据审计必须默认跳过：

- `.env`
- 密钥文件。
- 浏览器 profile。
- `node_modules`
- `.git`
- 大型构建产物。
- 包含明显个人隐私的文件。

项目证据进入简历前必须由用户确认。

### AI 生成内容

AI 不得凭空增加：

- 工作经历。
- 项目指标。
- 学历。
- 公司名。
- 薪资。
- 可验证技术成果。

可做的事情：

- 重排表达。
- 映射 JD 关键词。
- 提炼已有事实。
- 标记缺口。
- 提醒用户补充证据。

## 10. 分阶段建设路线

### Phase 1: 架构整理和文件契约

- 建立本文档。
- 确认目录契约。
- 明确 Web 和 skills 共用逻辑。
- 不改变当前爬虫控制台运行方式。

### Phase 2: 后端服务拆分

- 将 `backend/app.py` 中的逻辑拆到 services。
- 保持现有 Web API 兼容。
- 保持当前爬虫控制台可用。

### Phase 3: Pipeline 数据层

- 新增 `data/pipeline.md`。
- 从现有爬虫 DB 将岗位加入 inbox。
- Web 展示待评估队列。

### Phase 4: 单岗位评估

- 接入或整理现有 `crawler/analysis` 能力。
- 对单个岗位生成评估报告。
- 写入 `reports/jobs/` 和 `data/applications.md`。

### Phase 5: 批量评估

- 对已抓取 JD 做并行 AI 评估。
- 加入任务状态、失败重试、报告编号保护。
- Boss 请求层仍保持串行。

### Phase 6: 简历工作台

- 读取 `cv.md`。
- 生成定制简历建议。
- 用户确认后输出 Markdown/PDF。
- 不自动覆盖基础简历。

### Phase 7: Boss Connect

- 引入 `boss_api_service`。
- 查看资料、已投递、面试邀请、沟通列表。
- 生成打招呼草稿。
- 用户确认后发送。

### Phase 8: Skills Router

- 新增 `new/.agents/skills/bossspider/SKILL.md`。
- 将 scan、evaluate、tailor、greet、tracker、interview-prep 暴露给 agent。
- 确保 skill 调用与 Web 使用同一套服务和文件。

### Phase 9: Interview Prep

- 故事库。
- 题库。
- 公司岗位准备文档。
- 模拟面试。
- 面试后复盘。

## 11. 当前状态

当前 `new/` 已具备：

- 独立 FastAPI 后端。
- 独立 React Web 前端。
- 复制后的爬虫核心模块。
- 项目配置和 SQLite 岗位数据。
- Web 爬虫控制台基础页面。

下一步建议先做 Phase 2：后端服务拆分。目标是在不改变现有前端 API 行为的前提下，把 `backend/app.py` 拆成更清晰的 services，为后续 Pipeline、Evaluation、Boss Connect 做准备。
