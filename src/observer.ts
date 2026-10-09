import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { Config } from './config.js'
import { redact, redactText } from './redact.js'

export interface TraceRecord {
  version: 1
  sessionId: string
  taskId: string
  seq: number
  time: number
  type: 'turn/start' | 'turn/end' | 'tool/call' | 'tool/result' | 'usage'
  turn: number
  step?: number
  callId?: string
  tool?: string
  signature?: string
  durationMs?: number | null
  success?: boolean
  errorCode?: string
  reason?: string
  usage?: { inputTokens: number; outputTokens: number; totalTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number }
  payload?: unknown
}

export class ExecutionObserver {
  readonly file: string
  readonly stats = { recorded: 0, dropped: 0, errors: 0 }
  private pending = 0
  private queue: Promise<void> = Promise.resolve()
  private readonly calls = new Map<string, { time: number; tool: string }>()
  private closed = false
  constructor(private config: Config, private warn: (message: string) => void = () => {}) {
    this.file = join(config.storageDir, 'trajectories.jsonl')
  }
  observe(sessionId: string, event: SessionEvent): void {
    if (this.closed) return
    try {
      const record = this.project(sessionId, event)
      if (!record) return
      if (this.pending >= this.config.maxQueue) { this.stats.dropped++; return }
      const line = JSON.stringify(record) + '\n'
      this.pending++
      this.queue = this.queue.then(async () => {
        await mkdir(this.config.storageDir, { recursive: true })
        await appendFile(this.file, line, { encoding: 'utf8', mode: 0o600 })
        this.stats.recorded++
      }).catch(() => {
        this.stats.errors++
        this.warn('EvoForge trajectory persistence failed; inspect storage permissions')
      }).finally(() => { this.pending-- })
    } catch { this.stats.errors++ }
  }
  private project(sessionId: string, event: SessionEvent): TraceRecord | undefined {
    if (!['turn/start', 'turn/end', 'tool/call', 'tool/result', 'assistant/message'].includes(event.type)) return
    const data = event.data as { turn: number; step?: number }
    const base = { version: 1 as const, sessionId, taskId: `${sessionId}:${data.turn}`, seq: Number(event.seq), time: event.time, turn: data.turn, step: data.step }
    switch (event.type) {
      case 'turn/start': return { ...base, type: event.type }
      case 'turn/end':
        for (const key of this.calls.keys()) if (key.startsWith(`${sessionId}\0`)) this.calls.delete(key)
        return { ...base, type: event.type, reason: event.data.reason.kind }
      case 'tool/call': {
        const { callId, name, arguments: raw } = event.data
        const key = `${sessionId}\0${callId}`
        // Bounded in-flight correlation even if a session never closes.
        if (this.calls.size >= this.config.maxQueue) this.calls.delete(this.calls.keys().next().value!)
        this.calls.set(key, { time: event.time, tool: name })
        let safe: unknown
        try { safe = redact(JSON.parse(raw), this.config.maxPayloadChars) } catch { safe = '[INVALID_JSON]' }
        return { ...base, type: event.type, callId, tool: redactText(name, 100), signature: createHash('sha256').update(JSON.stringify(safe)).digest('hex'),
          ...(this.config.capturePayloads ? { payload: safe } : {}) }
      }
      case 'tool/result': {
        const { message, error } = event.data
        const key = `${sessionId}\0${message.toolCallId}`
        const call = this.calls.get(key)
        this.calls.delete(key)
        return { ...base, type: event.type, callId: message.toolCallId, tool: call?.tool,
          durationMs: call ? Math.max(0, event.time - call.time) : null,
          success: !message.isError, errorCode: error?.code,
          ...(this.config.capturePayloads ? { payload: redact(message.content, this.config.maxPayloadChars) } : {}) }
      }
      case 'assistant/message': {
        const u = event.data.usage
        if (!u) return
        return { ...base, type: 'usage', usage: { inputTokens: u.inputTokens, outputTokens: u.outputTokens,
          totalTokens: u.totalTokens, cacheReadTokens: u.cacheReadTokens, cacheWriteTokens: u.cacheWriteTokens } }
      }
    }
  }
  forget(sessionId: string): void {
    for (const key of this.calls.keys()) if (key.startsWith(`${sessionId}\0`)) this.calls.delete(key)
  }
  async flush(): Promise<void> { await this.queue }
  async close(): Promise<void> { this.closed = true; await this.flush(); this.calls.clear() }
}

export async function replay(file: string): Promise<TraceRecord[]> {
  const lines = (await readFile(file, 'utf8')).split('\n')
  const records: TraceRecord[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (!line) continue
    try {
      const record = JSON.parse(line) as TraceRecord
      if (record.version !== 1 || typeof record.sessionId !== 'string' || typeof record.taskId !== 'string' || !Number.isFinite(record.time)) throw new Error('invalid trace')
      records.push(record)
    } catch {
      // A crash may leave a torn final line. Interior corruption must be visible.
      if (i !== lines.length - 1) throw new Error(`Invalid trajectory line ${i + 1}`)
    }
  }
  return records
}
