// Database connection. SQLite in WAL mode with foreign keys on.
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'
import { runMigrations, type MigrationFile } from './migrate'

export type Db = BetterSQLite3Database<typeof schema>

export interface DbHandle {
  db: Db
  sqlite: Database.Database
}

export function openDb(path: string, migrations: MigrationFile[]): DbHandle {
  const sqlite = new Database(path)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')
  runMigrations(sqlite, migrations)
  return { db: drizzle(sqlite, { schema }), sqlite }
}
