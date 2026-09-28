import type {
  ApplicationState,
  GeoEligibility,
  JobSourceRecord,
  MatchResult,
  NormalizedJob,
  ScoredJob,
  VerificationStatus
} from '../../../shared/types'
import type { AppDb } from './database'
import { json } from './database'

interface JobRow {
  id: string
  data: string
  match: string | null
  relevance: string | null
  geo: string | null
  saved: number
  dismissed: number
  discovered_at: string
  last_seen_at: string
  verification_status: string
  app_id: string | null
  app_state: string | null
}

export interface JobListFilter {
  view?: 'all' | 'saved' | 'dismissed' | 'new' | 'applied'
  minScore?: number
  verification?: VerificationStatus[]
  ids?: string[]
  since?: string
  limit?: number
  offset?: number
  includeDemo?: boolean
}

export interface UpsertOutcome {
  inserted: string[]
  updated: string[]
}

const SELECT = `
  SELECT j.id, j.data, j.match, j.relevance, j.geo, j.saved, j.dismissed, j.discovered_at, j.last_seen_at,
         j.verification_status,
         (SELECT a.id FROM applications a WHERE a.job_id = j.id ORDER BY a.created_at DESC LIMIT 1) AS app_id,
         (SELECT a.state FROM applications a WHERE a.job_id = j.id ORDER BY a.created_at DESC LIMIT 1) AS app_state
  FROM jobs j`

function mergeSources(a: JobSourceRecord[], b: JobSourceRecord[]): JobSourceRecord[] {
  const map = new Map<string, JobSourceRecord>()
  for (const s of [...a, ...b]) map.set(`${s.providerId}::${s.sourceJobId}`, s)
  return [...map.values()]
}

export class JobsRepo {
  constructor(private readonly db: AppDb) {}

  private hydrate(row: JobRow): ScoredJob {
    const job = json<NormalizedJob>(row.data, {} as NormalizedJob)
    job.verificationStatus = row.verification_status as VerificationStatus
    job.discoveredAt = row.discovered_at
    job.lastSeenAt = row.last_seen_at
    return {
      ...job,
      match: json<MatchResult | undefined>(row.match, undefined),
      relevance: json(row.relevance, { score: 0, basis: 'not evaluated' }),
      geo: json<ScoredJob['geo']>(row.geo, { eligibility: 'unknown' as GeoEligibility }),
      state: {
        saved: !!row.saved,
        dismissed: !!row.dismissed,
        applicationId: row.app_id ?? undefined,
        applicationState: (row.app_state as ApplicationState) ?? undefined
      }
    }
  }

  get(id: string): ScoredJob | undefined {
    const row = this.db.get<JobRow>(`${SELECT} WHERE j.id = ?`, [id])
    return row ? this.hydrate(row) : undefined
  }

  exists(id: string): boolean {
    return !!this.db.get('SELECT 1 AS x FROM jobs WHERE id = ?', [id])
  }

