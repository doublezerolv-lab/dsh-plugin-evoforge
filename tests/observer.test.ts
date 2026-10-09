import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createAssistantMessage, createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import * as plugin from '../src/index.js'
import { resolveConfig } from '../src/config.js'
import { ExecutionObserver, replay } from '../src/observer.js'
import { redact } from '../src/redact.js'

const storage = () => mkdtemp(join(tmpdir(), 'evoforge-'))
function toolTurn(session: Session, turn = 1) {
  session.append('turn/start', { turn })
  session.append('tool/call', { turn, step: 1, callId: ToolCallId('call'), name: 'parse', arguments: '{"api_key":"sk-123456789","email":"ada@example.com","data":"abc"}' })
  session.append('tool/result', { turn, step: 1, message: createToolResultMessage({ callId: ToolCallId('call'), content: [{ type: 'text', text: 'secret=hide-me' }], isError: false }) }, { surfaceOp: 'append' })
  session.append('assistant/message', { turn, step: 1, message: createAssistantMessage({ content: [{ type: 'text', text: 'private reply' }], source: { provider: 'mock', model: 'mock' } }), stream: [], usage: { inputTokens: 10, outputTokens: 3 } }, { surfaceOp: 'append' })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}
test('real Cordis/Session plugin observes without changing history and unloads cleanly', async () => {
  const dir = await storage()
  const ctx = new Context()
  await ctx.plugin(SessionStore).await()
  const fiber = ctx.plugin(plugin, { storageDir: dir })
  await fiber.await()
  const session = ctx.sessions.create(SessionId('real-session'))
  toolTurn(session)
  const snapshot = JSON.stringify(session.snapshotEvents())
  await ctx.parallel('session/flush', session)
  const records = await replay(join(dir, 'trajectories.jsonl'))
  assert.equal(records.length, 5)
  assert.equal(records[2]?.success, true)
  assert.ok(records[2]?.durationMs !== null)
  assert.deepEqual(records[3]?.usage, { inputTokens: 10, outputTokens: 3 })
  assert.equal(JSON.stringify(session.snapshotEvents()), snapshot)
  await fiber.dispose()
  toolTurn(session, 2)
  await ctx.parallel('session/flush', session)
  assert.equal((await replay(join(dir, 'trajectories.jsonl'))).length, 5)
  await ctx.fiber.dispose()
})
test('default payload privacy and optional recursive redaction', async () => {
  const dir = await storage()
  const observer = new ExecutionObserver(resolveConfig({ storageDir: dir, capturePayloads: true }))
  const session = Session.create(SessionId('redaction'))
  toolTurn(session)
  for (const event of session.snapshotEvents()) observer.observe(session.id, event)
  await observer.close()
  const content = await readFile(observer.file, 'utf8')
  assert.ok(!content.includes('sk-123456789'))
  assert.ok(!content.includes('ada@example.com'))
  assert.ok(!content.includes('hide-me'))
  assert.ok(!content.includes('private reply'))
  assert.ok(content.includes('[REDACTED]'))
  assert.deepEqual(redact({ nested: { authorization: 'sensitive' } }), { nested: { authorization: '[REDACTED]' } })
})
test('write failure and queue overflow do not throw into agent', async () => {
  const dir = await storage()
  const blocked = join(dir, 'file')
  await writeFile(blocked, 'not a directory')
  const observer = new ExecutionObserver(resolveConfig({ storageDir: blocked, maxQueue: 1 }))
  const session = Session.create(SessionId('io-failure'))
  toolTurn(session)
  assert.doesNotThrow(() => { for (const event of session.snapshotEvents()) observer.observe(session.id, event) })
  await observer.close()
  assert.equal(observer.stats.errors, 1)
  assert.equal(observer.stats.dropped, 4)
})
test('replay tolerates a torn final line and rejects interior corruption', async () => {
  const dir = await storage()
  const file = join(dir, 'trace.jsonl')
  const line = JSON.stringify({ version: 1, sessionId: 's', taskId: 's:1', time: 1 })
  await writeFile(file, line + '\n{"broken')
  assert.equal((await replay(file)).length, 1)
  await writeFile(file, line + '\n{"broken\n' + line + '\n')
  await assert.rejects(replay(file), /line 2/)
})
test('configuration refuses unsafe approval and invalid generation combinations', () => {
  assert.equal(resolveConfig().enableGeneration, false)
  assert.throws(() => resolveConfig({ requireApproval: false }), /human approval/)
  assert.throws(() => resolveConfig({ autoEvolution: true }), /requires/)
  assert.throws(() => resolveConfig({ maxQueue: 0 }))
})
