/**
 * Windows UAC fallback for a settings write that the file ACL rejected.
 *
 * The unprivileged host writes the already-validated candidate JSON to a
 * temporary file, then launches a GUI-subsystem helper. The helper first shows
 * a Windows trust dialog (shield icon, target path, settings diff), then
 * self-elevates with ShellExecuteEx("runas") after the user allows it. No
 * PowerShell/console window is created. Cancelling the trust dialog or UAC
 * becomes a normal `settings-write-denied` error.
 */

import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { GatewayError } from './errors.js'

const HELPER_PATH = fileURLToPath(new URL('./settings-elevate.exe', import.meta.url))
const UAC_TIMEOUT_MS = 150000

function powershellPath() {
  const root = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows'
  return path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

function runHelper(helperPath, sourcePath, targetPath) {
  return new Promise((resolve) => {
    const chunks = []
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      resolve(result)
    }
    let child
    try {
      // Production uses the GUI .exe (no console). A .ps1 path remains
      // supported for tests and diagnostics, but it is not the default.
      if (helperPath.toLowerCase().endsWith('.exe')) {
        child = spawn(helperPath, [sourcePath, targetPath], {
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      } else {
        child = spawn(powershellPath(), [
          '-NoProfile',
          '-WindowStyle', 'Hidden',
          '-ExecutionPolicy', 'Bypass',
          '-File', helperPath,
          '-Source', sourcePath,
          '-Target', targetPath,
        ], {
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      }
    } catch (error) {
      finish({ code: null, error: String(error), stderr: '' })
      return
    }
    child.stdout?.on('data', (chunk) => chunks.push(chunk))
    child.stderr?.on('data', (chunk) => chunks.push(chunk))
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        // best effort
      }
      finish({ code: null, error: 'uac-timeout', stderr: Buffer.concat(chunks).toString('utf8') })
    }, UAC_TIMEOUT_MS)
    child.once('error', (error) => {
      clearTimeout(timer)
      finish({ code: null, error: String(error), stderr: Buffer.concat(chunks).toString('utf8') })
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      finish({ code, error: null, stderr: Buffer.concat(chunks).toString('utf8') })
    })
  })
}

/**
 * Ask Windows UAC to write one settings document. Resolves only after the file
 * content is verified; throws `settings-write-denied` when UAC is cancelled or
 * the elevated helper fails.
 *
 * @param {{filePath:string, body:string, logger?:object, helperPath?:string}} options
 */
export async function writeSettingsElevated({ filePath, body, logger, helperPath = HELPER_PATH }) {
  if (process.platform !== 'win32') {
    throw new GatewayError(
      'settings-write-denied',
      `cannot write settings file "${filePath}": administrator privileges are required and automatic elevation is only available on Windows`,
      { path: filePath, cause: 'elevation-unsupported' },
    )
  }
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-mcp-elevate-'))
  const sourcePath = path.join(directory, 'settings.json')
  try {
    await writeFile(sourcePath, body, { encoding: 'utf8', mode: 0o600 })
    const result = await runHelper(helperPath, sourcePath, filePath)
    if (result.code !== 0) {
      const detail = result.error === 'uac-timeout'
        ? 'the administrator permission prompt timed out'
        : 'the administrator permission prompt was cancelled or the elevated write failed'
      logger?.warn?.(`[dsh-mcp-gateway] elevated settings write failed: ${String(result.error ?? result.code)} ${result.stderr ?? ''}`)
      throw new GatewayError(
        'settings-write-denied',
        `cannot write settings file "${filePath}": ${detail}`,
        {
          path: filePath,
          cause: result.error === 'uac-timeout' ? 'elevation-timeout' : 'elevation-cancelled',
          exitCode: result.code,
          stderr: String(result.stderr ?? '').slice(0, 400),
        },
      )
    }
    const written = await readFile(filePath, 'utf8')
    if (written !== body) {
      throw new GatewayError(
        'settings-write-denied',
        `settings file "${filePath}" was written by the elevated helper but its content could not be verified`,
        { path: filePath, cause: 'elevation-verify-failed' },
      )
    }
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {})
  }
}
