/**
 * Shared constants and default values for the dsh-mcp-gateway plugin.
 */

import { defaultCapabilities } from './capabilities.js'

export const SETTINGS_SCHEMA_VERSION = 2
export const DATA_DIR_NAME = 'dsh-mcp-gateway'
export const SETTINGS_FILE_NAME = 'settings.json'

export const SERVER_PATH = '/dsh-mcp'
export const MCP_PATH = `${SERVER_PATH}/mcp`
export const API_PREFIX = `${SERVER_PATH}/api`
export const MCP_SERVER_NAME = 'dsh-mcp'
export const TOKEN_PREFIX = 'dshmcp_'

export const DEFAULT_APPROVAL_MODE = 'only-checked'

export const DEFAULT_SCOPE = Object.freeze({
  sessionMode: 'all',
  sessionIds: [],
  includeSubagents: false,
  modelMode: 'all',
  allowedModels: [],
  allowedRoots: [],
  defaultCwd: '',
  defaultModel: '',
  newSessionPreset: 'workspace-write',
})

/**
 * Numeric limits use -1 (or any negative value) as "unlimited". Positive
 * values keep the existing bounded behavior.
 */
export const DEFAULT_LIMITS = Object.freeze({
  maxReadMessages: -1,
  maxReadChars: -1,
  maxMessageChars: -1,
  defaultWaitMs: -1,
  maxWaitMs: -1,
  approvalTimeoutMs: -1,
  sendWhenBusy: 'queue',
})

/** True when a configured numeric limit should be ignored. */
export function isUnlimited(value) {
  return typeof value === 'number' && Number.isFinite(value) && value < 0
}

export const DEFAULT_ONBOARDING = Object.freeze({
  shownAt: null,
  acknowledgedAt: null,
})

export const LIMIT_BOUNDS = Object.freeze({
  maxReadMessages: { min: 1, max: 500 },
  maxReadChars: { min: 1000, max: 500000 },
  maxMessageChars: { min: 1000, max: 1000000 },
  defaultWaitMs: { min: 1000, max: 600000 },
  maxWaitMs: { min: 1000, max: 600000 },
  approvalTimeoutMs: { min: 5000, max: 600000 },
})

export const DEFAULT_SERVER = Object.freeze({
  enabled: true,
  token: '',
  allowNonLoopback: false,
  systemApprovalPopup: true,
  instructions: '',
})

/** Build a fresh, detached default settings object. */
export function defaultSettings() {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    approvalMode: DEFAULT_APPROVAL_MODE,
    capabilities: defaultCapabilities(),
    scope: {
      ...DEFAULT_SCOPE,
      sessionIds: [],
      allowedModels: [],
      allowedRoots: [],
    },
    limits: { ...DEFAULT_LIMITS },
    server: { ...DEFAULT_SERVER },
    onboarding: { ...DEFAULT_ONBOARDING },
  }
}

/** Defaults used by the settings UI "restore defaults" action. */
export function resettableDefaults() {
  const base = defaultSettings()
  return {
    approvalMode: base.approvalMode,
    capabilities: base.capabilities,
    scope: base.scope,
    limits: base.limits,
  }
}
