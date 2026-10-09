import type { Artifact, Capability, CapabilityGap, Decision, Sample } from './types.js'
import type { Config } from './config.js'
import type { Synthesizer } from './synthesizer.js'
import { RuleGapDetector } from './detector.js'
import { HeuristicPolicy } from './policy.js'
import { CapabilityRegistry } from './registry.js'
import { CapabilityVerifier } from './verifier.js'
import { replay, type TraceRecord } from './observer.js'
import { join } from 'node:path'

export class EvolutionEngine {
  readonly registry: CapabilityRegistry
  readonly detector: RuleGapDetector
  readonly policy = new HeuristicPolicy()
  constructor(readonly config: Config, private verifier: CapabilityVerifier, private synthesizer?: Synthesizer) {
    this.registry = new CapabilityRegistry(config.storageDir)
    this.detector = new RuleGapDetector({ minOccurrences: config.minOccurrences, failureRate: config.failureRate, slowMs: config.slowMs })
  }
  setSynthesizer(synthesizer: Synthesizer): void { this.synthesizer = synthesizer }
  async analyze(): Promise<{ gaps: CapabilityGap[]; decisions: Decision[] }> {
    let records: TraceRecord[]
    try { records = await replay(join(this.config.storageDir, 'trajectories.jsonl')) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') records = []
      else throw error
    }
    const gaps = this.detector.detect(records)
    const existing = await this.registry.list()
    const decisions = gaps.map(gap => this.policy.decide(gap, existing, {
      expectedReuse: gap.expectedReuse, savedTokensPerUse: this.config.savedTokensPerUse,
      generationTokens: this.config.generationEstimateTokens, verificationTokens: this.config.verificationEstimateTokens,
      minimumConfidence: this.config.minimumReuse,
    }))
    return { gaps, decisions }
  }
  async propose(gap: CapabilityGap, kind: Artifact['kind'], samples: Sample[], signal?: AbortSignal): Promise<Capability> {
    if (!this.config.enableGeneration) throw new Error('Generation is disabled (Observe mode)')
    if (!this.synthesizer) throw new Error('Harness model service unavailable')
    const existing = await this.registry.list()
    const reusable = existing.find(c => c.taskType === gap.taskType && c.kind === kind && c.status !== 'retired')
    if (reusable) return reusable
    let feedback = ''
    for (let attempt = 0; attempt <= this.config.maxRepairs; attempt++) {
      signal?.throwIfAborted()
      const artifact = await this.synthesizer.synthesize(gap, kind, samples, feedback, signal)
      const cap = await this.registry.create(artifact)
      // Automatic candidates without trusted acceptance fixtures remain drafts for human completion.
      if (!samples.some(sample => sample.source === 'independent')) return cap
      const verified = await this.verify(cap.id, signal)
      if (verified.verification?.passed) return verified
      feedback = verified.verification?.errors.join('\n') ?? 'Verification failed'
    }
    throw new Error(`Repair limit reached: ${feedback}`)
  }
  async verify(id: string, signal?: AbortSignal): Promise<Capability> {
    const cap = await this.registry.get(id)
    await this.registry.reserve(0, Math.max(1, cap.samples.length), { tokens: this.config.generationBudgetTokens, verifications: this.config.verificationBudget })
    return this.registry.recordVerification(id, await this.verifier.verify(cap, signal))
  }
  async evolve(signal?: AbortSignal): Promise<void> {
    if (!this.config.autoEvolution || !this.config.enableGeneration) return
    const { gaps, decisions } = await this.analyze()
    for (const decision of decisions) {
      const gap = gaps.find(g => g.id === decision.gapId)!
      try {
        if (decision.action === 'CREATE') {
          const cap = await this.propose(gap, gap.candidates[0]!, [], signal)
          decision.outcome = `${cap.id} ${cap.status}; human fixtures and approval required`
        } else if (decision.action === 'RETIRE' && decision.capabilityId) {
          await this.registry.retire(decision.capabilityId); decision.outcome = 'retired'
        } else if (decision.action === 'IMPROVE' && decision.capabilityId) {
          const old = await this.registry.get(decision.capabilityId)
          if (!this.synthesizer) throw new Error('Harness model service unavailable')
          const artifact = await this.synthesizer.synthesize(gap, old.kind, old.samples.filter(s => s.source === 'independent'), 'Improve the existing verified contract; retain its name and independent tests', signal)
          artifact.name = old.name
          if (artifact.kind === 'skill') throw new Error('Skill improvement requires explicit reviewed Markdown import in v0.1')
          const cap = await this.registry.create(artifact)
          const verified = await this.verify(cap.id, signal)
          decision.outcome = `${verified.id} ${verified.status}; human approval required`
        } else decision.outcome = 'no mutation'
      } catch (error) { decision.outcome = `failed: ${(error as Error).message}` }
      await this.registry.audit(decision)
    }
  }
}
