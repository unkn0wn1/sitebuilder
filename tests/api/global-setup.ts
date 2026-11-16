// One shared server for the API test files. Creates an editor and an approver through the real invite flow.
import type { TestProject } from 'vitest/node'
import { Client } from './client'
import { ADMIN_EMAIL, lastEmail, PASSWORD, startServer, tokenFrom, type TestServer } from './server'

let server: TestServer

declare module 'vitest' {
  export interface ProvidedContext {
    baseUrl: string
    outbox: string
    users: { admin: string; editor: string; approver: string; password: string }
  }
}

export default async function setup(project: TestProject) {
  server = await startServer()
  const admin = new Client(server.baseUrl)
  await admin.login(ADMIN_EMAIL, PASSWORD)
  for (const [email, role] of [['editor@example.org', 'editor'], ['approver@example.org', 'approver']] as const) {
    const r = await admin.post('/users', { email, name: role === 'editor' ? 'Asha' : 'Priya', role })
    if (r.status !== 200) throw new Error(`invite ${email}: ${JSON.stringify(r.body)}`)
    let token = ''
    for (let i = 0; i < 100 && !token; i++) {
      await new Promise((res) => setTimeout(res, 100))
      try {
        token = tokenFrom(lastEmail(server.outbox, email).text)
      } catch {}
    }
    const accept = await new Client(server.baseUrl).post('/auth/invite/accept', { token, name: role === 'editor' ? 'Asha' : 'Priya', password: PASSWORD })
    if (accept.status !== 200) throw new Error(`accept ${email}: ${JSON.stringify(accept.body)}`)
  }
  project.provide('baseUrl', server.baseUrl)
  project.provide('outbox', server.outbox)
  project.provide('users', { admin: ADMIN_EMAIL, editor: 'editor@example.org', approver: 'approver@example.org', password: PASSWORD })
  return async () => {
    await server.stop()
  }
}
