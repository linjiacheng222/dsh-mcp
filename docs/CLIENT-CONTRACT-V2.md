# dsh-mcp-gateway client contract v2

This file supersedes `CLIENT-CONTRACT.md` for the UI rewrite. The client bundle is
still a hand-written module-loader factory (`lib/client.js`), only
`require('react')`, no build step.

## Settings slot surface

- DSH 0.2.1: register the settings page in `settings.section` with id
  `dsh-mcp-gateway`.
- DSH 0.2.2+: register the same page in the plugin manager's `plugins.item`
  slot (`view: "summary"` for the card description, `view: "page"` for the
  full settings UI). Keep both registrations so one bundle works with both
  releases.
- The onboarding overlay remains in `shell.overlay`.

## Settings shape (v2)

```json
{
  "schemaVersion": 2,
  "approvalMode": "only-checked",
  "capabilities": {
    "listSessions": true,
    "readSessions": true,
    "sendMessages": true,
    "waitForCompletion": true,
    "askDsh": true,
    "listModels": false,
    "createSessions": false,
    "selectModel": false,
    "setPermission": false,
    "cancelTurns": false,
    "forkSessions": false,
    "renameSessions": false,
    "manageSettings": false,
    "managePlugins": false,
    "manageCredentials": false
  },
  "scope": {
    "sessionMode": "all",
    "sessionIds": [],
    "includeSubagents": false,
    "modelMode": "all",
    "allowedModels": [],
    "allowedRoots": [],
    "defaultCwd": "",
    "defaultModel": "",
    "newSessionPreset": "workspace-write"
  },
  "limits": {
    "maxReadMessages": -1,
    "maxReadChars": -1,
    "maxMessageChars": -1,
    "defaultWaitMs": -1,
    "maxWaitMs": -1,
    "approvalTimeoutMs": -1,
    "sendWhenBusy": "queue"
  },
  "server": {
    "enabled": true,
    "token": "dshmcp_...",
    "allowNonLoopback": false,
    "instructions": ""
  },
  "onboarding": { "shownAt": null, "acknowledgedAt": null }
}
```

There is **no** `permissions` and **no** `fullAccess` field anymore. Patches use
`approvalMode`, `capabilities`, `scope`, `limits`, `server`, `onboarding`.

All numeric `limits` default to `-1` (unlimited); any negative value disables that
limit, while `0` is invalid. Existing positive values in a settings file are kept
as-is; only a fresh install or "restore defaults" writes `-1`.

## Approval modes

| value | title | behavior |
|---|---|---|
| `only-checked` | 审批（仅勾选项） | only checked capabilities are available; every call needs approval |
| `except-checked` | 审批（勾选项除外） | checked capabilities run directly; unchecked capabilities need approval |
| `all` | 均需审批 | all capabilities are available; every call needs approval |
| `open` | 完全开放（无视名单） | all capabilities run directly; the list is display-only |

`catalog.approvalModes` returns `{value,title,titleEn,description,descriptionEn}`.
`only-checked` is the default.

## Capability levels

`catalog.capabilities` is an array of levels:

```json
[
  {
    "id": "basic",
    "title": "基础",
    "titleEn": "Basic",
    "description": "...",
    "descriptionEn": "...",
    "capabilities": [
      {
        "key": "listSessions",
        "level": "basic",
        "title": "列出会话",
        "titleEn": "List sessions",
        "description": "...",
        "descriptionEn": "...",
        "tools": ["list_sessions"],
        "checked": true
      }
    ]
  }
]
```

Level ordering is basic, regular, advanced. Advanced capabilities:
`manageSettings`, `managePlugins`, `manageCredentials`.

## API additions

### `GET /dsh-mcp/api/approvals`

```json
{
  "ok": true,
  "revision": 3,
  "pending": [
    {
      "id": "uuid",
      "capability": "createSessions",
      "tool": "create_session",
      "sessionId": "session-...",
      "summary": "{\"cwd\":\"E:\\\\work\"}",
      "createdAt": 1790000000000,
      "expiresAt": 1790000055000
    }
  ]
}
```

The overlay must poll this every ~2 seconds and show pending approval cards.
Allow/deny uses icon + visible text buttons with `aria-label` and `title`.

### `POST /dsh-mcp/api/approvals/{id}`

