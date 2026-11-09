/**
 * Capability registry, three levels, and the four approval modes.
 *
 * This module is pure policy: it maps model-facing MCP tools to the
 * capabilities the user grants, decides which tools are listed, and answers
 * whether a tool call needs a human approval.
 */

export const CAPABILITY_LEVELS = Object.freeze([
  {
    id: 'basic',
    title: '基础',
    titleEn: 'Basic',
    description: '已有会话的查看、读取、发送与等待。',
    descriptionEn: 'Inspect, read, message and wait on existing sessions.',
  },
  {
    id: 'regular',
    title: '常规',
    titleEn: 'Regular',
    description: '新建会话、指定模型、切换权限、取消、派生与改名。',
    descriptionEn: 'Create sessions, choose models, switch permissions, cancel, fork and rename.',
  },
  {
    id: 'advanced',
    title: '进阶',
    titleEn: 'Advanced',
    description: '调整 DSH 设置、管理插件与凭据等用户级操作。',
    descriptionEn: 'Change DSH settings, manage plugins and credentials, and other user-level operations.',
  },
])

export const CAPABILITIES = Object.freeze({
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
    descriptionEn: 'Rename a session.',
    tools: ['rename_session'],
  },
  manageSettings: {
    level: 'advanced',
    title: '调整设置',
    titleEn: 'Manage settings',
    description: '读取并修改 DSH 的实时插件设置。',
    descriptionEn: 'Read and change live DSH plugin settings.',
    tools: ['settings_describe', 'settings_update'],
  },
  managePlugins: {
    level: 'advanced',
    title: '管理插件',
    titleEn: 'Manage plugins',
    description: '列出、启停、安装与卸载 DSH 插件。',
    descriptionEn: 'List, enable, disable, install and remove DSH plugins.',
    tools: [
      'plugins_list',
      'plugin_set_enabled',
      'bundle_set_enabled',
      'plugin_install',
      'plugin_remove',
    ],
  },
  manageCredentials: {
    level: 'advanced',
    title: '管理凭据',
    titleEn: 'Manage credentials',
    description: '查看凭据状态、设置/移除环境变量凭据（不读取明文）。',
    descriptionEn: 'Inspect credential status and set/remove environment credentials (never read plaintext).',
    tools: ['credentials_describe', 'credential_set', 'credential_unset'],
  },
})

export const CAPABILITY_KEYS = Object.freeze(Object.keys(CAPABILITIES))

/** Tool -> required capabilities, first entry is the approval subject. */
export const TOOL_CAPABILITIES = Object.freeze({
  list_sessions: ['listSessions'],
  read_session: ['readSessions'],
  send_message: ['sendMessages'],
  wait_for_completion: ['waitForCompletion'],
  ask_dsh: ['askDsh', 'sendMessages', 'waitForCompletion'],
  list_models: ['listModels'],
  create_session: ['createSessions'],
  run_task: ['createSessions', 'sendMessages', 'waitForCompletion'],
  set_model: ['selectModel'],
  set_permission: ['setPermission'],
  cancel_turn: ['cancelTurns'],
  fork_session: ['forkSessions'],
  rename_session: ['renameSessions'],
  settings_describe: ['manageSettings'],
  settings_update: ['manageSettings'],
  plugins_list: ['managePlugins'],
  plugin_set_enabled: ['managePlugins'],
  bundle_set_enabled: ['managePlugins'],
  plugin_install: ['managePlugins'],
  plugin_remove: ['managePlugins'],
  credentials_describe: ['manageCredentials'],
  credential_set: ['manageCredentials'],
  credential_unset: ['manageCredentials'],
})

export const TOOL_NAMES = Object.freeze(Object.keys(TOOL_CAPABILITIES))

