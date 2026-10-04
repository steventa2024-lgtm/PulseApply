import fs from 'fs'
import path from 'path'
import initSqlJs, { type Database, type SqlValue } from 'sql.js'
import { MIGRATIONS } from './migrations'
import { log } from '../logger'

export type Params = SqlValue[] | Record<string, SqlValue>

/**
 * SQLite database backed by sql.js (WASM, no native module to rebuild for
 * Electron). The whole database lives in memory; every committed write
 * schedules an atomic flush to disk (write temp file -> fsync -> rename), and
 * the previous file is kept as `<name>.prev` so a crash mid-write can never
 * leave the user with a corrupt database.
 *
 * All access happens on the main-process thread, so statements are naturally
 * serialized; `transaction()` gives all-or-nothing semantics for multi-step
 * writes.
 */
export class AppDb {
  private saveTimer: NodeJS.Timeout | null = null
  private depth = 0
  private dirty = false
  private closed = false

  private constructor(
    private readonly db: Database,
    readonly filePath: string | null
  ) {}

  static async open(filePath: string | null): Promise<AppDb> {
    const SQL = await initSqlJs()
    let db: Database
    if (filePath && fs.existsSync(filePath)) {
      db = new SQL.Database(fs.readFileSync(filePath))
    } else if (filePath && fs.existsSync(filePath + '.prev')) {
      log.warn('db', 'Primary database missing; recovering from previous snapshot')
      db = new SQL.Database(fs.readFileSync(filePath + '.prev'))
    } else {
      db = new SQL.Database()
    }
    const instance = new AppDb(db, filePath)
    instance.exec('PRAGMA foreign_keys = ON')
    instance.migrate()
    return instance
  }

  get schemaVersion(): number {
    return (
      (this.get<{ v: number }>('SELECT MAX(version) AS v FROM schema_version')?.v as number) ?? 0
    )
  }

  private migrate(): void {
    this.exec(
      'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)'
    )
    const current = this.schemaVersion
    const pending = MIGRATIONS.filter((m) => m.version > current)
    // Before upgrading an existing database file, keep a byte-for-byte copy of it.
    if (pending.length && current > 0 && this.filePath && fs.existsSync(this.filePath)) {
      const backup = `${this.filePath}.pre-v${pending[pending.length - 1].version}.bak`
      if (!fs.existsSync(backup)) {
        fs.copyFileSync(this.filePath, backup)
        log.info('db', `Backed up database before migration to ${path.basename(backup)}`)
      }
    }
    for (const m of MIGRATIONS) {
      if (m.version <= current) continue
      this.transaction(() => {
        this.exec(m.sql)
        this.run('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)', [
          m.version,
          new Date().toISOString()
        ])
      })
      log.info('db', `Applied migration ${m.version}: ${m.name}`)
    }
    this.flush()
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('The database is closed (PulseApply is shutting down)')
  }

  exec(sql: string): void {
    this.assertOpen()
    this.db.exec(sql)
    this.markDirty()
  }

  run(sql: string, params: Params = []): number {
    this.assertOpen()
    this.db.run(sql, params as never)
    this.markDirty()
    return this.db.getRowsModified()
  }

  all<T = Record<string, unknown>>(sql: string, params: Params = []): T[] {
    this.assertOpen()
    const stmt = this.db.prepare(sql)
    try {
      stmt.bind(params as never)
      const rows: T[] = []
      while (stmt.step()) rows.push(stmt.getAsObject() as T)
      return rows
    } finally {
      stmt.free()
    }
  }

  get<T = Record<string, unknown>>(sql: string, params: Params = []): T | undefined {
    return this.all<T>(sql, params)[0]
  }

  /**
   * Runs `fn` atomically. Nested calls use savepoints. The callback must be
   * synchronous — awaiting inside a transaction would let other code interleave.
   */
  transaction<T>(fn: () => T): T {
    const sp = `sp_${this.depth}`
    if (this.depth === 0) this.db.exec('BEGIN')
    else this.db.exec(`SAVEPOINT ${sp}`)
    this.depth++
    try {
      const result = fn()
      if (result instanceof Promise) {
        throw new Error('AppDb.transaction callback must be synchronous')
      }
      this.depth--
      if (this.depth === 0) this.db.exec('COMMIT')
      else this.db.exec(`RELEASE ${sp}`)
      this.markDirty()
      return result
    } catch (err) {
      this.depth--
      if (this.depth === 0) this.db.exec('ROLLBACK')
      else this.db.exec(`ROLLBACK TO ${sp}; RELEASE ${sp}`)
      throw err
    }
  }

  private markDirty(): void {
    if (this.depth > 0) return
    this.dirty = true
    if (!this.filePath || this.closed) return
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.flush()
    }, 200)
  }

  /** Synchronously persists the database to disk if anything changed. */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (!this.filePath || !this.dirty || this.depth > 0) return
    const data = this.db.export()
    // db.export() resets pragmas on some sql.js builds; re-assert FK enforcement.
    this.db.exec('PRAGMA foreign_keys = ON')
    const dir = path.dirname(this.filePath)
    fs.mkdirSync(dir, { recursive: true })
    const tmp = `${this.filePath}.tmp-${process.pid}`
    const fd = fs.openSync(tmp, 'w')
    try {
      fs.writeSync(fd, data)
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    if (fs.existsSync(this.filePath)) {
      fs.copyFileSync(this.filePath, this.filePath + '.prev')
    }
    fs.renameSync(tmp, this.filePath)
    this.dirty = false
  }

  close(): void {
    if (this.closed) return
    this.flush()
    this.closed = true
    this.db.close()
  }
}

export function json<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value.length === 0) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}
