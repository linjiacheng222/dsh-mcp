# 实施验证记录（v2）

日期：2026-11-03
DSH 版本：0.2.2-rc.1（desktop profile；兼容范围 `>=0.2.1-rc.5 <0.3.0`）
Web GUI：http://127.0.0.1:59899
插件：`dsh-mcp-gateway` 0.3.2（settings schema v2）

## 自动化测试

```powershell
$env:DSH_DESKTOP_NODE_EXECUTABLE = 'E:\dp\DeepSeek Harness.exe'
node --test test/*.test.js
```

结果：**49 tests / 49 pass / 0 fail**。

覆盖：

- settings v2 首次创建、v1→v2 迁移、Token、revision 冲突、非法 patch、损坏文件备份。
- 三级能力、四级审批模式、工具可见性、ask_dsh 组合能力、scope/模型/cwd/limit。
- 审批队列：allow/deny/timeout/close、摘要脱敏；Windows 系统审批提示 spawn。
- 设置文件目录 ACL 拒绝写 → 注入的 elevated writer 成功写入；无 elevated writer 时 `settings-write-denied`、内存 revision 回滚。
- transcript/events 脱敏与截断、MCP initialize/tools/list/tools/call、审批错误映射。
- 管理 API 鉴权、409；审批 API 列表/决策/404；MCP 401/403/503。

## 运行中 DSH 烟测（v2）

### 只读

```powershell
node scripts/smoke-live.mjs
```

- 临时切到 `open` 模式后 `tools/list` = 23 个工具，结束后恢复 `only-checked`。
- list/read 正常，冷/热会话均可读；system prompt / request header 不泄露。

### 写入

```powershell
node scripts/smoke-live.mjs --write --root <repo>
```

- create_session（workspace-write）→ set_permission → set_model → ask_dsh。
- **ask_dsh 返回 `reply: "OK"`**，status `idle`，turnEndReason `completed`。
- wait_for_completion 使用 cursor 轮询正常。

### 完全开放上限

```powershell
node scripts/smoke-live.mjs --full --root <repo>
```

- `open` 模式下 create_session 使用 `danger-full-access`，ask_dsh 返回 OK。
- `run_task` 使用 danger-full-access 成功，runtime context 显示文件 sandbox 不限制、审批提示关闭。
- 结束后恢复 `only-checked` + 基础 5 项。

### 审批流

```powershell
node scripts/smoke-live.mjs --approval
```

- 设置 `only-checked` 后调用 `list_sessions`，审批队列出现 pending（能力 listSessions、工具 list_sessions、summary `{"limit":5}`、expiresAt）。
- POST allow 后 MCP 调用返回真实结果。
- 再次调用 `read_session`，POST deny 后返回 `approval-denied` 错误（isError），不会执行工具。
- 当前 pending=0，无遗留。

### 范围四档

`powershell
node scripts/scope-smoke.mjs
`

- except 模式排除一个会话：列表从 19 条变为 18 条，被排除会话不在列表；read_session 返回 session-scope-denied（reason except-list）。
- 
one 模式：list_sessions 返回 0 条；read_session 返回 session-scope-denied（reason session-scope-none）。
- 脚本结束恢复 all/all；当前状态已确认恢复。

### 进阶工具

```powershell
node scripts/smoke-live.mjs --advanced
```

- `settings_describe` → 23 个 settings namespace。
- `plugins_list` → 209 个 plugin entries、23 个 bundles。
- `credentials_describe` → `env:DEEPSEEK_API_KEY` {configured:false,writable:true}，不返回明文。

### 客户端 v2

- `lib/client.js`：4916 行，`node --check` 通过；只 `require('react')`，无构建。
- 真实 React 18 + jsdom harness：**69 个场景全部 PASS**（其中新增四档 scope、except 排除列表、none 警告/保存等）（Tab、四级审批、三级能力/全选、会话/模型多选、字段双向同步、保存 patch、open 二次确认、首次弹窗、使用方法、审批轮询/allow/deny/倒计时、图标按钮无文案等）。
- 真实 host shape 已核对；真实审批 E2E（pending → GET → POST allow → MCP 成功）通过。
- 当前 DSH 页面需刷新后加载新客户端 bundle（旧 bundle 不会自动 HMR）。
- 已确认宿主模块图包含 dsh-mcp-gateway 且 rev=fda31f968f64；/plugins/??dsh-mcp-gateway/client.js&rev=fda31f968f64 返回 237,451 字节的 V2 bundle（头注释为 rowser client bundle (v2 UI)）。