export const APPROVAL_MODES = Object.freeze([
  {
    value: 'only-checked',
    title: '审批（仅勾选项）',
    titleEn: 'Approval (checked only)',
    description: '只有勾选的能力可用；每次调用都需要你审批。',
    descriptionEn: 'Only checked capabilities are available; every call needs your approval.',
  },
  {
    value: 'except-checked',
    title: '审批（勾选项除外）',
    titleEn: 'Approval (except checked)',
    description: '勾选项直接放行；未勾选项需要你逐次审批。',
    descriptionEn: 'Checked capabilities run directly; unchecked ones need approval each time.',
  },
  {
    value: 'all',
    title: '均需审批',
    titleEn: 'Approve everything',
    description: '所有能力都可用，但每次调用都需要你审批。',
    descriptionEn: 'Every capability is available, and every call needs your approval.',
  },
  {
    value: 'open',
    title: '完全开放（无视名单）',
    titleEn: 'Open (ignore list)',
    description: '所有能力直接放行，不再询问；名单仅作展示。',
    descriptionEn: 'Every capability runs directly with no prompts; the list is display-only.',
  },
])

export const APPROVAL_MODE_VALUES = Object.freeze(APPROVAL_MODES.map((mode) => mode.value))

/** Whether a capability is checked in the user's grant list. */
export function isCapabilityChecked(settings, capability) {
  return settings.capabilities?.[capability] === true
}

/** All required capabilities for one tool. */
export function requiredCapabilities(toolName) {
  return TOOL_CAPABILITIES[toolName] ?? []
}

/**
 * Tool visibility under the current mode.
 * - only-checked: all required capabilities must be checked.
 * - every other mode: all tools stay visible; approval policy decides the call.
 */
export function isToolVisible(settings, toolName) {
  if (settings.approvalMode !== 'only-checked') return true
  return requiredCapabilities(toolName).every((capability) =>
    isCapabilityChecked(settings, capability),
  )
}

/** Visible model-facing tools in registry order. */
export function visibleToolNames(settings) {
  return TOOL_NAMES.filter((tool) => isToolVisible(settings, tool))
}

/**
 * Decide one tool call.
 * @returns {{allowed: boolean, approval: boolean, capability?: string, reason?: string}}
 */
export function evaluateToolAccess(settings, toolName) {
  const required = requiredCapabilities(toolName)
  if (required.length === 0) {
    return { allowed: false, approval: false, reason: 'unknown-tool' }
  }
  const primary = required[0]
  if (settings.approvalMode === 'open') {
    return { allowed: true, approval: false, capability: primary }
  }
  const checked = required.every((capability) => isCapabilityChecked(settings, capability))
  if (settings.approvalMode === 'only-checked') {
    if (!checked) {
      return { allowed: false, approval: false, capability: primary, reason: 'capability-not-granted' }
    }
    return { allowed: true, approval: true, capability: primary }
  }
  if (settings.approvalMode === 'except-checked') {
    return { allowed: true, approval: !checked, capability: primary }
  }
  // all
  return { allowed: true, approval: true, capability: primary }
}

/** Capability metadata grouped by level, with checked state for one settings object. */
export function capabilityCatalog(settings) {
  return CAPABILITY_LEVELS.map((level) => ({
    ...level,
    capabilities: CAPABILITY_KEYS.filter((key) => CAPABILITIES[key].level === level.id).map(
      (key) => ({
        key,
        level: level.id,
        title: CAPABILITIES[key].title,
        titleEn: CAPABILITIES[key].titleEn,
        description: CAPABILITIES[key].description,
        descriptionEn: CAPABILITIES[key].descriptionEn,
        tools: [...CAPABILITIES[key].tools],
        checked: isCapabilityChecked(settings, key),
      }),
    ),
  }))
}

export function defaultCapabilities() {
  const result = {}
  for (const key of CAPABILITY_KEYS) {
    result[key] = CAPABILITIES[key].level === 'basic'
  }
  return result
}

export function approvalModeCatalog() {
  return APPROVAL_MODES.map((mode) => ({ ...mode }))
}
