import type { SavedSearch, ScoredJob } from '../../../shared/types'
import type { Store } from '../persistence/store'
import type { SearchService } from '../jobs/orchestration/searchService'
import type { TelegramService } from '../telegram/telegramService'
import { log } from '../logger'

const SINGLETON = Symbol.for('pulseapply.scheduler')
const TICK_MS = 30_000
const MAX_PARALLEL = 2

/**
 * Persistent saved-search scheduler.
 *
 * - One timer per process (a previous instance registered on globalThis is
 *   disposed first), so reloading the main-process module cannot duplicate it.
 * - A search is atomically claimed in the database before running, so the
 *   same search never runs twice concurrently; abandoned claims expire.
 * - Failures back off exponentially (bounded by the search interval).
 * - Telegram receives only jobs not previously notified for that search.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null
  private readonly running = new Map<string, AbortController>()
  private stopped = true

  constructor(
    private readonly deps: {
      store: Store
      search: SearchService
      telegram?: TelegramService
      onUpdate?: () => void
      /** Desktop notification for new matching jobs (Electron only). */
      notifyNewJobs?: (searchName: string, jobs: ScoredJob[]) => void
    }
  ) {}

  start(): void {
    const g = globalThis as unknown as Record<symbol, Scheduler | undefined>
    if (g[SINGLETON] && g[SINGLETON] !== this) g[SINGLETON]!.stop()
    g[SINGLETON] = this
    if (this.timer) return
    this.stopped = false
    this.deps.store.searches.releaseAll()
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    setTimeout(() => void this.tick(), 5_000)
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    for (const c of this.running.values()) c.abort()
    const g = globalThis as unknown as Record<symbol, Scheduler | undefined>
    if (g[SINGLETON] === this) g[SINGLETON] = undefined
  }

  isRunning(id: string): boolean {
    return this.running.has(id)
  }

  async tick(): Promise<void> {
    if (this.stopped) return
    const due = this.deps.store.searches.due(new Date().toISOString())
    for (const s of due) {
      if (this.running.size >= MAX_PARALLEL) break
      void this.runSearch(s, 'scheduled')
    }
  }

  runNow(
    id: string
  ): Promise<{ resultCount: number; newCount: number; notified: number } | undefined> {
    const s = this.deps.store.searches.get(id)
    if (!s) throw new Error('Saved search not found')
    return this.runSearch(s, 'manual')
  }

  cancel(id: string): boolean {
    const c = this.running.get(id)
    c?.abort()
    return !!c
  }

  async runSearch(
    s: SavedSearch,
    trigger: 'scheduled' | 'manual'
  ): Promise<{ resultCount: number; newCount: number; notified: number } | undefined> {
    const { store } = this.deps
    if (this.running.has(s.id) || !store.searches.claim(s.id)) {
      log.info('scheduler', `Search "${s.name}" is already running; skipped`)
      return undefined
    }
    const controller = new AbortController()
    this.running.set(s.id, controller)
    this.deps.onUpdate?.()
    try {
      const result = await this.deps.search.run(s.criteria, {
        trigger: trigger === 'manual' ? 'scheduled' : trigger,
        searchId: s.id,
        signal: controller.signal
      })
      if (result.cancelled) {
        store.searches.release(s.id)
        return undefined
      }
      const visible = result.jobs.filter((j) => !j.state.dismissed)
      const fresh = store.searches.markSeen(
        s.id,
        visible.map((j) => j.id)
      )
      let notified = 0
      if (s.notify && this.deps.telegram?.isRunning()) {
        const pending = new Set(
          store.searches.unnotified(
            s.id,
            visible.map((j) => j.id)
          )
        )
        const qualifying: ScoredJob[] = visible.filter(
          (j) =>
            pending.has(j.id) &&
            !['STALE', 'EXPIRED', 'REMOVED'].includes(j.verificationStatus) &&
            (j.match ? j.match.score >= s.minScoreToNotify : j.relevance.score >= 0.75)
        )
        if (qualifying.length) {
          try {
            notified = await this.deps.telegram.sendJobBatch(qualifying, {
              searchId: s.id,
              searchName: s.name
            })
            if (notified)
              store.searches.markNotified(
                s.id,
                qualifying.map((j) => j.id)
              )
          } catch (err) {
            log.warn('scheduler', `Telegram notification failed: ${(err as Error).message}`)
          }
        }
      }
      const freshSet = new Set(fresh)
      const newMatches = visible.filter(
        (j) => freshSet.has(j.id) && (j.match ? j.match.score >= s.minScoreToNotify : true)
      )
      if (newMatches.length && store.settings.get().notifications?.desktop !== false) {
        try {
          this.deps.notifyNewJobs?.(s.name, newMatches)
        } catch (err) {
          log.warn('scheduler', `Desktop notification failed: ${(err as Error).message}`)
        }
      }
      store.searches.recordSuccess(s.id, visible.length, fresh.length)
      return { resultCount: visible.length, newCount: fresh.length, notified }
    } catch (err) {
      store.searches.recordFailure(s.id, (err as Error).message)
      log.warn('scheduler', `Search "${s.name}" failed: ${(err as Error).message}`)
      return undefined
    } finally {
      this.running.delete(s.id)
      this.deps.onUpdate?.()
    }
  }
}
