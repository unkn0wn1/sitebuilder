#!/usr/bin/env tsx
// Make, list, revoke and pause agent tokens from the command line (the agent gateway has no Settings screen yet).
// The secret is printed once. Only its hash is stored. See docs/agent-gateway.md.
//
//   npx tsx scripts/agent-token.ts presets
//   npx tsx scripts/agent-token.ts create --name "Claude, emergencies" --preset takedown [--admin you@example.org] [--days 90] [--ip 203.0.113.0/24]
//   npx tsx scripts/agent-token.ts create --name "Claude, copy" --access draft --rules rules.json
//   npx tsx scripts/agent-token.ts list
//   npx tsx scripts/agent-token.ts revoke agt_...
//   npx tsx scripts/agent-token.ts pause-all | resume-all
//
//   SITEBUILDER_DB_PATH   database file (default .data/sitebuilder.db)
import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { openDb } from '../server/db/client'
import { loadMigrationsFromDir } from '../server/db/migrations-fs'
import { users } from '../server/db/schema'
import type { ActingAs, ServiceCtx } from '../server/services/context'
import { getOnlySite } from '../server/services/site'
import { createAgentToken, listAgentTokens, revokeAgentToken, setAgentsPaused } from '../server/services/agent/tokens'
import { createDefaultRegistry } from '../shared/blocks/registry'
import { RULE_PRESETS, presetByKey } from '../shared/agent/presets'

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const fail = (msg: string): never => {
  console.error(msg)
  process.exit(2)
}

const command = process.argv[2]
if (command === 'presets') {
  for (const p of RULE_PRESETS) console.log(`${p.key.padEnd(12)} ${p.label}: ${p.description}`)
  process.exit(0)
}
if (!command || !['create', 'list', 'revoke', 'pause-all', 'resume-all'].includes(command)) fail('Usage: agent-token.ts presets | create | list | revoke <id> | pause-all | resume-all')

const { db } = openDb(process.env.SITEBUILDER_DB_PATH ?? '.data/sitebuilder.db', loadMigrationsFromDir())
const site = getOnlySite(db)
if (!site) fail('This install has no site yet. Run npm run seed first.')
const ctx: ServiceCtx = { db, siteId: site!.id, registry: createDefaultRegistry(), now: () => new Date() }

const adminEmail = (arg('--admin') ?? process.env.SEED_ADMIN_EMAIL ?? 'admin@example.org').toLowerCase()
const adminRow = db.select().from(users).where(eq(users.email, adminEmail)).get()
if (!adminRow || adminRow.role !== 'admin') fail(`No admin with the email ${adminEmail}. Pass --admin you@example.org.`)
const admin: ActingAs = { id: adminRow!.id, role: adminRow!.role, isOperator: adminRow!.isOperator }

if (command === 'create') {
  const name = arg('--name') ?? fail('Give --name "Claude, emergencies".')
  const presetKey = arg('--preset')
  const preset = presetKey ? (presetByKey(presetKey) ?? fail(`No preset "${presetKey}". Run: agent-token.ts presets`)) : null
  const rules = arg('--rules') ? JSON.parse(readFileSync(arg('--rules')!, 'utf8')) : (preset?.rules ?? [])
  const access = (arg('--access') ?? preset?.access ?? 'draft') as 'read' | 'draft'
  const days = arg('--days')
  const ip = arg('--ip')
  const { token, secret } = createAgentToken(ctx, admin, {
    name: name as string,
    access,
    rules,
    expiresAt: days ? new Date(Date.now() + Number(days) * 86_400_000).toISOString() : null,
    ipAllow: ip ? ip.split(',') : null,
  })
  console.log(`Token "${token.name}" (${token.id}) made for ${adminEmail}. Access: ${token.access}. Rules: ${token.rules.length}.`)
  console.log('Copy the secret now. It is not stored and cannot be shown again:\n')
  console.log(secret)
  console.log('\nIt acts as that admin, limited by its rules. Revoke it any time: agent-token.ts revoke ' + token.id)
} else if (command === 'list') {
  for (const t of listAgentTokens(ctx, admin)) console.log(`${t.id}  ${t.status.padEnd(8)} ${t.access.padEnd(6)} ${t.prefix}…  ${t.name}  (last used ${t.lastUsedAt ?? 'never'})`)
} else if (command === 'revoke') {
  const id = process.argv[3] ?? fail('Give the token id.')
  console.log(`Revoked ${revokeAgentToken(ctx, admin, id as string).name}.`)
} else {
  setAgentsPaused(ctx, admin, command === 'pause-all')
  console.log(command === 'pause-all' ? 'All agent access is paused.' : 'Agent access is resumed.')
}
