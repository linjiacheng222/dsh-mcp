# dsh-mcp-gateway

把本机正在运行的 **DeepSeek Harness（DSH）** 以 **Streamable HTTP MCP Server** 暴露给其它 Agent。

其它 Agent 可以通过 MCP 工具读取已有会话、发送消息、一次性提问并取回答复；在用户授权后还可以新建会话、指定模型、切换权限、取消/派生会话，甚至调整 DSH 设置、管理插件与凭据。

## 默认权限（下限）

安装并启用后默认：

- **审批模式：审批（仅勾选项）**
- **勾选能力：基础 5 项**
  - `list_sessions` 列出会话
  - `read_session` 读取记录
  - `send_message` 发送内容
  - `wait_for_completion` 等待完成
  - `ask_dsh` 一次调用完成“发送并返回回答”
- 其它所有能力默认关闭，且每次调用基础工具都会通过 **Windows MessageBox** 请求审批，用户允许后才执行。
- **所有 numeric limits 默认 `-1`**：负数表示不限制读取条数/字符数、单条消息长度、等待时间和审批超时；只有正数才启用原有限制。

> ⚠️ 默认允许向所有已有根会话发送消息。这些会话中的模型会按该会话当前的权限预设执行工具；如果会话是“完全权限”，外部 Agent 可能借此执行任意命令或文件操作。请用会话 allowlist、关闭发送能力或收紧会话权限来降低风险。

## 鉴权模型

### 四个审批档位

| 档位 | 行为 |
|---|---|
| 审批（仅勾选项） | 只有勾选的能力可用；每次调用都需要审批 |
| 审批（勾选项除外） | 勾选的能力直接放行；未勾选的能力每次调用需要审批 |
| 均需审批 | 所有能力都可用；每次调用都需要审批 |
| 完全开放（无视名单） | 所有能力直接放行，不再询问；勾选名单仅作展示 |

> 能力勾选在四种模式下含义不同：`only-checked` 会**隐藏**未勾选工具；`except-checked` 中未勾选工具仍可见，但每次调用必须审批（不是硬拒绝）；`all` 全部可见且每次审批；`open` 全部可见且直接放行。若要硬性禁止管理类工具，请使用 `only-checked` 或保持对应能力未勾选并选择 `only-checked`。

审批请求只通过 **Windows MessageBox** 显示：能力、工具、会话、参数摘要、超时时间；可以允许或拒绝。DSH 窗口内不再显示审批卡片，即使 DSH 窗口最小化也能看到系统弹窗。
审批等待默认**不限时**（`limits.approvalTimeoutMs=-1`）；配置正数时超时失败关闭，不会自动放行。

设置文件受 **Windows 文件 ACL** 保护：默认把 `$DSH_HOME/dsh-mcp-gateway` 目录和 `settings.json` 设为管理员/SYSTEM 可写、当前用户只读。非管理员保存设置时，插件会先尝试直接写；被 ACL 拒绝后自动触发 **Windows UAC**，用户批准后由提权 helper 写回同一份文件；取消授权才返回 `403 settings-write-denied`。插件层没有管理员判断或 `admin-required` 门禁。

### 三级能力

| 级别 | 能力 |
|---|---|
| 基础 | 列出会话、读取会话、发送消息、等待完成、问答接口 `ask_dsh` |
| 常规 | 列出模型、新建会话、选择模型、切换权限、取消轮次、派生会话、重命名会话 |
| 进阶 | 调整 DSH 设置、管理插件（列/启停/安装/卸载）、管理凭据（状态/设置/移除，不读取明文） |

设置页每个级别有“全选/取消全选”勾选行，可以逐项调整。

## 范围（Scope）

- **会话范围**：全部 / 仅勾选 / 除勾选外 / 禁用。勾选模式提供可视化会话列表（标题、cwd、模型、运行状态），也保留字段式配置。
- **模型范围**：全部 / 仅勾选 / 除勾选外 / 禁用。勾选模式按 provider 分组提供可视化列表，也保留 `provider/model` 字段。
- **子会话**：默认拒绝。
- **cwd 范围**：非完全开放模式下，MCP 新建会话的 cwd 必须位于 allowedRoots 或 defaultCwd 内；完全开放模式允许任意绝对路径。
- **权限预设**：MCP 新建会话默认使用 `workspace-write`；`danger-full-access` 仅在完全开放模式下可用。