## 设置迁移

运行中 `settings.json` 已从 schema v1 自动迁移到 v2：

- 旧 `permissions` → `capabilities`；
- `fullAccess:false` → `approvalMode:"only-checked"`；
- 新增 `limits.approvalTimeoutMs: 55000`；
- Token、scope、onboarding、server 保留；
- revision 递增，迁移告警写入 `activation.log`。

## 当前最终状态

- `approvalMode: except-checked`（用户在 UI 设置）
- 勾选能力：基础 5 项（list/read/send/wait/askDsh）
- `capabilityCount: 5`，`visibleToolCount: 23`（except-checked 暴露全部工具）
- revision: 51；mode: except-checked；capabilityCount: 12；visibleToolCount: 23；设置文件 ACL 已加固；UAC fallback/信任对话框已验证
- 服务启用，pending approvals: 0
- Token 仍为最终随机值（未写入本文档）
- 数据文件：`$DSH_HOME/dsh-mcp-gateway/settings.json`
- 诊断：`$DSH_HOME/dsh-mcp-gateway/activation.log`

## 当前 profile 修改

- `profiles\desktop\package.json`：`"dsh-mcp-gateway": "link:E:\\zaxiang\\DSH_MCP"`。
- `profiles\desktop\node_modules\dsh-mcp-gateway`：junction 指向 `<repo>`。
- `profiles\desktop\cordis.patch.yml`：末尾 insert 行。
- 备份：`cordis.patch.yml.bak-mcp-gateway`、`package.json.bak-mcp-gateway`。

## 测试会话

烟测创建了多个测试会话（title `OK`、`DSH MCP smoke test`、`Reply with OK`、`DSH MCP smoke test`、danger-full-access 任务会话等），可在 DSH UI 中自行删除。

## 未覆盖/需人工确认

- 真实浏览器中的视觉观感、焦点与动画：客户端 bundle 需要刷新页面后加载，CLI 无法读取已登录 GUI 的 DOM；jsdom 已覆盖渲染与交互。
- `settings_update` / `plugin_install` / `plugin_remove` 等写操作未在真实 DSH 上执行（避免改动用户配置）；工具链路、审批门禁和参数校验已由单元/协议测试覆盖。
- 审批超时的真实等待（unit test 覆盖 timeout）；新默认 `approvalTimeoutMs=-1`（不限时），正数时才超时关闭。

## 2026-11-03 视觉修复

- 主按钮文字/图标不可见：CSS reset 从 `.dshmcp-root button` 改为 `:where(button,input,select,textarea)`，避免 `color:inherit` 覆盖主按钮的 on-accent 颜色。
- “会话繁忙时”“默认模型”“会话权限预设”的原生 select 替换为 DSH 菜单风格 SelectMenu（fixed 弹层、MenuRow 单选、点击外部/Escape 关闭）。
- 客户端 bundle 最新 rev 4d30c75e1b61，served 241,826 字节；node --check 通过，jsdom harness 69/69 仍通过。

## 2026-11-03 第二轮反馈修复

