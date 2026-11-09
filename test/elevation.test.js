import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { writeSettingsElevated } from '../lib/settings-elevation.js'

test('writeSettingsElevated spawns a helper and verifies the written file', { skip: process.platform !== 'win32' }, async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dshmcp-elev-io-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const target = path.join(directory, 'settings.json')
  const helper = path.join(directory, 'copy-helper.ps1')
  const body = '{"schemaVersion":2,"revision":1}\n'
  await writeFile(target, '{"old":true}\n', 'utf8')
  await writeFile(helper, 'param([string]$Source,[string]$Target)\nCopy-Item -LiteralPath $Source -Destination $Target -Force\nexit 0\n', 'utf8')
  await writeSettingsElevated({ filePath: target, body, helperPath: helper })
  assert.equal(await readFile(target, 'utf8'), body)
})

test('a cancelled/failed helper becomes settings-write-denied', { skip: process.platform !== 'win32' }, async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dshmcp-elev-fail-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const target = path.join(directory, 'settings.json')
  const helper = path.join(directory, 'fail-helper.ps1')
  await writeFile(target, '{"old":true}\n', 'utf8')
  await writeFile(helper, 'exit 3\n', 'utf8')
  await assert.rejects(
    writeSettingsElevated({ filePath: target, body: '{"new":true}\n', helperPath: helper }),
    (error) => error.code === 'settings-write-denied' && error.details.cause === 'elevation-cancelled',
  )
  assert.equal(await readFile(target, 'utf8'), '{"old":true}\n')
})
