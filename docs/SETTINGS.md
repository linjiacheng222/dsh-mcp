# dsh-mcp-gateway 设置字段（schema v2）

设置保存在 `$DSH_HOME/dsh-mcp-gateway/settings.json`，由插件设置页维护。
文件带 `schemaVersion`（当前为 `2`）、`revision` 与 `updatedAt`；所有写入都校验、串行化并原子替换。
当前安装已通过 `scripts/protect-settings.ps1` 给目录和文件加 Windows ACL：管理员/SYSTEM 可写、当前用户只读；非管理员写入先被 OS 拒绝，随后插件启动 `lib/settings-elevate.exe`（GUI 子系统）：先显示 Windows 信任对话框（盾牌、目标文件、设置 diff、默认拒绝），点“信任并请求管理员权限”后再通过 `ShellExecuteEx("runas")` 请求 UAC；批准后提权写入，取消信任框/UAC 则返回 403 `settings-write-denied`，revision 保持不变。UAC fallback 需要交互式桌面。旧版 schema v1 会自动迁移，并保留 Token、范围、限制与 onboarding 状态。

## 顶层

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `schemaVersion` | `2` | `2` | 文件格式版本 |
| `revision` | 非负整数 | `1` | 每次成功写入递增；用于冲突检测 |
| `updatedAt` | 毫秒时间戳 | 写入时 | 最近写入时间 |
| `approvalMode` | 枚举 | `only-checked` | 四档审批模式 |
| `capabilities` | 对象 | 基础 5 项 | 三级能力勾选 |
| `scope` | 对象 | 见下 | 会话/模型/工作目录范围 |
| `limits` | 对象 | 见下 | 读取、发送、等待、审批限制 |
| `server` | 对象 | 见下 | 服务开关、Token、网络设置 |
| `onboarding` | 对象 | `{shownAt:null,acknowledgedAt:null}` | 首次配置引导状态 |

## approvalMode

| 值 | 含义 |
|---|---|
| `only-checked` | 仅勾选能力可用；每次调用需审批 |
| `except-checked` | 勾选能力直接放行；未勾选能力每次调用需审批 |
| `all` | 全部能力可用；每次调用需审批 |
| `open` | 全部能力直接放行，不再审批；勾选名单仅展示 |

## capabilities

| 键 | 级别 | 默认 |
|---|---|---|
| `listSessions` | basic | true |
| `readSessions` | basic | true |
| `sendMessages` | basic | true |
| `waitForCompletion` | basic | true |
| `askDsh` | basic | true |
| `listModels` | regular | false |
| `createSessions` | regular | false |
| `selectModel` | regular | false |
| `setPermission` | regular | false |
| `cancelTurns` | regular | false |
| `forkSessions` | regular | false |
| `renameSessions` | regular | false |
| `manageSettings` | advanced | false |
| `managePlugins` | advanced | false |
| `manageCredentials` | advanced | false |

工具到能力映射见 `lib/capabilities.js`；多能力工具（如 `run_task`）要求全部相关能力。

## scope

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `sessionMode` | `all` \| `allowlist` \| `except` \| `none` | `all` | 会话范围：全部 / 仅勾选 / 除勾选外 / 禁用 |
| `sessionIds` | 字符串数组 | `[]` | allowlist 或 except 模式的会话 id 名单 |
| `includeSubagents` | 布尔 | `false` | 是否允许子会话 |
| `modelMode` | `all` \| `allowlist` \| `except` \| `none` | `all` | 模型范围 |
| `allowedModels` | `provider/model` 数组 | `[]` | allowlist 或 except 模式的模型名单 |
| `allowedRoots` | 绝对路径数组 | `[]` | 非 open 模式下允许新建会话的目录根 |
| `defaultCwd` | 绝对路径字符串 | `""` | 新建会话默认 cwd |
| `defaultModel` | `provider/model` 或 `""` | `""` | 新建会话/默认模型 |
| `newSessionPreset` | 字符串 | `workspace-write` | MCP 新建会话的权限预设 |

规则：

