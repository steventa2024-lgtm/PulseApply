import type { JobCounters, NormalizedJob, SearchCriteria, SearchStats } from '../../../shared/types'
import type { Store } from '../persistence/store'
import type { JobEvaluation } from '../persistence/jobsRepo'
import type { GeoService } from '../jobs/geo/geoService'
import type { MatchingService } from '../matching/matchingService'
import { type CriteriaContext, criteriaKey, normalizeCriteria, resolveCriteria } from './criteria'
import { applyMinimumScore, evaluateJobEligibility } from './evaluate'
import { log } from '../logger'

const ACTIVE_KEY = 'active_criteria'
const LEGACY_LAST_SEARCH_KEY = 'last_search'

export interface EvaluatedJob extends JobEvaluation {
  job: NormalizedJob
}

/**
 * Owns the active search criteria (persisted, survives restarts) and keeps
 * every stored job's eligibility and score in sync with them. Results,
 * dashboard counters, the scheduler and Telegram all read the same numbers.
 */
export class CriteriaService {
  private cache: { key: string; ctx: Promise<CriteriaContext> } | null = null
  private recalcChain: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly deps: {
      store: Store
      geo: GeoService
      matching: MatchingService
      onChanged?: () => void
    }
  ) {}

  /** The saved criteria; falls back to the last manual search, then to the profile's preferences. */
  getActive(): SearchCriteria {
    const saved = this.deps.store.settings.getRaw<SearchCriteria | null>(ACTIVE_KEY, null)
    if (saved) return normalizeCriteria(saved)
    const last = this.deps.store.settings.getRaw<{ criteria?: SearchCriteria } | null>(
      LEGACY_LAST_SEARCH_KEY,
      null
    )
    if (last?.criteria) return normalizeCriteria(last.criteria)
    const p = this.deps.store.candidate.get().preferences
    return normalizeCriteria({
      query: p.targetRoles[0] ?? '',
      location: p.location,
      radius: p.radius,
      radiusUnit: p.radiusUnit,
      workModes: p.workModes,
      employmentTypes: p.employmentTypes
    })
  }

  hasActive(): boolean {
    return !!this.deps.store.settings.getRaw<SearchCriteria | null>(ACTIVE_KEY, null)
  }

  activeKey(): string {
    return criteriaKey(this.getActive())
  }

  /** Resolves (and caches) the evaluation context for some criteria. */
  context(
    criteria: SearchCriteria = this.getActive(),
    signal?: AbortSignal
  ): Promise<CriteriaContext> {
    const key = criteriaKey(criteria)
    if (this.cache?.key === key) return this.cache.ctx
    const ctx = resolveCriteria(criteria, {
      geo: this.deps.geo,
      profile: this.deps.store.candidate.get(),
      signal,
      online: this.deps.store.settings.get().onlineGeocoding
    })
    this.cache = { key, ctx }
    ctx.catch(() => {
      if (this.cache?.key === key) this.cache = null
    })
    return ctx
  }

  /**
   * Persists new active criteria and immediately re-evaluates every stored
   * job, so the Results page and counters change without a new search.
   */
  async setActive(
    criteria: SearchCriteria
  ): Promise<{ criteria: SearchCriteria; counters: JobCounters }> {
    const c = normalizeCriteria(criteria)
    const changed = criteriaKey(c) !== this.activeKey() || !this.hasActive()
    this.deps.store.settings.setRaw(ACTIVE_KEY, c)
    if (changed || this.deps.store.jobs.staleEvaluationCount(criteriaKey(c)) > 0)
      await this.recalculate()
    return { criteria: c, counters: await this.counters() }
  }

  /** Invalidates cached location/profile-dependent state (e.g. after a profile change). */
  invalidate(): void {
    this.cache = null
  }

  /** Evaluates and scores jobs against some criteria (pure with respect to the database). */
  async evaluate(
    jobs: NormalizedJob[],
    ctx: CriteriaContext,
    signal?: AbortSignal
  ): Promise<EvaluatedJob[]> {
    const first = jobs.map((job) => ({ job, ...evaluateJobEligibility(job, ctx) }))
    // Only jobs that passed the hard filters are scored.
    const scorable = first.filter((e) => e.eligibility.status !== 'excluded')
    const scores = await this.deps.matching.scoreEligible(
      scorable.map((e) => ({ job: e.job, geo: e.geo })),
      ctx,
      signal
    )
    return first.map((e) => {
      const match = e.eligibility.status === 'excluded' ? undefined : scores.get(e.job.id)
      return {
        id: e.job.id,
        job: e.job,
        geo: e.geo,
        relevance: e.relevance,
        match,
        eligibility: applyMinimumScore(e.eligibility, match?.score, ctx.criteria.minimumMatchScore)
      }
    })
  }

  /** Re-evaluates every stored job against the active criteria. Serialized. */
  recalculate(signal?: AbortSignal): Promise<number> {
    const run = async (): Promise<number> => {
      const t0 = Date.now()
      const ctx = await this.context(this.getActive(), signal)
      const jobs = this.deps.store.jobs.forEvaluation()
      const evals = await this.evaluate(jobs, ctx, signal)
      this.deps.store.jobs.setEvaluations(evals)
      log.info('criteria', `Re-evaluated ${evals.length} stored jobs in ${Date.now() - t0} ms`)
      this.deps.onChanged?.()
      return evals.length
    }
    const p = this.recalcChain.then(run, run)
    this.recalcChain = p.catch(() => undefined)
    return p
  }

  /** Re-scores after the candidate profile changed (e.g. a new master resume). */
  async profileChanged(): Promise<number> {
    this.invalidate()
    return this.recalculate()
  }

  async counters(): Promise<JobCounters> {
    const { store } = this.deps
    const ctx = await this.context().catch(() => undefined)
    const run = store.searches.recentRuns(20).find((r) => r.trigger === 'manual')
    const stats = run?.stats as SearchStats | undefined
    return store.jobs.counters({
      criteriaKey: this.activeKey(),
      criteriaLabel: ctx?.label ?? (this.getActive().query || 'No criteria yet'),
      includeDemo: store.settings.get().demoMode,
      lastRun: run
        ? {
            runId: run.id,
            finishedAt: run.finishedAt,
            fetched: stats?.fetched ?? 0,
            newJobs: stats?.newJobs ?? 0,
            status: run.status
          }
        : undefined
    })
  }
}
