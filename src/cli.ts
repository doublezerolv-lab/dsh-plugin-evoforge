#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { resolveConfig } from './config.js'
import { CapabilityRegistry } from './registry.js'
import { EvolutionEngine } from './engine.js'
import { DockerSandbox } from './sandbox.js'
import { CapabilityVerifier, validateArtifact } from './verifier.js'
import type { Artifact, Sample } from './types.js'

const args = process.argv.slice(2)
function option(name: string, fallback = ''): string {
  const index = args.indexOf(`--${name}`)
  if (index < 0) return fallback
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`--${name} requires a value`)
  return value
}
async function main(): Promise<void> {
  const configFile = option('config')
  const fromFile = configFile ? JSON.parse(await readFile(resolve(configFile), 'utf8')) : {}
  const config = resolveConfig({ ...fromFile, storageDir: option('storage', fromFile.storageDir ?? '.evoforge') })
  const registry = new CapabilityRegistry(config.storageDir)
  const sandbox = new DockerSandbox(config)
  const engine = new EvolutionEngine(config, new CapabilityVerifier(sandbox))
  const id = args[1] ?? ''
  let result: unknown
  switch (args[0]) {
    case 'analyze': result = await engine.analyze(); break
    case 'list': result = await registry.list(option('query')); break
    case 'show': result = await registry.get(id); break
    case 'import': {
      const artifact = JSON.parse(await readFile(resolve(id), 'utf8')) as Artifact
      validateArtifact(artifact); result = await registry.create(artifact); break
    }
    case 'samples': {
      const cap = await registry.get(id)
      const file = option('file')
      if (!file) throw new Error('samples requires --file with human-authored acceptance samples')
      const samples = JSON.parse(await readFile(resolve(file), 'utf8')) as Sample[]
      if (!Array.isArray(samples) || !samples.length || samples.some(s => s.source !== 'independent')) throw new Error('Only human independent fixtures may be attached')
      result = await registry.create({ ...cap, samples: [...cap.samples.filter(s => s.source !== 'independent'), ...samples] }); break
    }
    case 'verify': result = await engine.verify(id); break
    case 'approve': result = await registry.approve(id, option('reviewer'), option('external-tools').split(',').filter(Boolean)); break
    case 'retire': await registry.retire(id); result = { retired: id }; break
    case 'rollback': result = await registry.rollback(id, option('reviewer')); break
    case 'audit': result = { decisions: await registry.decisions(), reservedBudget: await registry.budget() }; break
    case 'sandbox-check': await sandbox.available(); result = { docker: 'available', image: config.sandboxImage }; break
    case 'export-skill': {
      const cap = await registry.get(id)
      if (cap.kind !== 'skill' || cap.status !== 'approved') throw new Error('Approved Skill required')
      const dir = resolve(option('output', 'artifacts/skills'), cap.name)
      await mkdir(dir, { recursive: true }); await writeFile(join(dir, 'SKILL.md'), cap.skillMarkdown!, 'utf8')
      result = { file: join(dir, 'SKILL.md') }; break
    }
    default:
      console.log('evoforge <analyze|list|show|import|samples|verify|approve|retire|rollback|audit|sandbox-check|export-skill> [id/file]')
      console.log('Options: --storage DIR --config FILE --reviewer NAME --file FIXTURES --external-tools a,b --output DIR --query TEXT')
      return
  }
  console.log(JSON.stringify(result, null, 2))
  if (args[0] === 'verify' && !(result as { verification?: { passed: boolean } }).verification?.passed) process.exitCode = 1
}
await main().catch(error => { console.error((error as Error).message); process.exitCode = 1 })
