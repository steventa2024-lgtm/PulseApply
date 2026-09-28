import fs from 'fs'
import path from 'path'
import { createHash, randomUUID } from 'crypto'

/**
 * Guarantees a single active getUpdates poller per bot token on this machine.
 *
 * - In-process: a registry on `globalThis` survives module re-evaluation, so a
 *   reloaded main-process module cannot start a second poller.
 * - Cross-process: a lock file in userData holds the owner's pid + heartbeat.
 *   A lock whose process is gone or whose heartbeat is stale is taken over;
 *   unrelated processes are never killed.
 */
const REGISTRY = Symbol.for('pulseapply.telegram.pollers')
type Registry = Map<string, string>

function registry(): Registry {
  const g = globalThis as unknown as Record<symbol, Registry | undefined>
  if (!g[REGISTRY]) g[REGISTRY] = new Map()
  return g[REGISTRY]!
}

export const STALE_AFTER_MS = 90_000

interface LockBody {
  pid: number
  owner: string
  heartbeatAt: number
}

function alive(pid: number): boolean {
  if (pid === process.pid) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export class PollingLock {
  readonly owner = randomUUID()
  private readonly file: string
  private readonly tokenKey: string
  private held = false

  constructor(dir: string, token: string) {
    this.tokenKey = createHash('sha256').update(token).digest('hex').slice(0, 16)
    this.file = path.join(dir, `telegram-poller-${this.tokenKey}.lock`)
  }

  /** Returns null on success, or a human-readable reason the lock is held elsewhere. */
  acquire(): string | null {
    const reg = registry()
    const inProc = reg.get(this.tokenKey)
    if (inProc && inProc !== this.owner)
      return 'Another Telegram poller is already running inside PulseApply.'
    try {
      const existing = JSON.parse(fs.readFileSync(this.file, 'utf8')) as LockBody
      const fresh = Date.now() - existing.heartbeatAt < STALE_AFTER_MS
      if (
        existing.owner !== this.owner &&
        existing.pid !== process.pid &&
        fresh &&
        alive(existing.pid)
      ) {
        return `Another PulseApply process (pid ${existing.pid}) is already polling this bot.`
      }
    } catch {
      // no lock file or unreadable: free
    }
    this.write()
    reg.set(this.tokenKey, this.owner)
    this.held = true
    return null
  }

  private write(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const body: LockBody = { pid: process.pid, owner: this.owner, heartbeatAt: Date.now() }
    const tmp = `${this.file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(body))
    fs.renameSync(tmp, this.file)
  }

  heartbeat(): void {
    if (this.held) this.write()
  }

  release(): void {
    if (!this.held) return
    this.held = false
    const reg = registry()
    if (reg.get(this.tokenKey) === this.owner) reg.delete(this.tokenKey)
    try {
      const existing = JSON.parse(fs.readFileSync(this.file, 'utf8')) as LockBody
      if (existing.owner === this.owner) fs.rmSync(this.file)
    } catch {
      // already gone
    }
  }
}
