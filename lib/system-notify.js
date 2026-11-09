/**
 * System-level approval prompt for MCP calls. The DSH page's in-window
 * approval card has been removed at the user's request; this MessageBox is the
 * only approval surface. It remains actionable when the DSH window is minimized
 * or the user is in another application.
 *
 * On Windows this spawns a small PowerShell process that shows a native Yes/No
 * message box. The process posts the decision to the loopback management API.
 * Other platforms have no approval UI (calls time out), which is intentional:
 * this plugin currently supports the Windows system prompt as its approval
 * channel.
 */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const SCRIPT_PATH = fileURLToPath(new URL('./approval-popup.ps1', import.meta.url))

function powershellPath() {
  const root = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows'
  return path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

function encodeBase64(text) {
  return Buffer.from(String(text), 'utf8').toString('base64')
}

/** Format a non-browser approval prompt; the body is UTF-8 decoded by the script. */
export function formatApprovalText(entry) {
  const lines = [
    'DSH MCP 请求一次授权',
    '',
    `工具: ${entry.tool ?? '(unknown)'}`,
    `能力: ${entry.capability ?? '(unknown)'}`,
    `会话: ${entry.sessionId ?? '(not specified)'}`,
    `参数: ${entry.summary ?? '{}'}`,
    entry.expiresAt === null || entry.expiresAt === undefined
      ? '超时: 无限制（等待用户处理）'
      : `超时: ${Math.max(1, Math.round((entry.expiresAt - Date.now()) / 1000))} 秒`,
    '',
    '点击“是”允许本次调用，点击“否”拒绝。',
    '此 MessageBox 是本次调用的唯一审批入口。',
  ]
  return lines.join('\n')
}

export class SystemApprovalNotifier {
  /**
   * @param {{apiBase: string|null, logger?: object, platform?: string,
   *          enabled?: () => boolean, scriptPath?: string}} options
   */
  constructor(options = {}) {
    this.apiBase = typeof options.apiBase === 'string' ? options.apiBase.replace(/\/+$/, '') : null
    this.logger = options.logger ?? console
    this.platform = options.platform ?? process.platform
    this.enabled = typeof options.enabled === 'function' ? options.enabled : () => true
    this.scriptPath = typeof options.scriptPath === 'string' ? options.scriptPath : SCRIPT_PATH
    this.children = new Map()
  }

  /** Show a native Windows prompt for one pending entry; never throws. */
  notify(entry) {
    if (this.platform !== 'win32') return false
    if (this.apiBase === null || this.apiBase.length === 0) return false
    try {
      if (this.enabled() === false) return false
      const id = String(entry?.id ?? '')
      if (id.length === 0) return false
      const apiUrl = `${this.apiBase}/approvals/${encodeURIComponent(id)}`
      const body = encodeBase64(formatApprovalText(entry))
      const child = spawn(powershellPath(), [
        '-NoProfile',
        '-STA',
        '-WindowStyle', 'Hidden',
        '-ExecutionPolicy', 'Bypass',
        '-File', this.scriptPath,
        '-ApprovalId', id,
        '-ApiUrl', apiUrl,
        '-Title', 'DSH MCP Approval',
        '-BodyBase64', body,
      ], {
        stdio: 'ignore',
        windowsHide: true,
        detached: false,
      })
      this.children.set(id, child)
      child.once('error', (error) => {
        if (this.children.get(id) === child) this.children.delete(id)
        this.logger.warn?.(`[dsh-mcp-gateway] system approval prompt failed: ${String(error)}`)
      })
      child.once('exit', (code) => {
        if (this.children.get(id) === child) this.children.delete(id)
        if (child.dshMcpCancelled !== true && code !== 0) {
          this.logger.warn?.(`[dsh-mcp-gateway] system approval prompt exited with code ${String(code)}`)
        }
      })
      return true
    } catch (error) {
      this.logger.warn?.(`[dsh-mcp-gateway] system approval prompt unavailable: ${String(error)}`)
      return false
    }
  }

  /** Close the prompt for one request after it was decided elsewhere/timed out. */
  cancel(id) {
    const key = String(id ?? '')
    const child = this.children.get(key)
    if (child === undefined) return false
    this.children.delete(key)
    child.dshMcpCancelled = true
    try {
      child.kill()
      return true
    } catch {
      return false
    }
  }

  close() {
    for (const child of this.children.values()) {
      child.dshMcpCancelled = true
      try {
        child.kill()
      } catch {
        // best effort
      }
    }
    this.children.clear()
  }
}
