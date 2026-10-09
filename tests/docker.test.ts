import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DockerSandbox } from '../src/sandbox.js'
import { CapabilityVerifier, compileTool } from '../src/verifier.js'
import { resolveConfig } from '../src/config.js'
import { sumTool } from './fixtures.js'

test('Docker end-to-end verification and hard execution deadline', { skip: process.env.EVOFORGE_DOCKER_TESTS !== '1' }, async () => {
  const sandbox = new DockerSandbox(resolveConfig())
  const proof = await new CapabilityVerifier(sandbox).verify(sumTool)
  assert.equal(proof.passed, true, proof.errors.join('\n'))
  assert.equal(proof.independentSamples, 2)
  const limited = new DockerSandbox(resolveConfig({ sandboxTimeoutMs: 1000 }))
  await assert.rejects(limited.execute(compileTool('export function run(): number { while(true) {} }'), {}), /time limit/)
})
