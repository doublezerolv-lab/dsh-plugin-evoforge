import type { Capability, CapabilityGap, Decision, EvolutionMetrics } from './types.js'

export interface EvolutionPolicy { decide(gap: CapabilityGap, existing: readonly Capability[], metrics: EvolutionMetrics): Decision }
export class HeuristicPolicy implements EvolutionPolicy {
  constructor(private minUses = 5, private retireBelow = 0.4, private improveBelow = 0.8) {}
  decide(gap: CapabilityGap, existing: readonly Capability[], input: EvolutionMetrics): Decision {
    const match = existing.find(c => c.taskType === gap.taskType && c.status === 'approved')
    const net = input.expectedReuse * input.savedTokensPerUse - input.generationTokens - input.verificationTokens
    const reliability = match && match.stats.uses ? match.stats.successes / match.stats.uses : undefined
    const metrics = { ...input, expectedNetTokens: net, ...(reliability === undefined ? {} : { reliability }) }
    const result = (action: Decision['action'], reasons: string[]): Decision => ({ action, gapId: gap.id, capabilityId: match?.id, reasons, metrics, time: new Date().toISOString() })
    if (match && match.stats.uses >= this.minUses && reliability! < this.retireBelow) return result('RETIRE', ['Observed reliability is below retirement threshold after sufficient uses'])
    if (match && match.stats.uses >= this.minUses && reliability! < this.improveBelow) {
      return net > 0 ? result('IMPROVE', ['Reliability warrants repair; expected savings cover generation and validation']) : result('DEFER', ['Repair costs exceed expected reuse savings'])
    }
    if (match) return result('REUSE', ['Approved matching capability is available; avoid another generation cost'])
    if (existing.some(c => c.taskType === gap.taskType && c.status !== 'retired')) return result('DEFER', ['Matching candidate already awaits verification or approval'])
    if (input.expectedReuse < input.minimumConfidence) return result('DEFER', ['Insufficient independent task evidence'])
    return net > 0 ? result('CREATE', ['Expected cumulative reuse savings exceed generation and verification costs']) : result('DEFER', ['Expected cumulative reuse savings do not cover creation costs'])
  }
}
