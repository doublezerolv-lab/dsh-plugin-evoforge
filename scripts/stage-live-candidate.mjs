import { readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { CapabilityRegistry, validateArtifact } from '../dist/core.js'

const [candidateFile, storageDir, outputFile] = process.argv.slice(2)
if (!candidateFile || !storageDir || !outputFile) throw new Error('Expected verified candidate, target storage and report file')
const source = JSON.parse(await readFile(resolve(candidateFile), 'utf8'))
validateArtifact(source)
if (source.status !== 'verified' || !source.verification?.passed || source.verification.execution !== 'docker' || source.approval) {
  throw new Error('Only an unapproved candidate with a passing real Docker proof can be staged')
}
const registry = new CapabilityRegistry(resolve(storageDir))
const cap = await registry.create(source)
if (cap.status === 'approved') throw new Error('Candidate is already approved; staging does not change its approval')
const staged = await registry.recordVerification(cap.id, source.verification)
await writeFile(resolve(outputFile), JSON.stringify(staged, null, 2) + '\n')
console.log(JSON.stringify({ id: staged.id, status: staged.status, execution: staged.verification.execution,
  independentSamples: staged.verification.independentSamples, storage: join(resolve(storageDir), 'registry.json') }))