Body `{ "decision": "allow" | "deny" }`. Response:

```json
{ "ok": true, "pending": [], "pendingCount": 0 }
```

If the request already settled, the server responds 404.

## State additions

```json
{
  "settingsPath": "D:\\.ds-harness-desktop\\dsh-home\\dsh-mcp-gateway\\settings.json",
  "catalog": {
    "capabilities": [ ...levels... ],
    "approvalModes": [ ...4 modes... ],
    "tools": [{ "name": "list_sessions", "visible": true }],
    "hiddenTools": ["create_session", "..."],
    "sessions": [
      {
        "sessionId": "session-...",
        "title": "标题",
        "cwd": "E:\\work",
        "modelKey": "provider/model",
        "permission": "workspace-write",
        "running": false,
        "blank": false,
        "updatedAt": 1790000000000
      }
    ],
    "models": [ ...provider groups... ],
    "permissionPresets": [{ "value": "workspace-write", "name": "workspace-write" }],
    "defaultPreset": "danger-full-access"
  },
  "status": {
    "enabled": true,
    "running": true,
    "capabilityCount": 5,
    "visibleToolCount": 5,
    "pendingApprovals": 0,
    "systemApprovalPopup": true,
    "serviceWarnings": []
  }
}
```

Settings writes use the operating-system file ACL directly. If the file is
protected and DSH runs without administrator rights, the host first tries the
normal write, then raises a native Windows UAC prompt and retries through an
elevated helper. Keep the save request in the busy state while this is pending.
If the user cancels UAC, `POST /api/settings` returns 403
`settings-write-denied` (details include `path`/`cause`); show a clear error card.
There is **no** plugin-level `elevated`/`admin-required` state to lock controls.

`status.systemApprovalPopup` is true when the host will also show a native
Windows Yes/No dialog for approvals; mention this in the approval step.

`catalog.sessions` may be empty if the session service is unavailable; show an
empty state and keep the manual field config.

## Scope modes

Both scope selectors use four native single-choice rows:

| value | session scope | model scope |
|---|---|---|
| `all` | all sessions | all models |
| `allowlist` | only the listed sessions | only the listed models |
| `except` | all except the listed sessions | all except the listed models |
| `none` | no session access | no model access |

`allowlist` and `except` both render the visual multi-select lists; `except`
means the checked entries are **excluded**. The field-config textareas stay in
sync and keep the same list for all four modes. In `none` the MCP gateway cannot
list/read/send sessions, and cannot create/select models.

## Required UI changes

### 1. Native visual style

Match the DSH permission menu reference (screenshot provided by the user):

- Rounded menu container (`border-radius: 12px`, DSH background/border vars).
- Rows ~44px high with a leading 16px line icon, label, and optional
  description; trailing checkmark icon when selected.
- Selected row uses a subtle DSH selected background; hover uses the DSH hover
  background. Keyboard focus ring is visible.
- Use this row/menu component for:
  - capability checkboxes,
  - approval mode selection (single choice, trailing checkmark),
  - session scope multi-select,
  - model scope multi-select,
  - any other multi-select (e.g. level select-all).
- Do not use raw browser `<select>` or default checkbox styling for any finite
  option list. `SelectMenu` is the canonical single-select control.

#### Icon policy

- Static, semantic icons per capability, approval mode, scope mode and session
  row; never use one fixed shield for everything.
- Model rows use a dynamic brand mark: DeepSeek → whale; GLM/Zhipu/chatglm →
  letter `Z`; unknown brands render **no icon** (no placeholder, no fallback
  shield).

### 2. Complete confirm/save/allow buttons

Every "confirm" / "save" / "apply" / "allow" / "deny" button must show a
complete inline SVG icon **and a visible text label**. Blank, icon-only or
partially rendered buttons are not acceptable. This includes:

- save settings,
- restore defaults confirmation,
- approval allow/deny,
- first-run "confirm and enable",
- any confirmation dialog primary/cancel buttons.

### 3. Capability levels and select-all

In the Permissions section:

- Render three level cards (基础 / 常规 / 进阶), each with a **select-all**
  native checkbox row that checks or unchecks every capability in that level.
- Render each capability as a native menu row with title + description and a
  trailing checkmark.
- Advanced capabilities must include `manageSettings`, `managePlugins`,
  `manageCredentials` with descriptions.
