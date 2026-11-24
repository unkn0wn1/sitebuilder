// Starts a demo builder for tests/e2e/demo.spec.ts. Not a Playwright test file.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildDemoGolden } from '../../server/services/demo-golden'
import { startServer, type TestServer } from '../api/server'

export interface DemoServer {
  baseUrl: string
  stop(): Promise<void>
}

export async function startDemoServer(): Promise<DemoServer> {
  const root = mkdtempSync(join(tmpdir(), 'sb-e2e-demo-'))
  await buildDemoGolden(root, { readOnly: true })
  const server = await startServer(
    {
      SITEBUILDER_DEMO_MODE: '1',
      SITEBUILDER_AGENT_GATEWAY: '0',
      SITEBUILDER_DEMO_ROOT: root,
      SITEBUILDER_DOCS_URL: 'https://docs.skewstone.com',
      SITEBUILDER_INSECURE_COOKIES: '1',
    },
    { seed: false },
  )
  const port = Number(new URL(server.baseUrl).port)
  if (port === 3010 || port === 3020) {
    await server.stop()
    rmTree(root)
    throw new Error(`Demo e2e took port ${port}. Use a free port other than 3010 or 3020.`)
  }
  return {
    baseUrl: server.baseUrl,
    async stop() {
      await server.stop()
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
