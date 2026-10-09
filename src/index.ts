import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session'
import { Config, resolveConfig } from './config.js'
import { ExecutionObserver } from './observer.js'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-llm'
import { DockerSandbox } from './sandbox.js'
import { CapabilityVerifier } from './verifier.js'
import { EvolutionEngine } from './engine.js'
import { HarnessSynthesizer } from './synthesizer.js'
import { CapabilityBinding } from './binding.js'

declare module '@deepseek-ai/cordis' {
  interface Context { evoforge: EvolutionEngine }
}

export { Config }
export const name = 'evoforge'
export const inject = ['sessions']

export function apply(ctx: Context, input: Config): void {
  const config = resolveConfig(input)
  const observer = new ExecutionObserver(config, message => ctx.logger.warn(message))
  const sandbox = new DockerSandbox(config)
  const engine = new EvolutionEngine(config, new CapabilityVerifier(sandbox))
  ctx.provide('evoforge', engine)
  const abort = new AbortController()
  let evolutionWork = Promise.resolve()
  ctx.effect(() => async () => { abort.abort(); await evolutionWork; await observer.close() })
  if (config.enableGeneration) ctx.inject(['llm'], child => {
    engine.setSynthesizer(new HarnessSynthesizer(child.llm, config, engine.registry))
  })
  ctx.inject(['tools', 'skills'], async child => {
    const binding = new CapabilityBinding(child, engine.registry, sandbox)
    child.effect(() => () => binding.close())
    await binding.sync()
    child.on('tools/result', (exec, result) => {
      binding.observeResult(exec.name, exec.arguments, exec.token, result.isError)
      return undefined
    })
    child.effect(() => {
      const timer = setInterval(() => {
        void binding.sync().catch(() => child.logger.warn('EvoForge capability sync failed; inspect registry and name collisions'))
      }, config.syncIntervalMs)
      timer.unref()
      return () => clearInterval(timer)
    })
  })
  ctx.on('session/event', (session, event) => {
    observer.observe(session.id, event)
    if (event.type === 'turn/end' && config.autoEvolution) {
      evolutionWork = evolutionWork.then(async () => { await observer.flush(); await engine.evolve(abort.signal) })
        .catch(() => { ctx.logger.warn('EvoForge evolution failed; Agent execution continues') })
    }
  })
  ctx.on('session/disposed', session => { observer.forget(session.id) })
  ctx.on('session/flush', () => observer.flush())
}
