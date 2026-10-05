import type {
  ApplicationState,
  ExclusionReason,
  GeoEligibility,
  JobCounters,
  JobEligibility,
  JobSourceRecord,
  MatchResult,
  NormalizedJob,
  ScoredJob,
  VerificationStatus
} from '../../../shared/types'
import type { AppDb } from './database'
import { json } from './database'
import { TrackingRepo } from './trackingRepo'
import { mergeApplyOptions } from '../jobs/normalization/applyOptions'

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
  elig: string | null
  t_status: string | null
  t_notes: string | null
  t_applied_at: string | null
  t_follow_up_at: string | null
  t_contact: string | null
  t_history: string | null
  t_updated_at: string | null
  app_id: string | null
  app_state: string | null
}

export type JobView =
  'all' | 'eligible' | 'review' | 'excluded' | 'archive' | 'saved' | 'dismissed' | 'new' | 'applied'

export interface JobEvaluation {
  id: string
  eligibility: JobEligibility
  match?: MatchResult
  geo: ScoredJob['geo']
  relevance: ScoredJob['relevance']
}

export interface JobListFilter {
  /**
   * eligible/review/excluded: evaluated against the active criteria.
   * archive: every stored job, regardless of criteria.
   * new: eligible jobs first seen in `runId` (or since `since`).
   */
  view?: JobView
  runId?: string
  reason?: ExclusionReason
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
         j.verification_status, j.elig,
         (SELECT a.id FROM applications a WHERE a.job_id = j.id ORDER BY a.created_at DESC LIMIT 1) AS app_id,
         (SELECT a.state FROM applications a WHERE a.job_id = j.id ORDER BY a.created_at DESC LIMIT 1) AS app_state,
         t.status AS t_status, t.notes AS t_notes, t.applied_at AS t_applied_at, t.follow_up_at AS t_follow_up_at,
         t.contact AS t_contact, t.history AS t_history, t.updated_at AS t_updated_at
  FROM jobs j LEFT JOIN job_tracking t ON t.job_id = j.id`

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
      eligibility: json<JobEligibility | undefined>(row.elig, undefined),
      state: {
        saved: !!row.saved,
        dismissed: !!row.dismissed,
        tracking: row.t_status
          ? TrackingRepo.fromRow({
              status: row.t_status,
              notes: row.t_notes ?? '',
              applied_at: row.t_applied_at,
              follow_up_at: row.t_follow_up_at,
              contact: row.t_contact,
              history: row.t_history ?? '[]',
              updated_at: row.t_updated_at ?? ''
            })
          : undefined,
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
        const { match, relevance, geo, eligibility, state: _state, isNew: _isNew, ...base } = job
        void _state
        void _isNew
        const elig = eligibility ? JSON.stringify(eligibility) : null
        let data: NormalizedJob = base
        if (existing) {
          const prev = json<NormalizedJob>(existing.data, base)
          data = {
            ...base,
            discoveredAt: existing.discovered_at,
            sources: mergeSources(prev.sources ?? [], base.sources),
            applyOptions: mergeApplyOptions(base.applyOptions, prev.applyOptions)
          }
          this.db.run(
            `UPDATE jobs SET canonical_key = ?, data = ?, title = ?, company = ?, source = ?, posted_at = ?,
               last_seen_at = ?, verification_status = ?, occupation_id = ?, match_score = ?, match = ?,
               relevance = ?, geo = ?, is_demo = ?, elig_status = ?, elig_reason = ?, elig = ?, elig_key = ?
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
              eligibility?.status ?? null,
              eligibility?.exclusionReasons[0] ?? null,
              elig,
              eligibility?.criteriaKey ?? null,
              job.id
            ]
          )
          outcome.updated.push(job.id)
        } else {
          this.db.run(
            `INSERT INTO jobs (id, canonical_key, data, title, company, source, posted_at, discovered_at, last_seen_at,
               verification_status, occupation_id, match_score, match, relevance, geo, is_demo,
               elig_status, elig_reason, elig, elig_key)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
              data.isDemo ? 1 : 0,
              eligibility?.status ?? null,
              eligibility?.exclusionReasons[0] ?? null,
              elig,
              eligibility?.criteriaKey ?? null
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
      case 'eligible':
      case 'review':
      case 'excluded':
        where.push('j.dismissed = 0', 'j.elig_status = ?')
        params.push(filter.view)
        break
      case 'new':
        where.push('j.dismissed = 0', "j.elig_status = 'eligible'")
        if (filter.runId) {
          where.push(
            'EXISTS (SELECT 1 FROM search_run_jobs r WHERE r.job_id = j.id AND r.run_id = ? AND r.is_new = 1)'
          )
          params.push(filter.runId)
        } else if (filter.since) {
          where.push('j.discovered_at >= ?')
          params.push(filter.since)
        }
        break
      case 'archive':
        break
      default:
        where.push('j.dismissed = 0')
    }
    if (filter.runId && filter.view !== 'new') {
      where.push('EXISTS (SELECT 1 FROM search_run_jobs r WHERE r.job_id = j.id AND r.run_id = ?)')
      params.push(filter.runId)
    }
    if (filter.reason) {
      where.push('j.elig_reason = ?')
      params.push(filter.reason)
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
    const limit = Math.min(filter.limit ?? 500, 5000)
    const offset = filter.offset ?? 0
    const order =
      filter.view === 'archive'
        ? 'j.last_seen_at DESC'
        : 'COALESCE(j.match_score, -1) DESC, j.last_seen_at DESC'
    const rows = this.db.all<JobRow>(
      `${SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    )
    return rows.map((r) => this.hydrate(r))
  }

  /**
   * One-off repair for jobs stored by earlier versions whose description still
   * contains markup. Returns the number of repaired rows.
   */
  repairDescriptions(clean: (text: string) => string, isDirty: (text: string) => boolean): number {
    const rows = this.db.all<{ id: string; data: string }>(
      "SELECT id, data FROM jobs WHERE data LIKE '%<%' OR data LIKE '%&lt;%' OR data LIKE '%&amp;%'"
    )
    let n = 0
    this.db.transaction(() => {
      for (const r of rows) {
        const job = json<NormalizedJob | null>(r.data, null)
        if (!job?.description || !isDirty(job.description)) continue
        job.description = clean(job.description)
        this.db.run('UPDATE jobs SET data = ? WHERE id = ?', [JSON.stringify(job), r.id])
        n++
      }
    })
    return n
  }

  /** All stored (non-legacy) jobs, for re-evaluation against new criteria. */
  forEvaluation(): NormalizedJob[] {
    return this.db
      .all<{
        data: string
        verification_status: string
        discovered_at: string
        last_seen_at: string
      }>('SELECT data, verification_status, discovered_at, last_seen_at FROM jobs WHERE legacy = 0')
      .map((r) => {
        const job = json<NormalizedJob>(r.data, {} as NormalizedJob)
        job.verificationStatus = r.verification_status as VerificationStatus
        job.discoveredAt = r.discovered_at
        job.lastSeenAt = r.last_seen_at
        return job
      })
  }

  /** Writes eligibility and scores computed against the active criteria (one transaction). */
  setEvaluations(evals: JobEvaluation[]): void {
    this.db.transaction(() => {
      for (const e of evals) {
        this.db.run(
          `UPDATE jobs SET elig_status = ?, elig_reason = ?, elig = ?, elig_key = ?, match_score = ?, match = ?,
             geo = ?, relevance = ? WHERE id = ?`,
          [
            e.eligibility.status,
            e.eligibility.exclusionReasons[0] ?? null,
            JSON.stringify(e.eligibility),
            e.eligibility.criteriaKey,
            e.match?.score ?? null,
            e.match ? JSON.stringify(e.match) : null,
            JSON.stringify(e.geo),
            JSON.stringify(e.relevance),
            e.id
          ]
        )
      }
    })
  }

  /** Records which jobs a search run returned (and which were first seen in it). */
  recordRun(runId: string, ids: string[], inserted: Set<string>): void {
    this.db.transaction(() => {
      for (const id of ids) {
        this.db.run(
          'INSERT OR IGNORE INTO search_run_jobs (run_id, job_id, is_new) VALUES (?, ?, ?)',
          [runId, id, inserted.has(id) ? 1 : 0]
        )
        this.db.run('UPDATE jobs SET last_run_id = ? WHERE id = ?', [runId, id])
      }
    })
  }

  /** Jobs whose stored evaluation was made against different criteria. */
  staleEvaluationCount(key: string): number {
    return (
      this.db.get<{ n: number }>(
        'SELECT COUNT(*) AS n FROM jobs WHERE legacy = 0 AND (elig_key IS NULL OR elig_key != ?)',
        [key]
      )?.n ?? 0
    )
  }

  counters(opts: {
    criteriaKey: string
    criteriaLabel: string
    includeDemo: boolean
    lastRun?: JobCounters['lastRun']
  }): JobCounters {
    const base = `FROM jobs WHERE legacy = 0${opts.includeDemo ? '' : ' AND is_demo = 0'}`
    const q = (sql: string, p: (string | number)[] = []): number =>
      this.db.get<{ n: number }>(`SELECT COUNT(*) AS n ${base} ${sql}`, p)?.n ?? 0
    const reasonCount = (reasons: string[]): number =>
      q(
        `AND dismissed = 0 AND elig_status = 'excluded' AND elig_reason IN (${reasons.map(() => '?').join(',')})`,
        reasons
      )
    const excluded = q(`AND dismissed = 0 AND elig_status = 'excluded'`)
    const location = reasonCount(['outside_radius', 'outside_country', 'remote_ineligible'])
    const occupation = reasonCount(['irrelevant_occupation', 'excluded_occupation'])
    const workMode = reasonCount(['remote_not_requested', 'onsite_not_requested', 'work_mode'])
    const belowScore = reasonCount(['below_minimum_score'])
    const expired = reasonCount(['expired'])
    const eligibleNew = opts.lastRun
      ? (this.db.get<{ n: number }>(
          `SELECT COUNT(*) AS n FROM jobs j JOIN search_run_jobs r ON r.job_id = j.id
           WHERE r.run_id = ? AND r.is_new = 1 AND j.elig_status = 'eligible' AND j.dismissed = 0`,
          [opts.lastRun.runId]
        )?.n ?? 0)
      : 0
    return {
      criteriaKey: opts.criteriaKey,
      criteriaLabel: opts.criteriaLabel,
      lastRun: opts.lastRun,
      historical: q(''),
      eligible: q(`AND dismissed = 0 AND elig_status = 'eligible'`),
      eligibleNew,
      review: q(`AND dismissed = 0 AND elig_status = 'review'`),
      excluded,
      excludedBy: {
        location,
        occupation,
        workMode,
        belowScore,
        expired,
        other: excluded - location - occupation - workMode - belowScore - expired
      },
      unverified: q(
        `AND dismissed = 0 AND elig_status = 'eligible' AND verification_status IN ('UNVERIFIED','STALE','VERIFICATION_FAILED')`
      ),
      saved: q('AND saved = 1'),
      dismissed: q('AND dismissed = 1')
    }
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
    const {
      match: _m,
      relevance: _r,
      geo: _g,
      state: _s,
      isNew: _n,
      eligibility: _e,
      ...base
    } = job
    void _e
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
    // Every figure counts jobs that currently meet the active criteria.
    const base =
      "FROM jobs WHERE legacy = 0 AND is_demo = 0 AND dismissed = 0 AND elig_status = 'eligible'"
    return {
      total: q(`SELECT COUNT(*) AS n ${base}`),
      newJobs: q(`SELECT COUNT(*) AS n ${base} AND discovered_at >= ?`, [sinceIso]),
      verified: q(
        `SELECT COUNT(*) AS n ${base} AND verification_status IN ('SOURCE_CONFIRMED','EMPLOYER_CONFIRMED')`
      ),
      strong: q(`SELECT COUNT(*) AS n ${base} AND match_score >= ?`, [strongThreshold]),
      saved: q('SELECT COUNT(*) AS n FROM jobs WHERE legacy = 0 AND is_demo = 0 AND saved = 1')
    }
  }
}