## 使用方式

### 1. 安装并启用插件

正常发行方式：在 DSH 的 Plugins 页面安装并启用 `dsh-mcp-gateway`。
当前机器因为 pnpm store 不一致，采用本地 link 方式安装（见下文“安装”）。

### 2. 确认首次配置

插件首次生效后客户端会弹出欢迎/风险提示；确认后写入 `onboarding` 状态。
设置页入口：DSH 0.2.2 为 **设置 → 插件 → DSH MCP Gateway**；DSH 0.2.1 为 **设置 → DSH MCP 网关**。

### 3. 直接连接 MCP（推荐）

端点：`http://127.0.0.1:<port>/dsh-mcp/mcp`（端口跟随当前 DSH Web 服务；设置页会显示实际地址）
Token：设置页复制，或读取 `$DSH_HOME/dsh-mcp-gateway/settings.json` 的 `server.token`。

复制 MCP 客户端配置是**推荐步骤**（不是多余操作），配置会随当前端口生成：

1. 在设置页复制 MCP 客户端配置（含当前地址/端口和 Token）；
2. 把设置页“使用方法”里的标准提示词发给 Agent，并同时提供配置或 Token；
3. 提示词中的地址、端口、设置文件路径来自当前网关状态，会动态变化；提示词不含真实 Token，Agent 需要认证时会向用户询问 Token。DSH 设置变化后请重新复制提示词。

```json
{
  "mcpServers": {
    "dsh": {
      "type": "http",
      "url": "http://127.0.0.1:<port>/dsh-mcp/mcp",
      "headers": {
        "Authorization": "Bearer dshmcp_xxx"
      }
    }
  }
}
```

如果 Agent 只支持 URL + Token、不需要配置文件，也可以省略 JSON；DSH 必须保持运行，v1 不提供 stdio 适配。

### 4. 调用

推荐的最小工作流：

1. `list_sessions` 找到目标会话；
2. `ask_dsh` 发送问题并直接拿到回答；
3. 长任务用 `send_message(wait=false)` + `wait_for_completion` 轮询；
4. 新任务用 `create_session` + `ask_dsh` 或直接 `run_task`。

`ask_dsh` 示例：

```json
{
  "sessionId": "session-...",
  "message": "解释这个仓库的构建流程",
  "timeoutMs": 60000
}
```

返回：

```json
{
  "sessionId": "session-...",
  "requestId": "...",
  "reply": "……",
  "status": "idle",
  "cursor": { "lastSeq": 123 },
  "messages": [ ... ]
}
```

如果 `reply` 为空或 `status` 为 `timeout/running/queued`，用返回的 `cursor.lastSeq` 调 `wait_for_completion` 继续取回。
`ask_dsh` 会阻塞到本轮结束；未传 `timeoutMs` 时使用 `maxWaitMs`（默认 -1，表示不限时）。调用期间不要自己启动轮询循环。

设置页的“使用方法”Tab 还提供可直接复制的**标准提示词**，可整段发给其它 Agent 使用。

## 工具列表

