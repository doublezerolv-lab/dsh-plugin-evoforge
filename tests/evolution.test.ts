import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CapabilityRegistry, fingerprint } from '../src/registry.js'
import { RuleGapDetector } from '../src/detector.js'
import { HeuristicPolicy } from '../src/policy.js'
import { CapabilityVerifier, compileTool } from '../src/verifier.js'
import { DockerSandbox } from '../src/sandbox.js'
import { resolveConfig } from '../src/config.js'
import { EvolutionEngine } from '../src/engine.js'
import { HarnessSynthesizer, parseGeneratedArtifact } from '../src/synthesizer.js'
import type { TraceRecord } from '../src/observer.js'
import type { Capability, Verification } from '../src/types.js'
import { sumTool, sumSkill, gap, sumSamples } from './fixtures.js'

const temp = () => mkdtemp(join(tmpdir(), 'evoforge-core-'))
// Test-only proof fixture. Production verification always uses DockerSandbox.
const proof = (cap: Capability): Verification => ({ passed: true, fingerprint: cap.fingerprint, time: new Date().toISOString(), checks: ['test-fixture'], errors: [], independentSamples: 2, execution: 'docker' })
async function approved(registry: CapabilityRegistry, artifact = sumTool) {
  const cap = await registry.create(artifact)
  await registry.recordVerification(cap.id, proof(cap))
  return registry.approve(cap.id, 'test-reviewer')
}
test('gap detector distinguishes unknown tools from permissions and isolated failures', () => {
  const rows: TraceRecord[] = ['UNKNOWN_TOOL', 'UNKNOWN_TOOL', 'PERMISSION_DENIED', 'AUTH_ERROR', 'INVALID_ARGUMENTS'].map((code, i) => ({ version: 1, sessionId: 's', taskId: `s:${i}`, seq: i, time: i, turn: i, type: 'tool/result', tool: i < 2 ? 'missing' : 'existing', callId: `c${i}`, success: false, errorCode: code }))
  const gaps = new RuleGapDetector().detect(rows)
  assert.equal(gaps.length, 1)
  assert.equal(gaps[0]?.kind, 'missing-tool')
  assert.equal(gaps[0]?.expectedReuse, 2)
})
test('detector detects repeated successful workflows, exact repeated code and slow calls', () => {
  const rows: TraceRecord[] = []
  for (let task = 1; task <= 3; task++) {
    for (const tool of ['read', 'parse']) rows.push({ version: 1, sessionId: 's', taskId: `s:${task}`, seq: rows.length, time: rows.length, turn: task, type: 'tool/result', tool, success: true, durationMs: 4000 })
    rows.push({ version: 1, sessionId: 's', taskId: `s:${task}`, seq: rows.length, time: rows.length, turn: task, type: 'turn/end', reason: 'completed' })
    rows.push({ version: 1, sessionId: 's', taskId: `s:${task}`, seq: rows.length, time: rows.length, turn: task, type: 'tool/call', tool: 'run_code', signature: 'abc' })
  }
  const kinds = new Set(new RuleGapDetector().detect(rows).map(g => g.kind))
  assert.deepEqual(kinds, new Set(['slow', 'workflow', 'repeated-code']))
})
test('cost policy covers CREATE/DEFER/REUSE/IMPROVE/RETIRE', async () => {
  const policy = new HeuristicPolicy()
  const metrics = { expectedReuse: 5, savedTokensPerUse: 1000, generationTokens: 2000, verificationTokens: 500, minimumConfidence: 3 }
  assert.equal(policy.decide(gap, [], metrics).action, 'CREATE')
  assert.equal(policy.decide(gap, [], { ...metrics, generationTokens: 6000 }).action, 'DEFER')
  const cap = await approved(new CapabilityRegistry(await temp()))
  assert.equal(policy.decide(gap, [cap], metrics).action, 'REUSE')
  cap.stats = { uses: 10, successes: 6, totalDurationMs: 10 }
  assert.equal(policy.decide(gap, [cap], metrics).action, 'IMPROVE')
  cap.stats.successes = 2
  assert.equal(policy.decide(gap, [cap], metrics).action, 'RETIRE')
})
test('registry deduplicates, gates approval, versions, rolls back and persists statistics', async () => {
  const registry = new CapabilityRegistry(await temp())
  const cap = await registry.create(sumTool)
  assert.equal((await registry.create(sumTool)).id, cap.id)
  await assert.rejects(registry.approve(cap.id, 'human'), /verification/)
  await registry.recordVerification(cap.id, proof(cap)); await registry.approve(cap.id, 'human')
  const next = await approved(registry, { ...sumTool, code: sumTool.code + '\n// revised' })
  assert.equal(next.version, 2)
  assert.equal((await registry.get(cap.id)).status, 'retired')
  await registry.rollback(cap.id, 'human')
  assert.equal((await registry.get(next.id)).status, 'retired')
  await registry.track(cap.id, true, 10)
  const restored = new CapabilityRegistry(registry.directory)
  assert.equal((await restored.get(cap.id)).stats.successes, 1)
  assert.equal((await restored.list('sum finite')).length, 2)
})
test('registry concurrent writers serialize and restart does not reset budgets', async () => {
  const dir = await temp()
  const a = new CapabilityRegistry(dir), b = new CapabilityRegistry(dir)
  await Promise.all([a.create(sumTool), b.create(sumSkill)])
  assert.equal((await a.list()).length, 2)
  await a.reserve(5, 1, { tokens: 10, verifications: 2 })
  await b.reserve(5, 1, { tokens: 10, verifications: 2 })
  await assert.rejects(new CapabilityRegistry(dir).reserve(1, 0, { tokens: 10, verifications: 2 }), /exhausted/)
})
test('artifact tampering and mismatched proof fail closed', async () => {
  const registry = new CapabilityRegistry(await temp())
  const cap = await registry.create(sumTool)
  await assert.rejects(registry.recordVerification(cap.id, { ...proof(cap), fingerprint: 'wrong' }), /does not match/)
  const state = JSON.parse(await readFile(registry.file, 'utf8'))
  state.capabilities[0].code += '\n// tampered'
  await writeFile(registry.file, JSON.stringify(state))
  await assert.rejects(registry.list(), /integrity/)
})
test('compiler rejects imports, ambient host access and broken TypeScript', () => {
  assert.match(compileTool(sumTool.code!), /export function run/)
  for (const code of ['import fs from "node:fs"; export function run() {}', 'export function run() { return process.env }', 'export function run() { return import("node:fs") }', 'export function run(): number { return "bad" }']) assert.throws(() => compileTool(code))
})
test('verification needs independent samples and surfaces sandbox refusal', async () => {
  let executions = 0
  const verifier = new CapabilityVerifier({ execute: async () => { executions++; throw new Error('Docker unavailable') } })
  const selfTests = await verifier.verify({ ...sumTool, samples: sumSamples.map(s => ({ ...s, source: 'generated' })) })
  assert.equal(selfTests.passed, false); assert.equal(executions, 0)
  const result = await verifier.verify(sumTool)
  assert.equal(result.passed, false); assert.match(result.errors[0]!, /Docker unavailable/)
})
test('Skill verifier checks independent workflow contracts without executing code', async () => {
  const verifier = new CapabilityVerifier({ execute: async () => { throw new Error('must not run') } })
  const result = await verifier.verify(sumSkill)
  assert.equal(result.passed, true); assert.equal(result.execution, 'skill-review')
  const invalid = await verifier.verify({ ...sumSkill, dependencies: [] })
  assert.equal(invalid.passed, false)
})
test('mock verification cannot approve a tool for production registration', async () => {
  const registry = new CapabilityRegistry(await temp())
  const cap = await registry.create(sumTool)
  await registry.recordVerification(cap.id, { ...proof(cap), execution: 'mock' })
  await assert.rejects(registry.approve(cap.id, 'human'), /Mock verification/)
})
test('real Docker adapter refuses missing Docker or missing local image', async () => {
  const sandbox = new DockerSandbox(resolveConfig({ sandboxImage: `evoforge-nonexistent-${Date.now()}` }))
  await assert.rejects(sandbox.execute('export function run() { return 1 }', {}), /unavailable|failed/)
})
test('Observe mode never synthesizes and automatic drafts remain unapproved', async () => {
  let syntheses = 0
  const synthesizer = { synthesize: async () => { syntheses++; return sumTool } }
  const verifier = new CapabilityVerifier({ execute: async () => 0 })
  const observe = new EvolutionEngine(resolveConfig({ storageDir: await temp() }), verifier, synthesizer)
  await assert.rejects(observe.propose(gap, 'tool', []), /disabled/); assert.equal(syntheses, 0)
  const enabled = new EvolutionEngine(resolveConfig({ storageDir: await temp(), enableGeneration: true }), verifier, synthesizer)
  const draft = await enabled.propose(gap, 'tool', [])
  assert.equal(draft.status, 'draft'); assert.equal(syntheses, 1)
  await enabled.propose(gap, 'tool', [])
  assert.equal(syntheses, 1)
})
test('synthesizer consumes official stream protocol and strips false independent provenance', async () => {
  const config = resolveConfig({ storageDir: await temp(), enableGeneration: true, provider: 'test', model: 'test', generationBudgetTokens: 20000 })
  const registry = new CapabilityRegistry(config.storageDir)
  const synthesizer = new HarnessSynthesizer({ async *stream(options) {
    assert.equal(options.provider, 'test')
    yield { type: 'text-delta', index: 0, text: JSON.stringify(sumTool) }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } }, config, registry)
  const artifact = await synthesizer.synthesize(gap, 'tool', [])
  assert.ok(artifact.samples.every(s => s.source === 'generated'))
  assert.equal(fingerprint(artifact).length, 64)
  assert.ok((await registry.budget()).tokens > 0)
})

test('generation parser accepts an entire JSON fence and refuses prose or malformed JSON', () => {
  const json = JSON.stringify(sumTool)
  assert.deepEqual(parseGeneratedArtifact('```json\n' + json + '\n```'), sumTool)
  assert.deepEqual(parseGeneratedArtifact('  ' + json + '\n'), sumTool)
  assert.throws(() => parseGeneratedArtifact('Here is a tool:\n' + json))
  assert.throws(() => parseGeneratedArtifact('```json\n{invalid}\n```'))
})
