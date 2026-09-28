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
import { evaluateGeo, toKm } from '../geo/geoService'
import type { HttpClient } from '../adapters/http'
import { CancelledError, RateLimitedError } from '../adapters/http'
import type { JobProvider, ProviderQuery, RawRecord } from '../providers/types'
import { missingCredentials } from '../providers/types'
import { buildIntent } from '../search/intent'
import { computeRelevance, RELEVANCE_THRESHOLD, normalizeTitle } from '../search/classify'
import { OCCUPATION_BY_ID } from '../search/taxonomy'
import { normalizeDraft } from '../normalization/normalize'
import { annualize } from '../normalization/salary'
import { dedupeJobs, normalizeCompany } from '../deduplication/dedupe'
import type { MatchingService } from '../../matching/matchingService'
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

const SENIOR_LEVELS = new Set(['senior', 'lead', 'manager', 'director', 'executive'])

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
      matching: MatchingService
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
        detail = `Last successful fetch ${new Date(health.lastSuccessAt).toLocaleString()}`
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
    const key = stableHash({ criteria, searchId: opts.searchId ?? null })
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
      // ---- 1. interpret -----------------------------------------------------
      emit({ phase: 'interpreting', message: 'Interpreting your search…' })
      const profile = store.candidate.get()
      const intent: SearchIntent = buildIntent(criteria, {
        location: profile.preferences.location || profile.location.value || undefined,
        radius: profile.preferences.radius,
        radiusUnit: profile.preferences.radiusUnit
      })

      // ---- 2. location -------------------------------------------------------
      if (intent.locationText) {
        emit({ phase: 'resolving_location', message: `Locating “${intent.locationText}”…` })
        const place = await geo.resolveSearchLocation(intent.locationText, signal)
        if (place.precision === 'none') {
          intent.notes.push(
            `Could not recognise the location “${intent.locationText}”. Results cannot be filtered by distance.`
          )
        } else intent.location = place
      }
      const country = criteria.country ?? intent.location?.country
      if (
        criteria.country &&
        intent.location?.country &&
        criteria.country !== intent.location.country
      ) {
        intent.notes.push(
          `Location “${intent.location.label}” is not in the selected country ${criteria.country}; the location wins.`
        )
      }

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

      // ---- 5. filter ------------------------------------------------------------
      const minAnnual = intent.minimumSalary
        ? annualize(intent.minimumSalary, intent.salaryPeriod)
        : undefined
      const excludedCompanies = intent.excludedCompanies.map(normalizeCompany)
      const kept: (NormalizedJob & { geo: ScoredJob['geo']; relevance: ScoredJob['relevance'] })[] =
        []
      const cutoff = intent.postedWithinDays
        ? Date.now() - intent.postedWithinDays * 86400_000
        : undefined
      for (const job of normalized) {
        if (job.verificationStatus === 'EXPIRED') {
          exclude('expired')
          continue
        }
        const rel = computeRelevance(job, intent)
        if (
          rel.score === 0 &&
          job.occupation &&
          intent.excludedOccupations.includes(job.occupation.id)
        ) {
          exclude('excluded_occupation')
          continue
        }
        if (rel.score < RELEVANCE_THRESHOLD) {
          exclude('irrelevant_occupation')
          continue
        }
        if (
          intent.excludedKeywords.some(
            (k) => k && job.title.toLowerCase().includes(k.toLowerCase())
          )
        ) {
          exclude('excluded_keyword')
          continue
        }
        if (excludedCompanies.includes(normalizeCompany(job.company))) {
          exclude('excluded_company')
          continue
        }
        const g = evaluateGeo(job, intent)
        if (!g.include) {
          exclude(g.exclusion ?? 'unknown_location')
          continue
        }
        if (
          intent.employmentTypes.length &&
          job.employmentTypes.length &&
          !job.employmentTypes.some((t) => intent.employmentTypes.includes(t))
        ) {
          exclude('employment_type')
          continue
        }
        if (
          intent.seniority.length &&
          job.seniority &&
          intent.seniority.every((s) => s === 'entry' || s === 'junior') &&
          SENIOR_LEVELS.has(job.seniority)
        ) {
          exclude('seniority')
          continue
        }
        if (
          minAnnual &&
          job.salary &&
          (job.salary.max ?? job.salary.min) &&
          (!intent.currency || !job.salary.currency || job.salary.currency === intent.currency)
        ) {
          const top = annualize((job.salary.max ?? job.salary.min)!, job.salary.period)
          if (top !== undefined && top < minAnnual) {
            exclude('salary_below_minimum')
            continue
          }
        }
        if (cutoff && job.postedAt && Date.parse(job.postedAt) < cutoff) {
          exclude('too_old')
          continue
        }
        kept.push({
          ...job,
          geo: { eligibility: g.eligibility, distance: g.distance, unit: g.unit, note: g.note },
          relevance: rel
        })
      }

      // ---- 6. dedupe --------------------------------------------------------------
      emit({ phase: 'deduplicating', message: 'Removing duplicates…' })
      const geoById = new Map(kept.map((k) => [k.id, { geo: k.geo, relevance: k.relevance }]))
      const { jobs: unique, merged } = dedupeJobs(kept)
      stats.duplicatesMerged = merged
      // Keep ids stable across runs: reuse the id already stored for any of the job's source records.
      const withIds = unique.map((j) => {
        // The merged representative is always one of the kept records, so its id is in the map.
        const ctx = geoById.get(j.id) ?? {
          geo: { eligibility: 'unknown' as const },
          relevance: { score: RELEVANCE_THRESHOLD, basis: '' }
        }
        let id = j.id
        for (const s of j.sources) {
          const existing = store.jobs.findJobIdBySourceRecord(s.providerId, s.sourceJobId)
          if (existing) {
            id = existing
            break
          }
        }
        return { ...j, id, geo: ctx.geo, relevance: ctx.relevance }
      })

      // ---- 7. match ------------------------------------------------------------------
      emit({ phase: 'matching', message: 'Matching your qualifications…' })
      const matches = await this.deps.matching.scoreAll(withIds, signal)

      // ---- 8. persist --------------------------------------------------------------
      emit({ phase: 'saving', message: 'Saving results…' })
      const scored: ScoredJob[] = withIds.map((j) => ({
        ...j,
        match: matches.get(j.id) ?? undefined,
        state: { saved: false, dismissed: false }
      }))
      const { inserted } = store.jobs.upsertMany(scored)
      stats.newJobs = inserted.length
      const insertedSet = new Set(inserted)
      const persisted = store.jobs
        .list({ ids: scored.map((s) => s.id), view: 'all', limit: 2000, includeDemo: true })
        .concat(
          store.jobs.list({
            ids: scored.map((s) => s.id),
            view: 'dismissed',
            limit: 2000,
            includeDemo: true
          })
        )
      const byId = new Map(persisted.map((p) => [p.id, p]))
      const final = scored
        .map((s) => ({ ...(byId.get(s.id) ?? s), isNew: insertedSet.has(s.id) }))
        .sort(
          (a, b) =>
            (b.match?.score ?? -1) - (a.match?.score ?? -1) || b.relevance.score - a.relevance.score
        )
      stats.returned = final.filter((f) => !f.state.dismissed).length

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
          jobIds: final.map((f) => f.id),
          startedAt,
          finishedAt
        })
      }
      emit({
        phase: 'done',
        message: `Found ${stats.returned} matching job${stats.returned === 1 ? '' : 's'} (${stats.newJobs} new).`
      })
      return { runId, intent, stats, jobs: final, cancelled: false, startedAt, finishedAt }
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
