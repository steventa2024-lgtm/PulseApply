import { createHash } from 'crypto'
import type {
  ExclusionReason,
  NormalizedJob,
  ProviderInfo,
  ProviderRunReport,
  ScoredJob,
  SearchCriteria,
  SearchIntent,
  SearchProgress,
  SearchRunResult,
  SearchStats
} from '../../../../shared/types'
import type { Store } from '../../persistence/store'
import { ProvidersRepo } from '../../persistence/providersRepo'
import type { GeoService } from '../geo/geoService'
import { toKm } from '../geo/geoService'
import type { HttpClient } from '../adapters/http'
import { CancelledError, RateLimitedError } from '../adapters/http'
import type { JobProvider, ProviderQuery, RawRecord } from '../providers/types'
import { missingCredentials } from '../providers/types'
import { buildIntent } from '../search/intent'
import { normalizeTitle } from '../search/classify'
import { OCCUPATION_BY_ID } from '../search/taxonomy'
import { normalizeDraft } from '../normalization/normalize'
import { dedupeJobs } from '../deduplication/dedupe'
import type { CriteriaService, EvaluatedJob } from '../../eligibility/criteriaService'
import { criteriaKey } from '../../eligibility/criteria'
import { manualSearchUrl } from '../providers/restricted'
import { log } from '../../logger'

const PROVIDER_CONCURRENCY = 4
const LAST_SEARCH_KEY = 'last_search'

export interface SearchOptions {
  trigger: 'manual' | 'scheduled' | 'telegram'
  searchId?: string
  onProgress?: (p: SearchProgress) => void
  signal?: AbortSignal
}

interface ProviderOutcome {
  provider: JobProvider
  records: RawRecord[]
  report: ProviderRunReport
}

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24)
}

/**
 * Runs a job search across all eligible providers.
 *
 * Fault tolerance: every provider runs independently (settled, never
 * rejected); a failing, slow, rate-limited or misconfigured provider is
 * reported in the stats but never stops the others.
 */
export class SearchService {
  private readonly running = new Map<string, AbortController>()
  private readonly inflight = new Map<string, Promise<SearchRunResult>>()

  constructor(
    private readonly deps: {
      store: Store
      geo: GeoService
      http: HttpClient
      providers: JobProvider[]
      criteria: CriteriaService
    }
  ) {
    for (const p of deps.providers)
      for (const h of p.hosts) deps.http.setHostInterval(h, p.rateLimit.minIntervalMs)
  }

  private secret = (key: string): string | undefined => this.deps.store.secrets.get(key)

  providerInfos(): ProviderInfo[] {
    const { store } = this.deps
    return this.deps.providers.map((p) => {
      const enabled = store.providers.isEnabled(p.id, p.defaultEnabled)
      const health = store.providers.health(p.id)
      const missing = missingCredentials(p, this.secret)
      const employerCount =
        p.kind === 'ats' || p.kind === 'employer_site'
          ? store.employers.list(p.id === 'careerpages' ? 'jsonld' : (p.id as never)).length
          : 0
      let status: ProviderInfo['status']
      let detail: string
      if (p.manualOnly) {
        status = 'MANUAL'
        detail = 'No authorized API access — use “Open search” to browse manually.'
      } else if (!enabled) {
        status = 'DISABLED'
        detail = 'Disabled by you.'
      } else if (missing.length) {
        status = 'REQUIRES_CREDENTIALS'
        detail = `Needs: ${missing.join(', ')}`
      } else if (health.rateLimitedUntil && health.rateLimitedUntil > new Date().toISOString()) {
        status = 'LIMITED'
        detail = `Rate-limited until ${new Date(health.rateLimitedUntil).toLocaleTimeString()}`
      } else if ((p.kind === 'ats' || p.kind === 'employer_site') && employerCount === 0) {
        status = 'AVAILABLE'
        detail = 'No employers registered yet — add career pages on the Sources page.'
      } else if (
        health.lastErrorAt &&
        (!health.lastSuccessAt || health.lastErrorAt > health.lastSuccessAt)
      ) {
        status = 'ERROR'
        detail = health.lastError ?? 'Last request failed'
      } else if (health.lastSuccessAt) {
        status = 'CONNECTED'
        detail = 'Responding normally.'
      } else {
        status = 'AVAILABLE'
        detail =
          p.kind === 'discovery' ? 'Ready for employer discovery.' : 'Ready; not queried yet.'
      }
      if (p.kind === 'ats' || p.kind === 'employer_site')
        detail += ` (${employerCount} employer${employerCount === 1 ? '' : 's'})`
      const configured: Record<string, boolean> = {}
      for (const c of p.credentials) configured[c.key] = !!this.secret(c.key)
      return {
        id: p.id,
        name: p.name,
        kind: p.kind,
        description: p.description,
        markets: p.markets,
        status,
        statusDetail: detail,
        enabled,
        credentials: p.credentials,
        credentialsConfigured: configured,
        docsUrl: p.docsUrl,
        signupUrl: p.signupUrl,
        termsNote: p.termsNote,
        rateLimitNote: p.rateLimit.note,
        lastSuccessAt: health.lastSuccessAt,
        lastErrorAt: health.lastErrorAt,
        lastError: health.lastError,
        lastCount: health.lastCount,
        rateLimitedUntil: health.rateLimitedUntil,
        manualSearchUrlTemplate: p.manualSearchUrlTemplate
      }
    })
  }

