# dsh-mcp-gateway client contract (v1 — superseded)

> This v1 document is kept for history. The active contract is
> [`CLIENT-CONTRACT-V2.md`](CLIENT-CONTRACT-V2.md): schema v2, four approval
> modes, three capability levels, approval overlay and the usage tab.

This file is the frozen contract between the host half and the browser half of
the plugin. The client bundle is hand-written (`lib/client.js`) and must not
import any package other than the shared `react` module.

## Package identity

- Package name / module-loader id: `dsh-mcp-gateway`
- Client bundle: `lib/client.js`
- Client plugin exports: `{ name, inject, apply }`
- Cordis service inject: `['slots']` only. `ctx.get('locale')` is optional.
- Registered slots:
  - `settings.section` with id `dsh-mcp-gateway`, order `60`, label `() => t('nav')`
  - `shell.overlay` with id `dsh-mcp-gateway-onboarding`, order `20`

The client bundle format is exactly:

```js
window.__ModuleLoader__.load({
  id: 'dsh-mcp-gateway',
  factory: (require) => {
    // ... module body
    return { name: 'dsh-mcp-gateway', inject: ['slots'], apply }
  },
})
```

## Host HTTP API (same origin as the DSH page)

All management routes live under `/dsh-mcp/api`. The client must send
`X-DSH-MCP-UI: 1` and `credentials: 'same-origin'` on every request, and use
`cache: 'no-store'`.

### `GET /dsh-mcp/api/state`

```json
{
  "ok": true,
  "revision": 3,
  "settings": { "...": "settings object, including server.token" },
  "endpoint": {
    "origin": "http://127.0.0.1:<port>",
    "mcpUrl": "http://127.0.0.1:<port>/dsh-mcp/mcp",
    "path": "/dsh-mcp"
  },
  "onboarding": {
    "firstRun": true,
    "acknowledged": false,
    "shownAt": null,
    "acknowledgedAt": null
  },
  "catalog": {
    "tools": [{ "name": "list_sessions", "permission": "listSessions", "enabled": true }],
    "models": [
      {
        "provider": "deepseek-account",
        "providerName": "DeepSeek",
        "models": [
          { "id": "deepseek-flash", "name": "DeepSeek Flash", "reasoningEfforts": [], "defaultEffort": null }
        ]
      }
    ],
    "defaultModel": "deepseek-account/deepseek-flash",
    "permissionPresets": [
      { "value": "read-only", "name": "read-only", "description": "..." }
    ],
    "defaultPreset": "danger-full-access"
  },
  "status": {
    "enabled": true,
    "running": true,
    "permissionCount": 4,
    "serviceWarnings": []
  },
  "warnings": []
}
```

- `settings` shape is documented in `docs/SETTINGS.md` (see below).
- `catalog.models` may be `[]` when the model catalog cannot be read; include a
  `serviceWarnings` entry in that case.
- `catalog.tools` reflects the current permission switches; disabled tools are
  still listed with `enabled: false`.

### `POST /dsh-mcp/api/settings`

Request: `{ "revision": 3, "patch": { ...deep partial settings... } }`

Response: the same shape as `GET /state` on success.

Errors are JSON and use the HTTP status:

```json
{ "ok": false, "error": { "code": "revision-conflict", "message": "...", "details": {} } }
```

Statuses: 400 invalid, 409 revision conflict, 403 origin check failed.

### `POST /dsh-mcp/api/token`

Request `{ "revision": 3 }`; response is a state object with the new token.

### `POST /dsh-mcp/api/onboarding`

Request `{ "revision": 3, "shown": true, "acknowledged": true }`; either field
may be omitted. Response is a state object.

## Settings shape (client-visible)

```json
{
  "schemaVersion": 1,
  "permissions": {
    "listSessions": true,
    "readSessions": true,
    "sendMessages": true,
    "waitForCompletion": true,
    "listModels": false,
    "createSessions": false,
    "selectModel": false,
    "setPermission": false,
    "cancelTurns": false,
    "forkSessions": false,
    "renameSessions": false
  },
  "fullAccess": false,
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
    "maxReadMessages": 100,
    "maxReadChars": 60000,
    "maxMessageChars": 100000,
    "defaultWaitMs": 45000,
    "maxWaitMs": 180000,
    "sendWhenBusy": "queue"
  },
  "server": {
    "enabled": true,
    "token": "dshmcp_...",
    "allowNonLoopback": false,
    "instructions": ""
  },
  "onboarding": {
    "shownAt": null,
    "acknowledgedAt": null
  }
}
```

`revision`/`updatedAt` are maintained by the host and are not part of `patch`.

## Client visual contract

- Inject one `<style>` element into `document.head` from `apply`, prefix every
  class with `dshmcp-`, and remove the style on fiber disposal. Use DSH CSS
  variables with fallbacks:
  - `--dsw-alias-label-primary`, `--dsw-alias-label-secondary`,
    `--dsw-alias-label-tertiary`, `--dsw-alias-border-l2`,
    `--dsw-alias-border-l3`, `--dsw-alias-bg-module-platform`,
    `--dsw-alias-interactive-bg-hover`, `--dsw-alias-brand-primary`,
    `--dsw-specific-menu`, `--dsw-radius-md`.
- Settings section: full width of the settings content column, scrollable,
  sectioned cards, no external icon package (inline SVG or text only).
- First-run overlay: fixed backdrop, centered card, max-width 720px,
  `z-index` above the app (at least 1000), Escape closes it, focus moves to the
  primary button. It is shown only while the local state says
  `onboarding.firstRun` and the user has not dismissed it in this page session.
- On first display, POST `onboarding { shown: true }` using the current
  revision. On "save", persist the form and POST `onboarding { acknowledged:
  true }`. On "later", only `shown` is written; do not auto-open again until
  `shownAt` is cleared by the user (settings page has a "重新显示欢迎页" action
  that can clear `shownAt`).
- The settings page must show an amber banner while `acknowledgedAt === null`.
- Token is masked by default with a 显示/隐藏 toggle and a copy button.
- `fullAccess` requires an in-page confirmation step (two clicks) and shows a
  red warning.
- All copy must be bilingual (zh/en) through a local dictionary. Use
  `ctx.get('locale')?.getSnapshot().active` when available; otherwise
  `navigator.language`.

## Failure behavior

- Any fetch failure must render an inline error card, never throw out of render.
- A 409 must reload state once and show "设置已在别处更新，请重试".
- If the state says `ok: false` or the API is unavailable, show a "MCP 服务未连接"
  card with a retry button.
