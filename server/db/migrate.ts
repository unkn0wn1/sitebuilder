// A tiny migration runner for the SQL files drizzle-kit generates. Works from the file system
// (tests, seed) or from Nitro server assets (production build). See ADR 0009.
import type Database from 'better-sqlite3'

export interface MigrationFile {
  name: string
  sql: string
}

export function runMigrations(sqlite: Database.Database, files: MigrationFile[]): string[] {
  sqlite.exec('CREATE TABLE IF NOT EXISTS __migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)')
  const done = new Set((sqlite.prepare('SELECT name FROM __migrations').all() as { name: string }[]).map((r) => r.name))
  const applied: string[] = []
  const sorted = [...files].filter((f) => f.name.endsWith('.sql')).sort((a, b) => a.name.localeCompare(b.name))
  for (const file of sorted) {
    if (done.has(file.name)) continue
    const statements = file.sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean)
    sqlite.transaction(() => {
      for (const statement of statements) sqlite.exec(statement)
      sqlite.prepare('INSERT INTO __migrations (name, applied_at) VALUES (?, ?)').run(file.name, new Date().toISOString())
    })()
    applied.push(file.name)
  }
  return applied
}
