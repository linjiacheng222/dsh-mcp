// dsh-mcp-gateway browser client bundle (v2 UI).
//
// Hand-written, no JSX and no build step by design. The v2 contract is
// docs/CLIENT-CONTRACT-V2.md: three capability levels, four approval modes,
// visual session/model pickers, usage tab, and the pending-approval overlay.
window.__ModuleLoader__.load({
  id: 'dsh-mcp-gateway',
  factory: (require) => {
    'use strict';
    const React = require('react');
    const h = React.createElement;

    // ------------------------------------------------------------------ constants
    const API_BASE = '/dsh-mcp/api';
    const REQUEST_TIMEOUT_MS = 12000;
    const STYLE_ATTRIBUTE = 'data-dsh-mcp-gateway-style';

    /** Settings that are on by default. */
    const PERMISSION_BASIC = Object.freeze([
      'listSessions',
      'readSessions',
      'sendMessages',
      'waitForCompletion',
    ]);
    /** Settings that are off by default; `fullAccess` is the master switch next to them. */
    const PERMISSION_EXTENDED = Object.freeze([
      'listModels',
      'createSessions',
      'selectModel',
      'setPermission',
      'cancelTurns',
      'forkSessions',
      'renameSessions',
    ]);
    const PERMISSION_KEYS = Object.freeze(PERMISSION_BASIC.concat(PERMISSION_EXTENDED));

    const DEFAULT_PERMISSIONS = Object.freeze({
      listSessions: true,
      readSessions: true,
      sendMessages: true,
      waitForCompletion: true,
      listModels: false,
      createSessions: false,
      selectModel: false,
      setPermission: false,
      cancelTurns: false,
      forkSessions: false,
      renameSessions: false,
    });

    const DEFAULT_SCOPE = Object.freeze({
      sessionMode: 'all',
      sessionIds: Object.freeze([]),
      includeSubagents: false,
      modelMode: 'all',
      allowedModels: Object.freeze([]),
      allowedRoots: Object.freeze([]),
      defaultCwd: '',
      defaultModel: '',
      newSessionPreset: 'workspace-write',
    });

    const DEFAULT_LIMITS = Object.freeze({
      maxReadMessages: -1,
      maxReadChars: -1,
      maxMessageChars: -1,
      defaultWaitMs: -1,
      maxWaitMs: -1,
      sendWhenBusy: 'queue',
    });

    const NUMERIC_LIMIT_KEYS = Object.freeze([
      'maxReadMessages',
      'maxReadChars',
      'maxMessageChars',
      'defaultWaitMs',
      'maxWaitMs',
    ]);

    /** Values the host accepts for limits.sendWhenBusy (contract example value is `queue`). */
    const SEND_WHEN_BUSY_VALUES = Object.freeze(['queue', 'reject']);

    // ------------------------------------------------------------------ v2 constants
    // The v2 host moved from permissions/fullAccess to approvalMode + three-level
    // capabilities. These fallbacks let the UI render before /state arrives and
    // when a catalog entry is missing; the live catalog always wins.
    const APPROVAL_MODE_VALUES_V2 = Object.freeze(['only-checked', 'except-checked', 'all', 'open']);
    const APPROVAL_MODE_META = Object.freeze({
      'only-checked': {
        value: 'only-checked',
        title: '审批（仅勾选项）',
        titleEn: 'Approval (checked only)',
        description: '只有勾选的能力可用；每次调用都需要你审批。',
        descriptionEn: 'Only checked capabilities are available; every call needs your approval.',
      },
      'except-checked': {
        value: 'except-checked',
        title: '审批（勾选项除外）',
        titleEn: 'Approval (except checked)',
        description: '勾选项直接放行；未勾选项需要你逐次审批。',
        descriptionEn: 'Checked capabilities run directly; unchecked ones need approval each time.',
      },
      all: {
        value: 'all',
        title: '均需审批',
        titleEn: 'Approve everything',
        description: '所有能力都可用，但每次调用都需要你审批。',
        descriptionEn: 'Every capability is available, and every call needs your approval.',
      },
      open: {
        value: 'open',
        title: '完全开放（无视名单）',
        titleEn: 'Open (ignore list)',
        description: '所有能力直接放行，不再询问；名单仅作展示。',
        descriptionEn: 'Every capability runs directly with no prompts; the list is display-only.',
      },
    });

    const CAPABILITY_LEVEL_ORDER_V2 = Object.freeze(['basic', 'regular', 'advanced']);
    const CAPABILITY_LEVEL_META = Object.freeze({
      basic: {
        id: 'basic',
        title: '基础',
        titleEn: 'Basic',
        description: '已有会话的查看、读取、发送与等待。',
        descriptionEn: 'Inspect, read, message and wait on existing sessions.',
      },
      regular: {
        id: 'regular',
        title: '常规',
        titleEn: 'Regular',
        description: '新建会话、指定模型、切换权限、取消、派生与改名。',
        descriptionEn: 'Create sessions, choose models, switch permissions, cancel, fork and rename.',
      },
      advanced: {
        id: 'advanced',
        title: '进阶',
        titleEn: 'Advanced',
        description: '调整 DSH 设置、管理插件与凭据等用户级操作。',
        descriptionEn: 'Change DSH settings, manage plugins and credentials, and other user-level operations.',
      },
    });

    const CAPABILITY_META = Object.freeze({
      listSessions: {
        level: 'basic',
        title: '列出会话',
        titleEn: 'List sessions',
        description: '列出已有 DSH 会话。',
        descriptionEn: 'List existing DSH sessions.',
        tools: ['list_sessions'],
      },
      readSessions: {
        level: 'basic',
        title: '读取会话',
        titleEn: 'Read sessions',
        description: '读取会话记录。',
        descriptionEn: 'Read session transcripts and events.',
        tools: ['read_session'],
      },
      sendMessages: {
        level: 'basic',
        title: '发送消息',
        titleEn: 'Send messages',
        description: '向已有会话发送内容。',
        descriptionEn: 'Send content into existing sessions.',
        tools: ['send_message'],
      },
      waitForCompletion: {
        level: 'basic',
        title: '等待完成',
        titleEn: 'Wait',
        description: '等待轮次结束并取回输出。',
        descriptionEn: 'Wait for a turn and retrieve its output.',
        tools: ['wait_for_completion'],
      },
      askDsh: {
        level: 'basic',
        title: '问答接口',
        titleEn: 'Ask interface',
        description: '一次调用完成“发送并返回回答”，像调用子智能体。',
        descriptionEn: 'Send one message and return the answer in one call, like a subagent.',
        tools: ['ask_dsh'],
      },
      listModels: {
        level: 'regular',
        title: '列出模型',
        titleEn: 'List models',
        description: '读取已配置的 provider/model。',
        descriptionEn: 'Read configured provider/model routes.',
        tools: ['list_models'],
      },
      createSessions: {
        level: 'regular',
        title: '新建会话',
        titleEn: 'Create sessions',
        description: '新建 DSH 会话并执行任务。',
        descriptionEn: 'Create DSH sessions and run tasks.',
        tools: ['create_session', 'run_task'],
      },
      selectModel: {
        level: 'regular',
        title: '选择模型',
        titleEn: 'Select model',
        description: '为会话选择模型。',
        descriptionEn: 'Choose the model for a session.',
        tools: ['set_model'],
      },
      setPermission: {
        level: 'regular',
        title: '切换权限',
        titleEn: 'Switch permissions',
        description: '切换会话的沙箱/审批预设。',
        descriptionEn: 'Switch a session permission preset.',
        tools: ['set_permission'],
      },
      cancelTurns: {
        level: 'regular',
        title: '取消轮次',
        titleEn: 'Cancel turns',
        description: '取消运行中的模型轮次。',
        descriptionEn: 'Cancel a running model turn.',
        tools: ['cancel_turn'],
      },
      forkSessions: {
        level: 'regular',
        title: '派生会话',
        titleEn: 'Fork sessions',
        description: '从历史事件派生新会话。',
        descriptionEn: 'Fork a new session from history.',
        tools: ['fork_session'],
      },
      renameSessions: {
        level: 'regular',
        title: '重命名会话',
        titleEn: 'Rename sessions',
        description: '修改会话标题。',
        descriptionEn: 'Change a session title.',
        tools: ['rename_session'],
      },
      manageSettings: {
        level: 'advanced',
        title: '调整设置',
        titleEn: 'Manage settings',
        description: '读取和修改 DSH 设置。',
        descriptionEn: 'Read and change DSH settings.',
        tools: ['settings_describe', 'settings_update'],
      },
      managePlugins: {
        level: 'advanced',
        title: '管理插件',
        titleEn: 'Manage plugins',
        description: '查看、启用/停用、安装与移除插件。',
        descriptionEn: 'List, enable, disable, install and remove plugins.',
        tools: ['plugins_list', 'plugin_set_enabled', 'bundle_set_enabled', 'plugin_install', 'plugin_remove'],
      },
      manageCredentials: {
        level: 'advanced',
        title: '管理凭据',
        titleEn: 'Manage credentials',
        description: '查看凭据状态、设置/移除环境变量凭据（不读取明文）。',
        descriptionEn: 'Inspect credential status and set/remove environment credentials (never read plaintext).',
        tools: ['credentials_describe', 'credential_set', 'credential_unset'],
      },
    });

    const CAPABILITY_KEYS_V2 = Object.freeze(Object.keys(CAPABILITY_META));

    const DEFAULT_APPROVAL_MODE_V2 = 'only-checked';

    const DEFAULT_CAPABILITIES_V2 = Object.freeze(
      CAPABILITY_KEYS_V2.reduce((result, key) => {
        result[key] = CAPABILITY_META[key].level === 'basic';
        return result;
      }, {}),
    );

    const DEFAULT_SCOPE_V2 = Object.freeze({
      sessionMode: 'all',
      sessionIds: Object.freeze([]),
      includeSubagents: false,
      modelMode: 'all',
      allowedModels: Object.freeze([]),
      allowedRoots: Object.freeze([]),
      defaultCwd: '',
      defaultModel: '',
      newSessionPreset: 'workspace-write',
    });

    const SCOPE_MODE_VALUES_V2 = Object.freeze(['all', 'allowlist', 'except', 'none']);

    function normalizeScopeModeV2(value) {
      return SCOPE_MODE_VALUES_V2.indexOf(value) !== -1 ? value : 'all';
    }

    const DEFAULT_LIMITS_V2 = Object.freeze({
      maxReadMessages: -1,
      maxReadChars: -1,
      maxMessageChars: -1,
      defaultWaitMs: -1,
      maxWaitMs: -1,
      approvalTimeoutMs: -1,
      sendWhenBusy: 'queue',
    });

    const NUMERIC_LIMIT_KEYS_V2 = Object.freeze([
      'maxReadMessages',
      'maxReadChars',
      'maxMessageChars',
      'defaultWaitMs',
      'maxWaitMs',
      'approvalTimeoutMs',
    ]);

    const APPROVAL_POLL_MS = 2000;
    const USAGE_TABS = Object.freeze(['settings', 'usage']);

    // ------------------------------------------------------------------ i18n
    // Local dictionaries only: we deliberately do NOT register a DSH locale
    // namespace. Language resolution prefers the live DSH locale snapshot and
    // falls back to the browser language.
    const ZH = {
      nav: 'MCP 网关',
      'plugins.summary': '配置 DSH MCP 网关的审批、能力、范围与使用说明。',
      'common.loading': '正在加载…',
      'common.retry': '重试',
      'common.copied': '已复制',
      'common.copy': '复制',
      'common.copyUrl': '复制地址',
      'common.show': '显示',
      'common.hide': '隐藏',
      'common.cancel': '取消',
      'common.confirm': '确认',
      'common.unsaved': '有未保存的更改',
      'common.upToDate': '已与服务器同步',
      'common.empty': '（未设置）',
      'common.copyFailed': '复制失败，请手动选择文本复制。',
      'status.title': '服务状态',
      'status.description': '这里显示 MCP 网关的连接信息与可用工具。',
      'status.enabled': '启用 MCP 服务',
      'status.enabledHint': '关闭后其他 AI 客户端将无法连接本机网关。',
      'status.mcpUrl': 'MCP 服务地址',
      'status.token': '访问 Token',
      'status.tokenHint': '在 MCP 客户端中配置为 Authorization: Bearer <token>。',
      'status.rotate': '轮换 Token',
      'status.rotateConfirm': '确认轮换 Token？所有已配置的客户端将立即失效。',
      'status.rotateConfirmButton': '确认轮换',
      'status.copyJson': '复制 MCP 客户端 JSON',
      'status.copyJsonHint': '内容包含 url 与 Authorization 头，可直接粘贴到 mcpServers 配置。',
      'status.running': '运行中',
      'status.pending': '待生效',
      'status.stopped': '已停止',
      'status.permissionCount': '已启用权限 {count} 项',
      'status.warnings': '服务警告',
      'banner.title': '欢迎页尚未确认',
      'banner.body': '默认只勾选 5 项基础能力，并采用“审批（仅勾选项）”。请确认能力与审批模式，或到设置中调整。',
      'banner.action': '重新显示欢迎页',
      'banner.reset': '已重置欢迎页状态，欢迎页将再次显示。',
      'banner.failed': '重置欢迎页失败',
      'permissions.title': '权限',
      'permissions.description': '控制 MCP 客户端能调用哪些 DSH 能力。',
      'permissions.basic': '基础权限（默认开启）',
      'permissions.extended': '扩展权限（默认关闭）',
      'permissions.fullAccess': '完全访问',
      'permissions.fullAccessHint': '开启后，MCP 客户端可使用全部工具并新建完全访问会话；仍不会自动批准 DSH 中的审批请求。',
      'permissions.fullAccessWarningTitle': '高风险操作',
      'permissions.fullAccessWarning': '完全访问会让 MCP 客户端以会话现有权限直接执行工具，请仅在你完全信任该客户端时开启。',
      'permissions.confirmFullAccess': '确认开启完全访问',
      'permission.listSessions': '列出会话',
      'permission.readSessions': '读取会话',
      'permission.sendMessages': '发送消息',
      'permission.waitForCompletion': '等待完成',
      'permission.listModels': '列出模型',
      'permission.createSessions': '创建会话',
      'permission.selectModel': '选择模型',
      'permission.setPermission': '设置会话权限',
      'permission.cancelTurns': '取消轮次',
      'permission.forkSessions': '分叉会话',
      'permission.renameSessions': '重命名会话',
      'scope.title': '范围',
      'scope.description': '限制 MCP 客户端可见的会话、模型与工作目录。',
      'scope.sessionMode': '会话范围',
      'scope.sessionModeAll': '全部会话',
      'scope.sessionModeAllowlist': '仅指定会话',
      'scope.sessionModeExcept': '除勾选会话外全部',
      'scope.sessionModeNone': '禁用所有会话',
      'scope.sessionIds': '会话 ID 列表',
      'scope.sessionIdsHint': '每行一个 ID；“仅勾选项”表示允许列表，“除勾选项外”表示排除列表。',
      'scope.sessionIdsPlaceholder': '例如：\n3f2a…\n9c1b…',
      'scope.includeSubagents': '包含子代理会话',
      'scope.includeSubagentsHint': '允许访问由子代理创建的会话。',
      'scope.modelMode': '模型范围',
      'scope.modelModeAll': '全部模型',
      'scope.modelModeAllowlist': '仅指定模型',
      'scope.modelModeExcept': '除勾选模型外全部',
      'scope.modelModeNone': '禁用所有模型',
      'scope.allowedModels': '允许的模型',
      'scope.allowedModelsHint': '每行一个 provider/model；“仅勾选项”表示允许列表，“除勾选项外”表示排除列表。',
      'scope.allowedModelsPlaceholder': '例如：deepseek-account/deepseek-flash',
      'scope.allowedRoots': '允许的工作目录',
      'scope.allowedRootsHint': '每行一个绝对路径；留空表示不额外限制。',
      'scope.allowedRootsPlaceholder': '例如：E:\\projects\\demo',
      'scope.defaultCwd': '默认工作目录',
      'scope.defaultCwdHint': '新建会话时使用；留空跟随 DSH 默认。',
      'scope.defaultModel': '默认模型',
      'scope.defaultModelHint': '新建会话使用；留空跟随 DSH 当前选择。',
      'scope.defaultModelEmpty': '跟随当前设置',
      'scope.newSessionPreset': '新会话权限预设',
      'scope.newSessionPresetHint': '选项来自 DSH 的 permissionPresets。',
      'limits.title': '限制',
      'limits.description': '控制单次调用的数据量与等待时间；负数（默认 -1）表示不限制。',
      'limits.maxReadMessages': '最多读取消息条数',
      'limits.maxReadChars': '最多读取字符数',
      'limits.maxMessageChars': '单条消息最大字符数',
      'limits.defaultWaitMs': '默认等待时长（毫秒）',
      'limits.maxWaitMs': '最大等待时长（毫秒）',
      'limits.sendWhenBusy': '会话繁忙时',
      'limits.sendWhenBusy.queue': '排队等待',
      'limits.sendWhenBusy.reject': '拒绝发送',
      'limits.invalidNumber': '请输入正整数；负数（如 -1）表示不限制，0 无效。',
      'limits.invalidFields': '请检查以下数字项：{fields}',
      'actions.save': '保存设置',
      'actions.saving': '正在保存…',
      'actions.reset': '恢复默认',
      'actions.resetHint': '将鉴权模式、能力、范围与限制恢复为默认值；Token 与服务开关保持不变。',
      'actions.resetConfirmButton': '确认恢复默认',
      'saved.done': '设置已保存。',
      'saved.conflict': '设置已在别处更新，请重试。',
      'saved.noChanges': '没有需要保存的更改。',
      saveFailed: '保存失败',
      rotateDone: 'Token 已轮换，请更新 MCP 客户端配置。',
      rotateFailed: '轮换 Token 失败',
      restoreDone: '已恢复默认设置。',
      restoreFailed: '恢复默认失败',
      loadErrorTitle: 'MCP 服务未连接',
      loadErrorHint: '无法读取网关状态。请确认插件已启用、服务正在运行，然后重试。',
      'error.timeout': '请求超时，请稍后重试。',
      'error.network': '网络请求失败：{message}',
      'error.invalidResponse': '服务返回了无法解析的数据。',
      'error.http': '服务返回错误（HTTP {status}）。',
      'error.httpWithStatus': 'HTTP {status}：{message}',
      'error.unknown': '未知错误，请重试。',
      'error.settingsWriteDenied': '操作系统拒绝写入设置文件：{path}。请以管理员身份重启 DSH，或修复 settings.json 的 ACL（允许当前用户写入）。',
      'error.settingsWriteDeniedNoPath': '操作系统拒绝写入设置文件。请以管理员身份重启 DSH，或修复 settings.json 的 ACL（允许当前用户写入）。',
      'overlay.title': 'DSH MCP 网关已启用',
      'overlay.intro': '其他 AI 客户端可以通过下面的 MCP 地址访问本机的 DSH 会话。确认后可在 设置 → DSH MCP 网关 中调整全部权限。',
      'overlay.riskTitle': '使用前请注意',
      'overlay.riskBody': '默认只开放 5 项基础能力，并采用“审批（仅勾选项）”：每次 MCP 调用都通过 Windows MessageBox 请求审批。已有会话会按自己的 DSH 权限预设执行工具。',
      'overlay.defaultsTitle': '默认权限摘要',
      'overlay.defaultsBasic': '基础 5 项：列出会话、读取会话、发送消息、等待完成、ask_dsh。',
      'overlay.defaultsExtended': '常规/进阶能力默认关闭；审批模式为“审批（仅勾选项）”。',
      'overlay.endpoint': 'MCP 地址',
      'overlay.token': '访问 Token',
      'overlay.save': '确认并启用',
      'overlay.later': '稍后配置',
      'overlay.ackFailed': '确认失败：{message}',
      'overlay.shownFailed': '记录欢迎页状态失败：{message}',
      // v2: tabs, native menus, capabilities, usage, approvals.
      'tab.settings': '设置',
      'tab.usage': '使用方法',
      'common.selected': '已选择 {count} 项',
      'common.refresh': '刷新',
      'common.selectAll': '全选',
      'common.clearAll': '清空',
      'common.expand': '展开',
      'common.collapse': '收起',
      'common.unknown': '未知',
      'common.reload': '重新加载',
      'aria.save': '保存设置',
      'aria.confirm': '确认',
      'aria.cancel': '取消',
      'aria.allow': '允许本次 MCP 调用',
      'aria.deny': '拒绝本次 MCP 调用',
      'aria.reset': '恢复默认设置',
      'aria.confirmReset': '确认恢复默认设置',
      'aria.cancelReset': '取消恢复默认',
      'aria.enableOpen': '确认开启完全开放',
      'aria.cancelOpen': '取消开启完全开放',
      'aria.close': '关闭',
      'aria.refresh': '刷新列表',
      'aria.selectAll': '全选本级',
      'aria.clearAll': '取消全选',
      'aria.copy': '复制',
      'aria.copyJson': '复制 MCP 客户端 JSON',
      'aria.copyPrompt': '复制标准提示词',
      'aria.showToken': '显示 Token',
      'aria.hideToken': '隐藏 Token',
      'aria.rotateToken': '轮换 Token',
      'aria.showWelcome': '重新显示欢迎页',
      'aria.expand': '展开字段配置',
      'aria.collapse': '收起字段配置',
      'status.capabilityCount': '已勾选能力 {count} 项',
      'status.visibleToolCount': '对外暴露工具 {count} 个',
      'status.pendingApprovals': '待审批 {count} 个',
      'status.hiddenTools': '未暴露工具 {count} 个',
      'status.mode': '审批模式：{mode}',
      'approval.title': '鉴权与审批',
      'approval.description': '决定哪些能力可用，以及哪些 MCP 调用需要 Windows MessageBox 审批；“仅勾选项”会隐藏未勾选工具，其它模式仍显示但按模式审批或放行。',
      'approval.modeLabel': '审批模式',
      'approval.current': '当前',
      'approval.checkedSummary': '能力勾选：{checked}/{total}',
      'approval.openWarningTitle': '高风险：完全开放',
      'approval.openWarningBody': '完全开放会让所有 MCP 调用直接执行，不再逐次审批，并且无视能力勾选名单。只应对你完全信任的 Agent 使用。',
      'approval.openConfirmTitle': '再次确认：完全开放',
      'approval.openConfirmBody': '开启后，外部 Agent 可以在没有逐次审批的情况下执行所有已暴露操作。确认继续？',
      'approval.openConfirmButton': '确认开启',
      'approval.aclHint': '设置文件写入由操作系统文件权限控制；无写权限时会先显示 Windows 原生信任对话框（含修改摘要），允许后请求 UAC 管理员授权，批准后写入，拒绝/取消才失败。',
      'approval.approvalHint': '审批通过 Windows MessageBox 弹出；DSH 窗口内不显示审批卡片。长时间不处理会按审批超时失败关闭。',
      'approval.approvalHintNoPopup': '系统 MessageBox 审批已关闭；当前没有审批入口，需要审批的调用会超时失败。',
      'capabilities.title': '能力',
      'capabilities.description': '按三级勾选允许 MCP 客户端使用的能力。默认只勾选基础 5 项。',
      'capabilities.selectAllLevel': '全选本级',
      'capabilities.clearLevel': '取消本级',
      'capabilities.levelCount': '{checked}/{total}',
      'capabilities.advancedHint': '进阶能力可以调整 DSH 设置、管理插件与凭据，请确认你信任当前 MCP 客户端。',
      'scope.visualTitle': '可视化范围',
      'scope.sessionModeLabel': '会话范围',
      'scope.modelModeLabel': '模型范围',
      'scope.allOption': '全部',
      'scope.allowlistOption': '仅勾选项',
      'scope.exceptOption': '除勾选项外',
      'scope.noneOption': '全部禁用',
      'scope.sessionsTitle': '选择会话',
      'scope.modelsTitle': '选择模型',
      'scope.selectAll': '全选',
      'scope.clearAll': '清空',
      'scope.refresh': '刷新',
      'scope.selectedCount': '已选 {count} 个',
      'scope.noSessions': '当前没有可展示的会话。',
      'scope.noModels': '当前没有可展示的模型。',
      'scope.running': '运行中',
      'scope.blank': '空会话',
      'scope.searchSessions': '筛选会话',
      'scope.emptySelectionHint': '未勾选任何项；allowlist 模式下这些目标会被拒绝。',
      'scope.selectedExcludedCount': '已选 {count} 个排除项',
      'scope.exceptSelectionHint': '未勾选任何排除项；除模式将允许全部。',
      'scope.exceptHintSessions': '勾选要排除的会话；未勾选项仍可用。',
      'scope.exceptHintModels': '勾选要排除的模型；未勾选项仍可用。',
      'scope.noneSessionWarning': '会话范围已禁用：MCP 将无法访问任何会话。',
      'scope.noneModelWarning': '模型范围已禁用：MCP 将无法使用任何模型。',
      'scope.useCurrentCwd': '使用当前会话 cwd',
      'scope.fieldsTitle': '字段配置（高级）',
      'scope.fieldsHint': '保留原始文本字段，与上方可视化选择双向同步；保存时以当前表单为准。',
      'scope.fieldsShow': '展开字段配置',
      'scope.fieldsHide': '收起字段配置',
      'scope.includeSubagents': '包含子代理会话',
      'scope.sessionIds': '会话 ID 列表',
      'scope.allowedModels': '允许的模型',
      'limits.approvalTimeoutMs': '审批超时（毫秒）',
      'usage.title': '使用方法',
      'usage.intro': '安装并确认后，其它 Agent 通过 MCP 访问本机 DSH。下面是推荐接入方式与可直接复制的材料。',
      'usage.flowTitle': '调用流程',
      'usage.flow.agent': '其它 Agent',
      'usage.flow.endpoint': 'MCP URL + Token',
      'usage.flow.dsh': 'DSH 会话 / 模型',
      'usage.flow.answer': '回答 / 结果',
      'usage.stepsTitle': '四步开始',
      'usage.step1.title': '1. 复制 MCP 配置',
      'usage.step1.body': '在“设置”页复制 MCP 客户端配置（含当前地址/端口与 Token）；也可以只复制地址和 Token。复制配置是推荐步骤，不是多余操作。',
      'usage.step2.title': '2. 确认权限',
      'usage.step2.body': '按需勾选能力并选择审批模式；勾选项在四种模式下分别表示允许、直接放行、需要审批或仅展示。',
      'usage.step3.title': '3. 把提示词和配置交给 Agent',
      'usage.step3.body': '把下方标准提示词发给 Agent，并提供 MCP 配置或 Token；提示词含动态地址/端口/设置文件路径，但不含真实 Token，Agent 需要时会向用户询问。',
      'usage.step4.title': '4. 处理审批',
      'usage.step4.body': '需要审批时，Windows 会弹出 MessageBox；DSH 窗口内不再显示审批卡片。允许/拒绝后 Agent 继续或失败。',
      'usage.step4.bodyNoPopup': '系统 MessageBox 审批已关闭；当前没有审批入口，需要审批的调用会超时失败。',
      'usage.notesTitle': '注意事项',
      'usage.note1': 'DSH 必须保持运行，MCP 端点才会可用。',
      'usage.note2': '审批只在 Windows MessageBox 中处理；长时间无人处理会按审批超时失败关闭。',
      'usage.note2NoPopup': '系统 MessageBox 审批已关闭；当前没有审批入口，需要审批的调用会超时失败。',
      'usage.note3': '审批（仅勾选项）：仅勾选能力可用，每次调用都要审批；审批（勾选项除外）：勾选能力直接放行，未勾选能力每次调用审批。',
      'usage.note4': '均需审批：全部能力可用，但每次调用都要审批（名单仅展示）；完全开放：全部直接放行并忽略名单，只对可信 Agent 使用。',
      'usage.note5': '当前仅支持 Streamable HTTP MCP，不支持 stdio；推荐复制 MCP 配置给 Agent，也可只提供地址 + Token。',
      'usage.note6': 'Token 只通过配置或单独消息提供给 Agent，不要写进提示词、公开日志或消息；Agent 需要时向用户询问。',
      'usage.note7': '已有会话按它自己的 DSH 权限预设执行工具；外部 Agent 发消息仍可能触发文件/命令操作。',
      'usage.note8': '长任务超时后，用 cursor.lastSeq 继续 wait_for_completion，不会丢任务。',
      'usage.clientTitle': 'MCP 客户端配置（推荐）',
      'usage.clientHint': '含当前地址/端口与 Token，直接复制给 Agent；端口或路径变化后会自动重新生成。',
      'usage.askTitle': 'ask_dsh 接口',
      'usage.askHint': '一次调用完成“发送消息 + 等待回答”，适合一问一答，像调用子智能体。',
      'usage.askExampleTitle': '调用示例',
      'usage.promptTitle': '标准提示词',
      'usage.promptHint': '自动使用当前地址、端口和设置文件路径；不含真实 Token，Agent 需要时会向用户询问。',
      'usage.endpointLabel': 'MCP 地址',
      'usage.copy': '复制',
      'usage.copied': '已复制',
      'approvals.title': '待审批的 MCP 调用',
      'approvals.capability': '能力',
      'approvals.tool': '工具',
      'approvals.session': '会话',
      'approvals.summary': '参数',
      'approvals.remaining': '剩余 {seconds} 秒',
      'approvals.expired': '已过期',
      'approvals.allow': '允许',
      'approvals.deny': '拒绝',
      'approvals.failed': '审批操作失败：{message}',
      'approvals.unknownCapability': '未知能力',
      'approvals.unknownSession': '未指定会话',
      'approvals.more': '还有 {count} 个待审批调用',
      'overlay.defaultsBasicV2': '默认已勾选 5 项基础能力：列出会话、读取会话、发送消息、等待完成、问答接口 ask_dsh。',
      'overlay.defaultsExtendedV2': '常规/进阶能力默认关闭；审批模式为“审批（仅勾选项）”。',
      'overlay.modeTitle': '默认审批模式',
      'overlay.modeBody': '只有勾选能力可用，每次调用都需要 Windows MessageBox 审批。',
      'overlay.approvalTitle': '审批通过 Windows MessageBox',
      'overlay.approvalBody': '有 MCP 调用等待审批时，Windows 会弹出 MessageBox；DSH 窗口内不再显示审批卡片。',
      'overlay.askTitle': 'ask_dsh 问答接口',
      'overlay.askBody': '其它 Agent 可以用 ask_dsh 一次调用完成“发送并返回回答”。',
      'overlay.confirmAria': '确认并启用 MCP 网关',
    };

    const EN = {
      nav: 'MCP Gateway',
      'plugins.summary': 'Configure approvals, capabilities, scopes and usage for the DSH MCP gateway.',
      'common.loading': 'Loading…',
      'common.retry': 'Retry',
      'common.copied': 'Copied',
      'common.copy': 'Copy',
      'common.copyUrl': 'Copy URL',
      'common.show': 'Show',
      'common.hide': 'Hide',
      'common.cancel': 'Cancel',
      'common.confirm': 'Confirm',
      'common.unsaved': 'Unsaved changes',
      'common.upToDate': 'In sync with the server',
      'common.empty': '(not set)',
      'common.copyFailed': 'Copy failed; select the text and copy it manually.',
      'status.title': 'Service status',
      'status.description': 'Connection details and tools exposed by the MCP gateway.',
      'status.enabled': 'Enable MCP service',
      'status.enabledHint': 'When disabled, other AI clients cannot connect to this gateway.',
      'status.mcpUrl': 'MCP endpoint',
      'status.token': 'Access token',
      'status.tokenHint': 'Configure it as Authorization: Bearer <token> in your MCP client.',
      'status.rotate': 'Rotate token',
      'status.rotateConfirm': 'Rotate the token? Every configured client stops working immediately.',
      'status.rotateConfirmButton': 'Rotate now',
      'status.copyJson': 'Copy MCP client JSON',
      'status.copyJsonHint': 'Contains the url and Authorization header; paste it into your mcpServers config.',
      'status.running': 'Running',
      'status.pending': 'Pending',
      'status.stopped': 'Stopped',
      'status.permissionCount': '{count} permissions enabled',
      'status.warnings': 'Service warnings',
      'banner.title': 'Welcome screen not confirmed',
      'banner.body': 'Only the five basic capabilities are checked, with "Approval (checked only)" as the default. Confirm the capabilities and mode, or adjust them in Settings.',
      'banner.action': 'Show welcome screen again',
      'banner.reset': 'Welcome screen state cleared; it will show again.',
      'banner.failed': 'Could not reset the welcome screen',
      'permissions.title': 'Permissions',
      'permissions.description': 'Choose which DSH capabilities the MCP client may use.',
      'permissions.basic': 'Basic permissions (on by default)',
      'permissions.extended': 'Extended permissions (off by default)',
      'permissions.fullAccess': 'Full access',
      'permissions.fullAccessHint': 'When on, the MCP client can use every tool and create full-access sessions; DSH approval prompts are still not auto-approved.',
      'permissions.fullAccessWarningTitle': 'High-risk setting',
      'permissions.fullAccessWarning': 'Full access lets the MCP client run tools directly with each session permissions. Enable it only for clients you fully trust.',
      'permissions.confirmFullAccess': 'Confirm full access',
      'permission.listSessions': 'List sessions',
      'permission.readSessions': 'Read sessions',
      'permission.sendMessages': 'Send messages',
      'permission.waitForCompletion': 'Wait for completion',
      'permission.listModels': 'List models',
      'permission.createSessions': 'Create sessions',
      'permission.selectModel': 'Select model',
      'permission.setPermission': 'Set session permission',
      'permission.cancelTurns': 'Cancel turns',
      'permission.forkSessions': 'Fork sessions',
      'permission.renameSessions': 'Rename sessions',
      'scope.title': 'Scope',
      'scope.description': 'Limit the sessions, models, and directories visible to the MCP client.',
      'scope.sessionMode': 'Session scope',
      'scope.sessionModeAll': 'All sessions',
      'scope.sessionModeAllowlist': 'Only listed sessions',
      'scope.sessionModeExcept': 'All sessions except checked',
      'scope.sessionModeNone': 'Disable all sessions',
      'scope.sessionIds': 'Session IDs',
      'scope.sessionIdsHint': 'One ID per line; "checked only" is an allowlist and "except checked" is an exclusion list.',
      'scope.sessionIdsPlaceholder': 'e.g.\n3f2a…\n9c1b…',
      'scope.includeSubagents': 'Include subagent sessions',
      'scope.includeSubagentsHint': 'Allow access to sessions created by subagents.',
      'scope.modelMode': 'Model scope',
      'scope.modelModeAll': 'All models',
      'scope.modelModeAllowlist': 'Only listed models',
      'scope.modelModeExcept': 'All models except checked',
      'scope.modelModeNone': 'Disable all models',
      'scope.allowedModels': 'Allowed models',
      'scope.allowedModelsHint': 'One provider/model per line; "checked only" is an allowlist and "except checked" is an exclusion list.',
      'scope.allowedModelsPlaceholder': 'e.g. deepseek-account/deepseek-flash',
      'scope.allowedRoots': 'Allowed roots',
      'scope.allowedRootsHint': 'One absolute path per line; leave empty for no extra restriction.',
      'scope.allowedRootsPlaceholder': 'e.g. E:\\projects\\demo',
      'scope.defaultCwd': 'Default working directory',
      'scope.defaultCwdHint': 'Used for new sessions; empty follows the DSH default.',
      'scope.defaultModel': 'Default model',
      'scope.defaultModelHint': 'Used for new sessions; empty follows the current DSH selection.',
      'scope.defaultModelEmpty': 'Follow current setting',
      'scope.newSessionPreset': 'New-session permission preset',
      'scope.newSessionPresetHint': 'Options come from the DSH permissionPresets catalog.',
      'limits.title': 'Limits',
      'limits.description': 'Control payload sizes and wait times per call; negative values (default -1) mean unlimited.',
      'limits.maxReadMessages': 'Max messages per read',
      'limits.maxReadChars': 'Max characters per read',
      'limits.maxMessageChars': 'Max characters per message',
      'limits.defaultWaitMs': 'Default wait (ms)',
      'limits.maxWaitMs': 'Max wait (ms)',
      'limits.sendWhenBusy': 'When the session is busy',
      'limits.sendWhenBusy.queue': 'Queue the message',
      'limits.sendWhenBusy.reject': 'Reject the send',
      'limits.invalidNumber': 'Enter a positive whole number, or a negative value (such as -1) for unlimited; 0 is invalid.',
      'limits.invalidFields': 'Check these numeric fields: {fields}',
      'actions.save': 'Save settings',
      'actions.saving': 'Saving…',
      'actions.reset': 'Restore defaults',
      'actions.resetHint': 'Restore the approval mode, capabilities, scope and limits to their defaults. The token and service switch are kept.',
      'actions.resetConfirmButton': 'Confirm restore',
      'saved.done': 'Settings saved.',
      'saved.conflict': 'Settings were updated elsewhere; please retry.',
      'saved.noChanges': 'There is nothing to save.',
      saveFailed: 'Save failed',
      rotateDone: 'Token rotated; update your MCP client configuration.',
      rotateFailed: 'Token rotation failed',
      restoreDone: 'Defaults restored.',
      restoreFailed: 'Could not restore defaults',
      loadErrorTitle: 'MCP service not connected',
      loadErrorHint: 'Could not read the gateway state. Make sure the plugin is enabled and the service is running, then retry.',
      'error.timeout': 'The request timed out; please retry.',
      'error.network': 'Network request failed: {message}',
      'error.invalidResponse': 'The service returned unreadable data.',
      'error.http': 'The service returned an error (HTTP {status}).',
      'error.httpWithStatus': 'HTTP {status}: {message}',
      'error.unknown': 'Unknown error; please retry.',
      'error.settingsWriteDenied': 'The operating system denied the settings-file write: {path}. Restart DSH as administrator, or fix the settings.json ACL so the current user can write it.',
      'error.settingsWriteDeniedNoPath': 'The operating system denied the settings-file write. Restart DSH as administrator, or fix the settings.json ACL so the current user can write it.',
      'overlay.title': 'DSH MCP gateway is enabled',
      'overlay.intro': 'Other AI clients can reach the local DSH sessions through the MCP endpoint below. After confirming, adjust every permission in Settings -> DSH MCP Gateway.',
      'overlay.riskTitle': 'Before you continue',
      'overlay.riskBody': 'Only the five basic capabilities are available, with "Approval (checked only)": every MCP call needs a Windows MessageBox approval. Existing sessions run tools under their own DSH permission preset.',
      'overlay.defaultsTitle': 'Default permission summary',
      'overlay.defaultsBasic': 'Five basic capabilities: list, read, send, wait, ask_dsh.',
      'overlay.defaultsExtended': 'Regular/advanced capabilities are off; approval mode is "Approval (checked only)".',
      'overlay.endpoint': 'MCP endpoint',
      'overlay.token': 'Access token',
      'overlay.save': 'Confirm and enable',
      'overlay.later': 'Configure later',
      'overlay.ackFailed': 'Could not confirm: {message}',
      'overlay.shownFailed': 'Could not record the welcome state: {message}',
      // v2: tabs, native menus, capabilities, usage, approvals.
      'tab.settings': 'Settings',
      'tab.usage': 'How to use',
      'common.selected': '{count} selected',
      'common.refresh': 'Refresh',
      'common.selectAll': 'Select all',
      'common.clearAll': 'Clear',
      'common.expand': 'Expand',
      'common.collapse': 'Collapse',
      'common.unknown': 'Unknown',
      'common.reload': 'Reload',
      'aria.save': 'Save settings',
      'aria.confirm': 'Confirm',
      'aria.cancel': 'Cancel',
      'aria.allow': 'Allow this MCP call',
      'aria.deny': 'Deny this MCP call',
      'aria.reset': 'Restore default settings',
      'aria.confirmReset': 'Confirm restoring defaults',
      'aria.cancelReset': 'Cancel restoring defaults',
      'aria.enableOpen': 'Confirm enabling open mode',
      'aria.cancelOpen': 'Cancel enabling open mode',
      'aria.close': 'Close',
      'aria.refresh': 'Refresh the list',
      'aria.selectAll': 'Select all in this level',
      'aria.clearAll': 'Clear this level',
      'aria.copy': 'Copy',
      'aria.copyJson': 'Copy MCP client JSON',
      'aria.copyPrompt': 'Copy the standard prompt',
      'aria.showToken': 'Show token',
      'aria.hideToken': 'Hide token',
      'aria.rotateToken': 'Rotate token',
      'aria.showWelcome': 'Show the welcome dialog again',
      'aria.expand': 'Expand the field configuration',
      'aria.collapse': 'Collapse the field configuration',
      'status.capabilityCount': '{count} capabilities checked',
      'status.visibleToolCount': '{count} tools exposed',
      'status.pendingApprovals': '{count} pending approvals',
      'status.hiddenTools': '{count} tools hidden',
      'status.mode': 'Approval mode: {mode}',
      'approval.title': 'Authorization and approvals',
      'approval.description': 'Choose which capabilities are available and which MCP calls need a Windows MessageBox approval; only-checked hides unchecked tools, while the other modes keep them visible and approve or bypass per mode.',
      'approval.modeLabel': 'Approval mode',
      'approval.current': 'Current',
      'approval.checkedSummary': 'Capabilities checked: {checked}/{total}',
      'approval.openWarningTitle': 'High risk: open mode',
      'approval.openWarningBody': 'Open mode runs every MCP call immediately without per-call approval and ignores the checked list. Use it only with agents you fully trust.',
      'approval.openConfirmTitle': 'Confirm once more: open mode',
      'approval.openConfirmBody': 'External agents will be able to run every exposed operation without per-call approval. Continue?',
      'approval.openConfirmButton': 'Enable open mode',
      'approval.aclHint': 'Settings writes use operating-system file permissions; if write access is denied, a native Windows trust dialog with the pending changes appears first. Allowing it requests a UAC administrator token (the UAC policy decides whether a prompt is shown or elevation is silent); denying it fails the save.',
      'approval.approvalHint': 'Approvals are requested through a Windows MessageBox; the DSH window no longer shows an approval card. Unanswered calls fail closed after the approval timeout.',
      'approval.approvalHintNoPopup': 'The system MessageBox approval channel is disabled; there is no approval UI and calls that need approval time out.',
      'capabilities.title': 'Capabilities',
      'capabilities.description': 'Check the capabilities MCP clients may use, grouped into three levels. Only the five basic capabilities are checked by default.',
      'capabilities.selectAllLevel': 'Select this level',
      'capabilities.clearLevel': 'Clear this level',
      'capabilities.levelCount': '{checked}/{total}',
      'capabilities.advancedHint': 'Advanced capabilities can change DSH settings and manage plugins and credentials. Make sure you trust the connected MCP client.',
      'scope.visualTitle': 'Visual scope',
      'scope.sessionModeLabel': 'Session scope',
      'scope.modelModeLabel': 'Model scope',
      'scope.allOption': 'All',
      'scope.allowlistOption': 'Checked only',
      'scope.exceptOption': 'Except checked',
      'scope.noneOption': 'Disabled',
      'scope.sessionsTitle': 'Choose sessions',
      'scope.modelsTitle': 'Choose models',
      'scope.selectAll': 'Select all',
      'scope.clearAll': 'Clear',
      'scope.refresh': 'Refresh',
      'scope.selectedCount': '{count} selected',
      'scope.noSessions': 'No sessions are available to show.',
      'scope.noModels': 'No models are available to show.',
      'scope.running': 'Running',
      'scope.blank': 'Blank',
      'scope.searchSessions': 'Filter sessions',
      'scope.emptySelectionHint': 'Nothing is checked; allowlist mode will reject these targets.',
      'scope.selectedExcludedCount': '{count} excluded',
      'scope.exceptSelectionHint': 'No exclusions checked; except mode allows everything.',
      'scope.exceptHintSessions': 'Check the sessions to exclude; unchecked sessions remain available.',
      'scope.exceptHintModels': 'Check the models to exclude; unchecked models remain available.',
      'scope.noneSessionWarning': 'Session scope is disabled: MCP cannot access any session.',
      'scope.noneModelWarning': 'Model scope is disabled: MCP cannot use any model.',
      'scope.useCurrentCwd': 'Use the current session cwd',
      'scope.fieldsTitle': 'Field configuration (advanced)',
      'scope.fieldsHint': 'Raw text fields are kept and stay in sync with the visual pickers above; saving uses the current form.',
      'scope.fieldsShow': 'Show field configuration',
      'scope.fieldsHide': 'Hide field configuration',
      'scope.includeSubagents': 'Include subagent sessions',
      'scope.sessionIds': 'Session ID list',
      'scope.allowedModels': 'Allowed models',
      'limits.approvalTimeoutMs': 'Approval timeout (ms)',
      'usage.title': 'How to use',
      'usage.intro': 'After installing and confirming, other agents reach this DSH instance over MCP. Below are the recommended setup and ready-to-copy material.',
      'usage.flowTitle': 'Call flow',
      'usage.flow.agent': 'Other agent',
      'usage.flow.endpoint': 'MCP URL + token',
      'usage.flow.dsh': 'DSH session / model',
      'usage.flow.answer': 'Answer / result',
      'usage.stepsTitle': 'Four steps',
      'usage.step1.title': '1. Copy the MCP config',
      'usage.step1.body': 'Copy the MCP client config from Settings (current endpoint/port and token); you can also copy just the endpoint and token. Copying the config is recommended and is not redundant.',
      'usage.step2.title': '2. Confirm permissions',
      'usage.step2.body': 'Check the capabilities you need and choose an approval mode; checked items mean allowed, bypassed, approval required, or display-only depending on the mode.',
      'usage.step3.title': '3. Give the prompt and config to the agent',
      'usage.step3.body': 'Send the standard prompt below and provide the MCP config or token. The prompt contains dynamic endpoint/port/settings-path values but no real token; the agent asks you for the token when needed.',
      'usage.step4.title': '4. Handle approvals',
      'usage.step4.body': 'When a call needs approval, Windows shows a MessageBox; the DSH window no longer displays an approval card. Allow or deny and the agent continues or fails.',
      'usage.step4.bodyNoPopup': 'The system MessageBox approval channel is disabled; there is no approval UI and calls that need approval time out.',
      'usage.notesTitle': 'Notes',
      'usage.note1': 'DSH must stay running for the MCP endpoint to be available.',
      'usage.note2': 'Approvals happen only in the Windows MessageBox; unanswered calls fail closed after the approval timeout.',
      'usage.note2NoPopup': 'The system MessageBox approval channel is disabled; there is no approval UI and calls that need approval time out.',
      'usage.note3': 'Approval (checked only): only checked capabilities are available and every call needs approval. Approval (except checked): checked capabilities run directly, unchecked ones need approval each time.',
      'usage.note4': 'Approve everything: all capabilities are available but every call needs approval (the list is display-only). Open: everything runs directly and the list is ignored; use only with trusted agents.',
      'usage.note5': 'Only Streamable HTTP MCP is supported; stdio is not provided. Copying the MCP config to the agent is recommended, but endpoint + token also works.',
      'usage.note6': 'Provide the token through the config or a separate message; never put it in a prompt, public log or message. The agent asks the user for it when needed.',
      'usage.note7': 'Existing sessions run tools under their own DSH permission preset; messages from external agents can still perform file or command operations.',
      'usage.note8': 'After a long task times out, continue wait_for_completion with cursor.lastSeq; the task is not cancelled.',
      'usage.clientTitle': 'MCP client config (recommended)',
      'usage.clientHint': 'Contains the current endpoint/port and token, ready to copy to the agent; regenerated automatically when the port or path changes.',
      'usage.askTitle': 'ask_dsh interface',
      'usage.askHint': 'One call that sends a message and returns the answer, suitable for one-shot questions like a subagent.',
      'usage.askExampleTitle': 'Call example',
      'usage.promptTitle': 'Standard prompt',
      'usage.promptHint': 'Uses the current endpoint, port and settings-file path automatically; it does not contain the real token, and the agent asks the user for the token when needed.',
      'usage.endpointLabel': 'MCP endpoint',
      'usage.copy': 'Copy',
      'usage.copied': 'Copied',
      'approvals.title': 'Pending MCP calls',
      'approvals.capability': 'Capability',
      'approvals.tool': 'Tool',
      'approvals.session': 'Session',
      'approvals.summary': 'Arguments',
      'approvals.remaining': '{seconds}s left',
      'approvals.expired': 'Expired',
      'approvals.allow': 'Allow',
      'approvals.deny': 'Deny',
      'approvals.failed': 'Approval action failed: {message}',
      'approvals.unknownCapability': 'Unknown capability',
      'approvals.unknownSession': 'No session',
      'approvals.more': '{count} more pending approval(s)',
      'overlay.defaultsBasicV2': 'Five basic capabilities are checked by default: list sessions, read sessions, send messages, wait, and the ask_dsh interface.',
      'overlay.defaultsExtendedV2': 'Regular and advanced capabilities are off by default; the approval mode is "Approval (checked only)".',
      'overlay.modeTitle': 'Default approval mode',
      'overlay.modeBody': 'Only checked capabilities are available, and every call needs a Windows MessageBox approval.',
      'overlay.approvalTitle': 'Approvals use a Windows MessageBox',
      'overlay.approvalBody': 'When an MCP call waits for approval, Windows shows a MessageBox; the DSH window no longer shows an approval card.',
      'overlay.askTitle': 'ask_dsh interface',
      'overlay.askBody': 'Other agents can call ask_dsh to send one message and get the answer in one call.',
      'overlay.confirmAria': 'Confirm and enable the MCP gateway',
    };

    /** Return 'zh' for Chinese browser/DSH locales, otherwise 'en'. */
    function normalizeLanguage(value) {
      const tag = typeof value === 'string' ? value.toLowerCase() : '';
      return tag.indexOf('zh') === 0 ? 'zh' : 'en';
    }

    /** Read the active language, preferring the optional DSH locale service. */
    function readLanguage(localeService) {
      try {
        const snapshot = localeService && typeof localeService.getSnapshot === 'function'
          ? localeService.getSnapshot()
          : null;
        if (snapshot && typeof snapshot.active === 'string' && snapshot.active) {
          return normalizeLanguage(snapshot.active);
        }
      } catch (error) {
        /* fall through to the browser language */
      }
      try {
        if (typeof navigator !== 'undefined' && typeof navigator.language === 'string') {
          return normalizeLanguage(navigator.language);
        }
      } catch (error) {
        /* ignore */
      }
      return 'en';
    }

    /** Build a `t(key, vars)` lookup for one language. */
    function createTranslator(language) {
      const dictionary = language === 'zh' ? ZH : EN;
      return function translate(key, vars) {
        let template = typeof dictionary[key] === 'string' ? dictionary[key] : EN[key];
        if (typeof template !== 'string') template = typeof key === 'string' ? key : '';
        if (vars === undefined || vars === null) return template;
        return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => (
          Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
        ));
      };
    }

    // ------------------------------------------------------------------ styles
    // One <style> element with every selector prefixed by `dshmcp-`. Falls back
    // to hard-coded light/dark colors when the DSH variables are unavailable.
    const STYLE_TEXT = `\
.dshmcp-root{--dshmcp-fg:var(--dsw-alias-label-primary,light-dark(#0f1115,#f9fafb));--dshmcp-muted:var(--dsw-alias-label-secondary,light-dark(#5f646b,#cfd3d6));--dshmcp-faint:var(--dsw-alias-label-tertiary,light-dark(#7c8188,#aab0b6));--dshmcp-border:var(--dsw-alias-border-l2,light-dark(#0000001a,#ffffff1f));--dshmcp-border-strong:var(--dsw-alias-border-l3,light-dark(#0000001f,#ffffff29));--dshmcp-surface:var(--dsw-alias-bg-module-platform,light-dark(#f7f8fa,#343638));--dshmcp-menu:var(--dsw-specific-menu,light-dark(#ffffff,#2b2d2f));--dshmcp-hover:var(--dsw-alias-interactive-bg-hover,light-dark(#2631480f,#ffffff14));--dshmcp-accent:var(--dsw-alias-brand-primary,light-dark(#0f1115,#f9fafb));--dshmcp-on-accent:var(--dsw-alias-label-primary-foreground,light-dark(#ffffff,#0f1115));--dshmcp-danger:var(--dsw-alias-state-error-primary,light-dark(#d92d20,#f97066));--dshmcp-ok:var(--dsw-alias-state-success-primary,light-dark(#067647,#47cd89));--dshmcp-warn:var(--dsw-alias-state-warning-primary,light-dark(#b54708,#fdb022));--dshmcp-radius:var(--dsw-radius-md,10px);color:var(--dshmcp-fg);font-size:13px;line-height:20px;text-align:left}
.dshmcp-root *{box-sizing:border-box}
.dshmcp-root :where(button,input,select,textarea){font:inherit;color:inherit}
.dshmcp-root button{cursor:pointer}
.dshmcp-root button:disabled{cursor:not-allowed;opacity:.55}
.dshmcp-root button:focus-visible,.dshmcp-root input:focus-visible,.dshmcp-root select:focus-visible,.dshmcp-root textarea:focus-visible{outline:2px solid var(--dshmcp-accent);outline-offset:2px}
.dshmcp-settings{display:flex;flex-direction:column;gap:14px;width:100%;max-width:none;overflow-y:auto}
.dshmcp-footer{display:flex;flex-direction:column;gap:10px}
.dshmcp-banner{display:flex;flex-direction:column;gap:6px;padding:12px 14px;border:.5px solid color-mix(in srgb,var(--dshmcp-warn) 45%,transparent);border-radius:var(--dshmcp-radius);background:color-mix(in srgb,var(--dshmcp-warn) 12%,transparent)}
.dshmcp-banner__title{font-size:13px;line-height:20px;font-weight:600}
.dshmcp-banner__body{margin:0;color:var(--dshmcp-muted);font-size:12px;line-height:18px}
.dshmcp-banner__actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:2px}
.dshmcp-card{display:flex;flex-direction:column;gap:14px;min-width:0;padding:16px;border:.5px solid var(--dshmcp-border);border-radius:var(--dshmcp-radius);background:var(--dshmcp-surface)}
.dshmcp-card__head{display:flex;flex-direction:column;gap:4px}
.dshmcp-card__title{margin:0;font-size:14px;line-height:22px;font-weight:600}
.dshmcp-card__desc{margin:0;color:var(--dshmcp-muted);font-size:12px;line-height:18px}
.dshmcp-card__body{display:flex;flex-direction:column;gap:14px;min-width:0}
.dshmcp-card__actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.dshmcp-row{display:flex;align-items:center;justify-content:space-between;gap:16px;min-width:0}
.dshmcp-row__text{display:flex;flex-direction:column;gap:3px;min-width:0}
.dshmcp-row__title{font-size:13px;line-height:20px}
.dshmcp-row__hint{margin:0;color:var(--dshmcp-muted);font-size:12px;line-height:18px}
.dshmcp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px 16px;min-width:0}
.dshmcp-field{display:flex;flex-direction:column;gap:5px;min-width:0}
.dshmcp-field__label{color:var(--dshmcp-muted);font-size:12px;line-height:18px}
.dshmcp-field__hint{margin:0;color:var(--dshmcp-faint);font-size:11px;line-height:16px;overflow-wrap:anywhere}
.dshmcp-field__hint--error{color:var(--dshmcp-danger)}
.dshmcp-input,.dshmcp-select,.dshmcp-textarea{width:100%;min-height:32px;padding:5px 9px;border:.5px solid var(--dshmcp-border-strong);border-radius:8px;background:var(--dshmcp-menu);color:var(--dshmcp-fg);font-size:13px;line-height:20px;outline:none}
.dshmcp-selectwrap{position:relative;min-width:0;width:100%}
.dshmcp-selecttrigger{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;min-height:32px;padding:5px 9px;border:.5px solid var(--dshmcp-border-strong);border-radius:8px;background:var(--dshmcp-menu);color:var(--dshmcp-fg);font-size:13px;line-height:20px;text-align:left}
.dshmcp-selecttrigger:hover:not(:disabled){background:var(--dshmcp-hover)}
.dshmcp-selecttrigger svg{flex:none;color:var(--dshmcp-muted)}
.dshmcp-selecttrigger__label{display:flex;align-items:center;gap:8px;flex:1;overflow:hidden;min-width:0}
.dshmcp-selecttrigger__text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.dshmcp-selecttrigger__icon{display:inline-flex;flex:none;align-items:center;justify-content:center;width:18px;height:18px;color:var(--dshmcp-muted)}
.dshmcp-selectmenu{position:fixed;z-index:1400;display:flex;flex-direction:column;gap:2px;padding:4px;max-height:260px;overflow-y:auto;box-shadow:0 12px 32px rgba(0,0,0,.2)}
.dshmcp-selectmenu .dshmcp-menu__row{min-height:36px;padding:6px 8px}
.dshmcp-input:focus,.dshmcp-select:focus,.dshmcp-textarea:focus{border-color:var(--dshmcp-accent)}
.dshmcp-input--mono,.dshmcp-textarea--mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
.dshmcp-input--num{max-width:160px}
.dshmcp-input--invalid{border-color:var(--dshmcp-danger)}
.dshmcp-input[readonly]{background:var(--dshmcp-surface);color:var(--dshmcp-muted)}
.dshmcp-textarea{min-height:64px;resize:vertical}
.dshmcp-valuerow{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0}
.dshmcp-valuerow .dshmcp-input{flex:1 1 220px;min-width:0}
.dshmcp-valuerow__actions{display:flex;flex-wrap:wrap;gap:6px}
.dshmcp-switch{position:relative;display:inline-flex;flex:none;width:38px;height:22px;padding:0;border:none;border-radius:999px;background:var(--dshmcp-border-strong);transition:background .15s ease}
.dshmcp-switch--on{background:var(--dshmcp-accent)}
.dshmcp-switch__thumb{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:var(--dshmcp-on-accent);transition:transform .15s ease}
.dshmcp-switch--on .dshmcp-switch__thumb{transform:translateX(16px)}
.dshmcp-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:30px;padding:4px 12px;border:.5px solid var(--dshmcp-border-strong);border-radius:8px;background:transparent;color:var(--dshmcp-fg);font-size:12px;line-height:18px;white-space:nowrap;transition:background .12s ease,border-color .12s ease,opacity .12s ease}
.dshmcp-btn svg{flex:none}
.dshmcp-btn:hover:not(:disabled){background:var(--dshmcp-hover)}
.dshmcp-btn--primary{border-color:transparent;background:var(--dshmcp-accent);color:var(--dshmcp-on-accent)}
.dshmcp-btn--primary:hover:not(:disabled){background:var(--dshmcp-accent);opacity:.9}
.dshmcp-btn--danger{border-color:var(--dshmcp-danger);background:transparent;color:var(--dshmcp-danger)}
.dshmcp-btn--danger:hover:not(:disabled){background:color-mix(in srgb,var(--dshmcp-danger) 12%,transparent)}
.dshmcp-btn--danger-solid{border-color:transparent;background:var(--dshmcp-danger);color:#fff}
.dshmcp-btn--danger-solid:hover:not(:disabled){opacity:.9}
.dshmcp-btn--ghost{border-color:transparent;background:transparent;color:var(--dshmcp-muted)}
.dshmcp-btn--ghost:hover:not(:disabled){background:var(--dshmcp-hover);color:var(--dshmcp-fg)}
.dshmcp-btn--sm{min-height:26px;padding:2px 9px;font-size:11px;line-height:16px}
.dshmcp-pill{display:inline-flex;align-items:center;gap:5px;align-self:flex-start;padding:0 8px;border:.5px solid var(--dshmcp-border-strong);border-radius:999px;color:var(--dshmcp-muted);font-size:11px;line-height:18px}
.dshmcp-pill--ok{color:var(--dshmcp-ok);border-color:color-mix(in srgb,var(--dshmcp-ok) 45%,transparent)}
.dshmcp-notice{padding:8px 12px;border:.5px solid var(--dshmcp-border-strong);border-radius:8px;background:var(--dshmcp-surface);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.dshmcp-notice--ok{border-color:color-mix(in srgb,var(--dshmcp-ok) 45%,transparent);background:color-mix(in srgb,var(--dshmcp-ok) 10%,transparent);color:var(--dshmcp-ok)}
.dshmcp-notice--warn{border-color:color-mix(in srgb,var(--dshmcp-warn) 45%,transparent);background:color-mix(in srgb,var(--dshmcp-warn) 10%,transparent);color:var(--dshmcp-fg)}
.dshmcp-notice--error{border-color:color-mix(in srgb,var(--dshmcp-danger) 45%,transparent);background:color-mix(in srgb,var(--dshmcp-danger) 10%,transparent);color:var(--dshmcp-fg)}
.dshmcp-errorcard{display:flex;flex-direction:column;gap:8px;padding:18px;border:.5px solid color-mix(in srgb,var(--dshmcp-danger) 45%,transparent);border-radius:var(--dshmcp-radius);background:color-mix(in srgb,var(--dshmcp-danger) 8%,transparent)}
.dshmcp-errorcard__title{font-size:14px;line-height:22px;font-weight:600}
.dshmcp-errorcard__message{margin:0;color:var(--dshmcp-muted);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.dshmcp-loading{padding:18px;color:var(--dshmcp-muted);font-size:13px}
.dshmcp-warnbox{display:flex;flex-direction:column;gap:4px;padding:8px 12px;border:.5px solid color-mix(in srgb,var(--dshmcp-warn) 45%,transparent);border-radius:8px;background:color-mix(in srgb,var(--dshmcp-warn) 10%,transparent);font-size:12px;line-height:18px}
.dshmcp-warnbox ul{margin:0;padding-left:18px}
.dshmcp-warnbox__title{font-size:12px;line-height:18px;font-weight:600;color:var(--dshmcp-fg)}
.dshmcp-warnbox__body{margin:0;color:var(--dshmcp-muted);font-size:12px;line-height:18px}
.dshmcp-perm-group{display:flex;flex-direction:column;gap:10px}
.dshmcp-perm-group__title{color:var(--dshmcp-muted);font-size:12px;line-height:18px;font-weight:600}
.dshmcp-perm-list{display:flex;flex-direction:column;gap:10px}
.dshmcp-risk{display:flex;flex-direction:column;gap:6px;padding:12px;border:.5px solid color-mix(in srgb,var(--dshmcp-danger) 45%,transparent);border-radius:8px;background:color-mix(in srgb,var(--dshmcp-danger) 8%,transparent)}
.dshmcp-risk-warn{border-color:color-mix(in srgb,var(--dshmcp-warn) 45%,transparent);background:color-mix(in srgb,var(--dshmcp-warn) 10%,transparent)}
.dshmcp-risk__title{font-size:13px;line-height:20px;font-weight:600}
.dshmcp-risk__body{margin:0;color:var(--dshmcp-muted);font-size:12px;line-height:18px}
.dshmcp-checklist{display:flex;flex-direction:column;gap:6px}
.dshmcp-checklist__title{font-size:13px;line-height:20px;font-weight:600}
.dshmcp-checklist ul{display:flex;flex-direction:column;gap:4px;margin:0;padding-left:18px;color:var(--dshmcp-muted);font-size:12px;line-height:18px}
.dshmcp-kv{display:flex;flex-direction:column;gap:10px}
.dshmcp-kv__row{display:flex;flex-direction:column;gap:4px}
.dshmcp-kv__key{color:var(--dshmcp-muted);font-size:12px;line-height:18px}
.dshmcp-actionsbar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;padding:4px 0 10px}
.dshmcp-actionsbar__status{color:var(--dshmcp-muted);font-size:12px;line-height:18px}
.dshmcp-actionsbar__status--dirty{color:var(--dshmcp-warn)}
.dshmcp-actions{display:flex;flex-wrap:wrap;gap:8px}
.dshmcp-overlay{position:fixed;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;padding:24px;overflow-y:auto;background:color-mix(in srgb,#000 45%,transparent)}
.dshmcp-modal{display:flex;flex-direction:column;gap:16px;width:100%;max-width:720px;max-height:calc(100vh - 48px);padding:24px;overflow-y:auto;border:.5px solid var(--dshmcp-border-strong);border-radius:16px;background:var(--dshmcp-menu);box-shadow:0 18px 60px rgba(0,0,0,.35)}
.dshmcp-modal__title{margin:0;font-size:18px;line-height:26px;font-weight:600}
.dshmcp-modal__subtitle{margin:0;color:var(--dshmcp-muted);font-size:13px;line-height:20px}
.dshmcp-modal__footer{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;padding-top:4px}
.dshmcp-modal__actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.dshmcp-modal .dshmcp-btn--primary{min-height:34px;padding:6px 16px;font-size:13px}
.dshmcp-copyok{color:var(--dshmcp-ok);font-size:12px}
.dshmcp-inline-icon{display:inline-flex;align-items:center}
.dshmcp-menu__row--partial .dshmcp-menu__check{opacity:1}
.dshmcp-tabs{display:flex;gap:4px;border-bottom:.5px solid var(--dshmcp-border);padding-bottom:2px}
.dshmcp-tab{border:none;background:transparent;color:var(--dshmcp-muted);border-radius:8px 8px 0 0;padding:6px 12px;font-size:13px;line-height:20px}
.dshmcp-tab:hover{background:var(--dshmcp-hover);color:var(--dshmcp-fg)}
.dshmcp-tab--active{color:var(--dshmcp-fg);font-weight:600;box-shadow:inset 0 -2px 0 var(--dshmcp-accent)}
.dshmcp-tabpane{display:flex;flex-direction:column;gap:14px;min-width:0}
.dshmcp-menu{display:flex;flex-direction:column;gap:2px;padding:5px;border:.5px solid var(--dshmcp-border);border-radius:12px;background:var(--dshmcp-menu)}
.dshmcp-menu__row{display:flex;align-items:flex-start;gap:10px;width:100%;min-height:40px;padding:8px 10px;border:none;border-radius:8px;background:transparent;color:var(--dshmcp-fg);text-align:left}
.dshmcp-menu__row:hover:not(:disabled){background:var(--dshmcp-hover)}
.dshmcp-menu__row--selected{background:color-mix(in srgb,var(--dshmcp-accent) 9%,transparent)}
.dshmcp-menu__row--danger{color:var(--dshmcp-danger)}
.dshmcp-menu__row--danger.dshmcp-menu__row--selected{background:color-mix(in srgb,var(--dshmcp-danger) 10%,transparent)}
.dshmcp-menu__icon{flex:none;display:inline-flex;width:18px;height:18px;margin-top:1px;color:var(--dshmcp-muted)}
.dshmcp-menu__row--selected .dshmcp-menu__icon{color:var(--dshmcp-fg)}
.dshmcp-menu__row--danger .dshmcp-menu__icon{color:var(--dshmcp-danger)}
.dshmcp-menu__text{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.dshmcp-menu__title{font-size:13px;line-height:20px}
.dshmcp-menu__desc{color:var(--dshmcp-muted);font-size:12px;line-height:18px}
.dshmcp-menu__check{flex:none;display:inline-flex;width:16px;height:16px;margin-top:3px;opacity:0;color:var(--dshmcp-fg)}
.dshmcp-menu__row--selected .dshmcp-menu__check{opacity:1}
.dshmcp-menu__row--danger .dshmcp-menu__check{color:var(--dshmcp-danger)}
.dshmcp-menu__row:disabled{opacity:.55;cursor:not-allowed}
.dshmcp-menu__divider{height:.5px;background:var(--dshmcp-border);margin:4px 8px}
.dshmcp-level{display:flex;flex-direction:column;gap:8px;padding:10px;border:.5px solid var(--dshmcp-border);border-radius:12px;background:var(--dshmcp-surface)}
.dshmcp-level__head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 4px}
.dshmcp-level__title{font-size:13px;line-height:20px;font-weight:600}
.dshmcp-level__desc{margin:0;color:var(--dshmcp-muted);font-size:12px;line-height:18px;padding:0 4px}
.dshmcp-level__count{color:var(--dshmcp-faint);font-size:11px;line-height:16px}
.dshmcp-picker{display:flex;flex-direction:column;gap:6px;max-height:300px;overflow-y:auto;padding:2px}
.dshmcp-picker__toolbar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;padding:2px 4px}
.dshmcp-picker__summary{color:var(--dshmcp-muted);font-size:12px;line-height:18px}
.dshmcp-picker__actions{display:flex;flex-wrap:wrap;gap:6px}
.dshmcp-picker__empty{padding:14px;color:var(--dshmcp-muted);font-size:12px;line-height:18px;text-align:center}
.dshmcp-picker__meta{color:var(--dshmcp-faint);font-size:11px;line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.dshmcp-picker__badge{display:inline-flex;padding:0 6px;border-radius:999px;font-size:10px;line-height:16px;border:.5px solid var(--dshmcp-border-strong);color:var(--dshmcp-muted)}
.dshmcp-picker__badge--running{color:var(--dshmcp-ok);border-color:color-mix(in srgb,var(--dshmcp-ok) 45%,transparent)}
.dshmcp-iconbtn{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;border:.5px solid var(--dshmcp-border-strong);border-radius:8px;background:transparent;color:var(--dshmcp-fg);flex:none}
.dshmcp-iconbtn:hover:not(:disabled){background:var(--dshmcp-hover)}
.dshmcp-iconbtn--primary{border-color:transparent;background:var(--dshmcp-accent);color:var(--dshmcp-on-accent)}
.dshmcp-iconbtn--primary:hover:not(:disabled){opacity:.9;background:var(--dshmcp-accent)}
.dshmcp-iconbtn--danger{border-color:color-mix(in srgb,var(--dshmcp-danger) 55%,transparent);color:var(--dshmcp-danger)}
.dshmcp-iconbtn--danger:hover:not(:disabled){background:color-mix(in srgb,var(--dshmcp-danger) 12%,transparent)}
.dshmcp-iconbtn--ghost{border-color:transparent;color:var(--dshmcp-muted)}
.dshmcp-iconbtn--ghost:hover:not(:disabled){color:var(--dshmcp-fg)}
.dshmcp-iconbtn--sm{width:26px;height:26px;border-radius:7px}
.dshmcp-iconbtn--lg{width:34px;height:34px}
.dshmcp-iconbtn svg{display:block;flex:none}
.dshmcp-savebar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;padding:10px 0;border-top:.5px solid var(--dshmcp-border)}
.dshmcp-savebar__status{color:var(--dshmcp-muted);font-size:12px;line-height:18px}
.dshmcp-savebar__status--dirty{color:var(--dshmcp-warn)}
.dshmcp-savebar__actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.dshmcp-collapse{display:flex;flex-direction:column;gap:10px;padding:12px;border:.5px dashed var(--dshmcp-border-strong);border-radius:10px;background:color-mix(in srgb,var(--dshmcp-surface) 65%,transparent)}
.dshmcp-collapse__head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.dshmcp-collapse__title{font-size:13px;line-height:20px;font-weight:600}
.dshmcp-collapse__body{display:flex;flex-direction:column;gap:12px}
.dshmcp-usage{display:flex;flex-direction:column;gap:16px;min-width:0}
.dshmcp-usage__hero{display:flex;flex-direction:column;gap:6px;padding:16px;border:.5px solid var(--dshmcp-border);border-radius:12px;background:var(--dshmcp-surface)}
.dshmcp-usage__title{margin:0;font-size:16px;line-height:24px;font-weight:600}
.dshmcp-usage__intro{margin:0;color:var(--dshmcp-muted);font-size:12px;line-height:18px}
.dshmcp-usage__grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;min-width:0}
.dshmcp-usage__card{display:flex;flex-direction:column;gap:8px;padding:12px;border:.5px solid var(--dshmcp-border);border-radius:10px;background:var(--dshmcp-surface);min-width:0}
.dshmcp-usage__cardTitle{font-size:13px;line-height:20px;font-weight:600}
.dshmcp-flow{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:14px;border:.5px solid var(--dshmcp-border);border-radius:12px;background:var(--dshmcp-surface)}
.dshmcp-flow__node{display:inline-flex;align-items:center;gap:6px;padding:7px 10px;border:.5px solid var(--dshmcp-border-strong);border-radius:8px;background:var(--dshmcp-menu);font-size:12px;line-height:18px;color:var(--dshmcp-fg)}
.dshmcp-flow__node--accent{border-color:color-mix(in srgb,var(--dshmcp-accent) 45%,transparent);background:color-mix(in srgb,var(--dshmcp-accent) 8%,transparent)}
.dshmcp-flow__node--ok{border-color:color-mix(in srgb,var(--dshmcp-ok) 45%,transparent);color:var(--dshmcp-ok)}
.dshmcp-flow__arrow{color:var(--dshmcp-faint);display:inline-flex}
.dshmcp-steps{display:flex;flex-direction:column;gap:10px;margin:0;padding:0;list-style:none}
.dshmcp-step{display:flex;align-items:flex-start;gap:10px}
.dshmcp-step__num{flex:none;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:var(--dshmcp-accent);color:var(--dshmcp-on-accent);font-size:11px;line-height:16px}
.dshmcp-step__text{display:flex;flex-direction:column;gap:2px;min-width:0}
.dshmcp-step__title{font-size:13px;line-height:20px;font-weight:600}
.dshmcp-step__body{margin:0;color:var(--dshmcp-muted);font-size:12px;line-height:18px}
.dshmcp-notes{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:5px;color:var(--dshmcp-muted);font-size:12px;line-height:18px}
.dshmcp-copyblock{display:flex;flex-direction:column;gap:6px;min-width:0}
.dshmcp-copyblock__head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px}
.dshmcp-copyblock__title{font-size:13px;line-height:20px;font-weight:600}
.dshmcp-code{margin:0;padding:10px 12px;border:.5px solid var(--dshmcp-border);border-radius:8px;background:var(--dshmcp-surface);color:var(--dshmcp-fg);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:17px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:280px;overflow:auto}
.dshmcp-approvals{position:fixed;right:20px;bottom:20px;z-index:900;display:flex;flex-direction:column;gap:10px;width:min(380px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow-y:auto;pointer-events:none}
.dshmcp-approval{pointer-events:auto;display:flex;flex-direction:column;gap:8px;padding:12px;border:.5px solid var(--dshmcp-border-strong);border-radius:12px;background:var(--dshmcp-menu);box-shadow:0 10px 30px rgba(0,0,0,.18)}
.dshmcp-approval__head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
.dshmcp-approval__headmain{display:flex;align-items:center;gap:8px;min-width:0}
.dshmcp-approval__icon{display:inline-flex;flex:none;align-items:center;justify-content:center;width:20px;height:20px;color:var(--dshmcp-danger)}
.dshmcp-approval__title{font-size:13px;line-height:20px;font-weight:600}
.dshmcp-approval__time{flex:none;color:var(--dshmcp-warn);font-size:11px;line-height:16px}
.dshmcp-approval__meta{display:grid;grid-template-columns:auto 1fr;gap:2px 8px;font-size:11px;line-height:16px}
.dshmcp-approval__key{color:var(--dshmcp-faint)}
.dshmcp-approval__val{color:var(--dshmcp-muted);min-width:0;overflow-wrap:anywhere}
.dshmcp-approval__summary{margin:0;padding:6px 8px;border-radius:6px;background:var(--dshmcp-surface);color:var(--dshmcp-muted);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10px;line-height:15px;max-height:100px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}
.dshmcp-approval__actions{display:flex;justify-content:flex-end;gap:8px}
.dshmcp-approval__error{color:var(--dshmcp-danger);font-size:11px;line-height:16px}
.dshmcp-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media (max-width:640px){.dshmcp-overlay{padding:12px}.dshmcp-modal{max-height:calc(100vh - 24px);padding:16px}.dshmcp-approvals{right:12px;bottom:12px;width:calc(100vw - 24px)}}
@media (prefers-reduced-motion:reduce){.dshmcp-root *{transition:none!important}}
`;

    /** Append the plugin stylesheet and return the element (claimed by apply's effect). */
    function injectStyles() {
      if (typeof document === 'undefined' || !document.head) return null;
      try {
        const stale = document.querySelector('style[' + STYLE_ATTRIBUTE + ']');
        if (stale && stale.parentNode) stale.parentNode.removeChild(stale);
        const style = document.createElement('style');
        style.setAttribute(STYLE_ATTRIBUTE, '1');
        style.textContent = STYLE_TEXT;
        document.head.appendChild(style);
        return style;
      } catch (error) {
        return null;
      }
    }

    // ------------------------------------------------------------------ shared plumbing
    function isObject(value) {
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function messageOf(error) {
      if (typeof error === 'string') return error;
      if (error && typeof error.message === 'string' && error.message) return error.message;
      try {
        return String(error);
      } catch (ignored) {
        return '';
      }
    }

    function sameJson(left, right) {
      try {
        return JSON.stringify(left) === JSON.stringify(right);
      } catch (error) {
        return false;
      }
    }

    function linesToArray(text) {
      if (typeof text !== 'string') return [];
      const seen = new Set();
      const values = [];
      for (const rawLine of text.split(/\r?\n/)) {
        const value = rawLine.trim();
        if (!value || seen.has(value)) continue;
        seen.add(value);
        values.push(value);
      }
      return values;
    }

    function linesFromArray(value) {
      if (!Array.isArray(value)) return '';
      return value.filter((item) => typeof item === 'string' && item).join('\n');
    }

    /** Normalize one API error payload into `{code, message, status}`. */
    function normalizeError(error, status) {
      const source = isObject(error) ? error : {};
      return {
        code: typeof source.code === 'string' && source.code ? source.code : 'unknown',
        message: typeof source.message === 'string' ? source.message : '',
        status: typeof status === 'number' ? status : 0,
        details: isObject(source.details) ? source.details : null,
      };
    }

    function errorFromResponse(payload, status, text) {
      if (isObject(payload) && isObject(payload.error)) {
        const error = normalizeError(payload.error, status);
        if (!error.message) error.message = typeof payload.error.message === 'string' ? payload.error.message : '';
        return error;
      }
      const trimmed = typeof text === 'string' ? text.trim().slice(0, 200) : '';
      return {
        code: 'http',
        message: trimmed && trimmed.charAt(0) !== '<' ? trimmed : '',
        status,
      };
    }

    /** Human-readable error text for inline error cards; never throws. */
    function describeError(t, error) {
      const source = isObject(error) ? error : {};
      const code = typeof source.code === 'string' ? source.code : 'unknown';
      const status = typeof source.status === 'number' && source.status > 0 ? source.status : 0;
      const message = typeof source.message === 'string' ? source.message : '';
      if (code === 'timeout') return t('error.timeout');
      if (code === 'network') return t('error.network', { message: message || 'network error' });
      if (code === 'revision-conflict') return t('saved.conflict');
      if (code === 'settings-write-denied') {
        const filePath = isObject(source.details) && typeof source.details.path === 'string'
          ? source.details.path
          : '';
        return filePath
          ? t('error.settingsWriteDenied', { path: filePath })
          : t('error.settingsWriteDeniedNoPath');
      }
      if (code === 'invalid-response' || code === 'invalid-state') return t('error.invalidResponse');
      if (message) {
        return status ? t('error.httpWithStatus', { status, message }) : message;
      }
      return status ? t('error.http', { status }) : t('error.unknown');
    }

    /**
     * One JSON request to the host API. Returns `{ok, status, data|error}` and
     * never throws: timeouts, network failures, and unreadable bodies all map to
     * a structured error.
     */
    async function requestJson(method, path, body) {
      const init = {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'X-DSH-MCP-UI': '1', Accept: 'application/json' },
      };
      if (body !== undefined) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      let controller = null;
      let timer = null;
      try {
        if (typeof AbortController === 'function') {
          controller = new AbortController();
          init.signal = controller.signal;
          timer = setTimeout(() => {
            try {
              controller.abort();
            } catch (ignored) {
              /* ignore */
            }
          }, REQUEST_TIMEOUT_MS);
        }
        const response = await fetch(API_BASE + path, init);
        let text = '';
        try {
          text = await response.text();
        } catch (ignored) {
          text = '';
        }
        let payload = null;
        if (text) {
          try {
            payload = JSON.parse(text);
          } catch (ignored) {
            payload = null;
          }
        }
        if (!response.ok) {
          return { ok: false, status: response.status, error: errorFromResponse(payload, response.status, text) };
        }
        if (!isObject(payload)) {
          return { ok: false, status: response.status, error: { code: 'invalid-response', message: '', status: response.status } };
        }
        if (payload.ok === false) {
          return { ok: false, status: response.status, error: errorFromResponse(payload, response.status, text) };
        }
        return { ok: true, status: response.status, data: payload };
      } catch (error) {
        const aborted = error && (error.name === 'AbortError' || /abort/i.test(messageOf(error)));
        return {
          ok: false,
          status: 0,
          error: { code: aborted ? 'timeout' : 'network', message: messageOf(error), status: 0 },
        };
      } finally {
        if (timer !== null) clearTimeout(timer);
      }
    }

    /** GET /state, validated to carry the expected settings object. */
    async function getGatewayState() {
      const result = await requestJson('GET', '/state');
      if (!result.ok) return result;
      const state = isObject(result.data) && isObject(result.data.settings) ? result.data : null;
      if (!state) {
        return { ok: false, status: result.status, error: { code: 'invalid-state', message: '', status: result.status } };
      }
      return { ok: true, status: result.status, data: state };
    }

    /**
     * POST an action returning a state object. A 409 reloads `/state` once and is
     * reported as `{conflict: true, reloaded}` so callers keep the user's edits.
     */
    async function postStateAction(path, body) {
      const first = await requestJson('POST', path, body);
      if (first.ok) {
        const state = isObject(first.data) && isObject(first.data.settings) ? first.data : null;
        if (state) return { ok: true, data: state };
        const reloaded = await getGatewayState();
        if (reloaded.ok) return { ok: true, data: reloaded.data };
        return { ok: true, data: null };
      }
      if (first.status === 409) {
        const reloaded = await getGatewayState();
        return { ok: false, conflict: true, reloaded: reloaded.ok ? reloaded.data : null, error: first.error };
      }
      return { ok: false, error: first.error };
    }

    function resolveEndpoint(data) {
      const endpoint = isObject(data) && isObject(data.endpoint) ? data.endpoint : {};
      return endpoint;
    }

    /** Resolve the public MCP URL, falling back to the current origin. */
    function resolveMcpUrl(data) {
      const endpoint = resolveEndpoint(data);
      if (typeof endpoint.mcpUrl === 'string' && endpoint.mcpUrl) return endpoint.mcpUrl;
      const path = typeof endpoint.path === 'string' && endpoint.path ? endpoint.path : '/dsh-mcp';
      let origin = typeof endpoint.origin === 'string' ? endpoint.origin : '';
      if (!origin) {
        try {
          origin = typeof location !== 'undefined' && location.origin ? location.origin : '';
        } catch (ignored) {
          origin = '';
        }
      }
      return origin + path + '/mcp';
    }

    function readToken(data) {
      const settings = isObject(data) && isObject(data.settings) ? data.settings : null;
      const server = isObject(settings) && isObject(settings.server) ? settings.server : null;
      return isObject(server) && typeof server.token === 'string' ? server.token : '';
    }

    /** Mask a token for display; the copy action always copies the real value. */
    function maskToken(token) {
      if (typeof token !== 'string' || !token) return '';
      if (token.length <= 8) return '••••••••';
      return token.slice(0, 7) + '…' + token.slice(-4);
    }

    /** The exact JSON handed to MCP clients (url + Authorization header). */
    function clientJson(mcpUrl, token) {
      const headers = typeof token === 'string' && token ? { Authorization: 'Bearer ' + token } : {};
      return JSON.stringify({
        mcpServers: {
          dsh: {
            type: 'http',
            url: typeof mcpUrl === 'string' ? mcpUrl : '',
            headers,
          },
        },
      }, null, 2);
    }

    function onboardingOf(data) {
      if (isObject(data) && isObject(data.onboarding)) return data.onboarding;
      if (isObject(data) && isObject(data.settings) && isObject(data.settings.onboarding)) {
        return data.settings.onboarding;
      }
      return {};
    }

    /** Epoch-millisecond onboarding stamps are numbers; `null`/`undefined` mean unset. */
    function hasOnboardingStamp(value) {
      return value !== null && value !== undefined && value !== false;
    }

    function isAcknowledged(data) {
      const onboarding = onboardingOf(data);
      if (hasOnboardingStamp(onboarding.acknowledgedAt)) return true;
      return onboarding.acknowledged === true;
    }

    function isFirstRun(data) {
      const onboarding = onboardingOf(data);
      if (typeof onboarding.firstRun === 'boolean') return onboarding.firstRun;
      return !hasOnboardingStamp(onboarding.shownAt) && !isAcknowledged(data);
    }

    /** Non-fatal host warnings shown inside the status card (deduplicated: the
     * host mirrors `warnings` into `status.serviceWarnings`). */
    function warningsOf(data) {
      const warnings = [];
      const seen = new Set();
      const push = (entry) => {
        let text = '';
        if (typeof entry === 'string') text = entry;
        else if (isObject(entry) && typeof entry.message === 'string') text = entry.message;
        if (!text || seen.has(text)) return;
        seen.add(text);
        warnings.push(text);
      };
      if (isObject(data) && Array.isArray(data.warnings)) data.warnings.forEach(push);
      if (isObject(data) && isObject(data.status) && Array.isArray(data.status.serviceWarnings)) {
        data.status.serviceWarnings.forEach(push);
      }
      return warnings;
    }

    /** Copy text with a clipboard-API path and a selection fallback. */
    async function copyText(text) {
      const value = typeof text === 'string' ? text : '';
      if (!value) return false;
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(value);
          return true;
        }
      } catch (error) {
        /* fall through to the legacy path */
      }
      try {
        if (typeof document === 'undefined' || !document.body) return false;
        const area = document.createElement('textarea');
        area.value = value;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.top = '-1000px';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        const copied = document.execCommand('copy');
        if (area.parentNode) area.parentNode.removeChild(area);
        return copied === true;
      } catch (error) {
        return false;
      }
    }

    /**
     * Tiny cross-slot signal bus. `refresh` tells the settings page the state
     * changed elsewhere; `reopen` asks the onboarding overlay to show again.
     */
    function createHub() {
      const listeners = new Set();
      return {
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        emit(signal) {
          for (const listener of Array.from(listeners)) {
            try {
              listener(signal);
            } catch (error) {
              /* one broken listener must not break the others */
            }
          }
        },
      };
    }

    const onboardingHub = createHub();

    // ------------------------------------------------------------------ settings <-> form
    function numberOf(value, fallback) {
      return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    }

    function isValidLimitValue(value) {
      return typeof value === 'number' && Number.isFinite(value) && Math.floor(value) === value && value !== 0;
    }

    /** Server settings -> editable form draft (arrays become textarea text). */
    function toForm(settings) {
      const source = isObject(settings) ? settings : {};
      const permissions = {};
      for (const key of PERMISSION_KEYS) {
        permissions[key] = isObject(source.permissions) && typeof source.permissions[key] === 'boolean'
          ? source.permissions[key]
          : DEFAULT_PERMISSIONS[key];
      }
      const scope = isObject(source.scope) ? source.scope : {};
      const limits = isObject(source.limits) ? source.limits : {};
      const server = isObject(source.server) ? source.server : {};
      return {
        permissions,
        fullAccess: source.fullAccess === true,
        server: { enabled: server.enabled !== false },
        scope: {
          sessionMode: scope.sessionMode === 'allowlist' ? 'allowlist' : 'all',
          sessionIdsText: linesFromArray(scope.sessionIds),
          includeSubagents: scope.includeSubagents === true,
          modelMode: scope.modelMode === 'allowlist' ? 'allowlist' : 'all',
          allowedModelsText: linesFromArray(scope.allowedModels),
          allowedRootsText: linesFromArray(scope.allowedRoots),
          defaultCwd: typeof scope.defaultCwd === 'string' ? scope.defaultCwd : '',
          defaultModel: typeof scope.defaultModel === 'string' ? scope.defaultModel : '',
          newSessionPreset: typeof scope.newSessionPreset === 'string' ? scope.newSessionPreset : '',
        },
        limits: {
          maxReadMessages: numberOf(limits.maxReadMessages, DEFAULT_LIMITS.maxReadMessages),
          maxReadChars: numberOf(limits.maxReadChars, DEFAULT_LIMITS.maxReadChars),
          maxMessageChars: numberOf(limits.maxMessageChars, DEFAULT_LIMITS.maxMessageChars),
          defaultWaitMs: numberOf(limits.defaultWaitMs, DEFAULT_LIMITS.defaultWaitMs),
          maxWaitMs: numberOf(limits.maxWaitMs, DEFAULT_LIMITS.maxWaitMs),
          sendWhenBusy: limits.sendWhenBusy === 'reject' ? 'reject' : 'queue',
        },
      };
    }

    function scopeFromForm(scope) {
      const source = isObject(scope) ? scope : {};
      return {
        sessionMode: source.sessionMode === 'allowlist' ? 'allowlist' : 'all',
        sessionIds: linesToArray(source.sessionIdsText),
        includeSubagents: source.includeSubagents === true,
        modelMode: source.modelMode === 'allowlist' ? 'allowlist' : 'all',
        allowedModels: linesToArray(source.allowedModelsText),
        allowedRoots: linesToArray(source.allowedRootsText),
        defaultCwd: typeof source.defaultCwd === 'string' ? source.defaultCwd.trim() : '',
        defaultModel: typeof source.defaultModel === 'string' ? source.defaultModel.trim() : '',
        newSessionPreset: typeof source.newSessionPreset === 'string' ? source.newSessionPreset : '',
      };
    }

    function limitsFromForm(limits) {
      const source = isObject(limits) ? limits : {};
      const result = {};
      for (const key of NUMERIC_LIMIT_KEYS) {
        const value = source[key];
        result[key] = typeof value === 'number' ? value : Number(value);
      }
      result.sendWhenBusy = source.sendWhenBusy === 'reject' ? 'reject' : 'queue';
      return result;
    }

    /** Deep partial settings patch; only sections that actually differ are sent. */
    function collectPatch(form, settings) {
      const baseline = toForm(settings);
      const patch = {};
      if (!sameJson(form.permissions, baseline.permissions)) {
        patch.permissions = { ...form.permissions };
      }
      if (form.fullAccess !== baseline.fullAccess) {
        patch.fullAccess = form.fullAccess === true;
      }
      const scope = scopeFromForm(form.scope);
      if (!sameJson(scope, scopeFromForm(baseline.scope))) {
        patch.scope = scope;
      }
      const limits = limitsFromForm(form.limits);
      if (!sameJson(limits, limitsFromForm(baseline.limits))) {
        patch.limits = limits;
      }
      if (form.server.enabled !== baseline.server.enabled) {
        patch.server = { enabled: form.server.enabled === true };
      }
      return patch;
    }

    function hasChanges(form, settings) {
      if (!form || !settings) return false;
      try {
        return Object.keys(collectPatch(form, settings)).length > 0;
      } catch (error) {
        return false;
      }
    }

    function invalidLimitKeys(limits) {
      return NUMERIC_LIMIT_KEYS.filter((key) => !isValidLimitValue(limits[key]));
    }

    /** Options for the default-model select; keeps an unknown current value visible. */
    function modelOptions(catalog, currentValue, t) {
      const options = [{ value: '', label: t('scope.defaultModelEmpty') }];
      const seen = new Set(['']);
      const groups = isObject(catalog) && Array.isArray(catalog.models) ? catalog.models : [];
      for (const group of groups) {
        if (!isObject(group) || !Array.isArray(group.models)) continue;
        for (const model of group.models) {
          if (!isObject(model) || typeof model.id !== 'string' || !model.id) continue;
          const provider = typeof group.provider === 'string' ? group.provider : '';
          const value = provider ? provider + '/' + model.id : model.id;
          if (seen.has(value)) continue;
          seen.add(value);
          const providerName = typeof group.providerName === 'string' && group.providerName ? group.providerName : provider;
          const modelName = typeof model.name === 'string' && model.name ? model.name : model.id;
          options.push({ value, label: providerName ? providerName + ' · ' + modelName : modelName });
        }
      }
      if (typeof currentValue === 'string' && currentValue && !seen.has(currentValue)) {
        options.push({ value: currentValue, label: currentValue });
      }
      return options;
    }

    /** Options for the new-session preset select; empty when the catalog is unreadable. */
    function presetOptions(catalog, currentValue) {
      const options = [];
      const seen = new Set();
      const presets = isObject(catalog) && Array.isArray(catalog.permissionPresets) ? catalog.permissionPresets : [];
      for (const preset of presets) {
        if (!isObject(preset) || typeof preset.value !== 'string' || !preset.value || seen.has(preset.value)) continue;
        seen.add(preset.value);
        const name = typeof preset.name === 'string' && preset.name ? preset.name : preset.value;
        const description = typeof preset.description === 'string' && preset.description ? preset.description : '';
        options.push({ value: preset.value, label: description ? name + ' — ' + description : name });
      }
      if (typeof currentValue === 'string' && currentValue && !seen.has(currentValue)) {
        options.push({ value: currentValue, label: currentValue });
      }
      return options;
    }

    function sendWhenBusyOptions(limits, t) {
      const options = [
        { value: 'queue', label: t('limits.sendWhenBusy.queue'), icon: h(Icon, { name: 'clock', size: 16 }) },
        { value: 'reject', label: t('limits.sendWhenBusy.reject'), icon: h(Icon, { name: 'ban', size: 16 }) },
      ];
      const current = isObject(limits) ? limits.sendWhenBusy : 'queue';
      if (SEND_WHEN_BUSY_VALUES.indexOf(current) === -1) {
        options.push({ value: current, label: String(current) });
      }
      return options;
    }

    // ------------------------------------------------------------------ hooks
    function useLanguage(localeService) {
      const [language, setLanguage] = React.useState(() => readLanguage(localeService));
      React.useEffect(() => {
        let active = true;
        const sync = () => {
          if (active) setLanguage(readLanguage(localeService));
        };
        sync();
        let off = null;
        if (localeService && typeof localeService.subscribe === 'function') {
          try {
            off = localeService.subscribe(sync);
          } catch (error) {
            off = null;
          }
        }
        return () => {
          active = false;
          if (typeof off === 'function') {
            try {
              off();
            } catch (error) {
              /* ignore */
            }
          }
        };
      }, [localeService]);
      return language;
    }

    // ------------------------------------------------------------------ small UI pieces
    function cn() {
      const parts = [];
      for (let index = 0; index < arguments.length; index += 1) {
        if (arguments[index]) parts.push(arguments[index]);
      }
      return parts.join(' ');
    }

    /** Render failures never escape into the DSH shell. */
    class PluginBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { failed: false };
      }

      static getDerivedStateFromError() {
        return { failed: true };
      }

      componentDidCatch(error) {
        try {
          console.error('[dsh-mcp-gateway] client UI failed', error);
        } catch (ignored) {
          /* ignore */
        }
      }

      render() {
        if (this.state.failed) {
          return h('div', { className: 'dshmcp-root' },
            h('div', { className: 'dshmcp-errorcard' },
              h('div', { className: 'dshmcp-errorcard__title' },
                'MCP 网关界面暂时不可用 / MCP gateway UI is temporarily unavailable.')));
        }
        return this.props.children;
      }
    }

    function ActionButton({ variant, size, buttonRef, icon, children, ...rest }) {
      return h('button', {
        type: 'button',
        ref: buttonRef,
        className: cn('dshmcp-btn', variant ? 'dshmcp-btn--' + variant : null, size === 'sm' ? 'dshmcp-btn--sm' : null),
        ...rest,
      }, icon ? h(Icon, { name: icon, size: 14 }) : null, children);
    }

    function Toggle({ checked, onChange, disabled, label }) {
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': checked ? 'true' : 'false',
        'aria-label': label,
        disabled: disabled === true,
        className: cn('dshmcp-switch', checked ? 'dshmcp-switch--on' : null),
        onClick: () => onChange(!checked),
      }, h('span', { className: 'dshmcp-switch__thumb', 'aria-hidden': 'true' }));
    }

    function TextInput({ value, onChange, disabled, placeholder, ariaLabel, mono, invalid }) {
      return h('input', {
        type: 'text',
        className: cn('dshmcp-input', mono ? 'dshmcp-input--mono' : null, invalid ? 'dshmcp-input--invalid' : null),
        value: typeof value === 'string' ? value : '',
        placeholder,
        disabled: disabled === true,
        'aria-label': ariaLabel,
        'aria-invalid': invalid ? 'true' : undefined,
        spellCheck: false,
        onChange: (event) => onChange(event.target.value),
      });
    }

    function NumberInput({ value, onChange, disabled, ariaLabel, invalid }) {
      const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
      return h('input', {
        type: 'number',
        min: '-1',
        step: '1',
        inputMode: 'numeric',
        className: cn('dshmcp-input dshmcp-input--num', invalid ? 'dshmcp-input--invalid' : null),
        value: text,
        disabled: disabled === true,
        'aria-label': ariaLabel,
        'aria-invalid': invalid ? 'true' : undefined,
        onChange: (event) => onChange(event.target.value === '' ? '' : Number(event.target.value)),
      });
    }

    function TextArea({ value, onChange, disabled, placeholder, ariaLabel, rows }) {
      return h('textarea', {
        className: 'dshmcp-textarea dshmcp-textarea--mono',
        value: typeof value === 'string' ? value : '',
        placeholder,
        rows: rows || 3,
        disabled: disabled === true,
        'aria-label': ariaLabel,
        spellCheck: false,
        onChange: (event) => onChange(event.target.value),
      });
    }

    function SelectInput({ value, options, onChange, disabled, ariaLabel }) {
      return h('select', {
        className: 'dshmcp-select',
        value: typeof value === 'string' ? value : '',
        disabled: disabled === true,
        'aria-label': ariaLabel,
        onChange: (event) => onChange(event.target.value),
      }, ...options.map((option) => h('option', { key: option.value, value: option.value }, option.label)));
    }

    /**
     * Native-looking single select: a form-control trigger plus a fixed menu of
     * MenuRow options. Fixed positioning keeps the menu visible inside the
     * scrollable settings column; click-outside and Escape close it.
     */
    function SelectMenu({ value, options, onChange, disabled, ariaLabel, placeholder, icon }) {
      const [open, setOpen] = React.useState(false);
      const [position, setPosition] = React.useState(null);
      const triggerRef = React.useRef(null);
      const menuRef = React.useRef(null);
      const list = Array.isArray(options) ? options : [];
      const selected = list.find((option) => option.value === value) || null;
      const selectedIcon = selected && selected.icon !== undefined ? selected.icon : icon;
      const triggerIcon = menuIconNode(selectedIcon);

      const close = React.useCallback(() => setOpen(false), []);

      React.useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event) => {
          const target = event.target;
          if (menuRef.current && menuRef.current.contains(target)) return;
          if (triggerRef.current && triggerRef.current.contains(target)) return;
          close();
        };
        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            close();
            try { triggerRef.current?.focus(); } catch (ignored) { /* ignore */ }
          }
        };
        const onViewport = () => close();
        document.addEventListener('mousedown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('resize', onViewport);
        window.addEventListener('scroll', onViewport, true);
        return () => {
          document.removeEventListener('mousedown', onPointerDown, true);
          document.removeEventListener('keydown', onKeyDown, true);
          window.removeEventListener('resize', onViewport);
          window.removeEventListener('scroll', onViewport, true);
        };
      }, [open, close]);

      const toggle = () => {
        if (disabled === true) return;
        if (open) {
          setOpen(false);
          return;
        }
        const rect = triggerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const width = Math.max(rect.width, 180);
        const left = Math.max(8, Math.min(rect.left, (window.innerWidth || 0) - width - 8));
        const top = Math.min(rect.bottom + 4, Math.max(8, (window.innerHeight || 0) - 280));
        setPosition({ left, top, width });
        setOpen(true);
      };

      return h('div', { className: 'dshmcp-selectwrap' },
        h('button', {
          ref: triggerRef,
          type: 'button',
          className: 'dshmcp-selecttrigger',
          disabled: disabled === true,
          'aria-label': ariaLabel,
          'aria-haspopup': 'listbox',
          'aria-expanded': open ? 'true' : 'false',
          onClick: toggle,
        },
        h('span', { className: 'dshmcp-selecttrigger__label' },
          triggerIcon ? h('span', { className: 'dshmcp-selecttrigger__icon' }, triggerIcon) : null,
          h('span', { className: 'dshmcp-selecttrigger__text' }, selected ? selected.label : (placeholder || value || ''))),
        h(Icon, { name: 'chevronDown', size: 14 })),
        open && position
          ? h('div', {
            ref: menuRef,
            className: 'dshmcp-menu dshmcp-selectmenu',
            role: 'listbox',
            'aria-label': ariaLabel,
            style: { left: position.left, top: position.top, width: position.width },
          }, ...list.map((option) => h(MenuRow, {
            key: option.value,
            role: 'radio',
            icon: option.icon,
            title: option.label,
            description: option.description,
            selected: option.value === value,
            disabled: option.disabled === true,
            onClick: () => {
              if (option.disabled === true) return;
              onChange(option.value);
              setOpen(false);
            },
          })))
          : null);
    }

    function Field({ label, hint, children }) {
      return h('div', { className: 'dshmcp-field' },
        h('span', { className: 'dshmcp-field__label' }, label),
        children,
        hint ? h('p', { className: 'dshmcp-field__hint' }, hint) : null);
    }

    function Row({ title, hint, children }) {
      return h('div', { className: 'dshmcp-row' },
        h('div', { className: 'dshmcp-row__text' },
          h('div', { className: 'dshmcp-row__title' }, title),
          hint ? h('p', { className: 'dshmcp-row__hint' }, hint) : null),
        children);
    }

    function SectionCard({ title, description, children }) {
      return h('section', { className: 'dshmcp-card' },
        h('div', { className: 'dshmcp-card__head' },
          h('h3', { className: 'dshmcp-card__title' }, title),
          description ? h('p', { className: 'dshmcp-card__desc' }, description) : null),
        h('div', { className: 'dshmcp-card__body' }, children));
    }

    function Notice({ notice }) {
      if (!notice || !notice.text) return null;
      const tone = notice.tone === 'ok' || notice.tone === 'warn' ? notice.tone : 'error';
      return h('div', {
        className: 'dshmcp-notice dshmcp-notice--' + tone,
        role: tone === 'error' ? 'alert' : 'status',
      }, notice.text);
    }

    function ErrorCard({ t, title, message, hint, onRetry }) {
      return h('div', { className: 'dshmcp-errorcard', role: 'alert' },
        h('div', { className: 'dshmcp-errorcard__title' }, title),
        message ? h('p', { className: 'dshmcp-errorcard__message' }, message) : null,
        hint ? h('p', { className: 'dshmcp-errorcard__message' }, hint) : null,
        onRetry ? h('div', { className: 'dshmcp-card__actions' },
          h(ActionButton, { variant: 'secondary', onClick: onRetry }, t('common.retry'))) : null);
    }

    function ValueRow({ value, ariaLabel, buttons }) {
      return h('div', { className: 'dshmcp-valuerow' },
        h('input', {
          className: 'dshmcp-input dshmcp-input--mono',
          type: 'text',
          readOnly: true,
          value: typeof value === 'string' ? value : '',
          'aria-label': ariaLabel,
          spellCheck: false,
          onFocus: (event) => {
            try {
              event.currentTarget.select();
            } catch (ignored) {
              /* ignore */
            }
          },
        }),
        buttons && buttons.length > 0
          ? h('div', { className: 'dshmcp-valuerow__actions' }, ...buttons)
          : null);
    }

    function WarnBox({ t, warnings }) {
      if (!warnings || warnings.length === 0) return null;
      return h('div', { className: 'dshmcp-warnbox', role: 'status' },
        h('div', null, t('status.warnings')),
        h('ul', null, ...warnings.map((warning, index) => h('li', { key: 'warning-' + index }, warning))));
    }

    // ------------------------------------------------------------------ status card
    function StatusCard(props) {
      const { t, data, form, busy, copied, showToken, rotatePending } = props;
      const mcpUrl = resolveMcpUrl(data);
      const token = readToken(data);
      const enabled = form.server.enabled === true;
      const status = isObject(data.status) ? data.status : {};
      const running = enabled && status.running === true;
      const warnings = warningsOf(data);
      const masked = showToken ? (token || t('common.empty')) : (maskToken(token) || t('common.empty'));
      const json = clientJson(mcpUrl, token);
      const toolCount = typeof status.permissionCount === 'number' ? status.permissionCount : 0;
      const pillLabel = !enabled
        ? t('status.stopped')
        : (running ? t('status.running') : t('status.pending'));

      const tokenButtons = [];
      tokenButtons.push(h(ActionButton, {
        key: 'toggle-token',
        variant: 'ghost',
        size: 'sm',
        onClick: props.onToggleToken,
      }, showToken ? t('common.hide') : t('common.show')));
      tokenButtons.push(h(ActionButton, {
        key: 'copy-token',
        variant: 'secondary',
        size: 'sm',
        disabled: !token,
        onClick: () => props.onCopy('token', token),
      }, copied === 'token' ? t('common.copied') : t('common.copy')));
      if (rotatePending) {
        tokenButtons.push(h(ActionButton, {
          key: 'rotate-confirm',
          variant: 'danger-solid',
          size: 'sm',
          disabled: busy !== null,
          onClick: props.onConfirmRotate,
        }, t('common.confirm')));
        tokenButtons.push(h(ActionButton, {
          key: 'rotate-cancel',
          variant: 'ghost',
          size: 'sm',
          disabled: busy !== null,
          onClick: props.onCancelRotate,
        }, t('common.cancel')));
      } else {
        tokenButtons.push(h(ActionButton, {
          key: 'rotate',
          variant: 'secondary',
          size: 'sm',
          disabled: busy !== null || !token,
          onClick: props.onRotate,
        }, t('status.rotate')));
      }

      return h(SectionCard, { title: t('status.title'), description: t('status.description') },
        h('div', { className: 'dshmcp-row' },
          h('div', { className: 'dshmcp-row__text' },
            h('span', { className: 'dshmcp-pill' + (running ? ' dshmcp-pill--ok' : '') }, pillLabel),
            h('div', { className: 'dshmcp-row__title' }, t('status.enabled')),
            h('p', { className: 'dshmcp-row__hint' }, t('status.enabledHint'))),
          h(Toggle, {
            checked: enabled,
            disabled: busy !== null,
            label: t('status.enabled'),
            onChange: props.onToggleServer,
          })),
        h(Field, { label: t('status.mcpUrl') },
          h(ValueRow, {
            value: mcpUrl,
            ariaLabel: t('status.mcpUrl'),
            buttons: [h(ActionButton, {
              key: 'copy-url',
              variant: 'secondary',
              size: 'sm',
              disabled: !mcpUrl,
              onClick: () => props.onCopy('url', mcpUrl),
            }, copied === 'url' ? t('common.copied') : t('common.copyUrl'))],
          })),
        h(Field, { label: t('status.token'), hint: t('status.tokenHint') },
          h(ValueRow, { value: masked, ariaLabel: t('status.token'), buttons: tokenButtons })),
        rotatePending ? h('div', { className: 'dshmcp-warnbox', role: 'alert' }, t('status.rotateConfirm')) : null,
        h('div', { className: 'dshmcp-card__actions' },
          h(ActionButton, {
            variant: 'primary',
            disabled: !mcpUrl,
            onClick: () => props.onCopy('json', json),
          }, copied === 'json' ? t('common.copied') : t('status.copyJson')),
          h('span', { className: 'dshmcp-field__hint' }, t('status.copyJsonHint'))),
        h(WarnBox, { t, warnings }),
        h('p', { className: 'dshmcp-row__hint' }, t('status.permissionCount', { count: toolCount })));
    }

    // ------------------------------------------------------------------ permissions card
    function PermissionRow({ label, checked, disabled, onChange }) {
      return h('div', { className: 'dshmcp-row' },
        h('div', { className: 'dshmcp-row__title' }, label),
        h(Toggle, { checked, disabled, label, onChange }));
    }

    function PermissionsCard(props) {
      const { t, permissions, fullAccess, fullAccessPending, busy } = props;
      const disabled = busy !== null;
      const permissionRow = (key) => h(PermissionRow, {
        key,
        label: t('permission.' + key),
        checked: permissions[key] === true,
        disabled,
        onChange: (value) => props.onTogglePermission(key, value),
      });
      return h(SectionCard, { title: t('permissions.title'), description: t('permissions.description') },
        h('div', { className: 'dshmcp-perm-group' },
          h('div', { className: 'dshmcp-perm-group__title' }, t('permissions.basic')),
          h('div', { className: 'dshmcp-perm-list' }, ...PERMISSION_BASIC.map(permissionRow))),
        h('div', { className: 'dshmcp-perm-group' },
          h('div', { className: 'dshmcp-perm-group__title' }, t('permissions.extended')),
          h('div', { className: 'dshmcp-perm-list' }, ...PERMISSION_EXTENDED.map(permissionRow))),
        h('div', { className: 'dshmcp-perm-group' },
          h('div', { className: 'dshmcp-perm-group__title' }, t('permissions.fullAccess')),
          h(Row, { title: t('permissions.fullAccess'), hint: t('permissions.fullAccessHint') },
            h(Toggle, {
              checked: fullAccess,
              disabled,
              label: t('permissions.fullAccess'),
              onChange: props.onToggleFullAccess,
            })),
          fullAccess ? h('div', { className: 'dshmcp-risk', role: 'alert' },
            h('div', { className: 'dshmcp-risk__title' }, t('permissions.fullAccessWarningTitle')),
            h('p', { className: 'dshmcp-risk__body' }, t('permissions.fullAccessWarning'))) : null,
          fullAccessPending ? h('div', { className: 'dshmcp-risk', role: 'alert' },
            h('div', { className: 'dshmcp-risk__title' }, t('permissions.fullAccessWarningTitle')),
            h('p', { className: 'dshmcp-risk__body' }, t('permissions.fullAccessWarning')),
            h('div', { className: 'dshmcp-card__actions' },
              h(ActionButton, { variant: 'danger-solid', onClick: props.onConfirmFullAccess }, t('permissions.confirmFullAccess')),
              h(ActionButton, { variant: 'secondary', onClick: props.onCancelFullAccess }, t('common.cancel')))) : null));
    }

    // ------------------------------------------------------------------ scope card
    function ScopeCard(props) {
      const { t, scope, catalog, busy } = props;
      const disabled = busy !== null;
      const onChange = (key) => (value) => props.onChange(key, value);
      const models = modelOptions(catalog, scope.defaultModel, t);
      const presets = presetOptions(catalog, scope.newSessionPreset);
      return h(SectionCard, { title: t('scope.title'), description: t('scope.description') },
        h('div', { className: 'dshmcp-grid' },
          h(Field, { label: t('scope.sessionMode') },
            h(SelectInput, {
              value: scope.sessionMode,
              disabled,
              ariaLabel: t('scope.sessionMode'),
              options: [
                { value: 'all', label: t('scope.sessionModeAll') },
                { value: 'allowlist', label: t('scope.sessionModeAllowlist') },
              ],
              onChange: onChange('sessionMode'),
            }))),
        h(Field, { label: t('scope.sessionIds'), hint: t('scope.sessionIdsHint') },
          h(TextArea, {
            value: scope.sessionIdsText,
            disabled: disabled || scope.sessionMode !== 'allowlist',
            placeholder: t('scope.sessionIdsPlaceholder'),
            ariaLabel: t('scope.sessionIds'),
            onChange: onChange('sessionIdsText'),
          })),
        h(Row, { title: t('scope.includeSubagents'), hint: t('scope.includeSubagentsHint') },
          h(Toggle, {
            checked: scope.includeSubagents,
            disabled,
            label: t('scope.includeSubagents'),
            onChange: onChange('includeSubagents'),
          })),
        h('div', { className: 'dshmcp-grid' },
          h(Field, { label: t('scope.modelMode') },
            h(SelectInput, {
              value: scope.modelMode,
              disabled,
              ariaLabel: t('scope.modelMode'),
              options: [
                { value: 'all', label: t('scope.modelModeAll') },
                { value: 'allowlist', label: t('scope.modelModeAllowlist') },
              ],
              onChange: onChange('modelMode'),
            }))),
        h(Field, { label: t('scope.allowedModels'), hint: t('scope.allowedModelsHint') },
          h(TextArea, {
            value: scope.allowedModelsText,
            disabled: disabled || scope.modelMode !== 'allowlist',
            placeholder: t('scope.allowedModelsPlaceholder'),
            ariaLabel: t('scope.allowedModels'),
            onChange: onChange('allowedModelsText'),
          })),
        h(Field, { label: t('scope.allowedRoots'), hint: t('scope.allowedRootsHint') },
          h(TextArea, {
            value: scope.allowedRootsText,
            disabled,
            placeholder: t('scope.allowedRootsPlaceholder'),
            ariaLabel: t('scope.allowedRoots'),
            onChange: onChange('allowedRootsText'),
          })),
        h('div', { className: 'dshmcp-grid' },
          h(Field, { label: t('scope.defaultCwd'), hint: t('scope.defaultCwdHint') },
            h(TextInput, {
              value: scope.defaultCwd,
              disabled,
              ariaLabel: t('scope.defaultCwd'),
              placeholder: 'E:\\projects\\demo',
              onChange: onChange('defaultCwd'),
            })),
          h(Field, { label: t('scope.defaultModel') },
            models.length > 1
              ? h(SelectInput, {
                value: scope.defaultModel,
                disabled,
                ariaLabel: t('scope.defaultModel'),
                options: models,
                onChange: onChange('defaultModel'),
              })
              : h(TextInput, {
                value: scope.defaultModel,
                disabled,
                ariaLabel: t('scope.defaultModel'),
                placeholder: 'provider/model',
                mono: true,
                onChange: onChange('defaultModel'),
              })),
          h(Field, { label: t('scope.newSessionPreset'), hint: t('scope.newSessionPresetHint') },
            presets.length > 0
              ? h(SelectInput, {
                value: scope.newSessionPreset,
                disabled,
                ariaLabel: t('scope.newSessionPreset'),
                options: presets,
                onChange: onChange('newSessionPreset'),
              })
              : h(TextInput, {
                value: scope.newSessionPreset,
                disabled,
                ariaLabel: t('scope.newSessionPreset'),
                placeholder: 'workspace-write',
                mono: true,
                onChange: onChange('newSessionPreset'),
              }))));
    }

    // ------------------------------------------------------------------ limits card
    function LimitsCard(props) {
      const { t, limits, busy } = props;
      const disabled = busy !== null;
      const fields = NUMERIC_LIMIT_KEYS.map((key) => {
        const invalid = !isValidLimitValue(limits[key]);
        return h(Field, { key, label: t('limits.' + key) },
          h(NumberInput, {
            value: limits[key],
            disabled,
            invalid,
            ariaLabel: t('limits.' + key),
            onChange: (value) => props.onChange(key, value),
          }),
          invalid ? h('p', { className: 'dshmcp-field__hint dshmcp-field__hint--error' }, t('limits.invalidNumber')) : null);
      });
      return h(SectionCard, { title: t('limits.title'), description: t('limits.description') },
        h('div', { className: 'dshmcp-grid' },
          ...fields,
          h(Field, { label: t('limits.sendWhenBusy') },
            h(SelectMenu, {
              value: limits.sendWhenBusy,
              disabled,
              ariaLabel: t('limits.sendWhenBusy'),
              options: sendWhenBusyOptions(limits, t),
              onChange: (value) => props.onChange('sendWhenBusy', value),
            }))));
    }

    // ------------------------------------------------------------------ banner + action bar
    function OnboardingBanner(props) {
      const { t, busy } = props;
      return h('div', { className: 'dshmcp-banner', role: 'status' },
        h('div', { className: 'dshmcp-banner__title' }, t('banner.title')),
        h('p', { className: 'dshmcp-banner__body' }, t('banner.body')),
        h('div', { className: 'dshmcp-banner__actions' },
          h(ActionButton, {
            variant: 'secondary',
            disabled: busy !== null,
            onClick: props.onShowWelcome,
          }, busy === 'welcome' ? t('actions.saving') : t('banner.action'))));
    }

    function ActionsBar(props) {
      const { t, dirty, busy, resetPending } = props;
      return h('div', { className: 'dshmcp-footer' },
        resetPending ? h('div', { className: 'dshmcp-warnbox', role: 'alert' }, t('actions.resetHint')) : null,
        h('div', { className: 'dshmcp-actionsbar' },
          h('span', {
            className: 'dshmcp-actionsbar__status' + (dirty ? ' dshmcp-actionsbar__status--dirty' : ''),
          }, dirty ? t('common.unsaved') : t('common.upToDate')),
          h('div', { className: 'dshmcp-actions' },
            // Always available: clears onboarding.shownAt so the welcome overlay opens again.
            h(ActionButton, {
              key: 'show-welcome',
              variant: 'ghost',
              disabled: busy !== null,
              onClick: props.onShowWelcome,
            }, busy === 'welcome' ? t('actions.saving') : t('banner.action')),
            resetPending
              ? h(ActionButton, {
                key: 'confirm-reset',
                variant: 'danger',
                disabled: busy !== null,
                onClick: props.onConfirmReset,
              }, t('actions.resetConfirmButton'))
              : h(ActionButton, {
                key: 'reset',
                variant: 'secondary',
                disabled: busy !== null,
                onClick: props.onReset,
              }, t('actions.reset')),
            resetPending
              ? h(ActionButton, {
                key: 'cancel-reset',
                variant: 'ghost',
                disabled: busy !== null,
                onClick: props.onCancelReset,
              }, t('common.cancel'))
              : null,
            h(ActionButton, {
              key: 'save',
              variant: 'primary',
              disabled: busy !== null || !dirty,
              onClick: props.onSave,
            }, busy === 'save' ? t('actions.saving') : t('actions.save')))));
    }

    // ------------------------------------------------------------------ settings section
    function SettingsSection({ localeService }) {
      const language = useLanguage(localeService);
      // Memoized so callback deps stay stable across renders (locale changes rebind it).
      const t = React.useMemo(() => createTranslator(language), [language]);
      const [remote, setRemote] = React.useState({ status: 'loading', data: null, error: null });
      const [form, setForm] = React.useState(null);
      const [busy, setBusy] = React.useState(null);
      const [notice, setNotice] = React.useState(null);
      const [showToken, setShowToken] = React.useState(false);
      const [copied, setCopied] = React.useState(null);
      const [fullAccessPending, setFullAccessPending] = React.useState(false);
      const [rotatePending, setRotatePending] = React.useState(false);
      const [resetPending, setResetPending] = React.useState(false);
      const generationRef = React.useRef(0);
      const copyTimerRef = React.useRef(null);
      const data = remote.status === 'ready' ? remote.data : null;

      const load = React.useCallback(async (options) => {
        const opts = options || {};
        const generation = generationRef.current + 1;
        generationRef.current = generation;
        if (opts.showLoading !== false) setRemote({ status: 'loading', data: null, error: null });
        const result = await getGatewayState();
        if (generation !== generationRef.current) return;
        if (!result.ok) {
          // A silent background refresh keeps the current UI; a visible reload shows the error card.
          if (opts.showLoading === false) {
            setRemote((current) => (current.status === 'ready' ? current : { status: 'error', data: null, error: result.error }));
            return;
          }
          setRemote({ status: 'error', data: null, error: result.error });
          setForm(null);
          return;
        }
        setRemote({ status: 'ready', data: result.data, error: null });
        setForm((current) => (opts.keepForm && current ? current : toForm(result.data.settings)));
      }, []);

      React.useEffect(() => {
        void load();
      }, [load]);

      React.useEffect(() => {
        if (copyTimerRef.current !== null) {
          clearTimeout(copyTimerRef.current);
          copyTimerRef.current = null;
        }
        return () => {
          if (copyTimerRef.current !== null) {
            clearTimeout(copyTimerRef.current);
            copyTimerRef.current = null;
          }
        };
      }, []);

      React.useEffect(() => onboardingHub.subscribe((signal) => {
        if (signal === 'refresh') void load({ showLoading: false, keepForm: true });
      }), [load]);

      const flagCopied = (key) => {
        setCopied(key);
        if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => {
          copyTimerRef.current = null;
          setCopied(null);
        }, 1600);
      };

      const copyValue = async (key, value) => {
        try {
          const copiedOk = await copyText(value);
          if (copiedOk) {
            flagCopied(key);
            return;
          }
        } catch (error) {
          /* handled below */
        }
        setNotice({ tone: 'error', text: t('common.copyFailed') });
      };

      const updateForm = (mutate) => {
        setForm((current) => {
          if (!current) return current;
          const next = { ...current };
          mutate(next);
          return next;
        });
      };

      const setPermission = (key, value) => updateForm((next) => {
        next.permissions = { ...next.permissions, [key]: value };
      });
      const setFullAccess = (value) => updateForm((next) => {
        next.fullAccess = value;
      });
      const setServerEnabled = (value) => updateForm((next) => {
        next.server = { ...next.server, enabled: value };
      });
      const setScopeField = (key, value) => updateForm((next) => {
        next.scope = { ...next.scope, [key]: value };
      });
      const setLimitField = (key, value) => updateForm((next) => {
        next.limits = { ...next.limits, [key]: value };
      });

      const toggleFullAccess = () => {
        if (!form || busy !== null) return;
        if (form.fullAccess) {
          setFullAccess(false);
          setFullAccessPending(false);
          return;
        }
        if (!fullAccessPending) {
          setFullAccessPending(true);
          return;
        }
        setFullAccess(true);
        setFullAccessPending(false);
      };

      const applyRemote = (next, options) => {
        const opts = options || {};
        setRemote({ status: 'ready', data: next, error: null });
        setForm((current) => (opts.resetForm === false && current ? current : toForm(next.settings)));
      };

      const reportConflict = (outcome) => {
        if (outcome && outcome.reloaded) applyRemote(outcome.reloaded, { resetForm: false });
        setNotice({ tone: 'warn', text: t('saved.conflict') });
      };

      const save = async () => {
        if (!data || !form || busy !== null) return;
        const invalid = invalidLimitKeys(form.limits);
        if (invalid.length > 0) {
          setNotice({
            tone: 'error',
            text: t('limits.invalidFields', { fields: invalid.map((key) => t('limits.' + key)).join(', ') }),
          });
          return;
        }
        const patch = collectPatch(form, data.settings);
        if (Object.keys(patch).length === 0) {
          setNotice({ tone: 'ok', text: t('saved.noChanges') });
          return;
        }
        setBusy('save');
        setNotice(null);
        try {
          const outcome = await postStateAction('/settings', { revision: data.revision, patch });
          if (outcome.ok) {
            if (outcome.data) applyRemote(outcome.data, { resetForm: true });
            else void load({ showLoading: false, keepForm: true });
            setNotice({ tone: 'ok', text: t('saved.done') });
          } else if (outcome.conflict) {
            reportConflict(outcome);
          } else {
            setNotice({ tone: 'error', text: t('saveFailed') + '：' + describeError(t, outcome.error) });
          }
        } catch (error) {
          setNotice({ tone: 'error', text: t('saveFailed') + '：' + messageOf(error) });
        } finally {
          setBusy(null);
        }
      };

      const rotateToken = async () => {
        if (!data || busy !== null) return;
        setRotatePending(false);
        setBusy('rotate');
        setNotice(null);
        try {
          const outcome = await postStateAction('/token', { revision: data.revision });
          if (outcome.ok) {
            if (outcome.data) applyRemote(outcome.data, { resetForm: false });
            else void load({ showLoading: false, keepForm: true });
            setNotice({ tone: 'ok', text: t('rotateDone') });
          } else if (outcome.conflict) {
            reportConflict(outcome);
          } else {
            setNotice({ tone: 'error', text: t('rotateFailed') + '：' + describeError(t, outcome.error) });
          }
        } catch (error) {
          setNotice({ tone: 'error', text: t('rotateFailed') + '：' + messageOf(error) });
        } finally {
          setBusy(null);
        }
      };

      const restoreDefaults = async () => {
        if (!data || busy !== null) return;
        setResetPending(false);
        setBusy('restore');
        setNotice(null);
        const patch = {
          permissions: { ...DEFAULT_PERMISSIONS },
          fullAccess: false,
          scope: {
            sessionMode: DEFAULT_SCOPE.sessionMode,
            sessionIds: [],
            includeSubagents: DEFAULT_SCOPE.includeSubagents,
            modelMode: DEFAULT_SCOPE.modelMode,
            allowedModels: [],
            allowedRoots: [],
            defaultCwd: DEFAULT_SCOPE.defaultCwd,
            defaultModel: DEFAULT_SCOPE.defaultModel,
            newSessionPreset: DEFAULT_SCOPE.newSessionPreset,
          },
          limits: { ...DEFAULT_LIMITS },
        };
        try {
          const outcome = await postStateAction('/settings', { revision: data.revision, patch });
          if (outcome.ok) {
            if (outcome.data) applyRemote(outcome.data, { resetForm: true });
            else void load({ showLoading: false, keepForm: true });
            setNotice({ tone: 'ok', text: t('restoreDone') });
          } else if (outcome.conflict) {
            reportConflict(outcome);
          } else {
            setNotice({ tone: 'error', text: t('restoreFailed') + '：' + describeError(t, outcome.error) });
          }
        } catch (error) {
          setNotice({ tone: 'error', text: t('restoreFailed') + '：' + messageOf(error) });
        } finally {
          setBusy(null);
        }
      };

      const showWelcomeAgain = async () => {
        if (!data || busy !== null) return;
        setBusy('welcome');
        setNotice(null);
        try {
          // Host contract: POST /onboarding {shown:false} clears onboarding.shownAt
          // (settings patch must not be used for onboarding state).
          const outcome = await postStateAction('/onboarding', {
            revision: data.revision,
            shown: false,
          });
          if (outcome.ok) {
            if (outcome.data) applyRemote(outcome.data, { resetForm: false });
            else void load({ showLoading: false, keepForm: true });
            setNotice({ tone: 'ok', text: t('banner.reset') });
            onboardingHub.emit('reopen');
          } else if (outcome.conflict) {
            reportConflict(outcome);
          } else {
            setNotice({ tone: 'error', text: t('banner.failed') + '：' + describeError(t, outcome.error) });
          }
        } catch (error) {
          setNotice({ tone: 'error', text: t('banner.failed') + '：' + messageOf(error) });
        } finally {
          setBusy(null);
        }
      };

      if (remote.status === 'loading') {
        return h('div', { className: 'dshmcp-root dshmcp-settings', 'aria-busy': 'true' },
          h('div', { className: 'dshmcp-loading', role: 'status' }, t('common.loading')));
      }

      if (remote.status !== 'ready' || !data || !form) {
        return h('div', { className: 'dshmcp-root dshmcp-settings' },
          h(ErrorCard, {
            t,
            title: t('loadErrorTitle'),
            message: describeError(t, remote.error),
            hint: t('loadErrorHint'),
            onRetry: () => {
              void load();
            },
          }));
      }

      const dirty = hasChanges(form, data.settings);
      const acknowledged = isAcknowledged(data);
      const children = [];
      if (!acknowledged) {
        children.push(h(OnboardingBanner, {
          key: 'banner',
          t,
          busy,
          onShowWelcome: () => {
            void showWelcomeAgain();
          },
        }));
      }
      children.push(h(Notice, { key: 'notice', notice }));
      children.push(h(StatusCard, {
        key: 'status',
        t,
        data,
        form,
        busy,
        copied,
        showToken,
        rotatePending,
        onToggleServer: (value) => setServerEnabled(value),
        onToggleToken: () => setShowToken((value) => !value),
        onCopy: (key, value) => {
          void copyValue(key, value);
        },
        onRotate: () => setRotatePending(true),
        onCancelRotate: () => setRotatePending(false),
        onConfirmRotate: () => {
          void rotateToken();
        },
      }));
      children.push(h(PermissionsCard, {
        key: 'permissions',
        t,
        permissions: form.permissions,
        fullAccess: form.fullAccess,
        fullAccessPending,
        busy,
        onTogglePermission: setPermission,
        onToggleFullAccess: toggleFullAccess,
        onConfirmFullAccess: () => {
          setFullAccess(true);
          setFullAccessPending(false);
        },
        onCancelFullAccess: () => setFullAccessPending(false),
      }));
      children.push(h(ScopeCard, {
        key: 'scope',
        t,
        scope: form.scope,
        catalog: isObject(data.catalog) ? data.catalog : {},
        busy,
        onChange: setScopeField,
      }));
      children.push(h(LimitsCard, {
        key: 'limits',
        t,
        limits: form.limits,
        busy,
        onChange: setLimitField,
      }));
      children.push(h(ActionsBar, {
        key: 'actions',
        t,
        dirty,
        busy,
        resetPending,
        onShowWelcome: () => {
          void showWelcomeAgain();
        },
        onSave: () => {
          void save();
        },
        onReset: () => setResetPending(true),
        onCancelReset: () => setResetPending(false),
        onConfirmReset: () => {
          void restoreDefaults();
        },
      }));

      return h('div', { className: 'dshmcp-root dshmcp-settings' }, ...children);
    }

    // ------------------------------------------------------------------ onboarding overlay
    function OnboardingOverlay({ localeService }) {
      const language = useLanguage(localeService);
      const t = React.useMemo(() => createTranslator(language), [language]);
      const [data, setData] = React.useState(null);
      const [open, setOpen] = React.useState(false);
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState(null);
      const [showToken, setShowToken] = React.useState(false);
      const [copied, setCopied] = React.useState(null);
      const autoOpenRef = React.useRef(false);
      const dismissedRef = React.useRef(false);
      const revisionRef = React.useRef(null);
      const primaryRef = React.useRef(null);
      const copyTimerRef = React.useRef(null);
      const shownRevisionRef = React.useRef(null);

      React.useEffect(() => () => {
        if (copyTimerRef.current !== null) {
          clearTimeout(copyTimerRef.current);
          copyTimerRef.current = null;
        }
      }, []);

      const flagCopied = (key) => {
        setCopied(key);
        if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => {
          copyTimerRef.current = null;
          setCopied(null);
        }, 1600);
      };

      const copyValue = async (key, value) => {
        try {
          const copiedOk = await copyText(value);
          if (copiedOk) {
            flagCopied(key);
            return;
          }
        } catch (ignored) {
          /* fall through */
        }
        setError(t('common.copyFailed'));
      };

      /** Persist `shownAt` once per displayed revision; failures stay non-blocking. */
      const markShown = React.useCallback(async (revision) => {
        if (typeof revision !== 'number' || shownRevisionRef.current === revision) return;
        shownRevisionRef.current = revision;
        const result = await requestJson('POST', '/onboarding', { revision, shown: true });
        if (result.ok) {
          const next = isObject(result.data) && isObject(result.data.settings) ? result.data : null;
          if (next) {
            revisionRef.current = next.revision;
            setData((current) => (current ? { ...current, revision: next.revision, onboarding: next.onboarding || current.onboarding } : next));
          }
          return;
        }
        if (result.status === 409) {
          const reloaded = await getGatewayState();
          if (reloaded.ok) {
            revisionRef.current = reloaded.data.revision;
            setData(reloaded.data);
            const retried = await requestJson('POST', '/onboarding', {
              revision: reloaded.data.revision,
              shown: true,
            });
            if (retried.ok) {
              shownRevisionRef.current = reloaded.data.revision;
              setError(null);
              return;
            }
          }
        }
        setError(t('overlay.shownFailed', { message: describeError(t, result.error) }));
      }, [t]);

      const openWith = React.useCallback((state) => {
        revisionRef.current = typeof state.revision === 'number' ? state.revision : null;
        setData(state);
        setError(null);
        setShowToken(false);
        setOpen(true);
        void markShown(revisionRef.current);
      }, [markShown]);

      React.useEffect(() => {
        let active = true;
        void (async () => {
          const result = await getGatewayState();
          if (!active || !result.ok) return;
          const state = result.data;
          revisionRef.current = state.revision;
          if (!dismissedRef.current && isFirstRun(state) && !autoOpenRef.current) {
            autoOpenRef.current = true;
            openWith(state);
            return;
          }
          setData(state);
        })();
        return () => {
          active = false;
        };
      }, [openWith]);

      React.useEffect(() => onboardingHub.subscribe((signal) => {
        if (signal !== 'reopen') return;
        dismissedRef.current = false;
        autoOpenRef.current = true;
        void (async () => {
          const result = await getGatewayState();
          if (!result.ok) return;
          openWith(result.data);
        })();
      }), [openWith]);

      React.useEffect(() => {
        if (!open) return undefined;
        const onKeyDown = (event) => {
          if (event.key !== 'Escape' && event.key !== 'Esc') return;
          event.preventDefault();
          event.stopPropagation();
          dismissedRef.current = true;
          setOpen(false);
        };
        document.addEventListener('keydown', onKeyDown, true);
        return () => document.removeEventListener('keydown', onKeyDown, true);
      }, [open]);

      React.useEffect(() => {
        if (!open) return undefined;
        const handle = setTimeout(() => {
          try {
            if (primaryRef.current && typeof primaryRef.current.focus === 'function') primaryRef.current.focus();
          } catch (ignored) {
            /* ignore */
          }
        }, 0);
        return () => clearTimeout(handle);
      }, [open]);

      const dismiss = () => {
        dismissedRef.current = true;
        setError(null);
        setOpen(false);
      };

      const acknowledge = async () => {
        if (busy) return;
        setBusy(true);
        setError(null);
        try {
          let revision = revisionRef.current;
          let result = await requestJson('POST', '/onboarding', { revision, acknowledged: true });
          if (!result.ok && result.status === 409) {
            const reloaded = await getGatewayState();
            if (reloaded.ok) {
              revision = reloaded.data.revision;
              revisionRef.current = revision;
              setData(reloaded.data);
              result = await requestJson('POST', '/onboarding', { revision, acknowledged: true });
            }
          }
          if (!result.ok) {
            setError(t('overlay.ackFailed', { message: describeError(t, result.error) }));
            return;
          }
          const next = isObject(result.data) && isObject(result.data.settings) ? result.data : null;
          if (next) {
            revisionRef.current = next.revision;
            setData(next);
          }
          dismissedRef.current = true;
          setOpen(false);
          onboardingHub.emit('refresh');
        } catch (caught) {
          setError(t('overlay.ackFailed', { message: messageOf(caught) }));
        } finally {
          setBusy(false);
        }
      };

      if (!open || !data) return null;

      const mcpUrl = resolveMcpUrl(data);
      const token = readToken(data);
      const masked = showToken ? (token || t('common.empty')) : (maskToken(token) || t('common.empty'));
      const json = clientJson(mcpUrl, token);

      return h('div', { className: 'dshmcp-root dshmcp-overlay' },
        h('div', {
          className: 'dshmcp-modal',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': 'dshmcp-onboarding-title',
        },
        h('h2', { id: 'dshmcp-onboarding-title', className: 'dshmcp-modal__title' }, t('overlay.title')),
        h('p', { className: 'dshmcp-modal__subtitle' }, t('overlay.intro')),
        h('div', { className: 'dshmcp-risk', role: 'alert' },
          h('div', { className: 'dshmcp-risk__title' }, t('overlay.riskTitle')),
          h('p', { className: 'dshmcp-risk__body' }, t('overlay.riskBody'))),
        h('div', { className: 'dshmcp-checklist' },
          h('div', { className: 'dshmcp-checklist__title' }, t('overlay.defaultsTitle')),
          h('ul', null,
            h('li', null, t('overlay.defaultsBasic')),
            h('li', null, t('overlay.defaultsExtended')))),
        h('div', { className: 'dshmcp-kv' },
          h('div', { className: 'dshmcp-kv__row' },
            h('span', { className: 'dshmcp-kv__key' }, t('overlay.endpoint')),
            h(ValueRow, {
              value: mcpUrl,
              ariaLabel: t('overlay.endpoint'),
              buttons: [h(ActionButton, {
                key: 'copy-url',
                variant: 'secondary',
                size: 'sm',
                disabled: !mcpUrl,
                onClick: () => {
                  void copyValue('url', mcpUrl);
                },
              }, copied === 'url' ? t('common.copied') : t('common.copyUrl'))],
            })),
          h('div', { className: 'dshmcp-kv__row' },
            h('span', { className: 'dshmcp-kv__key' }, t('overlay.token')),
            h(ValueRow, {
              value: masked,
              ariaLabel: t('overlay.token'),
              buttons: [
                h(ActionButton, {
                  key: 'toggle-token',
                  variant: 'ghost',
                  size: 'sm',
                  onClick: () => setShowToken((value) => !value),
                }, showToken ? t('common.hide') : t('common.show')),
                h(ActionButton, {
                  key: 'copy-token',
                  variant: 'secondary',
                  size: 'sm',
                  disabled: !token,
                  onClick: () => {
                    void copyValue('token', token);
                  },
                }, copied === 'token' ? t('common.copied') : t('common.copy')),
              ],
            }))),
        h('div', { className: 'dshmcp-modal__actions' },
          h(ActionButton, {
            variant: 'secondary',
            disabled: !mcpUrl,
            onClick: () => {
              void copyValue('json', json);
            },
          }, copied === 'json' ? t('common.copied') : t('status.copyJson')),
          h('span', { className: 'dshmcp-field__hint' }, t('status.copyJsonHint'))),
        error ? h('div', { className: 'dshmcp-notice dshmcp-notice--error', role: 'alert' }, error) : null,
        h('div', { className: 'dshmcp-modal__footer' },
          h(ActionButton, {
            variant: 'secondary',
            disabled: busy,
            onClick: dismiss,
          }, t('overlay.later')),
          h(ActionButton, {
            variant: 'primary',
            buttonRef: primaryRef,
            disabled: busy,
            onClick: () => {
              void acknowledge();
            },
          }, busy ? t('actions.saving') : t('overlay.save')))));
    }

    // ================================================================== v2 helpers
    function pickText(zh, en, language) {
      return language === 'zh' ? zh : en;
    }

    function capabilityFromMeta(key, language) {
      const meta = CAPABILITY_META[key];
      if (!meta) return null;
      return {
        key,
        level: meta.level,
        title: pickText(meta.title, meta.titleEn, language),
        titleZh: meta.title,
        titleEn: meta.titleEn,
        description: pickText(meta.description, meta.descriptionEn, language),
        descriptionZh: meta.description,
        descriptionEn: meta.descriptionEn,
        tools: Array.isArray(meta.tools) ? meta.tools.slice() : [],
      };
    }

    function fallbackLevelsV2(language) {
      return CAPABILITY_LEVEL_ORDER_V2.map((id) => {
        const level = CAPABILITY_LEVEL_META[id];
        return {
          id,
          title: pickText(level.title, level.titleEn, language),
          titleZh: level.title,
          titleEn: level.titleEn,
          description: pickText(level.description, level.descriptionEn, language),
          descriptionZh: level.description,
          descriptionEn: level.descriptionEn,
          capabilities: CAPABILITY_KEYS_V2
            .filter((key) => CAPABILITY_META[key].level === id)
            .map((key) => Object.assign(capabilityFromMeta(key, language), {
              checked: CAPABILITY_META[key].level === 'basic',
            })),
        };
      });
    }

    /** Normalize catalog.capabilities into ordered levels with mixed metadata. */
    function capabilityLevelsV2(data, language) {
      const catalog = isObject(data) && isObject(data.catalog) ? data.catalog : {};
      const hostLevels = Array.isArray(catalog.capabilities) ? catalog.capabilities : [];
      return CAPABILITY_LEVEL_ORDER_V2.map((levelId) => {
        const fallback = fallbackLevelsV2(language).find((entry) => entry.id === levelId);
        const hostLevel = hostLevels.find((entry) => entry && entry.id === levelId);
        const hostCapabilities = hostLevel && Array.isArray(hostLevel.capabilities) ? hostLevel.capabilities : [];
        const capabilities = (hostCapabilities.length > 0 ? hostCapabilities : fallback.capabilities).map((entry) => {
          const key = typeof entry.key === 'string' ? entry.key : '';
          const meta = key ? CAPABILITY_META[key] : null;
          const titleZh = (meta && meta.title) || (typeof entry.title === 'string' ? entry.title : key);
          const titleEn = (meta && meta.titleEn) || (typeof entry.titleEn === 'string' ? entry.titleEn : key);
          const descriptionZh = (meta && meta.description) || (typeof entry.description === 'string' ? entry.description : '');
          const descriptionEn = (meta && meta.descriptionEn) || (typeof entry.descriptionEn === 'string' ? entry.descriptionEn : '');
          return {
            key,
            level: levelId,
            title: pickText(titleZh, titleEn, language),
            titleZh,
            titleEn,
            description: pickText(descriptionZh, descriptionEn, language),
            descriptionZh,
            descriptionEn,
            tools: Array.isArray(entry.tools) ? entry.tools.slice() : (meta && Array.isArray(meta.tools) ? meta.tools.slice() : []),
            checked: entry.checked === true,
          };
        });
        const levelTitleZh = (hostLevel && typeof hostLevel.title === 'string') ? hostLevel.title : fallback.titleZh;
        const levelTitleEn = (hostLevel && typeof hostLevel.titleEn === 'string') ? hostLevel.titleEn : fallback.titleEn;
        const levelDescZh = (hostLevel && typeof hostLevel.description === 'string') ? hostLevel.description : fallback.descriptionZh;
        const levelDescEn = (hostLevel && typeof hostLevel.descriptionEn === 'string') ? hostLevel.descriptionEn : fallback.descriptionEn;
        return {
          id: levelId,
          title: pickText(levelTitleZh, levelTitleEn, language),
          titleZh: levelTitleZh,
          titleEn: levelTitleEn,
          description: pickText(levelDescZh, levelDescEn, language),
          descriptionZh: levelDescZh,
          descriptionEn: levelDescEn,
          capabilities,
        };
      });
    }

    function approvalModesV2(data, language) {
      const catalog = isObject(data) && isObject(data.catalog) ? data.catalog : {};
      const hostModes = Array.isArray(catalog.approvalModes)
        ? catalog.approvalModes
        : (Array.isArray(catalog.approvals) ? catalog.approvals : []);
      return (hostModes.length > 0 ? hostModes : APPROVAL_MODE_VALUES_V2.map((value) => APPROVAL_MODE_META[value]))
        .filter((entry) => entry && APPROVAL_MODE_VALUES_V2.indexOf(entry.value) !== -1)
        .map((entry) => {
          const meta = APPROVAL_MODE_META[entry.value];
          return {
            value: entry.value,
            title: typeof entry.title === 'string' ? entry.title : meta.title,
            titleEn: typeof entry.titleEn === 'string' ? entry.titleEn : meta.titleEn,
            description: typeof entry.description === 'string' ? entry.description : meta.description,
            descriptionEn: typeof entry.descriptionEn === 'string' ? entry.descriptionEn : meta.descriptionEn,
          };
        });
    }

    function approvalModeTextV2(mode, language) {
      const meta = APPROVAL_MODE_META[mode] || APPROVAL_MODE_META[DEFAULT_APPROVAL_MODE_V2];
      return pickText(meta.title, meta.titleEn, language);
    }

    function approvalModeDescriptionV2(mode, language) {
      const meta = APPROVAL_MODE_META[mode] || APPROVAL_MODE_META[DEFAULT_APPROVAL_MODE_V2];
      return pickText(meta.description, meta.descriptionEn, language);
    }

    // ------------------------------------------------------------------ v2 settings <-> form
    function toFormV2(settings) {
      const source = isObject(settings) ? settings : {};
      const capabilities = {};
      for (const key of CAPABILITY_KEYS_V2) {
        capabilities[key] = isObject(source.capabilities) && source.capabilities[key] === true;
      }
      const scope = isObject(source.scope) ? source.scope : {};
      const limits = isObject(source.limits) ? source.limits : {};
      const server = isObject(source.server) ? source.server : {};
      return {
        approvalMode: APPROVAL_MODE_VALUES_V2.indexOf(source.approvalMode) !== -1
          ? source.approvalMode
          : DEFAULT_APPROVAL_MODE_V2,
        capabilities,
        server: { enabled: server.enabled !== false },
        scope: {
          sessionMode: normalizeScopeModeV2(scope.sessionMode),
          sessionIds: Array.isArray(scope.sessionIds) ? scope.sessionIds.filter((id) => typeof id === 'string' && id) : [],
          sessionIdsText: linesFromArray(scope.sessionIds),
          includeSubagents: scope.includeSubagents === true,
          modelMode: normalizeScopeModeV2(scope.modelMode),
          allowedModels: Array.isArray(scope.allowedModels) ? scope.allowedModels.filter((key) => typeof key === 'string' && key) : [],
          allowedModelsText: linesFromArray(scope.allowedModels),
          allowedRootsText: linesFromArray(scope.allowedRoots),
          defaultCwd: typeof scope.defaultCwd === 'string' ? scope.defaultCwd : '',
          defaultModel: typeof scope.defaultModel === 'string' ? scope.defaultModel : '',
          newSessionPreset: typeof scope.newSessionPreset === 'string' ? scope.newSessionPreset : '',
        },
        limits: {
          maxReadMessages: numberOf(limits.maxReadMessages, DEFAULT_LIMITS_V2.maxReadMessages),
          maxReadChars: numberOf(limits.maxReadChars, DEFAULT_LIMITS_V2.maxReadChars),
          maxMessageChars: numberOf(limits.maxMessageChars, DEFAULT_LIMITS_V2.maxMessageChars),
          defaultWaitMs: numberOf(limits.defaultWaitMs, DEFAULT_LIMITS_V2.defaultWaitMs),
          maxWaitMs: numberOf(limits.maxWaitMs, DEFAULT_LIMITS_V2.maxWaitMs),
          approvalTimeoutMs: numberOf(limits.approvalTimeoutMs, DEFAULT_LIMITS_V2.approvalTimeoutMs),
          sendWhenBusy: limits.sendWhenBusy === 'reject' ? 'reject' : 'queue',
        },
      };
    }

    function scopeFromFormV2(scope) {
      const source = isObject(scope) ? scope : {};
      return {
        sessionMode: normalizeScopeModeV2(source.sessionMode),
        sessionIds: linesToArray(source.sessionIdsText),
        includeSubagents: source.includeSubagents === true,
        modelMode: normalizeScopeModeV2(source.modelMode),
        allowedModels: linesToArray(source.allowedModelsText),
        allowedRoots: linesToArray(source.allowedRootsText),
        defaultCwd: typeof source.defaultCwd === 'string' ? source.defaultCwd.trim() : '',
        defaultModel: typeof source.defaultModel === 'string' ? source.defaultModel.trim() : '',
        newSessionPreset: typeof source.newSessionPreset === 'string' ? source.newSessionPreset : '',
      };
    }

    function limitsFromFormV2(limits) {
      const source = isObject(limits) ? limits : {};
      const result = {};
      for (const key of NUMERIC_LIMIT_KEYS_V2) {
        const value = source[key];
        result[key] = typeof value === 'number' ? value : Number(value);
      }
      result.sendWhenBusy = source.sendWhenBusy === 'reject' ? 'reject' : 'queue';
      return result;
    }

    function invalidLimitKeysV2(limits) {
      const source = isObject(limits) ? limits : {};
      return NUMERIC_LIMIT_KEYS_V2.filter((key) => !isValidLimitValue(source[key]));
    }

    function collectPatchV2(form, serverSettings) {
      const baseline = toFormV2(serverSettings);
      const patch = {};
      if (form.approvalMode !== baseline.approvalMode) patch.approvalMode = form.approvalMode;
      if (!sameJson(form.capabilities, baseline.capabilities)) {
        patch.capabilities = Object.assign({}, form.capabilities);
      }
      if (form.server.enabled !== baseline.server.enabled) {
        patch.server = { enabled: form.server.enabled === true };
      }
      const scope = scopeFromFormV2(form.scope);
      if (!sameJson(scope, scopeFromFormV2(baseline.scope))) patch.scope = scope;
      const limits = limitsFromFormV2(form.limits);
      if (!sameJson(limits, limitsFromFormV2(baseline.limits))) patch.limits = limits;
      return patch;
    }

    function hasChangesV2(form, serverSettings) {
      return Object.keys(collectPatchV2(form, serverSettings)).length > 0;
    }

    function setSessionSelectionV2(form, nextIds) {
      const unique = [];
      const seen = new Set();
      for (const id of Array.isArray(nextIds) ? nextIds : []) {
        if (typeof id !== 'string' || !id || seen.has(id)) continue;
        seen.add(id);
        unique.push(id);
      }
      return Object.assign({}, form, {
        scope: Object.assign({}, form.scope, {
          sessionIds: unique,
          sessionIdsText: linesFromArray(unique),
        }),
      });
    }

    function setModelSelectionV2(form, nextKeys) {
      const unique = [];
      const seen = new Set();
      for (const key of Array.isArray(nextKeys) ? nextKeys : []) {
        if (typeof key !== 'string' || !key || seen.has(key)) continue;
        seen.add(key);
        unique.push(key);
      }
      return Object.assign({}, form, {
        scope: Object.assign({}, form.scope, {
          allowedModels: unique,
          allowedModelsText: linesFromArray(unique),
        }),
      });
    }

    function toggleIdInListV2(list, id) {
      const values = Array.isArray(list) ? list.slice() : [];
      const index = values.indexOf(id);
      if (index >= 0) values.splice(index, 1);
      else values.push(id);
      return values;
    }

    function modelOptionListV2(data, language) {
      const catalog = isObject(data) && isObject(data.catalog) ? data.catalog : {};
      const providers = Array.isArray(catalog.models) ? catalog.models : [];
      const result = [];
      for (const provider of providers) {
        if (!isObject(provider) || !Array.isArray(provider.models)) continue;
        for (const model of provider.models) {
          if (!isObject(model) || typeof model.id !== 'string') continue;
          const key = String(provider.provider || provider.id || '') + '/' + model.id;
          result.push({
            key,
            provider: provider.provider || provider.id || '',
            providerName: provider.providerName || provider.name || provider.provider || provider.id || '',
            id: model.id,
            name: typeof model.name === 'string' ? model.name : model.id,
            description: typeof model.description === 'string' ? model.description : '',
            label: (typeof model.name === 'string' ? model.name : model.id) + ' · ' + key,
          });
        }
      }
      return result;
    }

    function presetOptionListV2(data) {
      const catalog = isObject(data) && isObject(data.catalog) ? data.catalog : {};
      const presets = Array.isArray(catalog.permissionPresets) ? catalog.permissionPresets : [];
      return presets
        .filter((entry) => isObject(entry) && typeof entry.value === 'string')
        .map((entry) => ({
          value: entry.value,
          label: entry.name ? entry.name + ' (' + entry.value + ')' : entry.value,
        }));
    }

    function capabilityCheckedCountV2(capabilities) {
      let count = 0;
      for (const key of CAPABILITY_KEYS_V2) if (capabilities && capabilities[key] === true) count += 1;
      return count;
    }

    function capabilityLevelStatsV2(level, capabilities) {
      const total = level.capabilities.length;
      let checked = 0;
      for (const capability of level.capabilities) {
        if (capabilities[capability.key] === true) checked += 1;
      }
      return { total, checked, all: total > 0 && checked === total, some: checked > 0 && checked < total };
    }

    // ------------------------------------------------------------------ v2 icons
    function iconPaths(name) {
      switch (name) {
        case 'shield':
          return [
            h('path', { key: 's', d: 'M10 2.4l5.7 2.2v4.2c0 3.5-2.3 6.4-5.7 7.5-3.4-1.1-5.7-4-5.7-7.5V4.6L10 2.4z', fill: 'none', stroke: 'currentColor', strokeWidth: '1.4', strokeLinejoin: 'round' }),
          ];
        case 'shieldCheck':
          return [
            h('path', { key: 's', d: 'M10 2.4l5.7 2.2v4.2c0 3.5-2.3 6.4-5.7 7.5-3.4-1.1-5.7-4-5.7-7.5V4.6L10 2.4z', fill: 'none', stroke: 'currentColor', strokeWidth: '1.4', strokeLinejoin: 'round' }),
            h('path', { key: 'c', d: 'M7.2 9.8l2 2 3.7-3.9', fill: 'none', stroke: 'currentColor', strokeWidth: '1.4', strokeLinecap: 'round', strokeLinejoin: 'round' }),
          ];
        case 'shieldAlert':
          return [
            h('path', { key: 's', d: 'M10 2.4l5.7 2.2v4.2c0 3.5-2.3 6.4-5.7 7.5-3.4-1.1-5.7-4-5.7-7.5V4.6L10 2.4z', fill: 'none', stroke: 'currentColor', strokeWidth: '1.4', strokeLinejoin: 'round' }),
            h('path', { key: 'b', d: 'M10 6.4v4', fill: 'none', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round' }),
            h('circle', { key: 'd', cx: '10', cy: '13.6', r: '0.9', fill: 'currentColor' }),
          ];
        case 'check':
          return [h('path', { key: 'c', d: 'M4.5 10.2l3.4 3.4 7.6-7.7', fill: 'none', stroke: 'currentColor', strokeWidth: '1.6', strokeLinecap: 'round', strokeLinejoin: 'round' })];
        case 'x':
          return [h('path', { key: 'x', d: 'M5 5l10 10M15 5L5 15', fill: 'none', stroke: 'currentColor', strokeWidth: '1.6', strokeLinecap: 'round' })];
        case 'minus':
          return [h('path', { key: 'm', d: 'M5 10h10', fill: 'none', stroke: 'currentColor', strokeWidth: '1.6', strokeLinecap: 'round' })];
        case 'square':
          return [h('rect', { key: 'r', x: '4', y: '4', width: '12', height: '12', rx: '3', fill: 'none', stroke: 'currentColor', strokeWidth: '1.3' })];
        case 'squareCheck':
          return [
            h('rect', { key: 'r', x: '4', y: '4', width: '12', height: '12', rx: '3', fill: 'none', stroke: 'currentColor', strokeWidth: '1.3' }),
            h('path', { key: 'c', d: 'M7 10.2l2.1 2.1 4-4.1', fill: 'none', stroke: 'currentColor', strokeWidth: '1.4', strokeLinecap: 'round', strokeLinejoin: 'round' }),
          ];
        case 'squareMinus':
          return [
            h('rect', { key: 'r', x: '4', y: '4', width: '12', height: '12', rx: '3', fill: 'none', stroke: 'currentColor', strokeWidth: '1.3' }),
            h('path', { key: 'm', d: 'M7 10h6', fill: 'none', stroke: 'currentColor', strokeWidth: '1.4', strokeLinecap: 'round' }),
          ];
        case 'chevronDown':
          return [h('path', { key: 'c', d: 'M5.5 7.5L10 12l4.5-4.5', fill: 'none', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' })];
        case 'chevronRight':
          return [h('path', { key: 'c', d: 'M7.5 5.5L12 10l-4.5 4.5', fill: 'none', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' })];
        case 'copy':
          return [
            h('rect', { key: 'a', x: '7', y: '7', width: '9', height: '9', rx: '2', fill: 'none', stroke: 'currentColor', strokeWidth: '1.3' }),
            h('path', { key: 'b', d: 'M4 12.5V5.8C4 4.8 4.8 4 5.8 4h6.7', fill: 'none', stroke: 'currentColor', strokeWidth: '1.3', strokeLinecap: 'round' }),
          ];
        case 'refresh':
          return [
            h('path', { key: 'a', d: 'M16 10a6 6 0 1 1-1.8-4.3', fill: 'none', stroke: 'currentColor', strokeWidth: '1.4', strokeLinecap: 'round' }),
            h('path', { key: 'b', d: 'M16 3.8V7.6h-3.8', fill: 'none', stroke: 'currentColor', strokeWidth: '1.4', strokeLinecap: 'round', strokeLinejoin: 'round' }),
          ];
        case 'eye':
          return [
            h('path', { key: 'a', d: 'M2.5 10s2.8-4.5 7.5-4.5 7.5 4.5 7.5 4.5-2.8 4.5-7.5 4.5S2.5 10 2.5 10z', fill: 'none', stroke: 'currentColor', strokeWidth: '1.3' }),
            h('circle', { key: 'b', cx: '10', cy: '10', r: '2', fill: 'none', stroke: 'currentColor', strokeWidth: '1.3' }),
          ];
        case 'eyeOff':
          return [
            h('path', { key: 'a', d: 'M3 3l14 14', fill: 'none', stroke: 'currentColor', strokeWidth: '1.4', strokeLinecap: 'round' }),
            h('path', { key: 'b', d: 'M7.2 6.2C8 5.8 9 5.5 10 5.5c4.7 0 7.5 4.5 7.5 4.5a12 12 0 0 1-2.3 2.7M6.1 7.8A12 12 0 0 0 2.5 10s2.8 4.5 7.5 4.5c1 0 1.9-.2 2.7-.6', fill: 'none', stroke: 'currentColor', strokeWidth: '1.3', strokeLinecap: 'round' }),
          ];
        case 'robot':
          return [
            h('rect', { key: 'a', x: '4', y: '7', width: '12', height: '9', rx: '2.5', fill: 'none', stroke: 'currentColor', strokeWidth: '1.3' }),
            h('circle', { key: 'b', cx: '7.5', cy: '11.5', r: '1', fill: 'currentColor' }),
            h('circle', { key: 'c', cx: '12.5', cy: '11.5', r: '1', fill: 'currentColor' }),
            h('path', { key: 'd', d: 'M10 7V4.5M7.5 16v1.2M12.5 16v1.2', fill: 'none', stroke: 'currentColor', strokeWidth: '1.3', strokeLinecap: 'round' }),
          ];
        case 'server':
          return [
            h('rect', { key: 'a', x: '3.5', y: '4', width: '13', height: '5', rx: '1.6', fill: 'none', stroke: 'currentColor', strokeWidth: '1.3' }),
            h('rect', { key: 'b', x: '3.5', y: '11', width: '13', height: '5', rx: '1.6', fill: 'none', stroke: 'currentColor', strokeWidth: '1.3' }),
            h('circle', { key: 'c', cx: '6.3', cy: '6.5', r: '0.8', fill: 'currentColor' }),
            h('circle', { key: 'd', cx: '6.3', cy: '13.5', r: '0.8', fill: 'currentColor' }),
          ];
        case 'plug':
          return [
            h('path', { key: 'a', d: 'M7 3v4M13 3v4M5 7h10v2a5 5 0 0 1-10 0V7zM10 14v3', fill: 'none', stroke: 'currentColor', strokeWidth: '1.3', strokeLinecap: 'round', strokeLinejoin: 'round' }),
          ];
        case 'message':
          return [
            h('path', { key: 'a', d: 'M4 4.5h12v8H9l-3.5 3v-3H4z', fill: 'none', stroke: 'currentColor', strokeWidth: '1.3', strokeLinejoin: 'round' }),
          ];
        case 'arrowRight':
          return [h('path', { key: 'a', d: 'M4 10h11M11 6l4 4-4 4', fill: 'none', stroke: 'currentColor', strokeWidth: '1.4', strokeLinecap: 'round', strokeLinejoin: 'round' })];
        case 'rotate':
          return [
            h('path', { key: 'a', d: 'M5 7.5A6 6 0 1 1 4.2 12', fill: 'none', stroke: 'currentColor', strokeWidth: '1.4', strokeLinecap: 'round' }),
            h('path', { key: 'b', d: 'M4.8 3.8v4h4', fill: 'none', stroke: 'currentColor', strokeWidth: '1.4', strokeLinecap: 'round', strokeLinejoin: 'round' }),
          ];
        case 'lock':
          return [
            h('rect', { key: 'a', x: '4.5', y: '9', width: '11', height: '7.5', rx: '2', fill: 'none', stroke: 'currentColor', strokeWidth: '1.3' }),
            h('path', { key: 'b', d: 'M7 9V7a3 3 0 0 1 6 0v2', fill: 'none', stroke: 'currentColor', strokeWidth: '1.3' }),
          ];
        case 'info':
          return [
            h('circle', { key: 'a', cx: '10', cy: '10', r: '7', fill: 'none', stroke: 'currentColor', strokeWidth: '1.3' }),
            h('path', { key: 'b', d: 'M10 9v5', fill: 'none', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round' }),
            h('circle', { key: 'c', cx: '10', cy: '6.4', r: '0.9', fill: 'currentColor' }),
          ];
        case 'list':
          return [
            h('path', { key: 'a', d: 'M7 5.5h9M7 10h9M7 14.5h9', fill: 'none', stroke: 'currentColor', strokeWidth: '1.2', strokeLinecap: 'round' }),
            h('circle', { key: 'b', cx: '4.3', cy: '5.5', r: '0.9', fill: 'currentColor' }),
            h('circle', { key: 'c', cx: '4.3', cy: '10', r: '0.9', fill: 'currentColor' }),
            h('circle', { key: 'd', cx: '4.3', cy: '14.5', r: '0.9', fill: 'currentColor' }),
          ];
        case 'checkList':
          return [
            h('path', { key: 'a', d: 'M4 6l1.5 1.5L8 5M4 13l1.5 1.5L8 12', fill: 'none', stroke: 'currentColor', strokeWidth: '1.3', strokeLinecap: 'round', strokeLinejoin: 'round' }),
            h('path', { key: 'b', d: 'M10.5 6h5.5M10.5 13h5.5', fill: 'none', stroke: 'currentColor', strokeWidth: '1.3', strokeLinecap: 'round' }),
          ];
        case 'send':
          return [
            h('path', { key: 'a', d: 'M3.2 9.6L17 3.8l-5.1 13-2.8-5.4-5.9-1.8z', fill: 'none', stroke: 'currentColor', strokeWidth: '1.3', strokeLinejoin: 'round' }),
            h('path', { key: 'b', d: 'M9.1 11.4L17 3.8', fill: 'none', stroke: 'currentColor', strokeWidth: '1.1', strokeLinecap: 'round' }),
          ];
        case 'clock':
          return [
            h('circle', { key: 'a', cx: '10', cy: '10', r: '7', fill: 'none', stroke: 'currentColor', strokeWidth: '1.3' }),
            h('path', { key: 'b', d: 'M10 5.8v4.6l3 1.8', fill: 'none', stroke: 'currentColor', strokeWidth: '1.3', strokeLinecap: 'round', strokeLinejoin: 'round' }),
          ];
        case 'cpu':
          return [
            h('rect', { key: 'a', x: '5', y: '5', width: '10', height: '10', rx: '2', fill: 'none', stroke: 'currentColor', strokeWidth: '1.3' }),
            h('rect', { key: 'b', x: '7.5', y: '7.5', width: '5', height: '5', rx: '1', fill: 'none', stroke: 'currentColor', strokeWidth: '1.2' }),
            h('path', { key: 'c', d: 'M8 3v2M12 3v2M8 15v2M12 15v2M3 8h2M3 12h2M15 8h2M15 12h2', fill: 'none', stroke: 'currentColor', strokeWidth: '1.2', strokeLinecap: 'round' }),
          ];
        case 'sparkles':
          return [
            h('path', { key: 'a', d: 'M10 3l1.4 4.1L15.5 8.5l-4.1 1.4L10 14l-1.4-4.1-4.1-1.4 4.1-1.4L10 3z', fill: 'none', stroke: 'currentColor', strokeWidth: '1.2', strokeLinejoin: 'round' }),
            h('path', { key: 'b', d: 'M15.2 13.2l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7.7-1.9z', fill: 'currentColor' }),
          ];
        case 'plus':
          return [h('path', { key: 'a', d: 'M10 4.5v11M4.5 10h11', fill: 'none', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round' })];
        case 'stop':
          return [h('rect', { key: 'a', x: '5.2', y: '5.2', width: '9.6', height: '9.6', rx: '2', fill: 'none', stroke: 'currentColor', strokeWidth: '1.4' })];
        case 'fork':
          return [
            h('circle', { key: 'a', cx: '6', cy: '5', r: '1.6', fill: 'none', stroke: 'currentColor', strokeWidth: '1.2' }),
            h('circle', { key: 'b', cx: '6', cy: '15', r: '1.6', fill: 'none', stroke: 'currentColor', strokeWidth: '1.2' }),
            h('circle', { key: 'c', cx: '14', cy: '5', r: '1.6', fill: 'none', stroke: 'currentColor', strokeWidth: '1.2' }),
            h('path', { key: 'd', d: 'M6 6.6v6.8M7.3 12.2c2.9 0 5.2-1.9 5.2-5.2', fill: 'none', stroke: 'currentColor', strokeWidth: '1.2', strokeLinecap: 'round' }),
          ];
        case 'pencil':
          return [
            h('path', { key: 'a', d: 'M4 16l1-3.6L13.6 4a1.7 1.7 0 0 1 2.4 2.4L7.6 15 4 16z', fill: 'none', stroke: 'currentColor', strokeWidth: '1.3', strokeLinejoin: 'round' }),
            h('path', { key: 'b', d: 'M11.8 5.8l2.4 2.4', fill: 'none', stroke: 'currentColor', strokeWidth: '1.1' }),
          ];
        case 'sliders':
          return [
            h('path', { key: 'a', d: 'M4 6h12M4 10h12M4 14h12', fill: 'none', stroke: 'currentColor', strokeWidth: '1.2', strokeLinecap: 'round' }),
            h('circle', { key: 'b', cx: '8', cy: '6', r: '1.7', fill: 'none', stroke: 'currentColor', strokeWidth: '1.2' }),
            h('circle', { key: 'c', cx: '13', cy: '10', r: '1.7', fill: 'none', stroke: 'currentColor', strokeWidth: '1.2' }),
            h('circle', { key: 'd', cx: '7', cy: '14', r: '1.7', fill: 'none', stroke: 'currentColor', strokeWidth: '1.2' }),
          ];
        case 'key':
          return [
            h('circle', { key: 'a', cx: '7', cy: '8', r: '3', fill: 'none', stroke: 'currentColor', strokeWidth: '1.3' }),
            h('path', { key: 'b', d: 'M9.2 10.2L16 17M13.2 14.2l1.5-1.5M15 16l1.4-1.4', fill: 'none', stroke: 'currentColor', strokeWidth: '1.3', strokeLinecap: 'round' }),
          ];
        case 'ban':
          return [
            h('circle', { key: 'a', cx: '10', cy: '10', r: '6.6', fill: 'none', stroke: 'currentColor', strokeWidth: '1.3' }),
            h('path', { key: 'b', d: 'M5.4 5.4l9.2 9.2', fill: 'none', stroke: 'currentColor', strokeWidth: '1.4', strokeLinecap: 'round' }),
          ];
        case 'minusCircle':
          return [
            h('circle', { key: 'a', cx: '10', cy: '10', r: '6.6', fill: 'none', stroke: 'currentColor', strokeWidth: '1.3' }),
            h('path', { key: 'b', d: 'M6.7 10h6.6', fill: 'none', stroke: 'currentColor', strokeWidth: '1.4', strokeLinecap: 'round' }),
          ];
        case 'layers':
          return [
            h('path', { key: 'a', d: 'M10 3.2l6.5 3.3L10 9.8 3.5 6.5 10 3.2z', fill: 'none', stroke: 'currentColor', strokeWidth: '1.2', strokeLinejoin: 'round' }),
            h('path', { key: 'b', d: 'M3.5 10.2L10 13.5l6.5-3.3M3.5 13.7L10 17l6.5-3.3', fill: 'none', stroke: 'currentColor', strokeWidth: '1.2', strokeLinecap: 'round', strokeLinejoin: 'round' }),
          ];
        case 'chat':
          return [
            h('path', { key: 'a', d: 'M4 5h12v8H9l-3.5 3v-3H4z', fill: 'none', stroke: 'currentColor', strokeWidth: '1.2', strokeLinejoin: 'round' }),
            h('path', { key: 'b', d: 'M7 8h6M7 10.5h4', fill: 'none', stroke: 'currentColor', strokeWidth: '1.1', strokeLinecap: 'round' }),
          ];
        case 'unlock':
          return [
            h('rect', { key: 'a', x: '4.5', y: '9', width: '11', height: '7.5', rx: '2', fill: 'none', stroke: 'currentColor', strokeWidth: '1.3' }),
            h('path', { key: 'b', d: 'M7 9V7a3 3 0 0 1 5.6-1.6', fill: 'none', stroke: 'currentColor', strokeWidth: '1.3', strokeLinecap: 'round' }),
          ];
        case 'whale':
          return [
            h('path', { key: 'a', d: 'M3 12.2c1.4-3.8 4.8-5.8 8.2-5.2 1.7.3 3 .9 4.3 1 .8.1 1.4-.1 1.9-.5-.2 1.6-1.4 2.7-2.7 3 .2.5.2 1 0 1.4-.6-.7-1.4-1-2.5-1H9.4c-2.5 0-4.6-.8-6.4-2.7z', fill: 'none', stroke: 'currentColor', strokeWidth: '1.2', strokeLinejoin: 'round' }),
            h('circle', { key: 'b', cx: '7.8', cy: '10.6', r: '0.8', fill: 'currentColor' }),
            h('path', { key: 'c', d: 'M16.2 12.6c-1.2 1.6-3.2 2.5-5.4 2.5', fill: 'none', stroke: 'currentColor', strokeWidth: '1.1', strokeLinecap: 'round' }),
          ];
        case 'brandZ':
          return [
            h('path', { key: 'a', d: 'M5.2 4.8h9.6l-8 10.4h8.2', fill: 'none', stroke: 'currentColor', strokeWidth: '1.7', strokeLinecap: 'round', strokeLinejoin: 'round' }),
          ];
        default:
          return [h('circle', { key: 'a', cx: '10', cy: '10', r: '6', fill: 'none', stroke: 'currentColor', strokeWidth: '1.3' })];
      }
    }

    function Icon({ name, size }) {
      const dimension = typeof size === 'number' && size > 0 ? size : 16;
      return h('svg', {
        viewBox: '0 0 20 20',
        width: dimension,
        height: dimension,
        fill: 'none',
        'aria-hidden': 'true',
        focusable: 'false',
      }, ...iconPaths(name));
    }

    const CAPABILITY_ICONS = Object.freeze({
      listSessions: 'list',
      readSessions: 'eye',
      sendMessages: 'send',
      waitForCompletion: 'clock',
      askDsh: 'message',
      listModels: 'cpu',
      createSessions: 'plus',
      selectModel: 'sparkles',
      setPermission: 'lock',
      cancelTurns: 'stop',
      forkSessions: 'fork',
      renameSessions: 'pencil',
      manageSettings: 'sliders',
      managePlugins: 'plug',
      manageCredentials: 'key',
    });

    const APPROVAL_MODE_ICONS = Object.freeze({
      'only-checked': 'checkList',
      'except-checked': 'ban',
      all: 'sliders',
      open: 'unlock',
    });

    const SESSION_MODE_ICONS = Object.freeze({
      all: 'list',
      allowlist: 'checkList',
      except: 'ban',
      none: 'minusCircle',
    });

    const MODEL_MODE_ICONS = Object.freeze({
      all: 'cpu',
      allowlist: 'checkList',
      except: 'ban',
      none: 'minusCircle',
    });

    /** Provider/model brand detection for the dynamic model icon. */
    function modelBrandOf(provider, providerName, model, modelId, name, displayName) {
      const parts = [provider, providerName, modelId, name, displayName];
      if (isObject(model)) {
        parts.push(model.id, model.name, model.label, model.description, model.provider);
      }
      const haystack = parts.filter((part) => typeof part === 'string').join(' ').toLowerCase();
      if (haystack.indexOf('deepseek') !== -1) return 'deepseek';
      if (/(^|[^a-z])(glm|chatglm|zhipu|zhipuai|bigmodel|z-ai|z\.ai)([^a-z]|$)/.test(haystack)) return 'glm';
      return null;
    }

    function BrandIcon({ brand, size }) {
      if (brand !== 'deepseek' && brand !== 'glm') return null;
      return h(Icon, { name: brand === 'deepseek' ? 'whale' : 'brandZ', size: size || 16 });
    }

    /** Dynamic model icon; unknown brands intentionally render nothing. */
    function ModelIcon(props) {
      const brand = modelBrandOf(
        props.provider,
        props.providerName,
        props.model,
        props.modelId,
        props.name,
        props.displayName,
      );
      return brand === null ? null : h(BrandIcon, { brand, size: props.size });
    }

    /** Null for unknown brands so MenuRow does not reserve an icon slot. */
    function modelIconFor(provider, providerName, model) {
      const brand = modelBrandOf(provider, providerName, model, model && model.id, model && model.name);
      return brand === null ? null : h(BrandIcon, { brand, size: 16 });
    }

    function menuIconNode(icon) {
      if (icon === null || icon === undefined || icon === false) return null;
      if (typeof icon === 'string') return h(Icon, { name: icon });
      if (isObject(icon) && icon.$$typeof) return icon;
      if (isObject(icon) && typeof icon.name === 'string') return h(Icon, { name: icon.name, size: icon.size });
      return null;
    }

    /** Semantic icon for a catalog session row. */
    function sessionIcon(session) {
      if (!isObject(session)) return 'list';
      if (session.running === true) return 'message';
      if (session.blank === true) return 'plus';
      return 'chat';
    }

    function IconButton(props) {
      const {
        icon, label, variant, size, disabled, buttonRef, onClick,
      } = props;
      return h('button', {
        type: 'button',
        ref: buttonRef,
        className: cn(
          'dshmcp-iconbtn',
          variant ? 'dshmcp-iconbtn--' + variant : null,
          size === 'sm' ? 'dshmcp-iconbtn--sm' : (size === 'lg' ? 'dshmcp-iconbtn--lg' : null),
        ),
        'aria-label': label,
        title: label,
        disabled: disabled === true,
        onClick,
      }, h(Icon, { name: icon, size: size === 'lg' ? 18 : 16 }));
    }

    function MenuRow(props) {
      const {
        title, description, icon, selected, indeterminate, danger, disabled, onClick, role,
      } = props;
      const iconNode = menuIconNode(icon);
      return h('button', {
        type: 'button',
        role: role || 'button',
        className: cn(
          'dshmcp-menu__row',
          selected ? 'dshmcp-menu__row--selected' : null,
          indeterminate ? 'dshmcp-menu__row--partial' : null,
          danger ? 'dshmcp-menu__row--danger' : null,
        ),
        'aria-checked': role === 'radio' || role === 'checkbox'
          ? (indeterminate ? 'mixed' : (selected ? 'true' : 'false'))
          : undefined,
        'aria-selected': role === 'option' ? (selected === true ? 'true' : 'false') : undefined,
        'aria-pressed': role === 'button' ? (selected === true ? 'true' : 'false') : undefined,
        disabled: disabled === true,
        onClick,
      },
      iconNode ? h('span', { className: 'dshmcp-menu__icon' }, iconNode) : null,
      h('span', { className: 'dshmcp-menu__text' },
        h('span', { className: 'dshmcp-menu__title' }, title),
        description ? h('span', { className: 'dshmcp-menu__desc' }, description) : null),
      h('span', { className: 'dshmcp-menu__check' },
        selected ? h(Icon, { name: 'check' }) : (indeterminate ? h(Icon, { name: 'minus' }) : null)));
    }

    function TabBar(props) {
      const { t, active, onChange } = props;
      const tabs = [
        { id: 'settings', label: t('tab.settings'), icon: 'server' },
        { id: 'usage', label: t('tab.usage'), icon: 'message' },
      ];
      return h('div', { className: 'dshmcp-tabs', role: 'tablist' },
        ...tabs.map((tab) => h('button', {
          key: tab.id,
          type: 'button',
          role: 'tab',
          'aria-selected': active === tab.id ? 'true' : 'false',
          className: cn('dshmcp-tab', active === tab.id ? 'dshmcp-tab--active' : null),
          onClick: () => onChange(tab.id),
        }, h('span', { className: 'dshmcp-inline-icon' }, h(Icon, { name: tab.icon, size: 14 })), tab.label)));
    }

    function CopyBlock(props) {
      const { t, title, hint, text, language } = props;
      const [copied, setCopied] = React.useState(false);
      const timerRef = React.useRef(null);
      React.useEffect(() => () => {
        if (timerRef.current !== null) clearTimeout(timerRef.current);
      }, []);
      const copy = async () => {
        try {
          const ok = await copyText(text);
          if (ok) {
            setCopied(true);
            if (timerRef.current !== null) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => {
              timerRef.current = null;
              setCopied(false);
            }, 1600);
            return;
          }
        } catch (ignored) {
          /* fall through */
        }
        setCopied(false);
      };
      return h('div', { className: 'dshmcp-copyblock' },
        h('div', { className: 'dshmcp-copyblock__head' },
          h('div', { className: 'dshmcp-row__text' },
            title ? h('div', { className: 'dshmcp-copyblock__title' }, title) : null,
            hint ? h('p', { className: 'dshmcp-row__hint' }, hint) : null),
          h(ActionButton, {
            variant: 'secondary',
            size: 'sm',
            onClick: () => { void copy(); },
          }, copied ? t('usage.copied') : t('usage.copy'))),
        h('pre', { className: 'dshmcp-code' }, text));
    }

    function getApprovals() {
      return requestJson('GET', '/approvals');
    }

    function decideApproval(id, decision) {
      return requestJson('POST', '/approvals/' + encodeURIComponent(String(id)), { decision });
    }

    // ================================================================== v2 cards
    function StatusCardV2(props) {
      const {
        t, language, data, form, busy, copied, showToken, rotatePending,
      } = props;
      const mcpUrl = resolveMcpUrl(data);
      const token = readToken(data);
      const enabled = form.server.enabled === true;
      const status = isObject(data.status) ? data.status : {};
      const catalog = isObject(data.catalog) ? data.catalog : {};
      const running = enabled && status.running === true;
      const warnings = warningsOf(data);
      const masked = showToken ? (token || t('common.empty')) : (maskToken(token) || t('common.empty'));
      const json = clientJson(mcpUrl, token);
      const capabilityCount = typeof status.capabilityCount === 'number' ? status.capabilityCount : capabilityCheckedCountV2(form.capabilities);
      const visibleToolCount = typeof status.visibleToolCount === 'number' ? status.visibleToolCount : 0;
      const pendingApprovals = typeof status.pendingApprovals === 'number' ? status.pendingApprovals : 0;
      const hiddenTools = Array.isArray(catalog.hiddenTools) ? catalog.hiddenTools.length : 0;
      const modeLabel = approvalModeTextV2(form.approvalMode, language);
      const pillLabel = !enabled ? t('status.stopped') : (running ? t('status.running') : t('status.pending'));

      const tokenButtons = [
        h(ActionButton, {
          key: 'toggle-token',
          variant: 'ghost',
          size: 'sm',
          onClick: props.onToggleToken,
        }, showToken ? t('common.hide') : t('common.show')),
        h(ActionButton, {
          key: 'copy-token',
          variant: 'secondary',
          size: 'sm',
          disabled: !token,
          onClick: () => props.onCopy('token', token),
        }, copied === 'token' ? t('common.copied') : t('common.copy')),
      ];
      if (rotatePending) {
        tokenButtons.push(h(ActionButton, {
          key: 'rotate-confirm',
          icon: 'check',
          variant: 'danger',
          size: 'sm',
          disabled: busy !== null,
          onClick: props.onConfirmRotate,
        }, t('status.rotateConfirmButton')));
        tokenButtons.push(h(ActionButton, {
          key: 'rotate-cancel',
          icon: 'x',
          variant: 'ghost',
          size: 'sm',
          disabled: busy !== null,
          onClick: props.onCancelRotate,
        }, t('common.cancel')));
      } else {
        tokenButtons.push(h(ActionButton, {
          key: 'rotate',
          variant: 'secondary',
          size: 'sm',
          disabled: busy !== null || !token,
          onClick: props.onRotate,
        }, t('status.rotate')));
      }

      return h(SectionCard, { title: t('status.title'), description: t('status.description') },
        h('div', { className: 'dshmcp-row' },
          h('div', { className: 'dshmcp-row__text' },
            h('span', { className: 'dshmcp-pill' + (running ? ' dshmcp-pill--ok' : '') }, pillLabel),
            h('div', { className: 'dshmcp-row__title' }, t('status.enabled')),
            h('p', { className: 'dshmcp-row__hint' }, t('status.enabledHint'))),
          h(Toggle, {
            checked: enabled,
            disabled: busy !== null,
            label: t('status.enabled'),
            onChange: props.onToggleServer,
          })),
        h('div', { className: 'dshmcp-card__actions' },
          h('span', { className: 'dshmcp-pill' }, t('status.capabilityCount', { count: capabilityCount })),
          h('span', { className: 'dshmcp-pill' }, t('status.visibleToolCount', { count: visibleToolCount })),
          h('span', { className: 'dshmcp-pill' }, t('status.pendingApprovals', { count: pendingApprovals })),
          hiddenTools > 0 ? h('span', { className: 'dshmcp-pill' }, t('status.hiddenTools', { count: hiddenTools })) : null,
          h('span', { className: 'dshmcp-pill' }, t('status.mode', { mode: modeLabel }))),
        h(Field, { label: t('status.mcpUrl') },
          h(ValueRow, {
            value: mcpUrl,
            ariaLabel: t('status.mcpUrl'),
            buttons: [h(ActionButton, {
              key: 'copy-url',
              variant: 'secondary',
              size: 'sm',
              disabled: !mcpUrl,
              onClick: () => props.onCopy('url', mcpUrl),
            }, copied === 'url' ? t('common.copied') : t('common.copyUrl'))],
          })),
        h(Field, { label: t('status.token'), hint: t('status.tokenHint') },
          h(ValueRow, { value: masked, ariaLabel: t('status.token'), buttons: tokenButtons })),
        rotatePending ? h('div', { className: 'dshmcp-warnbox', role: 'alert' }, t('status.rotateConfirm')) : null,
        h('div', { className: 'dshmcp-card__actions' },
          h(ActionButton, {
            variant: 'primary',
            disabled: !mcpUrl,
            onClick: () => props.onCopy('json', json),
          }, copied === 'json' ? t('common.copied') : t('status.copyJson')),
          h('span', { className: 'dshmcp-field__hint' }, t('status.copyJsonHint'))),
        h(WarnBox, { t, warnings }));
    }

    function ApprovalModeCardV2(props) {
      const {
        t, language, data, form, busy, pendingOpen,
      } = props;
      const modes = approvalModesV2(data, language);
      const selectedMode = form.approvalMode;
      const disabled = busy !== null;
      const systemPopup = !(isObject(data) && isObject(data.status) && data.status.systemApprovalPopup === false);

      const chooseMode = (value) => {
        if (disabled) return;
        if (value === 'open' && selectedMode !== 'open') {
          props.onRequestOpen();
          return;
        }
        props.onSetMode(value);
      };

      return h(SectionCard, { title: t('approval.title'), description: t('approval.description') },
        h('div', { className: 'dshmcp-row__text' },
          h('div', { className: 'dshmcp-row__title' }, t('approval.modeLabel')),
          h('p', { className: 'dshmcp-row__hint' }, approvalModeDescriptionV2(selectedMode, language))),
        h('div', { className: 'dshmcp-menu', role: 'radiogroup', 'aria-label': t('approval.modeLabel') },
          ...modes.map((mode) => h(MenuRow, {
            key: mode.value,
            role: 'radio',
            icon: APPROVAL_MODE_ICONS[mode.value] || 'sliders',
            title: pickText(mode.title, mode.titleEn, language),
            description: pickText(mode.description, mode.descriptionEn, language),
            selected: selectedMode === mode.value,
            danger: mode.value === 'open',
            disabled,
            onClick: () => chooseMode(mode.value),
          }))),
        pendingOpen === true ? h('div', { className: 'dshmcp-risk', role: 'alert' },
          h('div', { className: 'dshmcp-risk__title' }, t('approval.openConfirmTitle')),
          h('p', { className: 'dshmcp-risk__body' }, t('approval.openConfirmBody')),
          h('div', { className: 'dshmcp-card__actions' },
            h(ActionButton, {
              icon: 'check',
              variant: 'danger',
              disabled,
              onClick: () => {
                props.onSetMode('open');
                props.onCancelOpen();
              },
            }, t('approval.openConfirmButton')),
            h(ActionButton, {
              icon: 'x',
              variant: 'ghost',
              disabled,
              onClick: props.onCancelOpen,
            }, t('common.cancel')))) : null,
        selectedMode === 'open' && pendingOpen !== true ? h('div', { className: 'dshmcp-risk', role: 'status' },
          h('div', { className: 'dshmcp-risk__title' }, t('approval.openWarningTitle')),
          h('p', { className: 'dshmcp-risk__body' }, t('approval.openWarningBody'))) : null,
        h('div', { className: 'dshmcp-notice' },
          h('div', { className: 'dshmcp-row__text' },
            h('div', { className: 'dshmcp-row__title' }, t('approval.checkedSummary', {
              checked: capabilityCheckedCountV2(form.capabilities),
              total: CAPABILITY_KEYS_V2.length,
            })),
            h('p', { className: 'dshmcp-row__hint' }, systemPopup ? t('approval.approvalHint') : t('approval.approvalHintNoPopup')),
            h('p', { className: 'dshmcp-field__hint' }, t('approval.aclHint')))));
    }

    function CapabilitiesCardV2(props) {
      const {
        t, language, data, form, busy,
      } = props;
      const levels = capabilityLevelsV2(data, language);
      const disabled = busy !== null;
      return h(React.Fragment, null,
        h(SectionCard, { title: t('capabilities.title'), description: t('capabilities.description') },
          ...levels.map((level) => {
            const stats = capabilityLevelStatsV2(level, form.capabilities);
            return h('div', { key: level.id, className: 'dshmcp-level' },
              h('div', { className: 'dshmcp-level__head' },
                h('div', { className: 'dshmcp-row__text' },
                  h('div', { className: 'dshmcp-level__title' }, level.title),
                  h('p', { className: 'dshmcp-level__desc' }, level.description)),
                h('span', { className: 'dshmcp-level__count' }, t('capabilities.levelCount', { checked: stats.checked, total: stats.total }))),
              h('div', { className: 'dshmcp-menu' },
                h(MenuRow, {
                  role: 'checkbox',
                  icon: stats.all ? 'squareCheck' : (stats.some ? 'squareMinus' : 'square'),
                  title: stats.all ? t('capabilities.clearLevel') : t('capabilities.selectAllLevel'),
                  description: '',
                  selected: stats.all,
                  indeterminate: stats.some,
                  disabled,
                  onClick: () => props.onToggleLevel(level, !stats.all),
                }),
                h('div', { className: 'dshmcp-menu__divider' }),
                ...level.capabilities.map((capability) => h(MenuRow, {
                  key: capability.key,
                  role: 'checkbox',
                  icon: CAPABILITY_ICONS[capability.key] || 'list',
                  title: capability.title,
                  description: capability.description,
                  selected: form.capabilities[capability.key] === true,
                  disabled,
                  onClick: () => props.onToggleCapability(capability.key),
                }))));
          }),
          levels.some((level) => level.id === 'advanced')
            ? h('div', { className: 'dshmcp-warnbox' }, t('capabilities.advancedHint'))
            : null));
    }

    /** Status-card mode label without threading the language through every prop. */
    function positionLanguage(t) {
      return t('tab.settings') === '设置' ? 'zh' : 'en';
    }

    // ================================================================== v2 scope + usage
    function ScopeCardV2(props) {
      const {
        t, language, data, form, busy, onScopeChange,
      } = props;
      const scope = form.scope;
      const catalog = isObject(data.catalog) ? data.catalog : {};
      const sessions = Array.isArray(catalog.sessions) ? catalog.sessions : [];
      const models = modelOptionListV2(data, language);
      const presets = presetOptionListV2(data);
      const selectedSessionIds = linesToArray(scope.sessionIdsText);
      const selectedModels = linesToArray(scope.allowedModelsText);
      const presetOptions = presets.map((preset) => Object.assign({}, preset, { icon: h(Icon, { name: 'lock', size: 16 }) }));
      if (scope.newSessionPreset && !presetOptions.some((option) => option.value === scope.newSessionPreset)) {
        presetOptions.push({ value: scope.newSessionPreset, label: scope.newSessionPreset, icon: h(Icon, { name: 'lock', size: 16 }) });
      }
      const defaultModelOptions = [{ value: '', label: t('scope.defaultModelEmpty') }].concat(models.map((model) => ({
        value: model.key,
        label: model.label,
        description: model.description,
        icon: modelIconFor(model.provider, model.providerName, model),
      })));
      if (scope.defaultModel && !defaultModelOptions.some((option) => option.value === scope.defaultModel)) {
        defaultModelOptions.push({ value: scope.defaultModel, label: scope.defaultModel });
      }
      const [search, setSearch] = React.useState('');
      const [showFields, setShowFields] = React.useState(false);
      const [refreshBusy, setRefreshBusy] = React.useState(false);
      const disabled = busy !== null;
      const currentCwd = (sessions.find((entry) => entry && typeof entry.cwd === 'string' && entry.cwd) || {}).cwd || '';
      const sessionExcept = scope.sessionMode === 'except';
      const modelExcept = scope.modelMode === 'except';
      const showSessionPicker = scope.sessionMode === 'allowlist' || sessionExcept;
      const showModelPicker = scope.modelMode === 'allowlist' || modelExcept;
      const sessionCountLabel = sessionExcept
        ? t('scope.selectedExcludedCount', { count: selectedSessionIds.length })
        : t('scope.selectedCount', { count: selectedSessionIds.length });
      const modelCountLabel = modelExcept
        ? t('scope.selectedExcludedCount', { count: selectedModels.length })
        : t('scope.selectedCount', { count: selectedModels.length });
      const sessionEmptyHint = sessionExcept
        ? t('scope.exceptSelectionHint')
        : t('scope.emptySelectionHint');
      const modelEmptyHint = modelExcept
        ? t('scope.exceptSelectionHint')
        : t('scope.emptySelectionHint');
      const sessionModeDescriptions = {
        all: t('scope.sessionModeAll'),
        allowlist: t('scope.sessionModeAllowlist'),
        except: t('scope.sessionModeExcept'),
        none: t('scope.sessionModeNone'),
      };
      const modelModeDescriptions = {
        all: t('scope.modelModeAll'),
        allowlist: t('scope.modelModeAllowlist'),
        except: t('scope.modelModeExcept'),
        none: t('scope.modelModeNone'),
      };

      const setField = (key, value) => onScopeChange({ [key]: value });
      const setSessionIds = (ids) => onScopeChange({
        sessionIds: ids,
        sessionIdsText: linesFromArray(ids),
      });
      const setModels = (keys) => onScopeChange({
        allowedModels: keys,
        allowedModelsText: linesFromArray(keys),
      });
      const refreshSessions = async () => {
        if (refreshBusy || disabled) return;
        setRefreshBusy(true);
        try {
          if (typeof props.onRefreshSessions === 'function') await props.onRefreshSessions();
        } catch (ignored) {
          /* parent reports errors */
        } finally {
          setRefreshBusy(false);
        }
      };

      const sessionRows = sessions.filter((session) => {
        if (!isObject(session)) return false;
        const term = search.trim().toLowerCase();
        if (!term) return true;
        const haystack = [
          session.sessionId,
          session.title,
          session.cwd,
          session.modelKey,
          session.permission,
        ].filter((value) => typeof value === 'string').join('\n').toLowerCase();
        return haystack.indexOf(term) !== -1;
      });

      const sessionPicker = showSessionPicker
        ? [
          h('div', { key: 'session-mode', className: 'dshmcp-row__text' },
            h('div', { className: 'dshmcp-row__title' }, t('scope.sessionModeLabel')),
            h('p', { className: 'dshmcp-row__hint' },
              sessionExcept ? t('scope.exceptHintSessions') : sessionCountLabel)),
          h('div', { key: 'session-picker', className: 'dshmcp-picker' },
            h('div', { className: 'dshmcp-picker__toolbar' },
              h('span', { className: 'dshmcp-picker__summary' }, sessionCountLabel),
              h('div', { className: 'dshmcp-picker__actions' },
                h(ActionButton, {
                  variant: 'ghost',
                  size: 'sm',
                  disabled,
                  onClick: () => setSessionIds(sessions.map((session) => session.sessionId).filter(Boolean)),
                }, t('scope.selectAll')),
                h(ActionButton, {
                  variant: 'ghost',
                  size: 'sm',
                  disabled,
                  onClick: () => setSessionIds([]),
                }, t('scope.clearAll')),
                h(ActionButton, {
                  variant: 'secondary',
                  size: 'sm',
                  disabled: disabled || refreshBusy,
                  onClick: () => { void refreshSessions(); },
                }, refreshBusy ? t('common.loading') : t('scope.refresh')))),
            h(TextInput, {
              value: search,
              disabled,
              ariaLabel: t('scope.searchSessions'),
              placeholder: t('scope.searchSessions'),
              onChange: setSearch,
            }),
            sessionRows.length === 0
              ? h('div', { className: 'dshmcp-picker__empty' }, t('scope.noSessions'))
              : h('div', { className: 'dshmcp-menu' },
                ...sessionRows.map((session) => {
                  const id = String(session.sessionId || '');
                  const selected = selectedSessionIds.indexOf(id) !== -1;
                  const badges = [];
                  if (session.running === true) badges.push('● ' + t('scope.running'));
                  if (session.blank === true) badges.push(t('scope.blank'));
                  const description = [
                    session.cwd || null,
                    session.modelKey || null,
                    session.permission || null,
                    badges.join(' · ') || null,
                  ].filter(Boolean).join(' · ');
                  return h(MenuRow, {
                    key: id,
                    role: 'checkbox',
                    icon: sessionIcon(session),
                    title: session.title || id,
                    description,
                    selected,
                    disabled,
                    onClick: () => setSessionIds(toggleIdInListV2(selectedSessionIds, id)),
                  });
                })),
            selectedSessionIds.length === 0 ? h('p', { className: 'dshmcp-field__hint' }, sessionEmptyHint) : null),
        ]
        : [];

      const modelPicker = showModelPicker
        ? [
          h('div', { key: 'model-mode', className: 'dshmcp-row__text' },
            h('div', { className: 'dshmcp-row__title' }, t('scope.modelModeLabel')),
            h('p', { className: 'dshmcp-row__hint' },
              modelExcept ? t('scope.exceptHintModels') : modelCountLabel)),
          h('div', { key: 'model-picker', className: 'dshmcp-picker' },
            h('div', { className: 'dshmcp-picker__toolbar' },
              h('span', { className: 'dshmcp-picker__summary' }, modelCountLabel),
              h('div', { className: 'dshmcp-picker__actions' },
                h(ActionButton, {
                  variant: 'ghost',
                  size: 'sm',
                  disabled,
                  onClick: () => setModels(models.map((model) => model.key)),
                }, t('scope.selectAll')),
                h(ActionButton, {
                  variant: 'ghost',
                  size: 'sm',
                  disabled,
                  onClick: () => setModels([]),
                }, t('scope.clearAll')))),
            models.length === 0
              ? h('div', { className: 'dshmcp-picker__empty' }, t('scope.noModels'))
              : h('div', { className: 'dshmcp-menu' },
                ...(Array.isArray(catalog.models) ? catalog.models : []).map((provider) => {
                  const providerModels = models.filter((model) => model.provider === (provider.provider || provider.id));
                  if (providerModels.length === 0) return null;
                  return h('div', { key: String(provider.provider || provider.id || 'provider'), className: 'dshmcp-menu__group' },
                    h('div', { className: 'dshmcp-level__count', style: { padding: '4px 10px 2px' } }, provider.providerName || provider.name || provider.provider || provider.id || ''),
                    ...providerModels.map((model) => h(MenuRow, {
                      key: model.key,
                      role: 'checkbox',
                      icon: modelIconFor(model.provider, model.providerName, model),
                      title: model.name,
                      description: model.key + (model.description ? ' — ' + model.description : ''),
                      selected: selectedModels.indexOf(model.key) !== -1,
                      disabled,
                      onClick: () => setModels(toggleIdInListV2(selectedModels, model.key)),
                    })));
                })),
            selectedModels.length === 0 ? h('p', { className: 'dshmcp-field__hint' }, modelEmptyHint) : null),
        ]
        : [];

      const fieldBody = showFields
        ? h('div', { className: 'dshmcp-collapse__body' },
          h(Field, { label: t('scope.sessionIds'), hint: t('scope.sessionIdsHint') },
            h(TextArea, {
              value: scope.sessionIdsText,
              disabled,
              ariaLabel: t('scope.sessionIds'),
              placeholder: t('scope.sessionIdsPlaceholder'),
              mono: true,
              onChange: (text) => onScopeChange({
                sessionIdsText: text,
                sessionIds: linesToArray(text),
              }),
            })),
          h(Field, { label: t('scope.allowedModels'), hint: t('scope.allowedModelsHint') },
            h(TextArea, {
              value: scope.allowedModelsText,
              disabled,
              ariaLabel: t('scope.allowedModels'),
              placeholder: t('scope.allowedModelsPlaceholder'),
              mono: true,
              onChange: (text) => onScopeChange({
                allowedModelsText: text,
                allowedModels: linesToArray(text),
              }),
            })),
          h(Field, { label: t('scope.allowedRoots'), hint: t('scope.allowedRootsHint') },
            h(TextArea, {
              value: scope.allowedRootsText,
              disabled,
              ariaLabel: t('scope.allowedRoots'),
              placeholder: t('scope.allowedRootsPlaceholder'),
              mono: true,
              onChange: (text) => setField('allowedRootsText', text),
            })),
          h(Field, { label: t('scope.defaultCwd'), hint: t('scope.defaultCwdHint') },
            h('div', { className: 'dshmcp-valuerow' },
              h(TextInput, {
                value: scope.defaultCwd,
                disabled,
                ariaLabel: t('scope.defaultCwd'),
                placeholder: 'E:\\work\\project',
                mono: true,
                onChange: (value) => setField('defaultCwd', value),
              }),
              h(ActionButton, {
                variant: 'secondary',
                size: 'sm',
                disabled: disabled || !currentCwd,
                onClick: () => setField('defaultCwd', currentCwd),
              }, t('scope.useCurrentCwd')))),
          h(Field, { label: t('scope.defaultModel'), hint: t('scope.defaultModelHint') },
            models.length > 0
              ? h(SelectMenu, {
                value: scope.defaultModel,
                disabled,
                ariaLabel: t('scope.defaultModel'),
                options: defaultModelOptions,
                onChange: (value) => setField('defaultModel', value),
              })
              : h(TextInput, {
                value: scope.defaultModel,
                disabled,
                ariaLabel: t('scope.defaultModel'),
                placeholder: 'provider/model',
                mono: true,
                onChange: (value) => setField('defaultModel', value),
              })),
          h(Field, { label: t('scope.newSessionPreset'), hint: t('scope.newSessionPresetHint') },
            presets.length > 0
              ? h(SelectMenu, {
                value: scope.newSessionPreset,
                disabled,
                ariaLabel: t('scope.newSessionPreset'),
                options: presetOptions,
                onChange: (value) => setField('newSessionPreset', value),
              })
              : h(TextInput, {
                value: scope.newSessionPreset,
                disabled,
                ariaLabel: t('scope.newSessionPreset'),
                placeholder: 'workspace-write',
                mono: true,
                onChange: (value) => setField('newSessionPreset', value),
              })))
        : null;

      return h(SectionCard, { title: t('scope.title'), description: t('scope.description') },
        h('div', { className: 'dshmcp-row__text' },
          h('div', { className: 'dshmcp-row__title' }, t('scope.visualTitle')),
          h('p', { className: 'dshmcp-row__hint' }, t('scope.description'))),
        h('div', { className: 'dshmcp-row__text' },
          h('div', { className: 'dshmcp-row__title' }, t('scope.sessionModeLabel')),
          h('p', { className: 'dshmcp-row__hint' }, sessionModeDescriptions[scope.sessionMode] || sessionModeDescriptions.all)),
        h('div', { className: 'dshmcp-menu', role: 'radiogroup', 'aria-label': t('scope.sessionModeLabel') },
          h(MenuRow, {
            role: 'radio',
            icon: SESSION_MODE_ICONS.all,
            title: t('scope.allOption'),
            description: t('scope.sessionModeAll'),
            selected: scope.sessionMode === 'all',
            disabled,
            onClick: () => setField('sessionMode', 'all'),
          }),
          h(MenuRow, {
            role: 'radio',
            icon: SESSION_MODE_ICONS.allowlist,
            title: t('scope.allowlistOption'),
            description: t('scope.sessionModeAllowlist'),
            selected: scope.sessionMode === 'allowlist',
            disabled,
            onClick: () => setField('sessionMode', 'allowlist'),
          }),
          h(MenuRow, {
            role: 'radio',
            icon: SESSION_MODE_ICONS.except,
            title: t('scope.exceptOption'),
            description: t('scope.sessionModeExcept'),
            selected: scope.sessionMode === 'except',
            disabled,
            onClick: () => setField('sessionMode', 'except'),
          }),
          h(MenuRow, {
            role: 'radio',
            icon: SESSION_MODE_ICONS.none,
            title: t('scope.noneOption'),
            description: t('scope.sessionModeNone'),
            selected: scope.sessionMode === 'none',
            danger: true,
            disabled,
            onClick: () => setField('sessionMode', 'none'),
          })),
        ...sessionPicker,
        scope.sessionMode === 'none' ? h('div', { className: 'dshmcp-warnbox', role: 'status' }, t('scope.noneSessionWarning')) : null,
        h('div', { className: 'dshmcp-row__text' },
          h('div', { className: 'dshmcp-row__title' }, t('scope.modelModeLabel')),
          h('p', { className: 'dshmcp-row__hint' }, modelModeDescriptions[scope.modelMode] || modelModeDescriptions.all)),
        h('div', { className: 'dshmcp-menu', role: 'radiogroup', 'aria-label': t('scope.modelModeLabel') },
          h(MenuRow, {
            role: 'radio',
            icon: MODEL_MODE_ICONS.all,
            title: t('scope.allOption'),
            description: t('scope.modelModeAll'),
            selected: scope.modelMode === 'all',
            disabled,
            onClick: () => setField('modelMode', 'all'),
          }),
          h(MenuRow, {
            role: 'radio',
            icon: MODEL_MODE_ICONS.allowlist,
            title: t('scope.allowlistOption'),
            description: t('scope.modelModeAllowlist'),
            selected: scope.modelMode === 'allowlist',
            disabled,
            onClick: () => setField('modelMode', 'allowlist'),
          }),
          h(MenuRow, {
            role: 'radio',
            icon: MODEL_MODE_ICONS.except,
            title: t('scope.exceptOption'),
            description: t('scope.modelModeExcept'),
            selected: scope.modelMode === 'except',
            disabled,
            onClick: () => setField('modelMode', 'except'),
          }),
          h(MenuRow, {
            role: 'radio',
            icon: MODEL_MODE_ICONS.none,
            title: t('scope.noneOption'),
            description: t('scope.modelModeNone'),
            selected: scope.modelMode === 'none',
            danger: true,
            disabled,
            onClick: () => setField('modelMode', 'none'),
          })),
        ...modelPicker,
        scope.modelMode === 'none' ? h('div', { className: 'dshmcp-warnbox', role: 'status' }, t('scope.noneModelWarning')) : null,
        h('div', { className: 'dshmcp-row' },
          h('div', { className: 'dshmcp-row__text' },
            h('div', { className: 'dshmcp-row__title' }, t('scope.includeSubagents')),
            h('p', { className: 'dshmcp-row__hint' }, t('scope.includeSubagentsHint'))),
          h(Toggle, {
            checked: scope.includeSubagents === true,
            disabled,
            label: t('scope.includeSubagents'),
            onChange: (value) => setField('includeSubagents', value),
          })),
        h('div', { className: 'dshmcp-collapse' },
          h('button', {
            type: 'button',
            className: 'dshmcp-collapse__head',
            'aria-expanded': showFields ? 'true' : 'false',
            onClick: () => setShowFields(!showFields),
          },
          h('span', { className: 'dshmcp-collapse__title' }, t('scope.fieldsTitle')),
          h('span', { className: 'dshmcp-menu__check', style: { opacity: 1, marginTop: 0 } },
            h(Icon, { name: showFields ? 'chevronDown' : 'chevronRight' }))),
          h('p', { className: 'dshmcp-field__hint' }, t('scope.fieldsHint')),
          fieldBody));
    }

    function LimitsCardV2(props) {
      const { t, limits, busy } = props;
      const disabled = busy !== null;
      return h(SectionCard, { title: t('limits.title'), description: t('limits.description') },
        h('div', { className: 'dshmcp-grid' },
          ...NUMERIC_LIMIT_KEYS_V2.map((key) => {
            const invalid = !isValidLimitValue(limits[key]);
            return h(Field, { key, label: t('limits.' + key) },
              h(NumberInput, {
                value: limits[key],
                disabled,
                invalid,
                ariaLabel: t('limits.' + key),
                onChange: (value) => props.onChange(key, value),
              }),
              invalid ? h('p', { className: 'dshmcp-field__hint dshmcp-field__hint--error' }, t('limits.invalidNumber')) : null);
          }),
          h(Field, { label: t('limits.sendWhenBusy') },
            h(SelectMenu, {
              value: limits.sendWhenBusy,
              disabled,
              ariaLabel: t('limits.sendWhenBusy'),
              options: sendWhenBusyOptions(limits, t),
              onChange: (value) => props.onChange('sendWhenBusy', value),
            }))));
    }

    function OnboardingBannerV2(props) {
      const { t, busy } = props;
      return h('div', { className: 'dshmcp-banner', role: 'status' },
        h('div', { className: 'dshmcp-banner__title' }, t('banner.title')),
        h('p', { className: 'dshmcp-banner__body' }, t('banner.body')),
        h('div', { className: 'dshmcp-banner__actions' },
          h(ActionButton, {
            variant: 'secondary',
            disabled: busy !== null,
            onClick: props.onShowWelcome,
          }, busy === 'welcome' ? t('actions.saving') : t('banner.action'))));
    }

    function ActionsBarV2(props) {
      const {
        t, dirty, busy, resetPending,
      } = props;
      return h('div', { className: 'dshmcp-savebar' },
        h('span', {
          className: 'dshmcp-savebar__status' + (dirty ? ' dshmcp-savebar__status--dirty' : ''),
        }, dirty ? t('common.unsaved') : t('common.upToDate')),
        h('div', { className: 'dshmcp-savebar__actions' },
          h(ActionButton, {
            variant: 'ghost',
            disabled: busy !== null,
            onClick: props.onShowWelcome,
          }, busy === 'welcome' ? t('actions.saving') : t('banner.action')),
          resetPending ? h('span', { className: 'dshmcp-field__hint' }, t('actions.resetHint')) : null,
          resetPending
            ? h(React.Fragment, null,
              h(ActionButton, {
                icon: 'check',
                variant: 'danger',
                disabled: busy !== null,
                onClick: props.onConfirmReset,
              }, t('actions.resetConfirmButton')),
              h(ActionButton, {
                icon: 'x',
                variant: 'ghost',
                disabled: busy !== null,
                onClick: props.onCancelReset,
              }, t('common.cancel')))
            : h(ActionButton, {
              variant: 'secondary',
              disabled: busy !== null,
              onClick: props.onReset,
            }, t('actions.reset')),
          h(ActionButton, {
            icon: 'check',
            variant: 'primary',
            size: 'lg',
            disabled: busy !== null || !dirty,
            onClick: props.onSave,
          }, busy === 'save' ? t('actions.saving') : t('actions.save'))));
    }

    function standardPromptV2(language, mcpUrl, settingsPath) {
      const url = typeof mcpUrl === 'string' && mcpUrl ? mcpUrl : 'http://127.0.0.1:61680/dsh-mcp/mcp';
      let port = '';
      try {
        const parsed = new URL(url);
        port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
      } catch (ignored) {
        port = '61680';
      }
      const path = typeof settingsPath === 'string' && settingsPath
        ? settingsPath
        : '$DSH_HOME/dsh-mcp-gateway/settings.json';
      const configJson = clientJson(url, '<TOKEN>');
      if (language === 'zh') {
        return [
          '你可以通过 MCP 工具访问用户本机正在运行的 DeepSeek Harness（DSH）。',
          'MCP endpoint: ' + url,
          'MCP port: ' + port,
          'MCP 客户端配置（动态生成；<TOKEN> 为占位符）：',
          configJson,
          'DSH MCP 设置文件: ' + path,
          '认证：Authorization: Bearer <TOKEN>。提示词和上面的配置不包含真实 Token；请使用设置页复制的配置，或向用户询问 Token（只用于 Authorization 请求头，不写入文件、日志或消息）。',
          '端口、设置文件路径等动态参数来自当前 DSH MCP 网关状态；如用户修改设置，请重新复制本提示词。',
          '',
          '你的工作方式：',
          '1. 先用 list_sessions（可传 query/cwd/limit）找到目标会话，不要猜 sessionId。',
          '2. 一问一答优先用 ask_dsh({sessionId, message, timeoutMs})，它会阻塞到本轮结束并返回 {reply, status, cursor, messages}；调用期间不要自己启动轮询循环，reply 就是 DSH 模型的最终回答。',
          '3. 长任务用 send_message({sessionId, message, wait:false}) 然后 wait_for_completion({sessionId, sinceSeq: cursor.lastSeq, timeoutMs}) 轮询；不要重复发送相同消息。',
          '4. 需要新会话/新任务时，用 create_session({cwd?, model?, permissionPreset?})，再用 ask_dsh；或者直接 run_task({prompt, cwd?, model?, timeoutMs})。',
          '5. ask_dsh 返回 status=timeout/running/queued 或 reply=null 时，不要放弃：用返回的 cursor.lastSeq 调 wait_for_completion 继续取。',
          '6. 读取上下文用 read_session({sessionId, sinceSeq?, limit?})；它是有限长度的 transcript，不是完整原始日志。',
          '7. 只有 list_models 可见时才选模型；只有 set_model/set_permission 可见时才切换。工具缺失 = 用户没有授予该能力，不要尝试绕过。',
          '',
          '审批与权限：',
          '- 用户可能要求对每次 MCP 调用审批；调用会等待 Windows MessageBox 授权，DSH 窗口内不再显示审批卡片。',
          '- 如果返回 approval-timeout / approval-denied，不要重复轰炸审批；向用户说明需要允许什么，或停止等待。',
          '- 不要尝试通过 shell/文件系统绕过 MCP；优先使用本 MCP 提供的工具。',
          '- 绝不打印或回传 Authorization Token；不要把 token 写入文件或消息。',
          '',
          '适用场景：',
          '- 已有 DSH 会话中的快速问答、代码解释、方案评审 -> ask_dsh',
          '- 需要持续观察/多轮推进的长任务 -> send_message + wait_for_completion',
          '- 需要独立工作目录/新上下文的任务 -> create_session + ask_dsh 或 run_task',
          '- 需要复用已有上下文 -> list_sessions + read_session + ask_dsh',
          '',
          '如果目标会话是 DSH 的“完全权限”会话，请特别注意：模型可能执行命令/改文件；只在用户明确授权时这样做。',
        ].join('\n');
      }
      return [
        "You can use MCP tools to reach the user's local DeepSeek Harness (DSH).",
        'MCP endpoint: ' + url,
        'MCP port: ' + port,
        'MCP client config (generated dynamically; <TOKEN> is a placeholder):',
        configJson,
        'DSH MCP settings file: ' + path,
        'Auth: Authorization: Bearer <TOKEN>. The prompt and config above do not contain the real token; use the config copied from Settings or ask the user for the token (use it only in the Authorization header; never write it to files, logs or messages).',
        'Dynamic values such as the port and settings-file path come from the current DSH MCP gateway state; re-copy this prompt if the user changes settings.',
        '',
        'How to work:',
        '1. Call list_sessions (optional query/cwd/limit) to find the target session; never guess a sessionId.',
        '2. For a single question/answer use ask_dsh: {sessionId, message, timeoutMs}. It blocks until the turn finishes and returns {reply, status, cursor, messages}; do not start your own polling loop while it runs, just use reply.',
        '3. For long tasks use send_message({sessionId, message, wait:false}) then poll wait_for_completion({sessionId, sinceSeq: cursor.lastSeq, timeoutMs}); do not resend the same message.',
        '4. For a new task use create_session({cwd?, model?, permissionPreset?}) followed by ask_dsh, or run_task({prompt, cwd?, model?, timeoutMs}) directly.',
        '5. If ask_dsh returns status=timeout/running/queued or reply=null, continue with wait_for_completion using cursor.lastSeq; do not give up.',
        '6. Use read_session({sessionId, sinceSeq?, limit?}) for bounded context; it is a transcript, not the full raw log.',
        '7. Only choose models when list_models is exposed and only switch when set_model/set_permission are exposed. A missing tool means the user did not grant that capability; do not try to bypass it.',
        '',
        'Approvals and permissions:',
        '- The user may require approval for every MCP call; the call then waits for a Windows MessageBox; the DSH window no longer displays an approval card.',
        '- On approval-timeout / approval-denied, do not spam approvals; tell the user what needs to be allowed or stop waiting.',
        '- Do not bypass MCP through shell/filesystem access; prefer the gateway tools.',
        '- Never print or return the Authorization token; never write it to files or messages.',
        '',
        'Scenarios:',
        '- Quick Q&A / code explanation / review inside an existing DSH session -> ask_dsh',
        '- Long-running, multi-turn task -> send_message + wait_for_completion',
        '- Independent task with a fresh context/workspace -> create_session + ask_dsh or run_task',
        '- Continue existing context -> list_sessions + read_session + ask_dsh',
        '',
        'If the target session has full DSH permissions, treat it accordingly: the model may run commands or modify files; only do that when the user explicitly authorized it.',
      ].join('\n');
    }

    function askInterfaceTextV2(language) {
      if (language === 'zh') {
        return [
          '工具：ask_dsh',
          '作用：一次调用完成“向已有会话发送消息 + 等待回答”，调用会阻塞到本轮结束；未传 timeoutMs 时使用 maxWaitMs（默认 -1，不限时），期间不要启动轮询循环。',
          '参数：',
          '  sessionId: string          // 来自 list_sessions',
          '  message: string            // 问题或任务',
          '  model?: string             // 可选，provider/model',
          '  reasoningEffort?: string   // 可选，需要 model',
          '  timeoutMs?: number         // 可选，等待回答的毫秒数',
          '返回：{ sessionId, reply, status, cursor, messages }',
          '若 reply 为 null 或 status 为 timeout：用 cursor.lastSeq 调 wait_for_completion，不要重复发送同一条消息。',
        ].join('\n');
      }
      return [
        'Tool: ask_dsh',
        'Purpose: one call that sends a message to an existing session and blocks until the answer; without timeoutMs it uses maxWaitMs (default -1, unlimited). Do not start a polling loop while it runs.',
        'Arguments:',
        '  sessionId: string          // from list_sessions',
        '  message: string            // question or task',
        '  model?: string             // optional provider/model',
        '  reasoningEffort?: string   // optional; requires model',
        '  timeoutMs?: number         // optional wait budget in milliseconds',
        'Returns: { sessionId, reply, status, cursor, messages }',
        'If reply is null or status is timeout: call wait_for_completion with cursor.lastSeq; do not resend the same message.',
      ].join('\n');
    }

    function UsageTabV2(props) {
      const { t, language, data } = props;
      const mcpUrl = resolveMcpUrl(data);
      const token = readToken(data);
      const json = clientJson(mcpUrl, token);
      const settingsPath = isObject(data) && typeof data.settingsPath === 'string' ? data.settingsPath : '';
      const askExample = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'ask_dsh',
          arguments: {
            sessionId: '<session-id-from-list_sessions>',
            message: language === 'zh'
              ? '请总结这个会话当前的任务与结论。'
              : 'Summarize the current task and conclusion of this session.',
            timeoutMs: 60000,
          },
        },
      }, null, 2);
      const flow = [
        { icon: 'robot', label: t('usage.flow.agent') },
        { icon: 'plug', label: t('usage.flow.endpoint') },
        { icon: 'server', label: t('usage.flow.dsh') },
        { icon: 'message', label: t('usage.flow.answer') },
      ];
      const systemPopup = !(isObject(data) && isObject(data.status) && data.status.systemApprovalPopup === false);
      const steps = [1, 2, 3, 4].map((index) => ({
        index,
        title: t('usage.step' + index + '.title'),
        body: index === 4 && systemPopup === false ? t('usage.step4.bodyNoPopup') : t('usage.step' + index + '.body'),
      }));
      const notes = [1, 2, 3, 4, 5, 6, 7, 8].map((index) => (
        index === 2 && systemPopup === false ? t('usage.note2NoPopup') : t('usage.note' + index)
      ));

      return h('div', { className: 'dshmcp-usage' },
        h('div', { className: 'dshmcp-usage__hero' },
          h('h2', { className: 'dshmcp-usage__title' }, t('usage.title')),
          h('p', { className: 'dshmcp-usage__intro' }, t('usage.intro'))),
        h('div', { className: 'dshmcp-usage__card' },
          h('div', { className: 'dshmcp-usage__cardTitle' }, t('usage.flowTitle')),
          h('div', { className: 'dshmcp-flow' },
            ...flow.reduce((result, node, index) => {
              if (index > 0) result.push(h('span', { key: 'arrow-' + index, className: 'dshmcp-flow__arrow' }, h(Icon, { name: 'arrowRight', size: 16 })));
              result.push(h('span', {
                key: 'node-' + index,
                className: cn(
                  'dshmcp-flow__node',
                  index === 1 ? 'dshmcp-flow__node--accent' : null,
                  index === flow.length - 1 ? 'dshmcp-flow__node--ok' : null,
                ),
              }, h(Icon, { name: node.icon, size: 14 }), node.label));
              return result;
            }, []))),
        h('div', { className: 'dshmcp-usage__card' },
          h('div', { className: 'dshmcp-usage__cardTitle' }, t('usage.stepsTitle')),
          h('ol', { className: 'dshmcp-steps' },
            ...steps.map((step) => h('li', { key: step.index, className: 'dshmcp-step' },
              h('span', { className: 'dshmcp-step__num' }, String(step.index)),
              h('div', { className: 'dshmcp-step__text' },
                h('div', { className: 'dshmcp-step__title' }, step.title),
                h('p', { className: 'dshmcp-step__body' }, step.body)))))),
        h('div', { className: 'dshmcp-usage__card' },
          h('div', { className: 'dshmcp-usage__cardTitle' }, t('usage.notesTitle')),
          h('ul', { className: 'dshmcp-notes' }, ...notes.map((note, index) => h('li', { key: 'note-' + index }, note)))),
        h('div', { className: 'dshmcp-usage__grid' },
          h('div', { className: 'dshmcp-usage__card' },
            h(CopyBlock, {
              t,
              language,
              title: t('usage.clientTitle'),
              hint: t('usage.clientHint'),
              text: json,
            })),
          h('div', { className: 'dshmcp-usage__card' },
            h(CopyBlock, {
              t,
              language,
              title: t('usage.askTitle'),
              hint: t('usage.askHint'),
              text: askInterfaceTextV2(language) + '\n\n' + t('usage.askExampleTitle') + ':\n' + askExample,
            }))),
        h('div', { className: 'dshmcp-usage__card' },
          h(CopyBlock, {
            t,
            language,
            title: t('usage.promptTitle'),
            hint: t('usage.promptHint'),
            text: standardPromptV2(language, mcpUrl, settingsPath),
          })));
    }

    // ================================================================== v2 settings section
    function SettingsSectionV2({ localeService }) {
      const language = useLanguage(localeService);
      const t = React.useMemo(() => createTranslator(language), [language]);
      const [remote, setRemote] = React.useState({ status: 'loading', data: null, error: null });
      const [form, setForm] = React.useState(null);
      const [tab, setTab] = React.useState('settings');
      const [busy, setBusy] = React.useState(null);
      const [notice, setNotice] = React.useState(null);
      const [copied, setCopied] = React.useState(null);
      const [showToken, setShowToken] = React.useState(false);
      const [rotatePending, setRotatePending] = React.useState(false);
      const [resetPending, setResetPending] = React.useState(false);
      const [pendingOpenMode, setPendingOpenMode] = React.useState(false);
      const copyTimerRef = React.useRef(null);

      React.useEffect(() => () => {
        if (copyTimerRef.current !== null) {
          clearTimeout(copyTimerRef.current);
          copyTimerRef.current = null;
        }
      }, []);

      const flagCopied = (key) => {
        setCopied(key);
        if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => {
          copyTimerRef.current = null;
          setCopied(null);
        }, 1600);
      };

      const copyValue = async (key, value) => {
        try {
          const ok = await copyText(value);
          if (ok) {
            flagCopied(key);
            return;
          }
        } catch (ignored) {
          /* fall through */
        }
        setNotice({ tone: 'error', text: t('common.copyFailed') });
      };

      const load = React.useCallback(async (options) => {
        const opts = options || {};
        setRemote((current) => ({
          status: current.data ? 'ready' : 'loading',
          data: current.data,
          error: null,
        }));
        const result = await getGatewayState();
        if (!result.ok) {
          setRemote((current) => ({
            status: current.data ? 'ready' : 'error',
            data: current.data,
            error: result.error,
          }));
          return result;
        }
        setRemote({ status: 'ready', data: result.data, error: null });
        setForm((current) => (opts.keepForm === true && current ? current : toFormV2(result.data.settings)));
        return result;
      }, []);

      React.useEffect(() => {
        void load();
      }, [load]);

      React.useEffect(() => onboardingHub.subscribe((signal) => {
        if (signal !== 'refresh' && signal !== 'reopen') return;
        void load({ keepForm: true });
      }), [load]);

      const data = remote.data;
      const dirty = data !== null && form !== null ? hasChangesV2(form, data.settings) : false;

      const applyRemote = (next, resetForm) => {
        setRemote({ status: 'ready', data: next, error: null });
        setForm((current) => (resetForm === true || current === null ? toFormV2(next.settings) : current));
      };

      const updateForm = (mutator) => {
        setForm((current) => {
          if (current === null) return current;
          let next;
          try {
            next = JSON.parse(JSON.stringify(current));
          } catch (ignored) {
            next = current;
          }
          mutator(next);
          return next;
        });
      };

      const reportConflict = (outcome) => {
        if (outcome && outcome.reloaded) applyRemote(outcome.reloaded, false);
        setNotice({ tone: 'warn', text: t('saved.conflict') });
      };

      const save = async () => {
        if (data === null || form === null || busy !== null) return;
        const invalid = invalidLimitKeysV2(form.limits);
        if (invalid.length > 0) {
          setNotice({
            tone: 'error',
            text: t('limits.invalidFields', { fields: invalid.map((key) => t('limits.' + key)).join(', ') }),
          });
          return;
        }
        const patch = collectPatchV2(form, data.settings);
        if (Object.keys(patch).length === 0) {
          setNotice({ tone: 'ok', text: t('saved.noChanges') });
          return;
        }
        setBusy('save');
        setNotice(null);
        try {
          const outcome = await postStateAction('/settings', { revision: data.revision, patch });
          if (outcome.ok) {
            if (outcome.data) applyRemote(outcome.data, true);
            else void load({ keepForm: true });
            setNotice({ tone: 'ok', text: t('saved.done') });
          } else if (outcome.conflict) {
            reportConflict(outcome);
          } else {
            setNotice({ tone: 'error', text: t('saveFailed') + '：' + describeError(t, outcome.error) });
          }
        } catch (error) {
          setNotice({ tone: 'error', text: t('saveFailed') + '：' + messageOf(error) });
        } finally {
          setBusy(null);
        }
      };

      const rotateToken = async () => {
        if (data === null || busy !== null) return;
        setRotatePending(false);
        setBusy('rotate');
        setNotice(null);
        try {
          const outcome = await postStateAction('/token', { revision: data.revision });
          if (outcome.ok) {
            if (outcome.data) applyRemote(outcome.data, false);
            else void load({ keepForm: true });
            setNotice({ tone: 'ok', text: t('rotateDone') });
          } else if (outcome.conflict) {
            reportConflict(outcome);
          } else {
            setNotice({ tone: 'error', text: t('rotateFailed') + '：' + describeError(t, outcome.error) });
          }
        } catch (error) {
          setNotice({ tone: 'error', text: t('rotateFailed') + '：' + messageOf(error) });
        } finally {
          setBusy(null);
        }
      };

      const restoreDefaults = async () => {
        if (data === null || busy !== null) return;
        setResetPending(false);
        setBusy('restore');
        setNotice(null);
        const patch = {
          approvalMode: DEFAULT_APPROVAL_MODE_V2,
          capabilities: Object.assign({}, DEFAULT_CAPABILITIES_V2),
          scope: {
            sessionMode: DEFAULT_SCOPE_V2.sessionMode,
            sessionIds: [],
            includeSubagents: DEFAULT_SCOPE_V2.includeSubagents,
            modelMode: DEFAULT_SCOPE_V2.modelMode,
            allowedModels: [],
            allowedRoots: [],
            defaultCwd: DEFAULT_SCOPE_V2.defaultCwd,
            defaultModel: DEFAULT_SCOPE_V2.defaultModel,
            newSessionPreset: DEFAULT_SCOPE_V2.newSessionPreset,
          },
          limits: Object.assign({}, DEFAULT_LIMITS_V2),
        };
        try {
          const outcome = await postStateAction('/settings', { revision: data.revision, patch });
          if (outcome.ok) {
            if (outcome.data) applyRemote(outcome.data, true);
            else void load({ keepForm: true });
            setNotice({ tone: 'ok', text: t('restoreDone') });
          } else if (outcome.conflict) {
            reportConflict(outcome);
          } else {
            setNotice({ tone: 'error', text: t('restoreFailed') + '：' + describeError(t, outcome.error) });
          }
        } catch (error) {
          setNotice({ tone: 'error', text: t('restoreFailed') + '：' + messageOf(error) });
        } finally {
          setBusy(null);
        }
      };

      const showWelcome = async () => {
        if (data === null || busy !== null) return;
        setBusy('welcome');
        try {
          const outcome = await postStateAction('/onboarding', { revision: data.revision, shown: false });
          if (outcome.ok) {
            if (outcome.data) applyRemote(outcome.data, false);
            else void load({ keepForm: true });
            onboardingHub.emit('reopen');
          } else if (outcome.conflict) {
            reportConflict(outcome);
          } else {
            setNotice({ tone: 'error', text: t('banner.failed') + '：' + describeError(t, outcome.error) });
          }
        } catch (error) {
          setNotice({ tone: 'error', text: t('banner.failed') + '：' + messageOf(error) });
        } finally {
          setBusy(null);
        }
      };

      const toggleCapability = (key) => {
        updateForm((next) => {
          next.capabilities[key] = !next.capabilities[key];
        });
      };

      const toggleLevel = (level, checked) => {
        updateForm((next) => {
          for (const capability of level.capabilities) next.capabilities[capability.key] = checked;
        });
      };

      const setApprovalMode = (mode) => {
        updateForm((next) => {
          next.approvalMode = mode;
        });
        if (mode !== 'open') setPendingOpenMode(false);
      };

      const updateScope = (patch) => {
        updateForm((next) => {
          next.scope = Object.assign({}, next.scope, patch);
        });
      };

      const updateLimit = (key, value) => {
        updateForm((next) => {
          next.limits = Object.assign({}, next.limits, { [key]: value });
        });
      };

      const children = [];
      children.push(h(TabBar, { key: 'tabs', t, active: tab, onChange: setTab }));

      if (data === null || form === null) {
        if (remote.status === 'error' && remote.error) {
          children.push(h(ErrorCard, {
            key: 'error',
            t,
            title: t('loadErrorTitle'),
            message: t('loadErrorHint'),
            hint: describeError(t, remote.error),
            onRetry: () => { void load(); },
          }));
        } else {
          children.push(h('div', { key: 'loading', className: 'dshmcp-loading' }, t('common.loading')));
        }
      } else if (tab === 'usage') {
        children.push(h(UsageTabV2, { key: 'usage', t, language, data }));
      } else {
        children.push(...[
          !isAcknowledged(data) ? h(OnboardingBannerV2, {
            key: 'banner',
            t,
            busy,
            onShowWelcome: () => { void showWelcome(); },
          }) : null,
          h(StatusCardV2, {
            key: 'status',
            t,
            language,
            data,
            form,
            busy,
            copied,
            showToken,
            rotatePending,
            onToggleServer: (value) => updateForm((next) => { next.server = Object.assign({}, next.server, { enabled: value }); }),
            onToggleToken: () => setShowToken(!showToken),
            onCopy: (key, value) => { void copyValue(key, value); },
            onRotate: () => setRotatePending(true),
            onConfirmRotate: () => { void rotateToken(); },
            onCancelRotate: () => setRotatePending(false),
          }),
          h(ApprovalModeCardV2, {
            key: 'approval-mode',
            t,
            language,
            data,
            form,
            busy,
            pendingOpen: pendingOpenMode,
            onSetMode: setApprovalMode,
            onRequestOpen: () => setPendingOpenMode(true),
            onCancelOpen: () => setPendingOpenMode(false),
          }),
          h(CapabilitiesCardV2, {
            key: 'capabilities',
            t,
            language,
            data,
            form,
            busy,
            onToggleCapability: toggleCapability,
            onToggleLevel: toggleLevel,
          }),
          h(ScopeCardV2, {
            key: 'scope',
            t,
            language,
            data,
            form,
            busy,
            onScopeChange: updateScope,
            onRefreshSessions: () => load({ keepForm: true }),
          }),
          h(LimitsCardV2, {
            key: 'limits',
            t,
            limits: form.limits,
            busy,
            onChange: updateLimit,
          }),
          h(Notice, { key: 'notice', notice }),
          h(ActionsBarV2, {
            key: 'actions',
            t,
            dirty,
            busy,
            resetPending,
            onSave: () => { void save(); },
            onReset: () => setResetPending(true),
            onCancelReset: () => setResetPending(false),
            onConfirmReset: () => { void restoreDefaults(); },
            onShowWelcome: () => { void showWelcome(); },
          }),
        ].filter(Boolean));
      }

      return h('div', { className: 'dshmcp-root dshmcp-settings' }, ...children);
    }

    // ================================================================== v2 onboarding overlay
    function OnboardingOverlayV2({ localeService }) {
      const language = useLanguage(localeService);
      const t = React.useMemo(() => createTranslator(language), [language]);
      const [data, setData] = React.useState(null);
      const [open, setOpen] = React.useState(false);
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState(null);
      const [showToken, setShowToken] = React.useState(false);
      const [copied, setCopied] = React.useState(null);
      const autoOpenRef = React.useRef(false);
      const dismissedRef = React.useRef(false);
      const revisionRef = React.useRef(null);
      const primaryRef = React.useRef(null);
      const copyTimerRef = React.useRef(null);
      const shownRevisionRef = React.useRef(null);

      React.useEffect(() => () => {
        if (copyTimerRef.current !== null) {
          clearTimeout(copyTimerRef.current);
          copyTimerRef.current = null;
        }
      }, []);

      const flagCopied = (key) => {
        setCopied(key);
        if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => {
          copyTimerRef.current = null;
          setCopied(null);
        }, 1600);
      };

      const copyValue = async (key, value) => {
        try {
          const ok = await copyText(value);
          if (ok) {
            flagCopied(key);
            return;
          }
        } catch (ignored) {
          /* fall through */
        }
        setError(t('common.copyFailed'));
      };

      const markShown = React.useCallback(async (revision) => {
        if (typeof revision !== 'number' || shownRevisionRef.current === revision) return;
        shownRevisionRef.current = revision;
        const result = await requestJson('POST', '/onboarding', { revision, shown: true });
        if (result.ok) {
          const next = isObject(result.data) && isObject(result.data.settings) ? result.data : null;
          if (next) {
            revisionRef.current = next.revision;
            setData((current) => (current
              ? Object.assign({}, current, { revision: next.revision, onboarding: next.onboarding || current.onboarding })
              : next));
          }
          return;
        }
        if (result.status === 409) {
          const reloaded = await getGatewayState();
          if (reloaded.ok) {
            revisionRef.current = reloaded.data.revision;
            setData(reloaded.data);
            const retried = await requestJson('POST', '/onboarding', { revision: reloaded.data.revision, shown: true });
            if (retried.ok) {
              shownRevisionRef.current = reloaded.data.revision;
              setError(null);
              return;
            }
          }
        }
        setError(t('overlay.shownFailed', { message: describeError(t, result.error) }));
      }, [t]);

      const openWith = React.useCallback((state) => {
        revisionRef.current = typeof state.revision === 'number' ? state.revision : null;
        setData(state);
        setError(null);
        setShowToken(false);
        setOpen(true);
        void markShown(revisionRef.current);
      }, [markShown]);

      React.useEffect(() => {
        let active = true;
        void (async () => {
          const result = await getGatewayState();
          if (!active || !result.ok) return;
          const state = result.data;
          revisionRef.current = state.revision;
          if (!dismissedRef.current && isFirstRun(state) && !autoOpenRef.current) {
            autoOpenRef.current = true;
            openWith(state);
            return;
          }
          setData(state);
        })();
        return () => {
          active = false;
        };
      }, [openWith]);

      React.useEffect(() => onboardingHub.subscribe((signal) => {
        if (signal !== 'reopen') return;
        dismissedRef.current = false;
        autoOpenRef.current = true;
        void (async () => {
          const result = await getGatewayState();
          if (!result.ok) return;
          openWith(result.data);
        })();
      }), [openWith]);

      React.useEffect(() => {
        if (!open) return undefined;
        const onKeyDown = (event) => {
          if (event.key !== 'Escape' && event.key !== 'Esc') return;
          event.preventDefault();
          event.stopPropagation();
          dismissedRef.current = true;
          setOpen(false);
        };
        document.addEventListener('keydown', onKeyDown, true);
        return () => document.removeEventListener('keydown', onKeyDown, true);
      }, [open]);

      React.useEffect(() => {
        if (!open) return undefined;
        const handle = setTimeout(() => {
          try {
            if (primaryRef.current && typeof primaryRef.current.focus === 'function') primaryRef.current.focus();
          } catch (ignored) {
            /* ignore */
          }
        }, 0);
        return () => clearTimeout(handle);
      }, [open]);

      if (!open || data === null) return null;

      const mcpUrl = resolveMcpUrl(data);
      const token = readToken(data);
      const json = clientJson(mcpUrl, token);
      const masked = showToken ? (token || t('common.empty')) : (maskToken(token) || t('common.empty'));

      const dismiss = () => {
        dismissedRef.current = true;
        setError(null);
        setOpen(false);
      };

      const acknowledge = async () => {
        if (busy) return;
        setBusy(true);
        setError(null);
        try {
          let revision = revisionRef.current;
          let result = await requestJson('POST', '/onboarding', {
            revision,
            shown: true,
            acknowledged: true,
          });
          if (!result.ok && result.status === 409) {
            const reloaded = await getGatewayState();
            if (reloaded.ok) {
              revision = reloaded.data.revision;
              result = await requestJson('POST', '/onboarding', {
                revision,
                shown: true,
                acknowledged: true,
              });
            }
          }
          if (result.ok) {
            const next = isObject(result.data) && isObject(result.data.settings) ? result.data : null;
            if (next) {
              revisionRef.current = next.revision;
              setData(next);
            }
            setOpen(false);
            onboardingHub.emit('refresh');
          } else {
            setError(t('overlay.ackFailed', { message: describeError(t, result.error) }));
          }
        } catch (caught) {
          setError(t('overlay.ackFailed', { message: messageOf(caught) }));
        } finally {
          setBusy(false);
        }
      };

      return h('div', { className: 'dshmcp-overlay' },
        h('div', { className: 'dshmcp-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dshmcp-onboarding-title' },
          h('h2', { id: 'dshmcp-onboarding-title', className: 'dshmcp-modal__title' }, t('overlay.title')),
          h('p', { className: 'dshmcp-modal__subtitle' }, t('overlay.intro')),
          h('div', { className: 'dshmcp-risk', role: 'alert' },
            h('div', { className: 'dshmcp-risk__title' }, t('overlay.riskTitle')),
            h('p', { className: 'dshmcp-risk__body' }, t('overlay.riskBody'))),
          h('div', { className: 'dshmcp-checklist' },
            h('div', { className: 'dshmcp-checklist__title' }, t('overlay.defaultsTitle')),
            h('ul', null,
              h('li', null, t('overlay.defaultsBasicV2')),
              h('li', null, t('overlay.defaultsExtendedV2')),
              h('li', null, t('overlay.modeTitle') + '：' + t('overlay.modeBody')),
              h('li', null, t('overlay.approvalTitle') + '：' + t('overlay.approvalBody')),
              h('li', null, t('overlay.askTitle') + '：' + t('overlay.askBody')))),
          h('div', { className: 'dshmcp-kv' },
            h('div', { className: 'dshmcp-kv__row' },
              h('span', { className: 'dshmcp-kv__key' }, t('overlay.endpoint')),
              h(ValueRow, {
                value: mcpUrl,
                ariaLabel: t('overlay.endpoint'),
                buttons: [h(ActionButton, {
                  key: 'copy-url',
                  variant: 'secondary',
                  size: 'sm',
                  disabled: !mcpUrl,
                  onClick: () => { void copyValue('url', mcpUrl); },
                }, copied === 'url' ? t('common.copied') : t('common.copyUrl'))],
              })),
            h('div', { className: 'dshmcp-kv__row' },
              h('span', { className: 'dshmcp-kv__key' }, t('overlay.token')),
              h(ValueRow, {
                value: masked,
                ariaLabel: t('overlay.token'),
                buttons: [
                  h(ActionButton, {
                    key: 'toggle',
                    variant: 'ghost',
                    size: 'sm',
                    onClick: () => setShowToken(!showToken),
                  }, showToken ? t('common.hide') : t('common.show')),
                  h(ActionButton, {
                    key: 'copy-token',
                    variant: 'secondary',
                    size: 'sm',
                    disabled: !token,
                    onClick: () => { void copyValue('token', token); },
                  }, copied === 'token' ? t('common.copied') : t('common.copy')),
                ],
              }))),
          h('div', { className: 'dshmcp-modal__actions' },
            h(ActionButton, {
              variant: 'secondary',
              disabled: !mcpUrl,
              onClick: () => { void copyValue('json', json); },
            }, copied === 'json' ? t('common.copied') : t('status.copyJson')),
            h('span', { className: 'dshmcp-field__hint' }, t('status.copyJsonHint'))),
          error ? h('div', { className: 'dshmcp-notice dshmcp-notice--error', role: 'alert' }, error) : null,
          h('div', { className: 'dshmcp-modal__footer' },
            h(ActionButton, {
              variant: 'secondary',
              disabled: busy,
              onClick: dismiss,
            }, t('overlay.later')),
            h(ActionButton, {
              icon: 'check',
              variant: 'primary',
              size: 'lg',
              buttonRef: primaryRef,
              disabled: busy,
              onClick: () => { void acknowledge(); },
            }, t('overlay.save')))));
    }

    // ================================================================== approval overlay
    function ApprovalOverlay({ localeService }) {
      const language = useLanguage(localeService);
      const t = React.useMemo(() => createTranslator(language), [language]);
      const [pending, setPending] = React.useState([]);
      const [now, setNow] = React.useState(Date.now());
      const [busyId, setBusyId] = React.useState(null);
      const [errors, setErrors] = React.useState({});
      const [sessionTitles, setSessionTitles] = React.useState({});
      const inFlightRef = React.useRef(false);
      const titlesLoadingRef = React.useRef(false);
      const titlesRequestedRef = React.useRef(new Set());
      const aliveRef = React.useRef(true);

      const refresh = React.useCallback(async () => {
        if (inFlightRef.current || !aliveRef.current) return;
        inFlightRef.current = true;
        try {
          const result = await getApprovals();
          if (result.ok && isObject(result.data) && aliveRef.current) {
            setPending(Array.isArray(result.data.pending) ? result.data.pending : []);
          }
        } catch (ignored) {
          /* polling stays silent */
        } finally {
          inFlightRef.current = false;
        }
      }, []);

      React.useEffect(() => {
        aliveRef.current = true;
        void refresh();
        const poll = setInterval(() => { void refresh(); }, APPROVAL_POLL_MS);
        const tick = setInterval(() => setNow(Date.now()), 1000);
        return () => {
          aliveRef.current = false;
          clearInterval(poll);
          clearInterval(tick);
        };
      }, [refresh]);

      React.useEffect(() => {
        if (titlesLoadingRef.current) return;
        const missingIds = [];
        for (const entry of pending) {
          if (!entry || typeof entry.sessionId !== 'string') continue;
          if (sessionTitles[entry.sessionId]) continue;
          if (titlesRequestedRef.current.has(entry.sessionId)) continue;
          missingIds.push(entry.sessionId);
        }
        if (missingIds.length === 0) return;
        for (const id of missingIds) titlesRequestedRef.current.add(id);
        titlesLoadingRef.current = true;
        void (async () => {
          try {
            const result = await getGatewayState();
            if (!aliveRef.current || !result.ok) return;
            const catalog = isObject(result.data.catalog) ? result.data.catalog : {};
            const next = {};
            for (const session of Array.isArray(catalog.sessions) ? catalog.sessions : []) {
              if (session && typeof session.sessionId === 'string') {
                next[session.sessionId] = session.title || session.sessionId;
              }
            }
            setSessionTitles((current) => Object.assign({}, current, next));
          } catch (ignored) {
            /* session titles are optional */
          } finally {
            titlesLoadingRef.current = false;
          }
        })();
      }, [pending, sessionTitles]);

      const decide = async (id, decision) => {
        if (busyId !== null) return;
        setBusyId(id);
        setErrors((current) => {
          const next = Object.assign({}, current);
          delete next[id];
          return next;
        });
        try {
          const result = await decideApproval(id, decision);
          if (result.ok && isObject(result.data)) {
            setPending(Array.isArray(result.data.pending) ? result.data.pending : []);
          } else {
            setErrors((current) => Object.assign({}, current, {
              [id]: t('approvals.failed', { message: describeError(t, result.error) }),
            }));
            void refresh();
          }
        } catch (error) {
          setErrors((current) => Object.assign({}, current, {
            [id]: t('approvals.failed', { message: messageOf(error) }),
          }));
        } finally {
          setBusyId(null);
        }
      };

      if (pending.length === 0) return null;

      return h('div', { className: 'dshmcp-approvals', 'aria-live': 'polite', 'aria-label': t('approvals.title') },
        ...pending.map((entry) => {
          if (!entry || typeof entry.id !== 'string') return null;
          const capability = CAPABILITY_META[entry.capability];
          const capabilityTitle = capability
            ? pickText(capability.title, capability.titleEn, language)
            : t('approvals.unknownCapability');
          const sessionTitle = entry.sessionId
            ? (sessionTitles[entry.sessionId] || entry.sessionId)
            : t('approvals.unknownSession');
          const remaining = typeof entry.expiresAt === 'number'
            ? Math.max(0, Math.ceil((entry.expiresAt - now) / 1000))
            : null;
          const expired = remaining !== null && remaining <= 0;
          return h('div', { key: entry.id, className: 'dshmcp-approval', role: 'group', 'aria-label': capabilityTitle },
            h('div', { className: 'dshmcp-approval__head' },
              h('div', { className: 'dshmcp-approval__headmain' },
                h('span', { className: 'dshmcp-approval__icon' }, h(Icon, { name: CAPABILITY_ICONS[entry.capability] || 'lock', size: 16 })),
                h('div', { className: 'dshmcp-approval__title' }, capabilityTitle)),
              h('span', { className: 'dshmcp-approval__time' },
                expired ? t('approvals.expired') : (remaining === null ? '' : t('approvals.remaining', { seconds: remaining })))),
            h('div', { className: 'dshmcp-approval__meta' },
              h('span', { className: 'dshmcp-approval__key' }, t('approvals.tool')),
              h('span', { className: 'dshmcp-approval__val' }, typeof entry.tool === 'string' ? entry.tool : ''),
              h('span', { className: 'dshmcp-approval__key' }, t('approvals.session')),
              h('span', { className: 'dshmcp-approval__val' }, sessionTitle)),
            h('pre', { className: 'dshmcp-approval__summary' }, typeof entry.summary === 'string' ? entry.summary : ''),
            errors[entry.id] ? h('div', { className: 'dshmcp-approval__error' }, errors[entry.id]) : null,
            h('div', { className: 'dshmcp-approval__actions' },
              h(ActionButton, {
                icon: 'x',
                variant: 'danger',
                size: 'sm',
                disabled: busyId !== null,
                onClick: () => { void decide(entry.id, 'deny'); },
              }, t('approvals.deny')),
              h(ActionButton, {
                icon: 'check',
                variant: 'primary',
                size: 'sm',
                disabled: busyId !== null || expired,
                onClick: () => { void decide(entry.id, 'allow'); },
              }, t('approvals.allow'))));
        }).filter(Boolean));
    }

    function apply(ctx) {
      const style = injectStyles();
      ctx.effect(() => () => {
        if (style && style.parentNode) style.parentNode.removeChild(style);
      }, 'dsh-mcp-gateway: styles');

      // The locale service is optional: fall back to navigator.language when absent.
      let localeService;
      try {
        localeService = typeof ctx.get === 'function' ? ctx.get('locale') : undefined;
      } catch (error) {
        localeService = undefined;
      }

      function SettingsSectionRoot(props) {
        return h(PluginBoundary, null, h(SettingsSectionV2, { ...props, localeService }));
      }

      function PluginSettingsItemRoot(props) {
        // DSH 0.2.2 moved plugin settings pages from `settings.section` to the
        // plugin manager's `plugins.item` slot. The summary view is just the
        // card description; the page view embeds the real settings UI.
        if (props?.view === 'summary') {
          const t = createTranslator(readLanguage(localeService));
          return h('span', { className: 'dshmcp-plugin-summary' }, t('plugins.summary'));
        }
        return h(PluginBoundary, null, h(SettingsSectionV2, { ...props, localeService }));
      }

      function OnboardingOverlayRoot(props) {
        // Approval UI intentionally lives only in the Windows system MessageBox
        // (system-notify.js); do not render an in-window approval overlay.
        return h(PluginBoundary, null, h(OnboardingOverlayV2, { ...props, localeService }));
      }

      const registerSlot = (name, options, component) => {
        try {
          ctx.slots.inject(name, () => ctx.slots.register({ name, ...options }, component));
        } catch (error) {
          // A slot that the running DSH release does not provide must not
          // prevent the other seams (notably the new plugin manager) from
          // registering.
          ctx.logger?.warn?.(`[dsh-mcp-gateway] slot ${name} unavailable: ${String(error)}`);
        }
      };

      // DSH 0.2.2+ plugin manager page. Keep the old settings.section
      // registration below so the same bundle also works with 0.2.1.
      registerSlot('plugins.item', {
        id: 'dsh-mcp-gateway',
        order: 60,
        label: () => createTranslator(readLanguage(localeService))('nav'),
        locale: 'dsh-mcp-gateway',
      }, PluginSettingsItemRoot);

      registerSlot('settings.section', {
        id: 'dsh-mcp-gateway',
        order: 60,
        label: () => createTranslator(readLanguage(localeService))('nav'),
      }, SettingsSectionRoot);

      registerSlot('shell.overlay', {
        id: 'dsh-mcp-gateway-onboarding',
        order: 20,
      }, OnboardingOverlayRoot);
    }

    return {
      name: 'dsh-mcp-gateway',
      inject: ['slots'],
      apply,
    };
  },
});
