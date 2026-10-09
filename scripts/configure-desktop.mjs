import { readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { parseDocument, isSeq } from 'yaml'

// Invoked only by the installer after the Desktop Host has exited.
const [profileDir, storageDir] = process.argv.slice(2)
if (!profileDir || !storageDir) throw new Error('Expected profile and storage directories')
const file = join(profileDir, 'cordis.patch.yml')
const document = parseDocument(await readFile(file, 'utf8'))
if (document.errors.length || !isSeq(document.contents)) throw new Error('Desktop patch must be a valid YAML sequence')
// Append the final override rather than rewriting unrelated account/model settings.
document.add({ id: 'evoforge', config: {
  storageDir, enableGeneration: false, autoEvolution: false, requireApproval: true,
  provider: 'deepseek-account', model: 'deepseek-flash',
  generationBudgetTokens: 12000, verificationBudget: 12, maxRepairs: 1,
} })
const temporary = file + '.evoforge-install.tmp'
await writeFile(temporary, document.toString(), { mode: 0o600 })
await rename(temporary, file)
console.log('EvoForge account route configured in Observe mode.')