| 工具 | 能力 | 说明 |
|---|---|---|
| `list_sessions` | listSessions | 列出已有根会话 |
| `read_session` | readSessions | transcript / 受限事件记录 |
| `send_message` | sendMessages | 向已有会话发送，可等待 |
| `wait_for_completion` | waitForCompletion | 等待/轮询轮次 |
| `ask_dsh` | askDsh + sendMessages + waitForCompletion | 一次调用阻塞等待并返回最终回答（未传 `timeoutMs` 时使用 `maxWaitMs`；默认 -1 表示不限时） |
| `list_models` | listModels | 已配置模型 |
| `create_session` | createSessions | 新建会话 |
| `run_task` | createSessions + sendMessages + waitForCompletion | 新建 + 发送 + 等待 |
| `set_model` | selectModel | 切换会话模型 |
| `set_permission` | setPermission | 切换权限预设 |
| `cancel_turn` | cancelTurns | 取消运行轮次 |
| `fork_session` | forkSessions | 派生会话 |
| `rename_session` | renameSessions | 重命名 |
| `settings_describe` | manageSettings | 读取 DSH 设置（脱敏） |
| `settings_update` | manageSettings | 修改 DSH 设置 |
| `plugins_list` | managePlugins | 列出插件/包 |
| `plugin_set_enabled` | managePlugins | 启停插件行 |
| `bundle_set_enabled` | managePlugins | 启用/停用 bundle |
| `plugin_install` | managePlugins | 安装插件（可能执行包构建脚本） |
| `plugin_remove` | managePlugins | 卸载插件 |
| `credentials_describe` | manageCredentials | 凭据状态（不返回明文） |
| `credential_set` | manageCredentials | 设置凭据 |
| `credential_unset` | manageCredentials | 移除凭据 |

说明：

- `wait_for_completion` 返回 transcript 页（`messages` / `completedTurns` / `turnEndReason` / `cursor`），**没有**顶层 `reply`；需要单条回答用 `ask_dsh`。
- 参数名按资源类型保留：`plugin_set_enabled` 用 `entryId`（Loader 行），`bundle_set_enabled` / `plugin_remove` 用 `name`（包名），credentials 用 `ref`。
- `set_permission` 切换到 `danger-full-access` 仍要求网关审批模式为 `open`；`read-only` / `workspace-write` 不受此限制。
- `cancel_turn` 等价于 GUI 停止当前运行轮次，保留已排队 follow-up；对已完成轮次是 no-op。

## 安全模型

- Bearer Token，常量时间比较；轮换即时失效；日志不记录 Token。
- 仅回环客户端；Host/Origin 校验；无 CORS。
- 每次需要审批的 MCP 调用通过 Windows MessageBox 确认；超时失败关闭。
- 设置文件写入走操作系统文件路径鉴权：非管理员写入被 ACL 拒绝后自动请求 UAC，批准则写入成功，取消则返回 403 `settings-write-denied`；插件层没有管理员门禁。
- 审批摘要会截断并遮蔽 token/secret/password/value 等字段。
- `open` 模式会放开全部能力，只建议完全信任的客户端使用。
- 本机同用户进程属于信任边界；能读 `$DSH_HOME` 的进程可以取得 Token。
- 不自动批准、不自动回答 `ask_user_question`；模型在 DSH 中等待用户时，MCP 调用会一直等待（默认限制已关闭）或受客户端自身超时限制。

## 安装

版本：DSH `0.2.2-rc.1`（兼容范围 `>=0.2.1-rc.5 <0.3.0`），desktop profile。

### 方式 A：插件管理器（推荐）

在 DSH 侧边栏 **Plugins** 页面搜索 `dsh-mcp-gateway` 并安装，或执行：

```sh
dsh plugin --profile <profile> add dsh-mcp-gateway
```

插件激活后创建 `$DSH_HOME/dsh-mcp-gateway/settings.json`。

### 方式 B：本地开发 link

```sh
# 1. 安装插件自身依赖（在仓库目录）
pnpm install

# 2. 让 profile 解析本地包
dsh plugin --profile <profile> add link:<本仓库绝对路径>

# 3. 在 profile 的 cordis.patch.yml 末尾加入：
#    - insert:
#        - id: dsh-mcp-gateway
#          name: dsh-mcp-gateway
```

保存后 DSH 会重载配置；若客户端未出现，刷新页面。

## 测试

