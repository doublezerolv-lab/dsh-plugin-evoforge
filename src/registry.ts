import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { Artifact, Capability, Decision, Verification } from './types.js'

interface State { format: 1; capabilities: Capability[]; decisions: Decision[]; budget: { tokens: number; verifications: number } }
const empty = (): State => ({ format: 1, capabilities: [], decisions: [], budget: { tokens: 0, verifications: 0 } })
export function fingerprint(artifact: Artifact): string {
  // Lifecycle fields do not participate in the executable/reviewed artifact identity.
  return createHash('sha256').update(JSON.stringify({ kind: artifact.kind, name: artifact.name, description: artifact.description,
    taskType: artifact.taskType, dependencies: artifact.dependencies, code: artifact.code,
    inputSchema: artifact.inputSchema, outputSchema: artifact.outputSchema, skillMarkdown: artifact.skillMarkdown, samples: artifact.samples })).digest('hex')
}
export class CapabilityRegistry {
  readonly file: string
  constructor(readonly directory: string) { this.file = join(directory, 'registry.json') }
  private async read(): Promise<State> {
    let raw: string
    try { raw = await readFile(this.file, 'utf8') } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty()
      throw error
    }
    const state = JSON.parse(raw) as State
    if (state.format !== 1 || !Array.isArray(state.capabilities) || !Array.isArray(state.decisions) || !state.budget) throw new Error('Invalid EvoForge registry')
    for (const cap of state.capabilities) if (cap.fingerprint !== fingerprint(cap)) throw new Error(`Artifact integrity failure: ${cap.id}`)
    return state
  }
  private async transaction<T>(mutate: (state: State) => T): Promise<T> {
    await mkdir(this.directory, { recursive: true })
    const lockPath = join(this.directory, '.registry.lock')
    let lock: Awaited<ReturnType<typeof open>> | undefined
    for (let attempt = 0; attempt < 100; attempt++) {
      try { lock = await open(lockPath, 'wx', 0o600); break } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        await new Promise(resolve => setTimeout(resolve, 20))
      }
    }
    if (!lock) throw new Error('Registry is locked; stop writers before recovering a stale .registry.lock')
    const temp = `${this.file}.${randomUUID()}.tmp`
    try {
      const state = await this.read()
      const result = mutate(state)
      const file = await open(temp, 'wx', 0o600)
      try { await file.writeFile(JSON.stringify(state, null, 2)); await file.sync() } finally { await file.close() }
      await rename(temp, this.file)
      return structuredClone(result)
    } finally {
      await unlink(temp).catch(() => {})
      await lock.close()
      await unlink(lockPath)
    }
  }
  async list(query = ''): Promise<Capability[]> {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    return (await this.read()).capabilities.filter(c => words.every(w => `${c.name} ${c.description} ${c.taskType}`.toLowerCase().includes(w)))
  }
  async get(id: string): Promise<Capability> {
    const cap = (await this.list()).find(c => c.id === id)
    if (!cap) throw new Error(`Unknown capability ${id}`)
    return cap
  }
  async create(artifact: Artifact): Promise<Capability> {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(artifact.name) || artifact.name.length > 80) throw new Error('Invalid capability name')
    artifact = { kind: artifact.kind, name: artifact.name, description: artifact.description, taskType: artifact.taskType,
      dependencies: artifact.dependencies, samples: artifact.samples,
      ...(artifact.kind === 'tool' ? { code: artifact.code, inputSchema: artifact.inputSchema, outputSchema: artifact.outputSchema } : { skillMarkdown: artifact.skillMarkdown }) }
    return this.transaction(state => {
      const hash = fingerprint(artifact)
      const duplicate = state.capabilities.find(c => c.fingerprint === hash)
      if (duplicate) return duplicate
      const prior = state.capabilities.filter(c => c.name === artifact.name && c.kind === artifact.kind)
      const version = Math.max(0, ...prior.map(c => c.version)) + 1
      const cap: Capability = { ...structuredClone(artifact), id: `${artifact.kind}:${artifact.name}@${version}`, version,
        fingerprint: hash, status: 'draft', createdAt: new Date().toISOString(), stats: { uses: 0, successes: 0, totalDurationMs: 0 } }
      state.capabilities.push(cap)
      return cap
    })
  }
  async recordVerification(id: string, proof: Verification): Promise<Capability> {
    return this.transaction(state => {
      const cap = this.find(state, id)
      if (proof.fingerprint !== cap.fingerprint) throw new Error('Verification does not match artifact')
      if (cap.status === 'approved' || cap.status === 'retired') throw new Error('Create a new version before re-verifying an activated artifact')
      cap.verification = proof
      cap.status = proof.passed ? 'verified' : 'draft'
      return cap
    })
  }
  async approve(id: string, reviewer: string, externalTools: string[] = []): Promise<Capability> {
    if (!reviewer.trim()) throw new Error('Reviewer identity required')
    return this.transaction(state => {
      const cap = this.find(state, id)
      if (cap.status !== 'verified' || !cap.verification?.passed || cap.verification.fingerprint !== cap.fingerprint || cap.verification.independentSamples < 1) throw new Error('Fresh independent verification required before approval')
      if (cap.kind === 'tool' && cap.verification.execution !== 'docker') throw new Error('Mock verification cannot approve executable capabilities')
      for (const dep of cap.dependencies) if (!externalTools.includes(dep) && !state.capabilities.some(c => c.status === 'approved' && (c.id === dep || c.name === dep))) throw new Error(`Unapproved dependency ${dep}`)
      // Only one version per kind/name may be active.
      for (const old of state.capabilities) if (old.kind === cap.kind && old.name === cap.name && old.status === 'approved') old.status = 'retired'
      cap.status = 'approved'
      cap.approval = { reviewer: reviewer.trim(), time: new Date().toISOString() }
      return cap
    })
  }
  async retire(id: string): Promise<void> {
    await this.transaction(state => { this.find(state, id).status = 'retired' })
  }
  async rollback(id: string, reviewer: string): Promise<Capability> {
    return this.transaction(state => {
      const cap = this.find(state, id)
      if (!reviewer.trim() || !cap.approval || !cap.verification?.passed || cap.verification.fingerprint !== cap.fingerprint) throw new Error('Rollback requires a previously approved verified version')
      for (const dep of cap.dependencies) if (!state.capabilities.some(c => c.status === 'approved' && (c.id === dep || c.name === dep))) throw new Error(`Unapproved dependency ${dep}`)
      for (const old of state.capabilities) if (old.kind === cap.kind && old.name === cap.name && old.status === 'approved') old.status = 'retired'
      cap.status = 'approved'; cap.approval = { reviewer, time: new Date().toISOString() }
      return cap
    })
  }
  async track(id: string, success: boolean, durationMs: number): Promise<void> {
    await this.transaction(state => {
      const cap = this.find(state, id)
      cap.stats.uses++; cap.stats.successes += Number(success); cap.stats.totalDurationMs += Math.max(0, durationMs)
      cap.stats.lastUsedAt = new Date().toISOString()
    })
  }
  async audit(decision: Decision): Promise<void> { await this.transaction(state => { state.decisions.push(decision) }) }
  async decisions(): Promise<Decision[]> { return (await this.read()).decisions }
  async reserve(tokens: number, verifications: number, limits: { tokens: number; verifications: number }): Promise<void> {
    if (![tokens, verifications].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error('Invalid budget reservation')
    await this.transaction(state => {
      if (state.budget.tokens + tokens > limits.tokens || state.budget.verifications + verifications > limits.verifications) throw new Error('Evolution budget exhausted')
      state.budget.tokens += tokens; state.budget.verifications += verifications
    })
  }
  async budget(): Promise<State['budget']> { return (await this.read()).budget }
  private find(state: State, id: string): Capability {
    const cap = state.capabilities.find(c => c.id === id)
    if (!cap) throw new Error(`Unknown capability ${id}`)
    return cap
  }
}
