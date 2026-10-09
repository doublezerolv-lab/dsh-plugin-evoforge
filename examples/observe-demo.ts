import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import * as evoforge from '../src/index.js'
import { replay } from '../src/observer.js'
import { resolve } from 'node:path'

const ctx = new Context()
await ctx.plugin(SessionStore).await()
await ctx.plugin(evoforge, { storageDir: '.evoforge/demo' }).await()
const session = ctx.sessions.create(SessionId(`demo-${Date.now()}`))
session.append('turn/start', { turn: 1 })
session.append('tool/call', { turn: 1, step: 1, callId: ToolCallId('parse-1'), name: 'parse-log', arguments: '{"api_key":"demo-only","text":"2026-10-09 ERROR timeout"}' })
session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId: ToolCallId('parse-1'), content: [{ type: 'text', text: 'Tool is not registered' }], isError: true }), error: { name: 'ToolError', code: 'UNKNOWN_TOOL' } }, { surfaceOp: 'append' })
session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
await ctx.parallel('session/flush', session)
console.log(JSON.stringify(await replay(resolve('.evoforge/demo/trajectories.jsonl')), null, 2))
await ctx.fiber.dispose()
