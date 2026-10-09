import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import SessionStore from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { CapabilityBinding } from '../src/binding.js'
import { CapabilityRegistry } from '../src/registry.js'
import { sumTool, sumSkill } from './fixtures.js'
import type { Artifact } from '../src/types.js'
import * as plugin from '../src/index.js'

async function seed(registry: CapabilityRegistry, artifact: Artifact) {
  const cap = await registry.create(artifact)
  await registry.recordVerification(cap.id, { passed: true, fingerprint: cap.fingerprint, time: new Date().toISOString(), checks: ['test-only-fixture'], errors: [], independentSamples: 2, execution: artifact.kind === 'tool' ? 'docker' : 'skill-review' })
  return registry.approve(cap.id, 'fixture-reviewer')
}
async function harness() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt).await()
  await ctx.plugin(ToolRuntime).await()
  await ctx.plugin(SkillRegistry).await()
  return ctx
}
test('official tool/skill registries restore approved capabilities and dispose cleanly', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'evoforge-bind-'))
  const registry = new CapabilityRegistry(dir)
  await seed(registry, sumTool); await seed(registry, sumSkill)
  const ctx = await harness()
  let invocations = 0
  // Trusted fixture implementation; generated source is not executed in this test.
  const sandbox = { execute: async (_code: string, input: unknown) => {
    invocations++
    return (input as { values: number[] }).values.reduce((a, b) => a + b, 0)
  } }
  let binding!: CapabilityBinding
  const fiber = ctx.plugin({ name: 'binding-fixture', inject: ['tools', 'skills'], async apply(child: Context) {
    binding = new CapabilityBinding(child, registry, sandbox)
    child.effect(() => () => binding.close())
    await binding.sync()
  } })
  await fiber.await()
  assert.ok(ctx.tools.schemas().some(s => s.name === sumTool.name))
  assert.equal((await ctx.skills.get(sumSkill.name))?.name, sumSkill.name)
  const result = await ctx.tools.execute({ name: sumTool.name, arguments: { values: [2, 4] }, callId: ToolCallId('test-call'), signal: new AbortController().signal })
  assert.equal(result.isError, false)
  assert.equal(result.value, 6)
  assert.equal(invocations, 1)
  const bad = await ctx.tools.execute({ name: sumTool.name, arguments: { values: ['bad'] }, callId: ToolCallId('invalid'), signal: new AbortController().signal })
  assert.equal(bad.isError, true); assert.equal(invocations, 1)
  await registry.retire('tool:evoforge-sum@1')
  // Retired tools reject before the polling removal happens.
  const denied = await ctx.tools.execute({ name: sumTool.name, arguments: { values: [] }, callId: ToolCallId('retired'), signal: new AbortController().signal })
  assert.equal(denied.isError, true)
  await binding.sync()
  assert.equal(ctx.tools.get(sumTool.name), undefined)
  assert.equal(await ctx.skills.get(sumSkill.name), undefined)
  await fiber.dispose(); await ctx.fiber.dispose()
})
test('plugin restart restores approved skills and leaves host services available on unload', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'evoforge-restart-'))
  const registry = new CapabilityRegistry(dir)
  const standalone = { ...sumSkill, name: 'evoforge-review', description: 'Review numeric inputs', dependencies: [],
    skillMarkdown: '---\nname: evoforge-review\ndescription: Review numeric inputs\ntools: []\nchecks: [finite-values]\n---\n## Workflow\nInspect the supplied numeric inputs.\n## Validation\nCheck finite-values before returning a result.\n## Limitations\nThis is a review workflow.\n',
    samples: [{ source: 'independent' as const, label: 'review-contract', input: { availableTools: [] }, expected: { tools: [], checks: ['finite-values'] } }] }
  await seed(registry, standalone)
  const ctx = await harness()
  await ctx.plugin(SessionStore).await()
  let fiber = ctx.plugin(plugin, { storageDir: dir, syncIntervalMs: 100 })
  await fiber.await()
  // Optional service fibers load asynchronously with their injected dependencies.
  for (let i = 0; i < 30 && !await ctx.skills.get(standalone.name); i++) await new Promise(resolve => setTimeout(resolve, 20))
  assert.ok(await ctx.skills.get(standalone.name))
  await fiber.dispose()
  assert.equal(await ctx.skills.get(standalone.name), undefined)
  assert.ok(ctx.sessions); assert.ok(ctx.tools); assert.ok(ctx.skills)
  fiber = ctx.plugin(plugin, { storageDir: dir, syncIntervalMs: 100 })
  await fiber.await()
  for (let i = 0; i < 30 && !await ctx.skills.get(standalone.name); i++) await new Promise(resolve => setTimeout(resolve, 20))
  assert.ok(await ctx.skills.get(standalone.name))
  await fiber.dispose(); await ctx.fiber.dispose()
})
