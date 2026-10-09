import { registerHooks } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFile, mkdir, writeFile } from 'node:fs/promises'

// Execute with the installed Desktop Electron in Node mode. Its ASAR filesystem
// supplies the exact signed Harness runtime, including account authentication.
const runtimeDir = process.env.EVOFORGE_HARNESS_RUNTIME
if (!runtimeDir) throw new Error('EVOFORGE_HARNESS_RUNTIME must name the installed dsh runtime')
const anchor = pathToFileURL(join(runtimeDir, 'node_modules/@deepseek-ai/dsh/package.json')).href
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@deepseek-ai/')) return nextResolve(specifier, { ...context, parentURL: anchor })
  return nextResolve(specifier, context)
} })

const { Context } = await import('@deepseek-ai/cordis')
const imports = {}
for (const name of ['dsh-llm', 'dsh-authorization', 'dsh-credentials-local', 'dsh-deepseek-account-platform', 'dsh-llm-deepseek-account']) {
  imports[name] = await import('@deepseek-ai/' + name)
}
if (process.argv[2] === 'inspect') {
  for (const [name, module] of Object.entries(imports)) console.log(JSON.stringify({ name, exports: Object.keys(module), inject: module.inject ?? module.default?.inject }))
  process.exit(0)
}
if (process.argv[2] !== 'generate') throw new Error('Use inspect or generate; generation is never implicit')

const { HarnessSynthesizer, CapabilityRegistry, CapabilityVerifier, DockerSandbox, resolveConfig } = await import('../dist/core.js')
const outputDir = resolve(process.argv[3] ?? 'artifacts/live-generation')
const storageDir = resolve(process.env.EVOFORGE_LIVE_STORAGE ?? join(outputDir, 'registry'))
await mkdir(outputDir, { recursive: true })
const config = resolveConfig({ storageDir, enableGeneration: true, autoEvolution: false, maxRepairs: 0,
  provider: 'deepseek-account', model: 'deepseek-flash', generationBudgetTokens: 12000,
  verificationBudget: 12, sandboxTimeoutMs: 15000 })
const ctx = new Context()
const report = { runtime: 'installed Desktop', provider: config.provider, model: config.model,
  scope: 'human-specified generation contract; not autonomous gap discovery',
  startedAt: new Date().toISOString(), calls: [], status: 'initializing' }
try {
  const previous = JSON.parse(await readFile(join(outputDir, 'report.json'), 'utf8'))
  report.history = [...(previous.history ?? []), { startedAt: previous.startedAt, status: previous.status, phase: previous.phase, calls: previous.calls, error: previous.error }]
} catch (error) { if (error.code !== 'ENOENT') throw error }
try {
  for (const name of ['dsh-llm', 'dsh-credentials-local', 'dsh-authorization', 'dsh-deepseek-account-platform', 'dsh-llm-deepseek-account']) {
    report.phase = 'load-' + name
    const module = imports[name]
    const plugin = module.default ?? module
    const options = name === 'dsh-credentials-local' ? { watch: false }
      : name === 'dsh-llm-deepseek-account' ? { reasoningEffort: 'off', retryPolicy: { mode: 'normal', maxRetries: 0 } } : {}
    await ctx.plugin(plugin, options).await()
  }
  report.phase = 'authenticated-catalog'
  const models = await ctx.llm.listModels(config.provider)
  report.modelCatalog = models.map(model => model.id)
  if (!models.some(model => model.id === config.model)) throw new Error('Requested account model is absent from authenticated catalog')
  const registry = new CapabilityRegistry(storageDir)
  const sandbox = new DockerSandbox(config)
  report.phase = 'docker-preflight'
  await sandbox.available()
  if ((await registry.list()).length) throw new Error('This validation storage already contains a candidate; inspect it before another generation')
  const samples = JSON.parse(await readFile(new URL('../examples/log-generation-samples.json', import.meta.url), 'utf8'))
  const measured = { async *stream(options) {
    const call = { startedAt: new Date().toISOString(), durationMs: null, usage: null, finish: null }
    report.calls.push(call)
    const started = performance.now()
    let text = ''
    try {
      for await (const chunk of ctx.llm.stream(options)) {
        if (chunk.type === 'usage') call.usage = chunk.usage
        if (chunk.type === 'text-delta') text += chunk.text
        if (chunk.type === 'finish') call.finish = chunk.reason
        yield chunk
      }
    } finally {
      call.durationMs = performance.now() - started
      // Only this synthetic acceptance contract's generated output is retained.
      await writeFile(join(outputDir, 'model-response.txt'), text)
    }
  } }
  report.status = 'generating'
  report.phase = 'generation'
  const gap = { id: 'human-log-contract-v1', kind: 'missing-tool', taskType: 'log-summary-live',
    description: 'Human-specified integration acceptance test, not an observed missing tool. Generate a pure JSON timestamped log counter named evoforge-live-log-summary. Input {text:string}. Ignore blank lines. A valid line is YYYY-MM-DDTHH:mm:ssZ LEVEL message, where LEVEL is INFO, WARN, or ERROR and message has at least one character. Check timestamp format only, not calendar validity. Count the three levels and all malformed nonblank lines. Return exactly {counts:{INFO:integer,WARN:integer,ERROR:integer},malformed:integer}. Use no dependencies.',
    evidence: { taskIds: [], callIds: [], occurrences: 0, failures: 0, meanDurationMs: null }, expectedReuse: 0, candidates: ['tool'] }
  const artifact = await new HarnessSynthesizer(measured, config, registry).synthesize(gap, 'tool', samples)
  const candidate = await registry.create(artifact)
  await writeFile(join(outputDir, 'candidate.json'), JSON.stringify(candidate, null, 2) + '\n')
  await writeFile(join(outputDir, 'generated-tool.ts'), candidate.code + '\n')
  report.candidateId = candidate.id
  report.status = 'verifying'
  report.phase = 'verification'
  await registry.reserve(0, candidate.samples.length, { tokens: config.generationBudgetTokens, verifications: config.verificationBudget })
  const proof = await new CapabilityVerifier(sandbox).verify(candidate)
  const verified = await registry.recordVerification(candidate.id, proof)
  await writeFile(join(outputDir, 'verified-candidate.json'), JSON.stringify(verified, null, 2) + '\n')
  report.verification = proof
  report.status = proof.passed ? 'verified-awaiting-human-approval' : 'verification-failed'
  report.reservedBudget = await registry.budget()
  console.log(JSON.stringify({ status: report.status, candidateId: candidate.id, passed: proof.passed, independentSamples: proof.independentSamples, errors: proof.errors }))
  if (!proof.passed) process.exitCode = 1
} catch (error) {
  // Provider error text may contain sensitive wire data. Persist only safe taxonomy.
  report.status = 'failed'
  report.error = { name: error.name, code: error.code ?? 'VALIDATION_ERROR' }
  report.error.frames = error.stack?.split('\n').slice(1, 5)
  console.error(JSON.stringify(report.error))
  process.exitCode = 1
} finally {
  report.finishedAt = new Date().toISOString()
  await writeFile(join(outputDir, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  await ctx.fiber.dispose()
}