- 确认/保存/允许/拒绝按钮全部恢复“图标 + 文字”：保存、恢复默认确认/取消、open 二次确认/取消、Token 轮换确认/取消、首次弹窗确认、审批 allow/deny；不再有空白/纯图标按钮。
- 能力/审批模式/范围模式/会话行使用语义图标；模型列表动态品牌图标（DeepSeek 鲸鱼、GLM/Zhipu 字母 Z），未知品牌不显示图标。
- 使用说明 note3/note4、step2/step4 按四种审批模式改写，并说明审批只走 Windows MessageBox；`systemApprovalPopup=false` 时没有审批入口，调用会超时。
- ~~非管理员进程插件层门禁~~（已移除）：不再校验 `status.elevated`，不再返回 `admin-required`；客户端不锁定设置控件。
- Windows 系统审批：审批入队时异步弹出原生 MessageBox；DSH 页面不再渲染审批卡片，也不轮询 `/api/approvals`；超时/关闭时弹窗由 settle hook 关闭。
- **操作系统文件路径鉴权 + 信任对话框 + UAC fallback**：`scripts/protect-settings.ps1` 把设置目录/文件 ACL 设为 Administrators/SYSTEM 完全控制、当前用户只读；普通写入被 OS 拒绝后，`lib/settings-elevation.js` 启动 `lib/settings-elevate.exe`（GUI 子系统）：先显示 Windows 信任对话框（WinForms，盾牌图标、目标文件、设置 diff、默认拒绝），信任后 `ShellExecuteEx("runas")` 请求 UAC；批准后提权写入，取消/超时映射为 403 `settings-write-denied`。
- 验证：宿主测试 **49/49**（含目录 ACL 写入拒绝、注入 elevated writer 成功路径、UAC helper spawn/失败映射、revision 回滚）；客户端 jsdom **88/88**；`node --check` 通过。
- `settings-elevate-gui.cs` 已用 .NET Framework csc 编译为 `lib/settings-elevate.exe`（14,848 字节）；GUI 子系统不创建控制台，信任对话框不依赖 PowerShell，因此保存时不再出现 PowerShell 窗口。
- **信任对话框验证**：用带差异的临时 source/target 启动 helper，UI Automation 读到标题 `DSH MCP Gateway`、标题文本“是否信任 DSH MCP Gateway 修改设置？”、目标文件、`approvalMode`/`capabilities` 修改摘要，以及“信任并请求管理员权限”“拒绝”按钮；未确认前目标文件不变。
- **真实提权写入验证**（trust dialog 之前版本）：设置文件/目录加 ACL 后，普通权限 `POST /settings` 成功写回（rev 45 → 46 → 47）；写后文件 ACL 保持“当前用户只读、Administrators 完全控制”。本机 UAC 策略 `ConsentPromptBehaviorAdmin=0`，因此提权为静默；默认 UAC 策略下会再显示系统授权弹窗，但不会出现 PowerShell 窗口。
- UAC 取消/失败路径由单测覆盖：helper 非零退出 → 403 `settings-write-denied`，文件内容不变。
- 真实系统弹窗 + 超时关闭烟测：`system popup smoke: PASS`；only-checked 审批 allow/deny 烟测通过，系统弹窗由 settle hook 自动关闭。
- 最终客户端 bundle rev `a9b2c0a253aa`，served 261,275 字节；插件版本 0.3.0；GUI helper `lib/settings-elevate.exe` 14,848 字节。

## 2026-11-09 DSH 0.2.2-rc.1 适配

- 根因：DSH 0.2.2 的 plugin compatibility preflight 检查 `engines.dsh`；原精确 `0.2.1-rc.5` 不匹配，host/client 行在启动时被禁用。
- `package.json` 版本升到 `0.3.2`，`engines.dsh` 改为 `>=0.2.1-rc.5 <0.3.0`；`PLUGIN_VERSION` 同步。
- DSH 0.2.2 的 client module 路由改为带 revision 的 `/plugins/??<id>/client.js&rev=...`；客户端已由新 `client-modules` 自动服务，验证路由 200。
- 新设置 UI 使用插件管理器的 `plugins.item` slot（`summary`/`page` 视图）；客户端同时保留 0.2.1 的 `settings.section` 注册，新增 DSH 0.2.2 入口 **设置 → 插件 → DSH MCP Gateway**。
- DSH 0.2.2 移除了 `SessionController.inspect`；bridge 的 `#inspect` 改为优先 `SessionQuery.readSurface`，保留旧 controller fallback。
- 真实链路验证：`GET /dsh-mcp/api/state` 200；MCP `tools/list` 23 个工具；`list_sessions`、`read_session`（transcript/events）成功；`ask_dsh` 返回 `reply="ADAPT_OK"`、`turnEndReason=completed`。
- 宿主测试 **49/49**；客户端 jsdom **88/88**；`node --check` 通过。
- 最终客户端 bundle rev `93edeb7c0538`，served 262,994 字节；路由 `/plugins/??dsh-mcp-gateway/client.js&rev=93edeb7c0538` 返回 200。

### 测试报告反馈（2026-11-09）

