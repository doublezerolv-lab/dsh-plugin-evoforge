import { readFile, mkdir, writeFile, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { resolveConfig } from '../src/config.js'
import { HarnessSynthesizer } from '../src/synthesizer.js'
import { CapabilityVerifier, compileTool } from '../src/verifier.js'
import { CapabilityRegistry } from '../src/registry.js'
import { DockerSandbox, type Sandbox } from '../src/sandbox.js'
import type { Artifact, CapabilityGap, Json } from '../src/types.js'

// Authored, trusted mock executor. Never evaluates the synthesized module on the host.
function trustedLogParser(input: Json): Json {
  const counts = { INFO: 0, WARN: 0, ERROR: 0 }; let malformed = 0
  for (const line of ((input as { text: string }).text).split(/\r?\n/)) {
    if (!line.trim()) continue
    const tokens = line.split(' ')
    const date = tokens.shift() ?? '', level = tokens.shift() ?? ''
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(date) || !['INFO', 'WARN', 'ERROR'].includes(level) || !tokens.join(' ')) { malformed++; continue }
    counts[level as keyof typeof counts]++
  }
  return { counts, malformed }
}

const dockerMode = process.argv.includes('--docker')
const outputArg = process.argv.indexOf('--output')
const outputDir = resolve(outputArg >= 0 ? process.argv[outputArg + 1]! : 'artifacts/benchmark-mock')
const rawTasks = await readFile(new URL('tasks.json', import.meta.url), 'utf8')
const tasks = JSON.parse(rawTasks) as { id: string; text: string; expected: Json }[]
const fixture = JSON.parse(await readFile(new URL('../examples/log-parser.json', import.meta.url), 'utf8')) as Artifact
const gap: CapabilityGap = { id: 'benchmark-log', kind: 'missing-tool', taskType: fixture.taskType, description: fixture.description,
  expectedReuse: tasks.length, candidates: ['tool'], evidence: { taskIds: tasks.map(t => t.id), callIds: [], occurrences: tasks.length, failures: 0, meanDurationMs: null } }
interface Row { group: string; task: string; success: boolean; durationMs: number; generationMs: number; verificationMs: number; generations: number; reused: boolean; promptBytes: number; tokens: null; moneyCost: null; error?: string }
const rows: Row[] = []
const verifications: { group: string; passed: boolean; errors: string[] }[] = []
for (const group of ['Baseline', 'CodeGen', 'EvoForge']) {
  const directory = await mkdtemp(join(tmpdir(), 'evoforge-bench-'))
  const config = resolveConfig({ storageDir: directory, enableGeneration: true, provider: 'mock', model: 'fixture-generator', generationBudgetTokens: 200000, verificationBudget: 100 })
  let registry = new CapabilityRegistry(directory)
  let promptBytes = 0
  const model = { async *stream(options: { messages: unknown[] }) {
    promptBytes += Buffer.byteLength(JSON.stringify(options.messages), 'utf8')
    yield { type: 'text-delta' as const, index: 0, text: JSON.stringify({ ...fixture, samples: [] }) }
    yield { type: 'finish' as const, reason: { kind: 'stop' as const } }
  } }
  let synthesizer = new HarnessSynthesizer(model, config, registry)
  const sandbox: Sandbox = dockerMode ? new DockerSandbox(config) : { isolation: 'mock', execute: async (_source, input) => trustedLogParser(input) }
  const verifier = new CapabilityVerifier(sandbox)
  let persistedId: string | undefined
  const compiled = new Map<string, string>()
  for (let index = 0; index < tasks.length; index++) {
    const task = tasks[index]!
    const started = performance.now(), beforeBytes = promptBytes
    let generations = 0, generationMs = 0, verificationMs = 0, reused = false
    try {
      let result: Json
      if (group === 'Baseline') result = trustedLogParser({ text: task.text })
      else {
        let artifact: Artifact
        if (group === 'EvoForge' && persistedId) {
          // New registry/model objects halfway through force a real disk restore.
          if (index === Math.floor(tasks.length / 2)) { registry = new CapabilityRegistry(directory); synthesizer = new HarnessSynthesizer(model, config, registry); compiled.clear() }
          artifact = await registry.get(persistedId); reused = true
        } else {
          const startGeneration = performance.now()
          artifact = await synthesizer.synthesize(gap, 'tool', fixture.samples)
          generations++; generationMs = performance.now() - startGeneration
          const startVerification = performance.now()
          const proof = await verifier.verify(artifact)
          verificationMs = performance.now() - startVerification
          verifications.push({ group, passed: proof.passed, errors: proof.errors })
          if (!proof.passed) throw new Error(proof.errors.join('; '))
          if (group === 'EvoForge') {
            const cap = await registry.create(artifact)
            await registry.recordVerification(cap.id, proof)
            // Mock proof remains verified, cannot activate in the real plugin.
            // Docker mode simulates explicit review only with the required CLI switch.
            if (dockerMode) {
              if (!process.argv.includes('--approve-reviewed-fixture')) throw new Error('Docker benchmark requires --approve-reviewed-fixture after reviewing examples/log-parser.json')
              await registry.approve(cap.id, 'benchmark-reviewed-fixture')
            }
            persistedId = cap.id
          }
        }
        // Runtime binding compiles once per active artifact; a restart recompiles.
        const key = artifact.code!
        let javascript = group === 'EvoForge' ? compiled.get(key) : undefined
        if (!javascript) { javascript = compileTool(key); if (group === 'EvoForge') compiled.set(key, javascript) }
        result = await sandbox.execute(javascript, { text: task.text })
      }
      rows.push({ group, task: task.id, success: isDeepStrictEqual(result, task.expected), durationMs: performance.now() - started,
        generationMs, verificationMs, generations, reused, promptBytes: promptBytes - beforeBytes, tokens: null, moneyCost: null })
    } catch (error) {
      rows.push({ group, task: task.id, success: false, durationMs: performance.now() - started, generationMs, verificationMs, generations, reused,
        promptBytes: promptBytes - beforeBytes, tokens: null, moneyCost: null, error: (error as Error).message })
    }
  }
}
const summaries = ['Baseline', 'CodeGen', 'EvoForge'].map(group => {
  const data = rows.filter(r => r.group === group), checks = verifications.filter(v => v.group === group)
  return { group, tasks: data.length, successRate: data.filter(r => r.success).length / data.length,
    averageTokens: null, moneyCost: null, elapsedMs: data.reduce((n, r) => n + r.durationMs, 0), averageMs: data.reduce((n, r) => n + r.durationMs, 0) / data.length,
    generationAttempts: data.reduce((n, r) => n + r.generations, 0), generationSuccessRate: checks.length ? checks.filter(c => c.passed).length / checks.length : null,
    toolReuseRate: data.filter(r => r.reused).length / data.length, skillReuseRate: null,
    firstTaskMs: data[0]!.durationMs, subsequentAverageMs: data.slice(1).reduce((n, r) => n + r.durationMs, 0) / (data.length - 1),
    generationPromptBytes: data.reduce((n, r) => n + r.promptBytes, 0) }
})
const report = { format: 1, executedAt: new Date().toISOString(), mode: dockerMode ? 'mock-model/docker-execution' : 'mock-model/trusted-fixture-execution',
  model: 'fixture-generator', taskSetSha256: createHash('sha256').update(rawTasks).digest('hex'),
  limitations: ['Scripted mock agent/model, not an LLM performance experiment.', 'Mock executor runs authored trusted logic, not generated source; mock verification cannot activate tools.',
    'Tokens and monetary costs are unavailable (null); prompt bytes are measured bytes, not tokens.', 'Baseline is a strong fixed parser; generated modes may have higher total latency.', 'No Skill efficacy measurement.'],
  summaries, rows, verifications }
