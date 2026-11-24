// Starts a demo builder for tests/e2e/demo.spec.ts. Not a Playwright test file.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildDemoGolden } from '../../server/services/demo-golden'
import { startServer, type TestServer } from '../api/server'

const PASS_SECRET = '1x0000000000000000000000000000000AA'

export interface DemoServer {
  baseUrl: string
  stop(): Promise<void>
}

function startVerifyStub(): Promise<{ url: string; close(): Promise<void> }> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const params = new URLSearchParams(Buffer.concat(chunks).toString())
      const success = params.get('secret') === PASS_SECRET && params.get('response') === 'XXXX.DUMMY.TOKEN.XXXX'
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ success, hostname: 'example.com' }))
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port
      resolve({
        url: `http://127.0.0.1:${port}/siteverify`,
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}

export async function startDemoServer(): Promise<DemoServer> {
  const root = mkdtempSync(join(tmpdir(), 'sb-e2e-demo-'))
  const stub = await startVerifyStub()
  await buildDemoGolden(root, { readOnly: true })
  const server = await startServer(
    {
      SITEBUILDER_DEMO_MODE: '1',
      SITEBUILDER_AGENT_GATEWAY: '0',
      SITEBUILDER_DEMO_ROOT: root,
      SITEBUILDER_DOCS_URL: 'https://docs.skewstone.com',
      SITEBUILDER_INSECURE_COOKIES: '1',
      SITEBUILDER_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
      SITEBUILDER_TURNSTILE_SECRET_KEY: PASS_SECRET,
      SITEBUILDER_TURNSTILE_ALLOW_STUB: '1',
      SITEBUILDER_TURNSTILE_VERIFY_URL: stub.url,
    },
    { seed: false },
  )
  const port = Number(new URL(server.baseUrl).port)
  if (port === 3010 || port === 3020) {
    await server.stop()
    await stub.close()
    rmTree(root)
    throw new Error(`Demo e2e took port ${port}. Use a free port other than 3010 or 3020.`)
  }
  return {
    baseUrl: server.baseUrl,
    async stop() {
      await server.stop()
      await stub.close()
      rmTree(server.dir)
      rmTree(root)
    },
  }
}

function rmTree(dir: string) {
  spawnSync('chmod', ['-R', 'u+w', dir])
  rmSync(dir, { recursive: true, force: true })
}

export type { TestServer }
