import { createHash } from 'node:crypto'
import type { TraceRecord } from './observer.js'
import type { CapabilityGap, GapKind } from './types.js'

export interface DetectorOptions { minOccurrences: number; failureRate: number; slowMs: number }
export interface GapDetector { detect(records: readonly TraceRecord[]): CapabilityGap[] }
export class RuleGapDetector implements GapDetector {
  constructor(private options: DetectorOptions = { minOccurrences: 3, failureRate: 0.5, slowMs: 3000 }) {}
  detect(records: readonly TraceRecord[]): CapabilityGap[] {
    const results = records.filter(r => r.type === 'tool/result' && r.tool)
    const groups = Map.groupBy(results, r => r.tool!)
    const gaps: CapabilityGap[] = []
    const add = (kind: GapKind, tool: string, rows: TraceRecord[], candidates: ('tool' | 'skill')[]) => {
      const times = rows.flatMap(r => typeof r.durationMs === 'number' ? [r.durationMs] : [])
      gaps.push({ id: createHash('sha256').update(`${kind}:${tool}`).digest('hex').slice(0, 16), kind, taskType: tool,
        description: `${kind}: ${tool}`,
        evidence: { taskIds: [...new Set(rows.map(r => r.taskId))], callIds: rows.flatMap(r => r.callId ? [r.callId] : []), occurrences: rows.length,
          failures: rows.filter(r => r.success === false).length, meanDurationMs: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null },
        expectedReuse: new Set(rows.map(r => r.taskId)).size, candidates })
    }
    for (const [tool, rows] of groups) {
      const missing = rows.filter(r => r.errorCode === 'UNKNOWN_TOOL')
      if (missing.length >= 2) add('missing-tool', tool, missing, ['tool'])
      // Authentication, invalid arguments and approval denials are not capability failures.
      const failures = rows.filter(r => r.success === false && r.errorCode && /^(?:EXECUTION_ERROR|TOOL_EXECUTION_ERROR|TIMEOUT|TOOL_TIMEOUT)$/.test(r.errorCode))
      if (rows.length >= this.options.minOccurrences && failures.length / rows.length >= this.options.failureRate) add('unreliable', tool, rows, ['tool'])
      const slow = rows.filter(r => r.success && typeof r.durationMs === 'number' && r.durationMs >= this.options.slowMs)
      if (slow.length >= this.options.minOccurrences) add('slow', tool, slow, ['tool'])
    }
    // Compare redacted argument fingerprints only for code execution tools.
    const codeCalls = records.filter(r => r.type === 'tool/call' && /^(?:run_code|bash|python|execute_code)$/.test(r.tool ?? '') && r.signature)
    for (const [signature, rows] of Map.groupBy(codeCalls, r => r.signature!)) {
      if (rows.length >= this.options.minOccurrences) add('repeated-code', `code-${signature.slice(0, 12)}`, rows, ['tool', 'skill'])
    }
    const completed = new Set(records.filter(r => r.type === 'turn/end' && r.reason === 'completed').map(r => r.taskId))
    const sequences = Map.groupBy(results.filter(r => completed.has(r.taskId)), r => r.taskId)
    const workflows = new Map<string, TraceRecord[]>()
    for (const rows of sequences.values()) {
      if (rows.length < 2 || rows.some(r => !r.success)) continue
      const sequence = rows.map(r => r.tool).join(' -> ')
      workflows.set(sequence, [...(workflows.get(sequence) ?? []), ...rows])
    }
    for (const [sequence, rows] of workflows) {
      if (new Set(rows.map(r => r.taskId)).size >= this.options.minOccurrences) add('workflow', sequence, rows, ['skill'])
    }
    return gaps.sort((a, b) => b.expectedReuse - a.expectedReuse || a.id.localeCompare(b.id))
  }
}