```sh
# 单元/协议测试
node --test test/*.test.js

# 只读烟测（临时切 open，结束后恢复）
node scripts/smoke-live.mjs

# 写入烟测：新建 + ask_dsh + wait
node scripts/smoke-live.mjs --write --root <工作区>

# 完全开放 + danger-full-access + run_task
node scripts/smoke-live.mjs --full --root <工作区>

# 审批流：only-checked 下出现审批 → allow / deny
node scripts/smoke-live.mjs --approval

# 进阶只读工具：settings_describe / plugins_list / credentials_describe
node scripts/smoke-live.mjs --advanced

# 范围四档：except 排除会话 / none 禁用会话（结束自动恢复）
node scripts/scope-smoke.mjs

# Windows 系统审批弹窗自测（弹窗约 1.2 秒后按超时自动关闭）
node scripts/system-popup-smoke.mjs

# 当前 only-checked 模式下的审批 allow/deny（不修改设置）
node scripts/approval-current-smoke.mjs
```

> `smoke-live` / `scope-smoke` 会临时切换审批模式或范围并写入设置文件；如果设置目录已加固 ACL，普通权限运行会弹出 UAC 并等待授权，不适合无人值守烟测。可在管理员身份启动的 DSH 下执行，或改用不写设置的 `approval-current-smoke` / `system-popup-smoke`。

烟测会创建留在 DSH 会话列表中的测试会话，可自行删除；`--write/--full` 结束会恢复原设置。

## 数据与日志

- 设置/Token：`$DSH_HOME/dsh-mcp-gateway/settings.json`（schemaVersion 2）。
- 旧版 v1 设置会自动迁移：权限布尔 → capabilities，`fullAccess:true` → `open`，Token/范围/引导状态保留。
- 激活诊断：`$DSH_HOME/dsh-mcp-gateway/activation.log`（设置目录加 ACL 后，普通权限进程无法再追加，属预期）。
- 损坏设置会备份为 `settings.json.corrupt-<timestamp>` 后重建默认配置。

## 设置文件权限加固（可选）

`scripts/protect-settings.ps1` 可以把设置目录和文件设为：

- `BUILTIN\Administrators` / `SYSTEM`：完全控制
- 当前用户：目录 `ReadAndExecute`、`settings.json` `Read`

因此保存设置时，普通进程会触发 UAC；批准后由提权 helper 写入，取消或超时才返回
`403 settings-write-denied`，且不会修改文件或 revision。

UAC helper 是 `lib/settings-elevate.exe`（GUI 子系统，无控制台窗口）：
- 先弹出 **Windows 信任对话框**（WinForms，盾牌图标，类似“是否信任此应用”）；显示目标
  文件路径、修改摘要（审批模式、能力、范围、限制、服务字段等 diff），默认按钮为“拒绝”；
- 点“信任并请求管理员权限”后，才通过 `ShellExecuteEx("runas")` 请求 UAC；
- 提权后的副本只接受目标名为 `settings.json`、父目录名为 `dsh-mcp-gateway`、源文件为合法
  JSON 的写请求，不执行任意命令；
- 不再启动 PowerShell，因此不会闪过 PowerShell 窗口。

测试方式：刷新 DSH 页面 → 修改任一设置 → 保存。若当前用户没有文件写权限，会先出现
Windows 信任对话框，列出目标文件和修改摘要；点“信任并请求管理员权限”后，Windows 再
按 UAC 策略弹授权框或静默提权；点“拒绝”则不写入，页面显示 `settings-write-denied`。

```powershell
# 重新加固（当前用户即可执行，因为仍是文件所有者）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\protect-settings.ps1 `
  -SettingsPath "$env:DSH_HOME\dsh-mcp-gateway\settings.json"

# 撤销 ACL（需要能修改 ACL 的身份；用于恢复默认继承权限）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\protect-settings.ps1 `
  -SettingsPath "$env:DSH_HOME\dsh-mcp-gateway\settings.json" -Unprotect
