// Load migration files from disk (tests, seed script, CLI).
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { MigrationFile } from './migrate'

export const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations', import.meta.url))

export function loadMigrationsFromDir(dir: string = MIGRATIONS_DIR): MigrationFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }))
}
