import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-skill'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { Ajv } from 'ajv'
import { CapabilityRegistry } from './registry.js'
import { compileTool, parseSkill, validateArtifact } from './verifier.js'
import type { Sandbox } from './sandbox.js'
import type { Capability, Json } from './types.js'

/** Contributes only verified, approved versions to the official registries. */
export class CapabilityBinding {
  private active = new Map<string, { cap: Capability; dispose: () => void }>()
  private syncWork: Promise<void> = Promise.resolve()
  private statsWork = new Set<Promise<void>>()
  private closed = false
  private starts = new Map<symbol, number>()
  constructor(private ctx: Context, private registry: CapabilityRegistry, private sandbox: Sandbox) {}
  sync(): Promise<void> {
    this.syncWork = this.syncWork.catch(() => {}).then(() => this.performSync())
    return this.syncWork
  }
  private async performSync(): Promise<void> {
    if (this.closed) return
    const caps = (await this.registry.list()).filter(c => c.status === 'approved' && c.approval && c.verification?.passed && c.verification.fingerprint === c.fingerprint && (c.kind === 'skill' || c.verification.execution === 'docker'))
    if (this.closed) return
    const eligible = new Map(caps.map(c => [c.id, c]))
    for (const [id, item] of this.active) {
      if (!eligible.has(id)) { item.dispose(); this.active.delete(id) }
    }
    for (const cap of caps.filter(c => c.kind === 'tool')) {
      if (this.active.has(cap.id)) continue
      validateArtifact(cap)
      if (this.ctx.tools.get(cap.name)) throw new Error(`Existing Harness tool already owns ${cap.name}`)
      const javascript = compileTool(cap.code!)
      const ajv = new Ajv({ strict: true, validateFormats: false })
      const input = ajv.compile(cap.inputSchema!), output = ajv.compile(cap.outputSchema!)
      const definition: ToolDefinition = {
        name: cap.name, description: cap.description, parameters: cap.inputSchema!,
        output: { schema: cap.outputSchema!, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
        execute: async (args, exec) => {
          const current = await this.registry.get(cap.id)
          if (this.closed || current.status !== 'approved') throw new Error('Capability is no longer approved')
          if (!input(args)) throw new Error('Capability input schema validation failed')
          this.starts.set(exec.token, performance.now())
          const value = await this.sandbox.execute(javascript, args as Json, exec.signal)
          if (!output(value)) throw new Error('Capability output schema validation failed')
          return value
        },
      }
      this.active.set(cap.id, { cap, dispose: this.ctx.tools.register(definition) })
    }
    for (const cap of caps.filter(c => c.kind === 'skill')) {
      const tools = cap.dependencies.map(dep => caps.find(c => c.id === dep)?.name ?? dep)
      if (tools.some(tool => !this.ctx.tools.get(tool))) {
        const current = this.active.get(cap.id)
        if (current) { current.dispose(); this.active.delete(cap.id) }
        continue
      }
      if (this.active.has(cap.id)) continue
      validateArtifact(cap)
      const parsed = parseSkill(cap.skillMarkdown!)
      const existing = await this.ctx.skills.get(cap.name)
      if (this.closed) return
      if (existing) throw new Error(`Existing Harness skill already owns ${cap.name}`)
      this.active.set(cap.id, { cap, dispose: this.ctx.skills.register({ name: cap.name, description: cap.description,
        content: parsed.content, source: 'runtime', metadata: { evoforgeId: cap.id, version: cap.version } }) })
    }
  }
  observeResult(name: string, args: unknown, token: symbol, isError: boolean): void {
    if (this.closed) return
    const skillName = name === 'skill' && args && typeof args === 'object' ? (args as { name?: string }).name : undefined
    const item = [...this.active.values()].find(item => item.cap.kind === 'tool' ? item.cap.name === name : item.cap.name === skillName)
    const started = this.starts.get(token)
    this.starts.delete(token)
    if (!item) return
    const work = this.registry.track(item.cap.id, !isError, started === undefined ? 0 : performance.now() - started)
      .catch(() => { this.ctx.logger.warn('EvoForge capability usage persistence failed') })
    this.statsWork.add(work)
    void work.finally(() => this.statsWork.delete(work))
  }
  async close(): Promise<void> {
    this.closed = true
    await this.syncWork.catch(() => {})
    for (const item of this.active.values()) item.dispose()
    this.active.clear(); this.starts.clear()
    await Promise.all(this.statsWork)
  }
}
