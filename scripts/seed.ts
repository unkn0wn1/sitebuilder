// Seed a local install: site, first admin, starter page types, site parts, a sample embed and page.
// Safe to run twice. Usage: npm run seed
//   SITEBUILDER_DB_PATH   database file (default .data/sitebuilder.db)
//   SEED_SITE_NAME        site name (default "Example charity")
//   SEED_ADMIN_EMAIL      first admin's email (default admin@example.org)
//   SEED_ADMIN_PASSWORD   first admin's password; if unset a random one is printed once
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { openDb } from '../server/db/client'
import { loadMigrationsFromDir } from '../server/db/migrations-fs'
import { pages, siteParts, templates, users } from '../server/db/schema'
import { createUser } from '../server/services/auth'
import type { ActingAs, ServiceCtx } from '../server/services/context'
import { createPage } from '../server/services/pages'
import { STARTER_TEMPLATES } from '../server/services/seed-data'
import { createEmbed, createSite, getOnlySite, listEmbeds } from '../server/services/site'
import { createSitePart } from '../server/services/site-parts'
import { createTemplate } from '../server/services/templates'
import { createDefaultRegistry } from '../shared/blocks/registry'

const path = process.env.SITEBUILDER_DB_PATH ?? '.data/sitebuilder.db'
if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
const { db, sqlite } = openDb(path, loadMigrationsFromDir())
const registry = createDefaultRegistry()
const now = () => new Date()
const log = (msg: string) => console.log(`seed: ${msg}`)

const siteId = getOnlySite(db)?.id ?? createSite({ db, registry, now }, { name: process.env.SEED_SITE_NAME ?? 'Example charity', settings: { workflow: { selfApproval: false } } })
const ctx: ServiceCtx = { db, siteId, registry, now }

const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@example.org').toLowerCase()
let admin = db.select().from(users).where(eq(users.email, email)).get()
if (!admin) {
  const password = process.env.SEED_ADMIN_PASSWORD ?? randomBytes(12).toString('base64url')
  admin = createUser(ctx, { email, name: 'Admin', role: 'admin', isOperator: true, password }).user
  log(`created admin ${email}`)
  if (!process.env.SEED_ADMIN_PASSWORD) log(`generated password (shown once, change it after signing in): ${password}`)
} else log(`admin ${email} already exists`)
const actor: ActingAs = { id: admin.id, role: admin.role, isOperator: admin.isOperator }

const haveTemplates = new Set(db.select({ key: templates.key }).from(templates).all().map((t) => t.key))
for (const [key, rules] of Object.entries(STARTER_TEMPLATES)) {
  if (!haveTemplates.has(key)) {
    createTemplate(ctx, key, rules, admin.id)
    log(`added page type ${key}`)
  }
}

const haveParts = new Set(db.select({ key: siteParts.key }).from(siteParts).all().map((p) => p.key))
for (const [kind, key, label] of [['header', 'header', 'Header'], ['footer', 'footer', 'Footer'], ['menu', 'main', 'Main menu']] as const) {
  if (!haveParts.has(key)) {
    createSitePart(ctx, kind, key, label, actor)
    log(`added site part ${label}`)
  }
}

if (!listEmbeds(ctx).some((e) => e.provider === 'virtuous')) {
  createEmbed(ctx, actor, { provider: 'virtuous', name: 'Example donation form', config: { formId: 'example-form' } })
  log('added sample Virtuous embed')
}

if (!db.select({ id: pages.id }).from(pages).where(eq(pages.slug, 'about-us')).get()) {
  createPage(ctx, actor, { title: 'About us', template: 'standard', slug: 'about-us' })
  log('added sample page About us')
}

sqlite.close()
log(`done (${path})`)