  manualLinks(criteria: SearchCriteria): { providerId: string; name: string; url: string }[] {
    const intent = buildIntent(criteria)
    const loc = criteria.location ?? intent.locationText ?? ''
    return this.deps.providers
      .filter((p) => p.manualOnly)
      .map((p) => ({
        providerId: p.id,
        name: p.name,
        url: manualSearchUrl(p, intent.keywords[0] ?? criteria.query, loc, criteria.country) ?? ''
      }))
      .filter((l) => l.url)
  }

  cancel(runId: string): boolean {
    const c = this.running.get(runId)
    if (!c) return false
    c.abort()
    return true
  }

  cancelAll(): void {
    for (const c of this.running.values()) c.abort()
  }

  isRunning(): boolean {
    return this.running.size > 0
  }

  /** Identical concurrent searches share one run (duplicate request suppression). */
  run(criteria: SearchCriteria, opts: SearchOptions): Promise<SearchRunResult> {
    const key = stableHash({
      criteria: criteriaKey(criteria),
      p: criteria.providerIds ?? [],
      searchId: opts.searchId ?? null
    })
    const existing = this.inflight.get(key)
    if (existing) return existing
    const p = this.execute(criteria, opts).finally(() => this.inflight.delete(key))
    this.inflight.set(key, p)
    return p
  }

