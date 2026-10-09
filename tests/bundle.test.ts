import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'

test('bundle declares npm entry and official insert patch shape', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const patch = parse(await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8'))
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.main, 'dist/index.js')
  assert.equal(patch[0].insert[0].name, pkg.name)
  assert.equal(patch[0].insert[0].config.enableGeneration, false)
  assert.equal(patch[0].insert[0].config.requireApproval, true)
  for (const version of Object.values(pkg.peerDependencies)) assert.ok(!String(version).includes('workspace:'))
})
