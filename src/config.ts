import Schema from '@deepseek-ai/schemastery'
import { resolve } from 'node:path'

export interface Config {
  storageDir: string
  enableGeneration: boolean
  autoEvolution: boolean
  requireApproval: boolean
  capturePayloads: boolean
  maxQueue: number
  maxPayloadChars: number
  generationBudgetTokens: number
  verificationBudget: number
  maxRepairs: number
  sandboxImage: string
  sandboxTimeoutMs: number
  sandboxMemoryMb: number
  sandboxCpus: number
  provider: string
  model: string
  syncIntervalMs: number
  minOccurrences: number
  failureRate: number
  slowMs: number
  minimumReuse: number
  savedTokensPerUse: number
  generationEstimateTokens: number
  verificationEstimateTokens: number
}
export const Config: Schema<Partial<Config>, Config> = Schema.object({
  storageDir: Schema.string().default('.evoforge'),
  enableGeneration: Schema.boolean().default(false),
  autoEvolution: Schema.boolean().default(false),
  requireApproval: Schema.boolean().default(true),
  capturePayloads: Schema.boolean().default(false),
  maxQueue: Schema.number().min(1).step(1).default(2000),
  maxPayloadChars: Schema.number().min(64).step(1).default(2048),
  generationBudgetTokens: Schema.number().min(1).step(1).default(12000),
  verificationBudget: Schema.number().min(1).step(1).default(12),
  maxRepairs: Schema.number().min(0).max(3).step(1).default(1),
  sandboxImage: Schema.string().default('evoforge-sandbox:1'),
  sandboxTimeoutMs: Schema.number().min(100).max(60000).default(5000),
  sandboxMemoryMb: Schema.number().min(32).max(1024).default(128),
  sandboxCpus: Schema.number().min(0.1).max(2).default(0.5),
  provider: Schema.string().default(''),
  model: Schema.string().default(''),
  syncIntervalMs: Schema.number().min(100).default(1000),
  minOccurrences: Schema.number().min(2).step(1).default(3),
  failureRate: Schema.number().min(0).max(1).default(0.5),
  slowMs: Schema.number().min(1).default(3000),
  minimumReuse: Schema.number().min(2).default(3),
  savedTokensPerUse: Schema.number().min(0).default(1000),
  generationEstimateTokens: Schema.number().min(0).default(1800),
  verificationEstimateTokens: Schema.number().min(0).default(300),
})
export function resolveConfig(input: Partial<Config> = {}): Config {
  const config = Config(input)
  // This release always requires human approval. The setting makes the boundary visible.
  if (!config.requireApproval) throw new Error('v0.1 requires human approval; requireApproval must be true')
  if (config.autoEvolution && !config.enableGeneration) throw new Error('autoEvolution requires enableGeneration')
  return { ...config, storageDir: resolve(config.storageDir) }
}
