export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type GapKind = 'missing-tool' | 'repeated-code' | 'workflow' | 'unreliable' | 'slow'
export interface CapabilityGap {
  id: string
  kind: GapKind
  taskType: string
  description: string
  evidence: { taskIds: string[]; callIds: string[]; occurrences: number; failures: number; meanDurationMs: number | null }
  expectedReuse: number
  candidates: ('tool' | 'skill')[]
}
export interface Sample { input: Json; expected: Json; source: 'independent' | 'generated'; label: string }
export interface Artifact {
  kind: 'tool' | 'skill'
  name: string
  description: string
  taskType: string
  dependencies: string[]
  code?: string
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  skillMarkdown?: string
  samples: Sample[]
}
export interface Verification {
  passed: boolean
  fingerprint: string
  time: string
  checks: string[]
  errors: string[]
  independentSamples: number
  execution: 'docker' | 'mock' | 'skill-review'
}
export interface Capability extends Artifact {
  id: string
  version: number
  fingerprint: string
  status: 'draft' | 'verified' | 'approved' | 'retired'
  createdAt: string
  verification?: Verification
  approval?: { reviewer: string; time: string }
  stats: { uses: number; successes: number; totalDurationMs: number; lastUsedAt?: string }
}
export interface EvolutionMetrics {
  expectedReuse: number
  savedTokensPerUse: number
  generationTokens: number
  verificationTokens: number
  minimumConfidence: number
}
export interface Decision {
  action: 'CREATE' | 'REUSE' | 'IMPROVE' | 'RETIRE' | 'DEFER'
  capabilityId?: string
  gapId: string
  reasons: string[]
  metrics: EvolutionMetrics & { expectedNetTokens: number; reliability?: number }
  time: string
  outcome?: string
}