- Show a short helper text explaining what the selected approval mode does.
- `open` mode shows a red warning; switching to it requires a second
  confirmation step (icon + text confirm button).
- The level select-all must reflect indeterminate state (some checked) visually
  as a dash/check style if practical.

### 4. Scope visual pickers (keep field config)

- Session scope:
  - Mode rows: 全部会话 / 仅勾选会话 (native single-choice rows).
  - When `仅勾选`, render `catalog.sessions` as a native multi-select list with
    checkbox rows (title, cwd, model/tag, running dot). Provide 全选 / 清空 /
    刷新 buttons.
  - Empty state + "无法读取会话列表" fallback.
  - Keep the existing textarea/session-id field config in a collapsible
    "字段配置" section below the visual picker; the visual picker and the text
    field must stay in sync.
- Model scope:
  - Mode rows: 全部模型 / 仅勾选模型.
  - When allowlist, render `catalog.models` grouped by provider as native
    multi-select rows (model name/id, reasoning badge). Provide 全选 / 清空.
  - Keep the existing `provider/model` textarea in the collapsible field config.
- Keep allowedRoots, defaultCwd, defaultModel, newSessionPreset fields; add a
  "使用当前会话 cwd" helper button that fills defaultCwd from the first
  `catalog.sessions` entry, if available.
- Limits: add the numeric `approvalTimeoutMs` field (审批等待超时).

### 5. Usage instructions tab

Add a tab layout inside the DSH MCP Gateway settings section:

- Tab 1: 设置 (the existing configuration form)
- Tab 2: 使用方法

The usage tab must contain:

1. A concise inline SVG diagram (no external image files) showing:
   `其它 Agent → MCP 地址 + Token → DSH 会话/模型 → 回答`.
   Keep it simple, use DSH text/label colors.
2. Numbered steps:
   1. 复制 MCP 客户端配置（含当前地址/端口和 Token）；配置复制是推荐步骤，不是多余操作。
   2. 把标准提示词发给 Agent，并同时提供配置或 Token；提示词不含真实 Token，Agent 需要时会向用户询问。
   3. 调用 `list_sessions` 找到会话，再调用 `ask_dsh` 发送问题并获取回答。
3. Cautions list:
   - DSH 必须保持运行。
   - 审批只通过 Windows MessageBox 出现，需要人工允许；超时会失败关闭；DSH 窗口内没有审批卡片。
   - `only-checked` 是默认最小权限；`open` 会放开全部能力。
   - 只支持 Streamable HTTP MCP；推荐复制配置，也支持只给 URL + Token。
4. Copyable MCP client config (recommended; current endpoint/port and token).
5. Copyable `ask_dsh` interface description and a JSON example call.
6. Copyable **standard prompt** for other agents. Content should explain:
   - use the MCP gateway tools, not shell,
   - dynamic endpoint/port/settings-file path from current state,
   - embedded MCP config snippet with `<TOKEN>` placeholder,
   - `list_sessions` / `ask_dsh` / `send_message` / `wait_for_completion`,
   - when to use which (quick Q&A vs long task vs creating a new session),
   - **if the token is not provided, ask the user for it**; never write it to files/logs/messages,
   - approval/permission caveats (Windows MessageBox only),
   - how to recover on timeout using cursor.
   Keep it self-contained and directly pasteable; re-copy when settings change.
7. A note that the gateway is HTTP-only; copying the MCP config is recommended; approvals need the Windows MessageBox.

### 6. First-run overlay

- Keep the first-run modal, but update copy:
  - default is 5 basic tools with approval-only mode (not "4 basic no approval");
  - mention `ask_dsh` as the one-call interface;
  - mention approvals are requested via the Windows MessageBox (not an in-window card);
  - icon + text "confirm and enable" button.
- Keep the "重新显示欢迎页" action.

### 7. Pending approval UI

- The DSH page must **not** render an in-window approval card and must not poll
  `/api/approvals` for UI purposes.
- Approvals are presented only by the host via the Windows system MessageBox
  (`lib/system-notify.js` + `lib/approval-popup.ps1`), which posts the decision
  back to `/api/approvals/{id}`.
- If the system approval channel is disabled, there is no approval UI; calls
  that need approval time out and fail closed.

### 8. All copy

Bilingual zh/en for every new string. Keep the local dictionary approach.