- P1 capability 门控：当前实现复核为**符合设计**——DSH 0.2.2 实测在 `except-checked` 下调用 `settings_describe` 会产生 `manageSettings` 的 pending approval，拒绝后返回 `approval-denied`；只有 `open` 模式才直接放行。报告可能是在 `open` 模式或不同状态下执行。客户端/README 已补充能力勾选语义：`only-checked` 隐藏未勾选，其它模式仍可见但按模式审批/放行。
- P2 create_session / run_task：未配置 `defaultCwd`/`allowedRoots` 时，继承已有会话 cwd 作为兜底根，省略 cwd 或显式使用已有会话 cwd 均可创建；错误详情返回 `allowedRoots`。实测显式 `<repo>` 创建成功，cwd 正确。
- P3 set_model：改用 DSH 0.2.2 的 `SessionController.selectModel`，实测成功返回 `deepseek-account/deepseek-flash`；旧版仍保留 fallback。
- P4 文档确认：`danger-full-access` 需要 `open` 模式；`read-only`/`workspace-write` 不受影响。
- P5 文档：`wait_for_completion` description 明确返回 transcript 页且没有顶层 `reply`。
- P6：`settings_update` 对未知 namespace 映射为可操作的 `invalid-argument` 错误；settings_describe/update description 说明 namespace 语义。
- P7：`cancel_turn` description 明确等价 GUI 停止当前轮次、保留 pending follow-up、已完成轮次 no-op。
- P8：保留资源类型对应的参数名（entryId/name/ref），已在 README 明确说明，避免破坏现有客户端。

## 2026-11-04 第三轮反馈修复

- 移除 DSH 窗口内审批卡片与 `/api/approvals` 轮询；审批只通过系统 MessageBox（`lib/system-notify.js` + `lib/approval-popup.ps1`）。系统弹窗的说明文字改为“此 MessageBox 是本次调用的唯一审批入口”。
- 使用说明恢复推荐复制 MCP 客户端配置；步骤改为复制配置/Token、把提示词与配置/Token 交给 Agent；说明“配置复制不是多余操作”。
- 标准提示词增加：Token 未提供时向用户询问；内嵌动态生成的 MCP 配置；包含当前 `MCP port`、`settingsPath`（当前设置文件路径）和 endpoint；设置变化后重新复制。
- 宿主 `state` 增加 `settingsPath`；客户端 usage/prompt 从当前 state 动态生成端口、地址、配置和设置文件路径。
- 验证：宿主测试 **49/49**；客户端 jsdom **88/88**；`node --check` 通过。
- **所有 numeric limits 默认 -1 / 负数即忽略限制**：
  - `DEFAULT_LIMITS` 六项 numeric 默认全部 -1；schema 接受任意负数，仅正数校验原有上下界。
  - `readLimit` / `waitTimeout` / `assertMessageLength` / `buildTranscript` / `buildEventsView` 对负数返回不限或跳过限制。
  - `send_message` / `ask_dsh` 未显式传 timeout 时不再被默认/最大等待限制钳制；`approvalTimeoutMs=-1` 时审批队列不创建超时 timer，`expiresAt=null`，系统 MessageBox 显示“无限制”。
  - 客户端 limits 输入接受负数，默认展示 -1，保存校验允许非零整数。
  - 测试：`test/permissions.test.js`、`test/approvals.test.js`、`test/settings.test.js`、`test/system.test.js` 覆盖负数/0/正数边界。
  - 注意：已有 `settings.json` 中的正数 limits 是持久化值，不会自动改写；需要用户在设置页改负数或使用恢复默认。
- **ask_dsh 阻滞回归验证**：真实 DSH 会话要求 shell `Start-Sleep` 后回复：
  - 显式 `timeoutMs=60000`：调用阻塞 **8.2s**，返回 `status=idle`、`reply="BLOCK_OK"`、`turnEndReason=completed`；
  - 不传 `timeoutMs`（当时持久化配置 `maxWaitMs=180000`；新默认 -1 为不限时）：阻塞 **7.57s**，返回 `reply="DEFAULT_BLOCK_OK"`。
  - 根因是 prompt 接受后 agent 状态尚未变 running，旧逻辑立即返回 idle；现在 `expectTurn` 等待 `turn/end`，并扫描 prompt 后已出现的 turn end，避免漏掉快速完成。
- 当前 live 状态：revision 51、mode `except-checked`、capabilityCount 12、visibleToolCount 23；`settingsPath=\dsh-mcp-gateway\settings.json`。现有 settings 仍保留旧正数 limits（未强制覆盖），新默认/reset 为 -1。

