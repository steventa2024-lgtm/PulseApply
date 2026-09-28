import { randomUUID } from 'crypto'
import type { SavedSearch, SearchCriteria, SearchStats } from '../../../shared/types'
import type { AppDb } from './database'
import { json } from './database'

interface Row {
  id: string
  name: string
  criteria: string
  enabled: number
  interval_minutes: number
  notify: number
  min_score_to_notify: number
  last_run_at: string | null
  last_success_at: string | null
  last_result_count: number | null
  last_new_count: number | null
  last_error: string | null
  consecutive_failures: number
  next_run_at: string | null
  running_since: string | null
  created_at: string
}

export const MIN_INTERVAL_MINUTES = 15
/** A run marked as running for longer than this is considered abandoned (e.g. app crashed). */
const STALE_RUN_MS = 15 * 60_000

export class SearchesRepo {
  constructor(private readonly db: AppDb) {}

  private hydrate(r: Row): SavedSearch {
    return {
      id: r.id,
      name: r.name,
      criteria: json<SearchCriteria>(r.criteria, { query: '' }),
      enabled: !!r.enabled,
      intervalMinutes: r.interval_minutes,
      notify: !!r.notify,
      minScoreToNotify: r.min_score_to_notify,
      lastRunAt: r.last_run_at ?? undefined,
      lastSuccessAt: r.last_success_at ?? undefined,
      lastResultCount: r.last_result_count ?? undefined,
      lastNewCount: r.last_new_count ?? undefined,
      lastError: r.last_error ?? undefined,
      consecutiveFailures: r.consecutive_failures,
      nextRunAt: r.next_run_at ?? undefined,
      running: !!r.running_since && Date.now() - Date.parse(r.running_since) < STALE_RUN_MS,
      createdAt: r.created_at
    }
  }

  list(): SavedSearch[] {
    return this.db
      .all<Row>('SELECT * FROM search_profiles ORDER BY created_at ASC')
      .map((r) => this.hydrate(r))
  }

  get(id: string): SavedSearch | undefined {
    const r = this.db.get<Row>('SELECT * FROM search_profiles WHERE id = ?', [id])
    return r ? this.hydrate(r) : undefined
  }