await mkdir(outputDir, { recursive: true })
await writeFile(join(outputDir, 'results.json'), JSON.stringify(report, null, 2))
await writeFile(join(outputDir, 'results.csv'), ['group,task,success,durationMs,generationMs,verificationMs,generations,reused,promptBytes,tokens,moneyCost', ...rows.map(r => [r.group, r.task, r.success, r.durationMs, r.generationMs, r.verificationMs, r.generations, r.reused, r.promptBytes, '', ''].join(','))].join('\n'))
const bars = (key: 'elapsedMs' | 'generationAttempts', title: string) => {
  const max = Math.max(1, ...summaries.map(s => s[key]))
  return `<svg viewBox="0 0 680 160" role="img" aria-label="${title}"><text x="10" y="20" font-size="17">${title}</text>${summaries.map((s, i) => `<text x="10" y="${55 + i * 40}">${s.group}</text><rect x="120" y="${37 + i * 40}" width="${s[key] / max * 420}" height="25" fill="${['#64748b', '#b45309', '#0369a1'][i]}"/><text x="${130 + s[key] / max * 420}" y="${55 + i * 40}">${s[key].toFixed(1)}</text>`).join('')}</svg>`
}
await writeFile(join(outputDir, 'report.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><title>EvoForge executed mock benchmark</title><style>body{font:16px system-ui;max-width:900px;margin:40px auto;color:#172033}svg{width:100%;margin:20px 0}table{border-collapse:collapse;width:100%}td,th{padding:10px;border-bottom:1px solid #ddd;text-align:left}</style><h1>Executed mock benchmark</h1><p>Mode: ${report.mode}. This measures implementation behavior, not LLM efficacy. Baseline may be faster. Tokens and monetary costs are unavailable.</p><table><tr><th>Group</th><th>Success</th><th>First task ms</th><th>Later mean ms</th><th>Reuse</th></tr>${summaries.map(s => `<tr><td>${s.group}</td><td>${(s.successRate * 100).toFixed(0)}%</td><td>${s.firstTaskMs.toFixed(1)}</td><td>${s.subsequentAverageMs.toFixed(1)}</td><td>${(s.toolReuseRate * 100).toFixed(0)}%</td></tr>`).join('')}</table>${bars('elapsedMs', 'Total measured elapsed ms (lower is faster)')}${bars('generationAttempts', 'Observed generation attempts')}<p>Executed at ${report.executedAt}. All arms use the same 12 tasks and independent expected results. No Skill efficacy claim.</p></html>`)
console.log(JSON.stringify(summaries, null, 2))
console.log(`Artifacts: ${outputDir}`)
if (rows.some(r => !r.success)) process.exitCode = 1
