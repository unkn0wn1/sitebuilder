// Start the built server (.output/server/index.mjs) on a free port with its own database and outbox.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const ADMIN_EMAIL = 'admin@example.org'
export const PASSWORD = 'api-test-password-long'

export interface TestServer {
  baseUrl: string
  dir: string
  outbox: string
  stop(): Promise<void>
  logs(): string
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as { port: number }).port
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}

export async function startServer(extraEnv: Record<string, string> = {}, opts: { seed?: boolean } = {}): Promise<TestServer> {
  if (!existsSync('.output/server/index.mjs')) throw new Error('Build first: npm run build (npm run test:api does this).')
  const dir = mkdtempSync(join(tmpdir(), 'sb-api-'))
  const outbox = join(dir, 'outbox')
  const port = await freePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    NODE_ENV: 'production',
    PORT: String(port),
    HOST: '127.0.0.1',
    SITEBUILDER_DB_PATH: join(dir, 'sitebuilder.db'),
    SITEBUILDER_MEDIA_DIR: join(dir, 'media'),
    SITEBUILDER_MAIL_OUTBOX: outbox,
    SITEBUILDER_ORIGIN: baseUrl,
    SITEBUILDER_ALLOW_NO_ACCESS: '1',
    SITEBUILDER_INSECURE_COOKIES: '1',
    SITEBUILDER_SECRET_KEY: randomBytes(32).toString('base64'),
    SEED_ADMIN_EMAIL: ADMIN_EMAIL,
    SEED_ADMIN_PASSWORD: PASSWORD,
    // Don't inherit a leftover demo-page seed from a developer or screenshot shell.
    SEED_SAMPLE_PAGES: '',
    ...extraEnv,
  }
  if (opts.seed !== false) {
    const seed = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/seed.ts'], { env, encoding: 'utf8' })
    if (seed.status !== 0) throw new Error(`Seed failed: ${seed.stderr}`)
  }
  let output = ''
  const child: ChildProcess = spawn(process.execPath, ['.output/server/index.mjs'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout!.on('data', (d) => (output += d))
  child.stderr!.on('data', (d) => (output += d))
  const exited = new Promise<number | null>((resolve) => child.on('exit', resolve))
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`Server exited: ${output}`)
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) break
    } catch {}
    await new Promise((r) => setTimeout(r, 100))
    if (i === 99) throw new Error(`Server did not start: ${output}`)
  }
  return {
    baseUrl,
    dir,
    outbox,
    logs: () => output,
    async stop() {
      if (child.exitCode === null) child.kill('SIGTERM')
      await exited
    },
  }
}

/** The newest email to an address, from the outbox folder. */
export function lastEmail(outbox: string, to: string): { to: string; subject: string; text: string } {
  if (!existsSync(outbox)) throw new Error('No emails sent')
  const mails = readdirSync(outbox)
    .sort()
    .map((f) => JSON.parse(readFileSync(join(outbox, f), 'utf8')) as { to: string; subject: string; text: string })
    .filter((m) => m.to === to)
  if (!mails.length) throw new Error(`No email to ${to}`)
  return mails[mails.length - 1]!
}

export const tokenFrom = (text: string) => /#token=([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? ''
