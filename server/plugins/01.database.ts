// Open the database and run migrations on start-up. Migrations ship as Nitro server assets.
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { openDb } from '../db/client'
import type { MigrationFile } from '../db/migrate'
import { setDbHandle } from '../utils/state'

export default defineNitroPlugin(async () => {
  const path = process.env.SITEBUILDER_DB_PATH ?? '.data/sitebuilder.db'
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const storage = useStorage('assets:migrations')
  const keys = (await storage.getKeys()).filter((k) => k.endsWith('.sql'))
  const files: MigrationFile[] = []
  for (const key of keys) files.push({ name: key, sql: String(await storage.getItem(key)) })
  setDbHandle(openDb(path, files), path)
  console.info(JSON.stringify({ level: 'info', msg: 'database ready', path, migrations: files.length }))
})