  private async execute(criteria: SearchCriteria, opts: SearchOptions): Promise<SearchRunResult> {
    const { store, geo } = this.deps
    const runId = store.searches.startRun(opts.searchId ?? null, opts.trigger)
    const controller = new AbortController()
    this.running.set(runId, controller)
    const signal = opts.signal
      ? AbortSignal.any([opts.signal, controller.signal])
      : controller.signal
    const startedAt = new Date().toISOString()
    const emit = (p: Omit<SearchProgress, 'runId'>): void | undefined =>
      opts.onProgress?.({ runId, ...p })
    const stats: SearchStats = {
      providers: [],
      fetched: 0,
      normalized: 0,
      rejectedMalformed: 0,
      excluded: {},
      duplicatesMerged: 0,
      returned: 0,
      newJobs: 0
    }
    const exclude = (r: ExclusionReason): number =>
      (stats.excluded[r] = (stats.excluded[r] ?? 0) + 1)

    try {
      // ---- 1. interpret + 2. resolve location --------------------------------
      emit({ phase: 'interpreting', message: 'Interpreting your search…' })
      if (criteria.location)
        emit({ phase: 'resolving_location', message: `Locating “${criteria.location}”…` })
      const runCtx = await this.deps.criteria.context(criteria, signal)
      const intent: SearchIntent = runCtx.intent
      const country = runCtx.criteria.country ?? intent.location?.country

      const query: ProviderQuery = {
        intent,
        keywords: intent.keywords[0] ?? '',
        alternateKeywords: intent.occupationSynonyms
          .filter((s) => normalizeTitle(s) !== normalizeTitle(intent.keywords[0] ?? ''))
          .slice(0, 2),
        location: intent.location,
        radiusKm: intent.radius ? toKm(intent.radius, intent.radiusUnit) : undefined,
        country: intent.location?.country ?? country,
        wantsRemote: intent.workModes.includes('remote'),
        wantsOnsite: intent.workModes.includes('onsite') || intent.workModes.includes('hybrid'),
        postedWithinDays: intent.postedWithinDays,
        maxResults: 150
      }

      // ---- 3. providers --------------------------------------------------------
      const selected: JobProvider[] = []
      for (const p of this.deps.providers) {
        if (p.manualOnly || p.kind === 'discovery') continue
        if (criteria.providerIds?.length && !criteria.providerIds.includes(p.id)) continue
        const report = (status: ProviderRunReport['status'], reason: string): void => {
          stats.providers.push({
            providerId: p.id,
            providerName: p.name,
            status,
            reason,
            fetched: 0,
            normalized: 0,
            rejected: 0,
            durationMs: 0
          })
          emit({
            phase: 'searching_providers',
            message: `${p.name}: ${reason}`,
            provider: { id: p.id, name: p.name, status: 'skipped', error: reason }
          })
        }
        if (!store.providers.isEnabled(p.id, p.defaultEnabled)) {
          report('skipped', 'Disabled')
          continue
        }
        const missing = missingCredentials(p, this.secret)
        if (missing.length) {
          report('skipped', `Requires credentials (${missing.join(', ')})`)
          continue
        }
        const sup = p.supports(query)
        if (!sup.ok) {
          report('skipped', sup.reason ?? 'Not applicable to this search')
          continue
        }
        const limited = store.providers.health(p.id).rateLimitedUntil
        if (limited && limited > new Date().toISOString()) {
          report('skipped', `Rate-limited until ${new Date(limited).toLocaleTimeString()}`)
          continue
        }
        if (
          (p.kind === 'ats' || p.kind === 'employer_site') &&
          store.employers
            .list(p.id === 'careerpages' ? 'jsonld' : (p.id as never))
            .filter((e) => e.status !== 'invalid' && e.status !== 'disabled').length === 0
        ) {
          report('skipped', 'No employers registered')
          continue
        }
        selected.push(p)
      }

      emit({
        phase: 'searching_providers',
        message: `Searching ${selected.length} employment source${selected.length === 1 ? '' : 's'}…`
      })
      const outcomes = await this.runProviders(selected, query, signal, emit)
      stats.providers.push(...outcomes.map((o) => o.report))
      if (signal.aborted) throw new CancelledError()

      // ---- 4. normalize ----------------------------------------------------------
      emit({ phase: 'normalizing', message: 'Normalizing results…' })
      const staleAfterDays = store.settings.get().staleAfterDays * 3
      const normalized: NormalizedJob[] = []
      for (const o of outcomes) {
        stats.fetched += o.records.length
        for (const rec of o.records) {
          let res
          try {
            const draft = o.provider.normalize(rec)
            res = draft
              ? normalizeDraft(draft, {
                  providerId: o.provider.id,
                  providerName: o.provider.name,
                  geo,
                  staleAfterDays
                })
              : { error: 'empty record' }
          } catch (err) {
            res = { error: (err as Error).message }
          }
          if (res.job) {
            normalized.push(res.job)
            o.report.normalized++
          } else {
            o.report.rejected++
            stats.rejectedMalformed++
            log.debug(
              'normalize',
              `${o.provider.id} rejected record ${rec.sourceJobId}: ${res.error}`
            )
          }
        }
      }
      stats.normalized = normalized.length

      // ---- 5. dedupe (before any filtering, so merged sources are complete) -------
      emit({ phase: 'deduplicating', message: 'Removing duplicates…' })
      const { jobs: unique, merged } = dedupeJobs(normalized)
      stats.duplicatesMerged = merged
      // Keep ids stable across runs: reuse the id already stored for any of the job's source records.
      const withIds: NormalizedJob[] = unique.map((j) => {
        for (const src of j.sources) {
          const existing = store.jobs.findJobIdBySourceRecord(src.providerId, src.sourceJobId)
          if (existing) return { ...j, id: existing }
        }
        return j
      })

      // ---- 6. hard filters, then 7. score eligible jobs only ----------------------
      emit({ phase: 'matching', message: 'Checking occupation, location and work mode…' })
      const runEvals = await this.deps.criteria.evaluate(withIds, runCtx, signal)
      // Stored columns always reflect the ACTIVE criteria (a scheduled search may use different ones).
      const activeKey = this.deps.criteria.activeKey()
      const storedEvals: EvaluatedJob[] =
        runCtx.key === activeKey
          ? runEvals
          : await this.deps.criteria.evaluate(
              withIds,
              await this.deps.criteria.context(undefined, signal),
              signal
            )
      for (const e of runEvals) {
        const r = e.eligibility.exclusionReasons[0]
        if (r) exclude(r)
      }
      stats.review = runEvals.filter((e) => e.eligibility.status === 'review').length
      stats.belowMinimumScore = runEvals.filter((e) =>
        e.eligibility.exclusionReasons.includes('below_minimum_score')
      ).length

      // ---- 8. persist ------------------------------------------------------------------
      emit({ phase: 'saving', message: 'Saving results…' })
      const toStore: ScoredJob[] = storedEvals.map((e) => ({
        ...e.job,
        match: e.match,
        geo: e.geo,
        relevance: e.relevance,
        eligibility: e.eligibility,
        state: { saved: false, dismissed: false }
      }))
      const { inserted } = store.jobs.upsertMany(toStore)
      stats.newJobs = inserted.length
      const insertedSet = new Set(inserted)
      store.jobs.recordRun(
        runId,
        toStore.map((j) => j.id),
        insertedSet
      )
      const byId = new Map(
        store.jobs
          .list({ ids: toStore.map((j) => j.id), view: 'archive', limit: 5000, includeDemo: true })
          .map((p) => [p.id, p])
      )
      const present = (e: EvaluatedJob): ScoredJob => ({
        ...(byId.get(e.id) ?? {
          ...e.job,
          state: { saved: false, dismissed: false },
          geo: e.geo,
          relevance: e.relevance
        }),
        // Present the job as evaluated for THIS run's criteria.
        eligibility: e.eligibility,
        match: e.match,
        geo: e.geo,
        relevance: e.relevance,
        isNew: insertedSet.has(e.id)
      })
      const byScore = (a: ScoredJob, b: ScoredJob): number =>
        (b.match?.score ?? -1) - (a.match?.score ?? -1) || b.relevance.score - a.relevance.score
      const final = runEvals
        .filter((e) => e.eligibility.status === 'eligible')
        .map(present)
        .filter((j) => !j.state.dismissed)
        .sort(byScore)
      const review = runEvals
        .filter((e) => e.eligibility.status === 'review')
        .map(present)
        .filter((j) => !j.state.dismissed)
        .sort(byScore)
      stats.returned = final.length

      for (const o of outcomes) {
        if (o.report.status === 'ok' || o.report.status === 'cached')
          store.providers.recordSuccess(o.provider.id, o.report.normalized)
      }
      const finishedAt = new Date().toISOString()
      store.searches.finishRun(runId, 'ok', stats)
      if (opts.trigger === 'manual') {
        store.settings.setRaw(LAST_SEARCH_KEY, {
          runId,
          criteria,
          intent,
          stats,
          criteriaKey: runCtx.key,
          jobIds: final.map((f) => f.id),
          startedAt,
          finishedAt
        })
      }
      emit({
        phase: 'done',
        message: `Found ${stats.returned} matching job${stats.returned === 1 ? '' : 's'} (${stats.newJobs} new).`
      })
      return { runId, intent, stats, jobs: final, review, cancelled: false, startedAt, finishedAt }
    } catch (err) {
      const cancelled = err instanceof CancelledError || signal.aborted
      store.searches.finishRun(
        runId,
        cancelled ? 'cancelled' : 'error',
        stats,
        cancelled ? undefined : (err as Error).message
      )
      emit({
        phase: cancelled ? 'cancelled' : 'error',
        message: cancelled ? 'Search cancelled.' : `Search failed: ${(err as Error).message}`
      })
      if (cancelled) {
        return {
          runId,
          intent: buildIntent(criteria),
          stats,
          jobs: [],
          review: [],
          cancelled: true,
          startedAt,
          finishedAt: new Date().toISOString()
        }
      }
      throw err
    } finally {
      this.running.delete(runId)
    }
  }