- `sessionMode: allowlist` 时只有 `sessionIds` 中的会话可被列表/读取/发送；`except` 时 `sessionIds` 中的会话被排除，其余全部允许；`none` 禁用所有会话访问。
- `modelMode` 同理：`allowlist` 仅允许名单，`except` 排除名单，`none` 禁用模型选择/新建会话。
- `includeSubagents: false` 时，`origin: "subagent"` 或有 parent 的会话一律拒绝。
- `danger-full-access` 预设与 `approvalMode: open` 绑定。
- `newSessionPreset` 不能是 `auto`。
- 非 `open` 模式下，新建会话的 `cwd` 必须是 `defaultCwd` 本身/其子目录，或位于 `allowedRoots` 之一；`open` 允许任意绝对路径。
- 未配置 `defaultCwd` 和 `allowedRoots` 时，省略 `cwd` 会使用第一个已有会话的 cwd（没有则使用 DSH 默认工作目录）；显式传入的 `cwd` 也必须位于已有会话 cwd 或默认目录内。

## limits

| 字段 | 默认 | 合法范围 | 说明 |
|---|---:|---|---|
| `maxReadMessages` | `-1` | 负数或 1–500 | 单次读取消息数上限；负数表示不限制 |
| `maxReadChars` | `-1` | 负数或 1000–500000 | 单次读取字符上限；负数表示不限制 |
| `maxMessageChars` | `-1` | 负数或 1000–1000000 | 单条发送消息字符上限；负数表示不限制 |
| `defaultWaitMs` | `-1` | 负数或 1000–600000 | 默认等待预算；负数表示不限时 |
| `maxWaitMs` | `-1` | 负数或 1000–600000 | 等待硬上限；负数表示不限时 |
| `approvalTimeoutMs` | `-1` | 负数或 5000–600000 | 审批等待超时；负数表示不限时，超时失败关闭 |
| `sendWhenBusy` | `queue` | `queue` \| `reject` | 会话忙碌时排队或拒绝 |

numeric limits 的默认值均为 `-1`，表示不启用该限制；`0` 非法。已有 `settings.json` 里的正数会原样保留，只有新建或恢复默认时才使用 `-1`。

## server

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | MCP 服务总开关；关闭后端点返回 503 |
| `token` | 首次启动生成 | Bearer Token，`dshmcp_` 前缀 |
| `allowNonLoopback` | `false` | 是否允许非回环 MCP 客户端；管理 API 始终只允许回环 |
| `systemApprovalPopup` | `true` | Windows 上审批请求是否同时弹出系统 Yes/No 消息框 |
| `instructions` | `""` | 追加到 MCP server instructions 的自由文本（≤8000 字符） |

## onboarding

| 字段 | 默认 | 说明 |
|---|---|---|
| `shownAt` | `null` | 首次配置弹窗显示时间；`null` 表示下次客户端挂载时自动显示 |
| `acknowledgedAt` | `null` | 用户确认时间；`null` 时设置页显示未完成横幅 |

## 管理 API

同源、仅回环、要求 `X-DSH-MCP-UI: 1`：

| 路由 | 方法 | Body | 说明 |
|---|---|---|---|
| `/dsh-mcp/api/state` | GET | — | revision/settings/endpoint/onboarding/catalog/status/warnings |
| `/dsh-mcp/api/catalog` | GET | — | 与 state 相同快照 |
| `/dsh-mcp/api/settings` | POST | `{revision, patch}` | 合并设置并校验 |
| `/dsh-mcp/api/token` | POST | `{revision}` | 轮换 Token |
| `/dsh-mcp/api/onboarding` | POST | `{revision, shown?, acknowledged?}` | true 设置时间戳，false 清空 |
| `/dsh-mcp/api/approvals` | GET | — | 待审批列表 |
| `/dsh-mcp/api/approvals/{id}` | POST | `{decision:"allow"\|"deny"}` | 处理一条审批 |

错误统一为 `{ok:false,error:{code,message,details?}}`；revision 不匹配返回 409。设置写入被 ACL 拒绝时会尝试 UAC 提权；用户取消/UAC 超时/提权失败才返回 403 `settings-write-denied`，`details` 含 `path`、`cause`，内存中的 revision/settings 会回滚到文件状态。

`status` 提供 `systemApprovalPopup`（系统弹窗是否启用）。`state` 顶层还提供 `settingsPath`（当前设置文件的绝对路径，用于动态展示/提示词）。

## 迁移（v1 → v2）

- `permissions` 布尔 → `capabilities` 同名键；`askDsh` 在 `sendMessages` 为真时默认开启。
- `fullAccess: true` → `approvalMode: "open"`；否则 `only-checked`。
- `limits` 增加 `approvalTimeoutMs` 默认值 `-1`（不限时）。
- 删除 `fullAccess` 与 `permissions` 字段。
- Token、scope、server、onboarding 原样保留；迁移后 revision 递增。