  save(input: {
    id?: string
    name: string
    criteria: SearchCriteria
    enabled: boolean
    intervalMinutes: number
    notify: boolean
    minScoreToNotify: number
  }): SavedSearch {
    const interval = Math.max(MIN_INTERVAL_MINUTES, Math.round(input.intervalMinutes))
    const id = input.id ?? randomUUID()
    const now = new Date().toISOString()
    if (input.id && this.get(input.id)) {
      this.db.run(
        `UPDATE search_profiles SET name = ?, criteria = ?, enabled = ?, interval_minutes = ?, notify = ?, min_score_to_notify = ?
         WHERE id = ?`,
        [
          input.name,
          JSON.stringify(input.criteria),
          input.enabled ? 1 : 0,
          interval,
          input.notify ? 1 : 0,
          input.minScoreToNotify,
          id
        ]
      )
    } else {
      this.db.run(
        `INSERT INTO search_profiles (id, name, criteria, enabled, interval_minutes, notify, min_score_to_notify, next_run_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.name,
          JSON.stringify(input.criteria),
          input.enabled ? 1 : 0,
          interval,
          input.notify ? 1 : 0,
          input.minScoreToNotify,
          now,
          now
        ]
      )
    }
    return this.get(id)!
  }

  delete(id: string): void {
    this.db.run('DELETE FROM search_profiles WHERE id = ?', [id])
  }

  setEnabled(id: string, enabled: boolean): void {
    this.db.run(
      'UPDATE search_profiles SET enabled = ?, next_run_at = CASE WHEN ? = 1 THEN ? ELSE next_run_at END WHERE id = ?',
      [enabled ? 1 : 0, enabled ? 1 : 0, new Date().toISOString(), id]
    )
  }

  due(nowIso: string): SavedSearch[] {
    return this.list().filter(
      (s) => s.enabled && !s.running && (!s.nextRunAt || s.nextRunAt <= nowIso)
    )
  }

  /** Atomically claims a search for running; returns false if another run holds it. */
  claim(id: string): boolean {
    const staleBefore = new Date(Date.now() - STALE_RUN_MS).toISOString()
    return (
      this.db.run(
        'UPDATE search_profiles SET running_since = ? WHERE id = ? AND (running_since IS NULL OR running_since < ?)',
        [new Date().toISOString(), id, staleBefore]
      ) === 1
    )
  }

  release(id: string): void {
    this.db.run('UPDATE search_profiles SET running_since = NULL WHERE id = ?', [id])
  }

  releaseAll(): void {
    this.db.run('UPDATE search_profiles SET running_since = NULL WHERE running_since IS NOT NULL')
  }

  recordSuccess(id: string, resultCount: number, newCount: number): void {
    const s = this.get(id)
    if (!s) return
    const now = new Date()
    this.db.run(
      `UPDATE search_profiles SET last_run_at = ?, last_success_at = ?, last_result_count = ?, last_new_count = ?,
         last_error = NULL, consecutive_failures = 0, next_run_at = ?, running_since = NULL WHERE id = ?`,
      [
        now.toISOString(),
        now.toISOString(),
        resultCount,
        newCount,
        new Date(now.getTime() + s.intervalMinutes * 60_000).toISOString(),
        id
      ]
    )
  }

  /** Bounded exponential backoff: 2, 4, 8 ... minutes, never longer than the configured interval. */
  recordFailure(id: string, error: string): void {
    const s = this.get(id)
    if (!s) return
    const failures = s.consecutiveFailures + 1
    const backoffMin = Math.min(s.intervalMinutes, 2 ** Math.min(failures, 6))
    const now = new Date()
    this.db.run(
      `UPDATE search_profiles SET last_run_at = ?, last_error = ?, consecutive_failures = ?, next_run_at = ?, running_since = NULL
       WHERE id = ?`,
      [
        now.toISOString(),
        error.slice(0, 500),
        failures,
        new Date(now.getTime() + backoffMin * 60_000).toISOString(),
        id
      ]
    )
  }

  // --- seen / notified bookkeeping -----------------------------------------

  /** Records jobs seen by a search; returns the ids seen for the first time. */
  markSeen(searchId: string, jobIds: string[]): string[] {
    const fresh: string[] = []
    const now = new Date().toISOString()
    this.db.transaction(() => {
      for (const jobId of jobIds) {
        if (
          this.db.run(
            'INSERT OR IGNORE INTO search_seen_jobs (search_id, job_id, first_seen_at) VALUES (?, ?, ?)',
            [searchId, jobId, now]
          ) === 1
        ) {
          fresh.push(jobId)
        }
      }
    })
    return fresh
  }

  unnotified(searchId: string, jobIds: string[]): string[] {
    if (jobIds.length === 0) return []
    const rows = this.db.all<{ job_id: string }>(
      `SELECT job_id FROM search_seen_jobs WHERE search_id = ? AND notified_at IS NULL AND job_id IN (${jobIds.map(() => '?').join(',')})`,
      [searchId, ...jobIds]
    )
    return rows.map((r) => r.job_id)
  }

  markNotified(searchId: string, jobIds: string[]): void {
    const now = new Date().toISOString()
    this.db.transaction(() => {
      for (const jobId of jobIds) {
        this.db.run(
          'UPDATE search_seen_jobs SET notified_at = ? WHERE search_id = ? AND job_id = ?',
          [now, searchId, jobId]
        )
      }
    })
  }

  // --- run history ---------------------------------------------------------

  startRun(searchId: string | null, trigger: string): string {
    const id = randomUUID()
    this.db.run(
      'INSERT INTO automation_runs (id, search_id, trigger, started_at, status) VALUES (?, ?, ?, ?, ?)',
      [id, searchId, trigger, new Date().toISOString(), 'running']
    )
    return id
  }

  finishRun(
    runId: string,
    status: 'ok' | 'error' | 'cancelled',
    stats?: SearchStats,
    error?: string
  ): void {
    this.db.run(
      'UPDATE automation_runs SET finished_at = ?, status = ?, stats = ?, error = ? WHERE id = ?',
      [new Date().toISOString(), status, stats ? JSON.stringify(stats) : null, error ?? null, runId]
    )
  }

  recentRuns(limit = 30): {
    id: string
    searchId?: string
    trigger: string
    startedAt: string
    finishedAt?: string
    status: string
    stats?: SearchStats
    error?: string
  }[] {
    return this.db
      .all<{
        id: string
        search_id: string | null
        trigger: string
        started_at: string
        finished_at: string | null
        status: string
        stats: string | null
        error: string | null
      }>('SELECT * FROM automation_runs ORDER BY started_at DESC LIMIT ?', [limit])
      .map((r) => ({
        id: r.id,
        searchId: r.search_id ?? undefined,
        trigger: r.trigger,
        startedAt: r.started_at,
        finishedAt: r.finished_at ?? undefined,
        status: r.status,
        stats: json<SearchStats | undefined>(r.stats, undefined),
        error: r.error ?? undefined
      }))
  }

  lastSuccessfulRunAt(): string | undefined {
    return (
      this.db.get<{ t: string | null }>(
        "SELECT MAX(finished_at) AS t FROM automation_runs WHERE status = 'ok'"
      )?.t ?? undefined
    )
  }

  /** Marks runs left 'running' by a crashed process as abandoned. */
  abandonDanglingRuns(): void {
    this.db.run(
      "UPDATE automation_runs SET status = 'error', error = 'Interrupted (application closed)', finished_at = ? WHERE status = 'running'",
      [new Date().toISOString()]
    )
  }
}