  private async runProviders(
    providers: JobProvider[],
    query: ProviderQuery,
    signal: AbortSignal,
    emit: (p: Omit<SearchProgress, 'runId'>) => void
  ): Promise<ProviderOutcome[]> {
    const { store } = this.deps
    const employers = store.employers.list()
    const queue = [...providers]
    const outcomes: ProviderOutcome[] = []

    const worker = async (): Promise<void> => {
      for (;;) {
        const p = queue.shift()
        if (!p) return
        const t0 = Date.now()
        const report: ProviderRunReport = {
          providerId: p.id,
          providerName: p.name,
          status: 'ok',
          fetched: 0,
          normalized: 0,
          rejected: 0,
          durationMs: 0
        }
        const phase =
          p.kind === 'ats' || p.kind === 'employer_site'
            ? 'checking_employer_boards'
            : 'searching_providers'
        emit({
          phase,
          message: `Querying ${p.name}…`,
          provider: { id: p.id, name: p.name, status: 'running' }
        })
        const relevantEmployers = employers.filter((e) =>
          p.id === 'careerpages' ? e.atsProvider === 'jsonld' : e.atsProvider === p.id
        )
        const cacheKey = ProvidersRepo.cacheKey(p.id, {
          k: query.keywords,
          a: query.alternateKeywords,
          l: query.location?.label,
          r: query.radiusKm,
          c: query.country,
          rm: query.wantsRemote,
          os: query.wantsOnsite,
          d: query.postedWithinDays,
          e: relevantEmployers.map((e) => e.boardId).sort()
        })
        let records: RawRecord[] = []
        try {
          const cached = store.providers.cacheGet<RawRecord[]>(cacheKey)
          if (cached) {
            records = cached
            report.status = 'cached'
          } else {
            const timeout = AbortSignal.timeout(Math.max(p.timeoutMs * 3, 30_000))
            records = await p.fetch(query, {
              http: this.deps.http,
              secret: this.secret,
              config: store.providers.getConfig(p.id, {}),
              employers: relevantEmployers,
              signal: AbortSignal.any([signal, timeout]),
              contactEmail: store.settings.get().contactEmailForApis,
              onEmployerSynced: (id, status, detail, count) =>
                store.employers.recordSync(id, status, detail, count)
            })
            store.providers.cacheSet(cacheKey, p.id, records, p.cacheTtlMs)
          }
          report.fetched = records.length
          emit({
            phase,
            message: `${p.name}: ${records.length} listing${records.length === 1 ? '' : 's'}`,
            provider: {
              id: p.id,
              name: p.name,
              status: report.status === 'cached' ? 'cached' : 'ok',
              count: records.length
            }
          })
        } catch (err) {
          if (signal.aborted) {
            report.status = 'cancelled'
          } else {
            report.status = 'error'
            report.reason = err instanceof RateLimitedError ? err.message : (err as Error).message
            const until =
              err instanceof RateLimitedError && err.retryAfterMs
                ? new Date(Date.now() + err.retryAfterMs).toISOString()
                : undefined
            store.providers.recordError(p.id, report.reason, until)
            emit({
              phase,
              message: `${p.name} failed: ${report.reason}`,
              provider: { id: p.id, name: p.name, status: 'error', error: report.reason }
            })
          }
          records = []
        }
        report.durationMs = Date.now() - t0
        outcomes.push({ provider: p, records, report })
      }
    }
    await Promise.allSettled(
      Array.from({ length: Math.min(PROVIDER_CONCURRENCY, providers.length) }, worker)
    )
    return outcomes
  }

  lastSearch():
    | {
        runId: string
        criteria: SearchCriteria
        intent: SearchIntent
        stats: SearchStats
        jobIds: string[]
        finishedAt: string
      }
    | undefined {
    return this.deps.store.settings.getRaw(LAST_SEARCH_KEY, undefined)
  }

  /** Occupations known to the taxonomy (for the search form). */
  static occupations(): { id: string; label: string }[] {
    return [...OCCUPATION_BY_ID.values()]
      .map((o) => ({ id: o.id, label: o.label }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }
}
