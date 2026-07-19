# BossFlow MCP 与 Skills v1 规格

## 1. 架构

BossFlow 后端是岗位、材料和任务状态的唯一事实来源。Streamable HTTP MCP 挂载在同一 FastAPI 进程的 `/mcp/`；stdio 入口只代理到正在运行的 HTTP MCP，不导入业务服务，也不启动调度器。

```text
Claude Code / Codex / Trae
  ├─ Streamable HTTP ───────────────┐
  └─ stdio bridge ── HTTP proxy ───┤
                                    ↓
FastAPI + BossFlow MCP + TaskManager
                                    ↓
项目工作区 / SQLite / 串行采集队列
```

## 2. 传输与鉴权

- HTTP endpoint：`http://127.0.0.1:<backend-port>/mcp/`
- Header：`Authorization: Bearer <agent-token>`
- 仅接受无 Origin 的本地客户端或 `localhost` / `127.0.0.1` Origin。
- 未配置 `BOSSFLOW_AGENT_TOKEN` 时 MCP 返回 503，普通 Web API 不受影响。
- 桌面版首次运行生成持久令牌，并把当前 URL 与令牌写入 Windows 用户目录的 `agent-runtime.json`。
- stdio 桥通过 `BOSSFLOW_AGENT_CONNECTION_FILE` 读取运行时连接；BossFlow 未运行时直接失败，不另起业务后端。

开发环境可在启动后端前设置：

```powershell
$env:BOSSFLOW_AGENT_TOKEN = "replace-with-a-long-random-token"
python -m uvicorn backend.app:app --port 8000
```

## 3. MCP Tools v1

### 读取

| Tool | 用途 |
| --- | --- |
| `list_projects` | 列出求职方向 |
| `get_project_summary` | 读取采集配置摘要、岗位和证据计数 |
| `search_jobs` | 按城市、薪资、分类、评分、匹配/风险、更新时间和在招观测状态筛选岗位 |
| `get_job` | 读取单个岗位完整记录 |
| `get_pipeline` | 读取候选岗位及工作流状态 |
| `get_task_status` | 读取当前采集状态和日志尾部 |
| `get_evidence` | 读取能力档案统计和分页摘要，必要时可显式读取完整集合 |
| `get_capabilities` | 分页读取归一化能力卡片 |
| `get_capability` | 读取单项能力的完整岗位要求、依据和提升计划关联 |
| `get_requirement_groups` | 读取保留 `any_of` 替代关系的岗位要求组 |
| `preview_resume_capability_import` | 分析基础简历中的能力，预览新增、合并、已同步和待判断项 |
| `get_login_state` | 读取登录 Cookie 保存时间、浏览器到期时间和定时任务可用性 |
| `get_evidence_requirements` | 分页读取精评提取的原子岗位要求 |
| `get_evidence_tasks` | 分页读取能力补充或提升任务 |
| `get_application_context` | 读取单个候选岗位的精评、证据、故事和已有材料上下文 |
| `get_base_resume` | 默认返回个人基础简历的本机路径、修改时间和 revision；不能访问文件时可返回全文 |
| `list_tailored_resumes` | 分页列出已有简历建议或定制简历的候选岗位和文件位置 |
| `get_tailored_resume` | 默认返回单个岗位简历建议、定制简历的路径和 revision；不能访问文件时可返回全文 |
| `get_story_bank` | 读取已确认故事 |
| `get_story_drafts` | 读取待确认故事草稿 |

### 写入或付费生成

