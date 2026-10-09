import type { Artifact, CapabilityGap, Sample } from '../src/types.js'
export const sumSamples: Sample[] = [
  { source: 'independent', label: 'empty', input: { values: [] }, expected: 0 },
  { source: 'independent', label: 'mixed', input: { values: [2, -1, 3] }, expected: 4 },
]
export const sumTool: Artifact = { kind: 'tool', name: 'evoforge-sum', description: 'Sum finite numbers', taskType: 'sum', dependencies: [],
  code: 'export function run(input: { values: number[] }): number { return input.values.reduce((a, b) => a + b, 0) }',
  inputSchema: { type: 'object', properties: { values: { type: 'array', items: { type: 'number' } } }, required: ['values'], additionalProperties: false },
  outputSchema: { type: 'number' }, samples: sumSamples }
export const sumSkill: Artifact = { kind: 'skill', name: 'evoforge-sum-workflow', description: 'Validate and sum a sequence', taskType: 'sum-workflow', dependencies: ['evoforge-sum'],
  skillMarkdown: '---\nname: evoforge-sum-workflow\ndescription: Validate and sum a sequence\ntools: [evoforge-sum]\nchecks: [numeric-total]\n---\n## Workflow\nValidate input values, then call evoforge-sum with the values array.\n## Validation\nCheck numeric-total against an independently computed sum before returning it.\n## Limitations\nFinite numbers only; no rounding or arbitrary precision guarantee.\n',
  samples: [{ source: 'independent', label: 'workflow-review', input: { availableTools: ['evoforge-sum'] }, expected: { tools: ['evoforge-sum'], checks: ['numeric-total'] } }] }
export const gap: CapabilityGap = { id: 'g1', kind: 'missing-tool', taskType: 'sum', description: 'Need sum', expectedReuse: 4, candidates: ['tool'],
  evidence: { taskIds: ['s:1', 's:2', 's:3', 's:4'], callIds: ['c1', 'c2'], occurrences: 4, failures: 4, meanDurationMs: null } }
