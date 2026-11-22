#!/usr/bin/env tsx
// Make, list, revoke and pause agent tokens from the command line. Settings, Agents does the same in the app; this script is for operators and scripts.
// The secret is printed once. Only its hash is stored. See docs/agent-gateway.md.
//
//   npx tsx scripts/agent-token.ts presets
//   npx tsx scripts/agent-token.ts create --name "Claude, emergencies" --preset takedown [--admin you@example.org] [--days 90] [--ip 203.0.113.0/24]
//   npx tsx scripts/agent-token.ts create --name "Claude, copy" --access draft --rules rules.json
//   npx tsx scripts/agent-token.ts list
//   npx tsx scripts/agent-token.ts revoke agt_...
//   npx tsx scripts/agent-token.ts always-allow agt_... --days 3 --site-name "Example charity"       (1 to 7 days)
//   npx tsx scripts/agent-token.ts always-allow agt_... --permanent --site-name "Example charity"    (no end date)
//   npx tsx scripts/agent-token.ts always-allow-off agt_...
//     The admin password is read from SITEBUILDER_ADMIN_PASSWORD, or asked for (typing is hidden).
//   npx tsx scripts/agent-token.ts pause-all | resume-all
//
//   SITEBUILDER_DB_PATH   database file (default .data/sitebuilder.db)
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { eq } from 'drizzle-orm'
import { openDb } from '../server/db/client'
import { loadMigrationsFromDir } from '../server/db/migrations-fs'
import { users } from '../server/db/schema'
import type { ActingAs, ServiceCtx } from '../server/services/context'
import { getOnlySite } from '../server/services/site'
import { createAgentToken, disableAlwaysAllow, enableAlwaysAllow, listAgentTokens, revokeAgentToken, setAgentsPaused } from '../server/services/agent/tokens'
import { createDefaultRegistry } from '../shared/blocks/registry'
import { RULE_PRESETS, presetByKey } from '../shared/agent/presets'

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}
function askPassword(): Promise<string> {
  if (process.env.SITEBUILDER_ADMIN_PASSWORD) return Promise.resolve(process.env.SITEBUILDER_ADMIN_PASSWORD)
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    const w = (rl as unknown as { _writeToOutput: (s: string) => void })
    process.stdout.write('Admin password (hidden): ')
    w._writeToOutput = () => {}
    rl.question('', (answer) => {
      rl.close()
      process.stdout.write('\n')
      resolve(answer)
    })
  })
}
const fail = (msg: string): never => {
  console.error(msg)
  process.exit(2)
}

process.on('uncaughtException', (e) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})

const command = process.argv[2]
if (command === 'presets') {
  for (const p of RULE_PRESETS) console.log(`${p.key.padEnd(12)} ${p.label}: ${p.description}`)
  process.exit(0)
}
if (!command || !['create', 'list', 'revoke', 'always-allow', 'always-allow-off', 'pause-all', 'resume-all'].includes(command)) fail('Usage: agent-token.ts presets | create | list | revoke <id> | always-allow <id> | always-allow-off <id> | pause-all | resume-all')

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
  for (const t of listAgentTokens(ctx, admin)) {
    const aa = t.alwaysAllow ? (t.alwaysAllow.permanent ? '  ALWAYS-ALLOW: PERMANENT (no end date)' : `  always-allow until ${t.alwaysAllow.until}`) : ''
    console.log(`${t.id}  ${t.status.padEnd(8)} ${t.access.padEnd(6)} ${t.prefix}…  ${t.name}  (last used ${t.lastUsedAt ?? 'never'})${aa}`)
  }
} else if (command === 'always-allow') {
  const id = process.argv[3] ?? fail('Give the token id.')
  const permanent = process.argv.includes('--permanent')
  const days = arg('--days')
  if (permanent === !!days) fail('Give exactly one of --days 1..7 or --permanent.')
  const siteName = arg('--site-name') ?? fail('Give --site-name "<the exact site name>" to confirm.')
  const password = await askPassword()
  const t = enableAlwaysAllow(ctx, admin, id as string, { ...(permanent ? { permanent: true } : { days: Number(days) }), siteName: siteName as string, password })
  console.log(t.alwaysAllow?.permanent ? `Always-allow is ON for "${t.name}" with NO END DATE. Switch it off with: agent-token.ts always-allow-off ${t.id}` : `Always-allow is ON for "${t.name}" until ${t.alwaysAllow?.until}.`)
} else if (command === 'always-allow-off') {
  const id = process.argv[3] ?? fail('Give the token id.')
  console.log(`Always-allow is off for "${disableAlwaysAllow(ctx, admin, id as string).name}".`)
} else if (command === 'revoke') {
  const id = process.argv[3] ?? fail('Give the token id.')
  console.log(`Revoked ${revokeAgentToken(ctx, admin, id as string).name}.`)
} else {
  setAgentsPaused(ctx, admin, command === 'pause-all')
  console.log(command === 'pause-all' ? 'All agent access is paused.' : 'Agent access is resumed.')
}
