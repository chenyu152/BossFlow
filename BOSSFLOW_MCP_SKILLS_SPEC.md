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
| `search_jobs` | 分页搜索已采集岗位 |
| `get_job` | 读取单个岗位完整记录 |
| `get_pipeline` | 读取候选岗位及工作流状态 |
| `get_task_status` | 读取当前采集状态和日志尾部 |
| `get_evidence` | 读取证据概览 |
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
| `save_imported_story_drafts` | 保存外部项目提取的故事草稿 |
| `confirm_story_draft` | 将指定草稿提升为已确认故事 |

每个写入或付费工具第一次以 `confirmed=false` 返回预览，不修改数据。Agent 展示预览并取得用户许可后，才可用相同参数和 `confirmed=true` 重试。执行结果写入 `logs/agent-audit.log`，日志不记录令牌或 LLM 密钥。

## 4. Resources v1

- `bossflow://workspace/projects`
- `bossflow://project/{project}/summary`
- `bossflow://project/{project}/pipeline`
- `bossflow://project/{project}/evidence`
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