| Tool | 用途 |
| --- | --- |
| `add_candidate_jobs` | 加入候选岗位 |
| `set_candidate_status` | 更新候选推进状态 |
| `start_collection` | 使用已保存配置启动采集 |
| `run_fine_review` | 执行 LLM 精评 |
| `create_resume_suggestions` | 生成证据绑定的简历建议 |
| `create_interview_prep` | 生成面试准备 |
| `stage_evidence_item` | 保存待用户核验的证据草稿 |
| `confirm_evidence` | 确认事实证据可复用 |
| `classify_evidence_requirement` | 保存用户对岗位要求的证据判断 |
| `decide_capability` | 保存一项归一化能力的可复用判断 |
| `import_resume_capabilities` | 导入用户从基础简历预览中选中的能力 |
| `set_evidence_task_status` | 更新证据任务状态 |
| `update_base_resume` | 通过差异预览、人工确认和 revision 校验保存个人简历 |
| `update_tailored_resume` | 保存岗位定制简历，并同步编辑元数据及校验 revision |
| `save_agent_resume_suggestions` | 保存外部 Agent 生成的证据绑定简历建议，不调用 BossFlow LLM |
| `save_agent_interview_preparation` | 保存外部 Agent 生成的面试准备，不调用 BossFlow LLM |
| `save_imported_story_drafts` | 保存外部项目提取的故事草稿 |
| `confirm_story_draft` | 将指定草稿提升为已确认故事 |

每个写入或付费工具第一次不传 `confirmation_id`，服务端返回绑定动作、目标和完整参数哈希的短期一次性 `confirmationId`，且不修改数据。Agent 必须展示准确预览并结束当前轮次；只有用户在后续消息中明确同意，才可用相同参数和该凭证重试。参数变化、超时、重复使用或未知凭证均被服务端拒绝。执行结果写入 `logs/agent-audit.log`，日志不记录令牌或 LLM 密钥。

Skill 约束可让合规 Agent 询问用户，但不能证明回答者一定是人。一次性参数绑定凭证提供服务端防误用；若未来需要不可绕过的“真人审批”，应增加 BossFlow 内置审批队列，由 UI 签发执行凭证。

文本生成默认由用户当前连接的 Agent 完成：BossFlow 提供结构化可信上下文、证据边界和落盘工具。`run_fine_review`、`create_resume_suggestions`、`create_interview_prep` 继续保留为使用 BossFlow API Key 的可选兼容路径，必须单独披露成本并确认。

## 4. Resources v1

- `bossflow://workspace/projects`
- `bossflow://project/{project}/summary`
- `bossflow://project/{project}/pipeline`
- `bossflow://project/{project}/evidence`
- `bossflow://project/{project}/evidence-requirements`
- `bossflow://project/{project}/login-state`
- `bossflow://project/{project}/story-bank`
- `bossflow://project/{project}/story-drafts`
- `bossflow://job/{project}/{job_id}`

## 5. Skills v1

唯一源目录为 `.agents/skills/`：

- `triage-new-jobs`：采集、查看新增岗位、解释筛选和确认入候选。
- `prepare-application`：精评、证据核对、简历建议与面试准备。
- `import-story-bank`：只读审计用户授权项目，生成可追溯草稿，确认后写入故事库。

Skills 只编排 MCP 工具，不复制 FastAPI 业务逻辑。不同 Agent 产品需要专有目录时，应由安装脚本从该目录复制或生成，不维护第二份手写内容。

## 6. 客户端配置

桌面版在“系统设置 → MCP”中显示 Server 运行状态，并分别生成 Claude Code、Codex 与 Trae 所需的配置。stdio 为桌面版推荐方式：

```json
{
  "mcpServers": {
    "bossflow": {
      "type": "stdio",
      "command": "<BossFlowBackend.exe>",
      "args": ["--mcp-stdio-bridge"],
      "env": {
        "BOSSFLOW_AGENT_CONNECTION_FILE": "<agent-runtime.json>"
      }
    }
  }
}
```

开发环境可直接使用 HTTP：

```json
{
  "mcpServers": {
    "bossflow": {
      "type": "http",
      "url": "http://127.0.0.1:8000/mcp/",
      "headers": {
        "Authorization": "Bearer <BOSSFLOW_AGENT_TOKEN>"
      }
    }
  }
}
```

## 7. 验证门槛

- 所有 MCP 工具必须有 JSON Schema 和只读/写入注解。
- 写工具必须有未确认不落盘测试。
- HTTP 必须覆盖未配置、无令牌、错误 Origin 和合法 Bearer 四种情况。
- 使用官方 MCP 客户端完成初始化、工具发现、Resource 模板发现和至少一个工具调用。
- stdio 桥必须通过官方 stdio 客户端完成同样的工具调用。
- 每个 Skill 必须通过 `quick_validate.py`。
