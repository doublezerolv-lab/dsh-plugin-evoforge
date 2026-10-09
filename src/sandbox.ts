import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Config } from './config.js'
import type { Json } from './types.js'

export interface Sandbox { readonly isolation?: 'docker' | 'mock'; execute(javascript: string, input: Json, signal?: AbortSignal): Promise<Json> }
export async function command(executable: string, args: string[], timeoutMs: number, stdin = '', signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let output = '', errorOutput = '', failure: Error | undefined
    const stop = (error: Error) => { failure ??= error; child.kill() }
    const abort = () => stop(new Error('Sandbox operation cancelled'))
    const timer = setTimeout(() => stop(new Error('Sandbox time limit exceeded')), timeoutMs)
    signal?.addEventListener('abort', abort, { once: true })
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
    child.stdout.on('data', (data: Buffer) => {
      output += data.toString('utf8')
      if (output.length > 1024 * 1024) stop(new Error('Sandbox output limit exceeded'))
    })
    child.stderr.on('data', (data: Buffer) => { errorOutput = (errorOutput + data.toString('utf8')).slice(-4096) })
    child.on('error', error => { cleanup(); reject(new Error(`Sandbox executable unavailable: ${executable}`, { cause: error })) })
    child.on('close', code => {
      cleanup()
      if (failure) reject(failure)
      else if (code !== 0) reject(new Error(`Sandbox command failed (${code}): ${errorOutput.slice(-800)}`))
      else resolve(output)
    })
    child.stdin.on('error', () => {})
    child.stdin.end(stdin)
  })
}
export class DockerSandbox implements Sandbox {
  readonly isolation = 'docker' as const
  constructor(private config: Pick<Config, 'sandboxImage' | 'sandboxTimeoutMs' | 'sandboxMemoryMb' | 'sandboxCpus'>) {}
  async available(): Promise<void> {
    await command('docker', ['info', '--format', '{{.ServerVersion}}'], 10000)
    // Never pull an image during a model call. Image preparation is explicit.
    await command('docker', ['image', 'inspect', this.config.sandboxImage], 10000)
  }
  async execute(javascript: string, input: Json, signal?: AbortSignal): Promise<Json> {
    await this.available()
    signal?.throwIfAborted()
    const dir = await mkdtemp(join(tmpdir(), 'evoforge-sandbox-'))
    const name = `evoforge-${randomUUID()}`
    try {
      // mkdtemp creates 0700 directories on POSIX. The non-root container
      // must be able to traverse its read-only bind mount; only the owner
      // retains write access to these generated artifacts.
      await chmod(dir, 0o755)
      await writeFile(join(dir, 'tool.mjs'), javascript, { mode: 0o644 })
      await writeFile(join(dir, 'runner.mjs'),
        "import { run } from './tool.mjs';\nlet text='';for await(const chunk of process.stdin){text+=chunk;if(text.length>262144)throw new Error('input limit');}\nconst result=await run(JSON.parse(text));\nconst out=JSON.stringify(result);if(out===undefined||out.length>1048576)throw new Error('output limit');\nprocess.stdout.write(out);\n", { mode: 0o644 })
      const args = ['run', '--rm', '--init', '--name', name, '-i', '--network=none', '--read-only', '--cap-drop=ALL',
        '--security-opt=no-new-privileges', '--user=65534:65534', '--pids-limit=32',
        `--memory=${this.config.sandboxMemoryMb}m`, `--memory-swap=${this.config.sandboxMemoryMb}m`, `--cpus=${this.config.sandboxCpus}`,
        '--tmpfs=/tmp:rw,noexec,nosuid,size=16m', '--mount', `type=bind,source=${dir},target=/work,readonly`,
        '--entrypoint=node', this.config.sandboxImage, '/work/runner.mjs']
      const raw = await command('docker', args, this.config.sandboxTimeoutMs, JSON.stringify(input), signal)
      return JSON.parse(raw) as Json
    } finally {
      // Killing the Docker CLI alone does not stop a timed-out container.
      await command('docker', ['rm', '-f', name], 10000).catch(() => {})
      await rm(dir, { recursive: true, force: true })
    }
  }
}