```

注意：Windows 文件所有者仍可能主动改回 ACL；这是操作系统所有权模型，不是插件能覆盖的边界。

## 已知限制

- 只支持 Streamable HTTP；无 stdio proxy。
- Windows 系统审批弹窗依赖 `powershell.exe` 与 `System.Windows.Forms`；非 Windows 没有审批 UI，需要审批的调用会超时失败。
- 审批只依赖 Windows MessageBox；DSH 页面关闭/最小化不影响审批，非 Windows 无审批入口。
- 设置文件写入受 Windows ACL 控制；普通用户保存时触发 UAC，批准后写入，取消则失败。
- UAC fallback 需要交互式桌面；无桌面/服务会话或 UAC 被策略禁用时，保存直接返回 `settings-write-denied`。
- 管理员边界在操作系统文件层；插件只在文件写入被拒绝时请求 UAC，没有 `admin-required` 插件门禁。
- 不支持 MCP resources / prompts / sampling / elicitation。
- 不自动批准，不自动回答用户提问。
- 插件安装/设置修改依赖 DSH 会话服务；兼容 DSH `0.2.1-rc.5` 和 `0.2.2-rc.1`，升级 DSH 后仍需复核。DSH 0.2.2 的入口在 **设置 → 插件 → DSH MCP Gateway**（旧版为设置分区）。
- `open` 模式与 `except-checked` 下勾选高级能力都可能让外部 Agent 执行用户级操作，请谨慎。

## 排障

| 现象 | 处理 |
|---|---|
| MCP 401 | Token 错误/已轮换；从设置页复制新 Token |
| MCP 403 | 非回环地址、Host/Origin 不匹配；改用 `http://127.0.0.1:<port>` |
| MCP 503 | 设置中 `server.enabled` 为 false |
| 工具缺失 | 当前审批模式/能力未勾选；或 `only-checked` 下未勾选 |
| 调用一直等待 | 需要 Windows MessageBox 审批但无人处理；默认审批不限时，检查弹窗是否被其它窗口遮挡 |
| 设置页/弹窗不出现 | 刷新页面；在 **设置 → 插件 → DSH MCP Gateway** 打开；检查 `__DSH_BOOT__` 中是否有 `dsh-mcp-gateway`；查看 activation.log |
| 保存冲突 409 | 别处已修改设置；刷新后重试 |
| 读不到设置 | 检查 `$DSH_HOME`；插件启动时会创建目录/文件 |

## 卸载 / 回滚

1. 从 profile `cordis.patch.yml` 删除 `dsh-mcp-gateway` insert 行；
2. 从 profile `package.json` 删除依赖；
3. 删除 `profiles\desktop\node_modules\dsh-mcp-gateway` junction；
4. 可选删除 `$DSH_HOME/dsh-mcp-gateway`；
5. 刷新/重载 DSH。

已有备份：`cordis.patch.yml.bak-mcp-gateway`、`package.json.bak-mcp-gateway`。

## 实现文件

| 文件 | 职责 |
|---|---|
| `lib/index.js` | Cordis 入口、路由生命周期、审批队列 |
| `lib/settings.js` | v2 设置、v1 迁移、Token、revision、原子写 |
| `lib/capabilities.js` | 三级能力、四级审批模式、工具可见/调用策略 |
| `lib/approvals.js` | 审批队列、摘要脱敏 |
| `lib/bridge.js` | DSH 服务适配、会话/模型/设置/插件/凭据操作 |
| `lib/format.js` | transcript / events 投影与脱敏 |
| `lib/mcp.js` | MCP Server、23 个工具、审批门禁 |
| `lib/http.js` | 认证、管理 API、审批 API |
| `lib/client.js` | 浏览器 UI（原生勾选、Tab、使用说明；审批仅在系统 MessageBox） |
| `lib/settings-elevation.js` | 写文件被 ACL 拒绝时触发 UAC 提权 fallback |
| `lib/settings-elevate.exe` | GUI 信任对话框 + 提权写入 helper（无 console；WinForms 盾牌窗口） |
| `scripts/settings-elevate-gui.cs` | UAC/信任对话框 helper 源码 |
| `scripts/build-elevate.ps1` | 用 .NET Framework csc 重新编译 helper |
| `scripts/protect-settings.ps1` | 给设置目录/文件加管理员可写、用户只读的 Windows ACL |
| `docs/CLIENT-CONTRACT-V2.md` | 客户端 v2 契约 |
| `docs/SETTINGS.md` | 设置字段与 API |
| `docs/STANDARD-PROMPT.md` | 可直接复制给其它 Agent 的标准提示词 |
| `docs/VERIFICATION.md` | 验证记录 |