  /** Inserts or refreshes jobs in a single transaction, preserving user state and first-seen time. */
  upsertMany(jobs: ScoredJob[]): UpsertOutcome {
    const outcome: UpsertOutcome = { inserted: [], updated: [] }
    this.db.transaction(() => {
      for (const job of jobs) {
        const existing = this.db.get<{ data: string; discovered_at: string }>(
          'SELECT data, discovered_at FROM jobs WHERE id = ?',
          [job.id]
        )
        const { match, relevance, geo, state: _state, isNew: _isNew, ...base } = job
        void _state
        void _isNew
        let data: NormalizedJob = base
        if (existing) {
          const prev = json<NormalizedJob>(existing.data, base)
          data = {
            ...base,
            discoveredAt: existing.discovered_at,
            sources: mergeSources(prev.sources ?? [], base.sources)
          }
          this.db.run(
            `UPDATE jobs SET canonical_key = ?, data = ?, title = ?, company = ?, source = ?, posted_at = ?,
               last_seen_at = ?, verification_status = ?, occupation_id = ?, match_score = ?, match = ?,
               relevance = ?, geo = ?, is_demo = ?
             WHERE id = ?`,
            [
              data.canonicalKey,
              JSON.stringify(data),
              data.title,
              data.company,
              data.source,
              data.postedAt ?? null,
              data.lastSeenAt,
              data.verificationStatus,
              data.occupation?.id ?? null,
              match?.score ?? null,
              match ? JSON.stringify(match) : null,
              JSON.stringify(relevance),
              JSON.stringify(geo),
              data.isDemo ? 1 : 0,
              job.id
            ]
          )
          outcome.updated.push(job.id)
        } else {
          this.db.run(
            `INSERT INTO jobs (id, canonical_key, data, title, company, source, posted_at, discovered_at, last_seen_at,
               verification_status, occupation_id, match_score, match, relevance, geo, is_demo)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              job.id,
              data.canonicalKey,
              JSON.stringify(data),
              data.title,
              data.company,
              data.source,
              data.postedAt ?? null,
              data.discoveredAt,
              data.lastSeenAt,
              data.verificationStatus,
              data.occupation?.id ?? null,
              match?.score ?? null,
              match ? JSON.stringify(match) : null,
              JSON.stringify(relevance),
              JSON.stringify(geo),
              data.isDemo ? 1 : 0
            ]
          )
          outcome.inserted.push(job.id)
        }
        for (const s of data.sources) {
          this.db.run(
            `INSERT INTO job_source_records (provider_id, source_job_id, job_id, source_url, apply_url, employer_direct, fetched_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(provider_id, source_job_id) DO UPDATE SET job_id = excluded.job_id,
               source_url = excluded.source_url, apply_url = excluded.apply_url, fetched_at = excluded.fetched_at`,
            [
              s.providerId,
              s.sourceJobId,
              job.id,
              s.sourceUrl,
              s.applyUrl ?? null,
              s.employerDirect ? 1 : 0,
              s.fetchedAt
            ]
          )
        }
      }
    })
    return outcome
  }

  /** Map provider record identity -> existing canonical job id (for cross-run dedupe). */
  findJobIdBySourceRecord(providerId: string, sourceJobId: string): string | undefined {
    return this.db.get<{ job_id: string }>(
      'SELECT job_id FROM job_source_records WHERE provider_id = ? AND source_job_id = ?',
      [providerId, sourceJobId]
    )?.job_id
  }

  list(filter: JobListFilter = {}): ScoredJob[] {
    const where: string[] = ['j.legacy = 0']
    const params: (string | number)[] = []
    if (!filter.includeDemo) where.push('j.is_demo = 0')
    switch (filter.view) {
      case 'saved':
        where.push('j.saved = 1')
        break
      case 'dismissed':
        where.push('j.dismissed = 1')
        break
      case 'applied':
        where.push('EXISTS (SELECT 1 FROM applications a WHERE a.job_id = j.id)')
        break
      case 'new':
        where.push('j.dismissed = 0')
        if (filter.since) {
          where.push('j.discovered_at >= ?')
          params.push(filter.since)
        }
        break
      default:
        where.push('j.dismissed = 0')
    }
    if (filter.minScore !== undefined) {
      where.push('COALESCE(j.match_score, 0) >= ?')
      params.push(filter.minScore)
    }
    if (filter.verification?.length) {
      where.push(`j.verification_status IN (${filter.verification.map(() => '?').join(',')})`)
      params.push(...filter.verification)
    }
    if (filter.ids) {
      if (filter.ids.length === 0) return []
      where.push(`j.id IN (${filter.ids.map(() => '?').join(',')})`)
      params.push(...filter.ids)
    }
    const limit = Math.min(filter.limit ?? 500, 2000)
    const offset = filter.offset ?? 0
    const rows = this.db.all<JobRow>(
      `${SELECT} WHERE ${where.join(' AND ')}
       ORDER BY COALESCE(j.match_score, -1) DESC, j.last_seen_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    )
    return rows.map((r) => this.hydrate(r))
  }

  count(filter: JobListFilter = {}): number {
    return this.list({ ...filter, limit: 2000, offset: 0 }).length
  }

  setSaved(id: string, saved: boolean): void {
    this.db.transaction(() => {
      this.db.run(
        'UPDATE jobs SET saved = ?, dismissed = CASE WHEN ? = 1 THEN 0 ELSE dismissed END WHERE id = ?',
        [saved ? 1 : 0, saved ? 1 : 0, id]
      )
      if (saved) {
        this.db.run('INSERT OR IGNORE INTO saved_jobs (job_id, saved_at) VALUES (?, ?)', [
          id,
          new Date().toISOString()
        ])
      } else {
        this.db.run('DELETE FROM saved_jobs WHERE job_id = ?', [id])
      }
    })
  }

  setDismissed(id: string, dismissed: boolean): void {
    this.db.run('UPDATE jobs SET dismissed = ? WHERE id = ?', [dismissed ? 1 : 0, id])
  }

  setVerification(id: string, status: VerificationStatus, note: string): void {
    const job = this.get(id)
    if (!job) return
    const now = new Date().toISOString()
    const { match: _m, relevance: _r, geo: _g, state: _s, isNew: _n, ...base } = job
    void _m
    void _r
    void _g
    void _s
    void _n
    const data: NormalizedJob = {
      ...base,
      verificationStatus: status,
      lastVerifiedAt: now,
      verificationNotes: [
        ...(job.verificationNotes ?? []).slice(-4),
        `${now.slice(0, 10)}: ${note}`
      ]
    }
    this.db.run('UPDATE jobs SET verification_status = ?, data = ? WHERE id = ?', [
      status,
      JSON.stringify(data),
      id
    ])
  }

  /** Marks jobs not seen recently as STALE; never deletes jobs referenced by applications or saves. */
  markStale(olderThanDays: number): number {
    const cutoff = new Date(Date.now() - olderThanDays * 86400_000).toISOString()
    return this.db.run(
      `UPDATE jobs SET verification_status = 'STALE'
       WHERE last_seen_at < ? AND verification_status IN ('SOURCE_CONFIRMED', 'EMPLOYER_CONFIRMED', 'UNVERIFIED')`,
      [cutoff]
    )
  }

  markExpired(): number {
    const now = new Date().toISOString()
    const rows = this.db.all<{ id: string; data: string }>(
      `SELECT id, data FROM jobs WHERE verification_status NOT IN ('EXPIRED', 'REMOVED')`
    )
    let n = 0
    for (const r of rows) {
      const d = json<NormalizedJob>(r.data, {} as NormalizedJob)
      if (d.expiresAt && d.expiresAt < now) {
        this.db.run(`UPDATE jobs SET verification_status = 'EXPIRED' WHERE id = ?`, [r.id])
        n++
      }
    }
    return n
  }

  stats(
    sinceIso: string,
    strongThreshold: number
  ): { total: number; newJobs: number; verified: number; strong: number; saved: number } {
    const q = (sql: string, p: (string | number)[] = []): number =>
      this.db.get<{ n: number }>(sql, p)?.n ?? 0
    const base = 'FROM jobs WHERE legacy = 0 AND is_demo = 0'
    return {
      total: q(`SELECT COUNT(*) AS n ${base} AND dismissed = 0`),
      newJobs: q(`SELECT COUNT(*) AS n ${base} AND dismissed = 0 AND discovered_at >= ?`, [
        sinceIso
      ]),
      verified: q(
        `SELECT COUNT(*) AS n ${base} AND dismissed = 0 AND verification_status IN ('SOURCE_CONFIRMED','EMPLOYER_CONFIRMED')`
      ),
      strong: q(`SELECT COUNT(*) AS n ${base} AND dismissed = 0 AND match_score >= ?`, [
        strongThreshold
      ]),
      saved: q(`SELECT COUNT(*) AS n ${base} AND saved = 1`)
    }
  }
}
