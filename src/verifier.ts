import { Ajv } from 'ajv'
import ts from 'typescript'
import { parse } from 'yaml'
import { isDeepStrictEqual } from 'node:util'
import { assertSupportedJsonSchema } from '@deepseek-ai/dsh-tools'
import type { Artifact, Json, Verification } from './types.js'
import { fingerprint } from './registry.js'
import type { Sandbox } from './sandbox.js'

const ajv = new Ajv({ strict: true, allErrors: true, validateFormats: false })
export function validateSchema(schema: Record<string, unknown>): void {
  if (JSON.stringify(schema).length > 16000) throw new Error('Schema too large')
  if (JSON.stringify(schema).includes('"$ref"')) throw new Error('Schema references are forbidden')
  assertSupportedJsonSchema(schema)
  ajv.compile(schema)
}
export function validateArtifact(artifact: Artifact): void {
  if (!artifact || !['tool', 'skill'].includes(artifact.kind) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(artifact.name) || artifact.name.length > 80) throw new Error('Invalid artifact identity')
  if (!artifact.description || artifact.description.length > 1000 || !artifact.taskType || !Array.isArray(artifact.dependencies) || !Array.isArray(artifact.samples)) throw new Error('Invalid artifact metadata')
  if (artifact.kind === 'tool') {
    if (!artifact.code || artifact.code.length > 16000 || !artifact.inputSchema || !artifact.outputSchema) throw new Error('Tool requires bounded code and schemas')
    if (artifact.inputSchema.type !== 'object') throw new Error('Tool arguments must be an object')
    if (artifact.dependencies.length) throw new Error('Pure JSON tools cannot depend on other capabilities')
    validateSchema(artifact.inputSchema); validateSchema(artifact.outputSchema)
  } else if (!artifact.skillMarkdown || artifact.skillMarkdown.length > 16000) throw new Error('Skill requires bounded Markdown')
}
export function compileTool(code: string): string {
  const source = ts.createSourceFile('tool.ts', code, ts.ScriptTarget.ES2023, true, ts.ScriptKind.TS)
  const forbidden = new Set(['process', 'global', 'globalThis', 'require', 'eval', 'Function', 'fetch', 'WebSocket', 'Deno', 'Bun'])
  let exported = false
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node) || ts.isExportDeclaration(node) || node.kind === ts.SyntaxKind.ImportKeyword) throw new Error('Imports and re-exports are forbidden')
    if (ts.isIdentifier(node) && forbidden.has(node.text)) throw new Error(`Forbidden identifier: ${node.text}`)
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'run' && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) exported = true
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (!exported) throw new Error('Expected export function run(input)')
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, strict: true, noEmit: true, types: [] }
  const host = ts.createCompilerHost(options)
  const original = host.getSourceFile.bind(host)
  host.getSourceFile = (file, language, ...rest) => file === 'tool.ts' ? source : original(file, language, ...rest)
  const program = ts.createProgram(['tool.ts'], options, host)
  const diagnostics = ts.getPreEmitDiagnostics(program)
  if (diagnostics.length) throw new Error(diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n').slice(0, 2000))
  return ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText
}

export interface ParsedSkill { name: string; description: string; content: string; tools: string[]; checks: string[] }
export function parseSkill(markdown: string): ParsedSkill {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/.exec(markdown)
  if (!match) throw new Error('SKILL.md requires YAML frontmatter')
  const metadata = parse(match[1]!) as Record<string, unknown>
  if (!metadata || typeof metadata.name !== 'string' || typeof metadata.description !== 'string') throw new Error('Skill name and description required')
  if (!Array.isArray(metadata.tools) || !metadata.tools.every(x => typeof x === 'string') || !Array.isArray(metadata.checks) || !metadata.checks.every(x => typeof x === 'string')) throw new Error('Skill requires tools and checks lists')
  const content = match[2]!
  for (const heading of ['Workflow', 'Validation', 'Limitations']) if (!content.includes(`## ${heading}`)) throw new Error(`Missing skill section ${heading}`)
  if (/https?:\/\/|\]\([^)]*\)|```(?:bash|sh|powershell)|ignore (?:previous|all)|api[-_ ]?key|password/i.test(content)) throw new Error('v0.1 skill must be a self-contained tool workflow without scripts, links or credentials')
  for (const entry of [...metadata.tools, ...metadata.checks]) if (!content.includes(entry)) throw new Error(`Skill body must explain ${entry}`)
  return { name: metadata.name, description: metadata.description, content, tools: metadata.tools, checks: metadata.checks }
}

export class CapabilityVerifier {
  constructor(private sandbox: Sandbox) {}
  async verify(artifact: Artifact, signal?: AbortSignal): Promise<Verification> {
    const proof: Verification = { passed: false, fingerprint: fingerprint(artifact), time: new Date().toISOString(), checks: [], errors: [], independentSamples: 0, execution: artifact.kind === 'tool' ? this.sandbox.isolation ?? 'mock' : 'skill-review' }
    try {
      validateArtifact(artifact)
      proof.checks.push('artifact/schema')
      const independent = artifact.samples.filter(sample => sample.source === 'independent')
      if (!independent.length) throw new Error('At least one independently authored acceptance sample required')
      if (artifact.kind === 'tool') {
        const javascript = compileTool(artifact.code!)
        proof.checks.push('typescript/compile', 'restricted-source')
        const input = ajv.compile(artifact.inputSchema!)
        const output = ajv.compile(artifact.outputSchema!)
        for (const sample of artifact.samples) {
          signal?.throwIfAborted()
          if (!input(sample.input)) throw new Error(`Invalid sample input: ${sample.label}`)
          const value = await this.sandbox.execute(javascript, sample.input, signal)
          if (!output(value) || !isDeepStrictEqual(value, sample.expected)) throw new Error(`Acceptance sample failed: ${sample.label}`)
          if (sample.source === 'independent') proof.independentSamples++
          proof.checks.push(`sample:${sample.label}`)
        }
      } else {
        const skill = parseSkill(artifact.skillMarkdown!)
        if (skill.name !== artifact.name || skill.description !== artifact.description) throw new Error('Skill frontmatter differs from artifact metadata')
        if (!isDeepStrictEqual([...skill.tools].sort(), [...artifact.dependencies].sort())) throw new Error('Skill tools must match explicit dependencies')
        for (const sample of independent) {
          const expected = sample.expected as { tools?: Json; checks?: Json }
          const input = sample.input as { availableTools?: Json }
          const available = input.availableTools
          if (!Array.isArray(available) || skill.tools.some(tool => !available.includes(tool))) throw new Error('Skill sample lacks required tools')
          if (!isDeepStrictEqual(skill.tools, expected.tools) || !isDeepStrictEqual(skill.checks, expected.checks)) throw new Error('Skill acceptance contract mismatch')
          proof.independentSamples++; proof.checks.push(`workflow-contract:${sample.label}`)
        }
        proof.checks.push('skill/format', 'skill/dependencies', 'skill/validation-contract')
      }
      proof.passed = true
    } catch (error) { proof.errors.push((error as Error).message) }
    return proof
  }
}
