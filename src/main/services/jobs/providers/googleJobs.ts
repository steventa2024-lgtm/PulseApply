import { z } from 'zod'
import type { EmploymentType, SalaryPeriod } from '../../../../shared/types'
import type { DraftJob, JobProvider, ProviderQuery, RawRecord } from './types'
import { isoFromString, isoFromUnix, num, str } from './types'
import { CA_PROVINCES, US_STATES, countryName } from '../geo/regions'
import { HttpError } from '../adapters/http'

/**
 * Google for Jobs, through licensed search APIs.
 *
 * Google's job search aggregates postings published on employer career sites,
 * LinkedIn, Indeed, ZipRecruiter, Glassdoor and many other boards. JSearch
 * and SerpApi return those listings — with links to every site the job is
 * posted on — through paid APIs with free tiers. This is how PulseApply covers
 * the big job boards without scraping them.
 */

function where(q: ProviderQuery): string | undefined {
  const l = q.location
  if (!l || l.precision === 'none') return undefined
  return [l.city, l.region, l.city || l.region ? undefined : l.label].filter(Boolean).join(', ')
}

/** Google's long location form, e.g. "Lakewood, California, United States". */
export function googleLocation(q: ProviderQuery): string | undefined {
  const l = q.location
  if (!l || l.precision === 'none') return undefined
  const region =
    l.country === 'US'
      ? (US_STATES.find(([c]) => c === l.region)?.[1] ?? l.region)
      : l.country === 'CA'
        ? (CA_PROVINCES.find(([c]) => c === l.region)?.[2] ?? l.region)
        : l.region
  const country = l.country === 'US' ? 'United States' : countryName(l.country)
  const parts = [l.city, region, country].filter(Boolean)
  return parts.length ? parts.join(', ') : l.label
}

function datePosted(days?: number): string {
  if (!days) return 'all'
  if (days <= 1) return 'today'
  if (days <= 3) return '3days'
  if (days <= 7) return 'week'
  return 'month'
}

function hostLabel(url: string | undefined): string | undefined {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '') : undefined
  } catch {
    return undefined
  }
}

const KNOWN_BOARDS =
  /(^|\.)(linkedin\.com|indeed\.[a-z.]+|glassdoor\.[a-z.]+|ziprecruiter\.com|monster\.com|simplyhired\.com|careerbuilder\.com|snagajob\.com|talent\.com|jooble\.org|google\.com)$/

// ---------------------------------------------------------------------------
// JSearch (OpenWeb Ninja, on RapidAPI) — https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch
// ---------------------------------------------------------------------------

const JSearchJob = z
  .object({
    job_id: z.string().min(1),
    job_title: z.string().min(2),
    employer_name: z.string().min(1),
    employer_website: z.string().nullish(),
    job_publisher: z.string().nullish(),
    job_employment_type: z.string().nullish(),
    job_employment_types: z.array(z.string()).nullish(),
    job_apply_link: z.string().url(),
    job_apply_is_direct: z.boolean().nullish(),
    apply_options: z
      .array(
        z
          .object({
            publisher: z.string().nullish(),
            apply_link: z.string(),
            is_direct: z.boolean().nullish()
          })
          .passthrough()
      )
      .nullish(),
    job_description: z.string().nullish(),
    job_is_remote: z.boolean().nullish(),
    job_posted_at_datetime_utc: z.string().nullish(),
    job_posted_at_timestamp: z.number().nullish(),
    job_offer_expiration_datetime_utc: z.string().nullish(),
    job_location: z.string().nullish(),
    job_city: z.string().nullish(),
    job_state: z.string().nullish(),
    job_country: z.string().nullish(),
    job_latitude: z.number().nullish(),
    job_longitude: z.number().nullish(),
    job_google_link: z.string().nullish(),
    job_min_salary: z.number().nullish(),
    job_max_salary: z.number().nullish(),
    job_salary_period: z.string().nullish(),
    job_salary_currency: z.string().nullish()
  })
  .passthrough()

const JS_TYPE: Record<string, EmploymentType> = {
  FULLTIME: 'full_time',
  PARTTIME: 'part_time',
  CONTRACTOR: 'contract',
  INTERN: 'internship',
  TEMPORARY: 'temporary'
}
const JS_PERIOD: Record<string, SalaryPeriod> = {
  HOUR: 'hour',
  DAY: 'day',
  WEEK: 'week',
  MONTH: 'month',
  YEAR: 'year'
}

export const jsearchProvider: JobProvider = {
  id: 'jsearch',
  name: 'JSearch (Google for Jobs)',
  kind: 'aggregator',
  description:
    'Google for Jobs listings — including jobs posted on LinkedIn, Indeed, Glassdoor, ZipRecruiter and employer sites — with links to each site.',
  markets: 'Worldwide (best in US, UK, CA, AU, IN)',
  docsUrl: 'https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch',
  signupUrl: 'https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch/pricing',
  termsNote:
    'Licensed API (free plan with a monthly request quota). Subscribe to the free plan on RapidAPI and paste your RapidAPI key. Each page of 10 results uses one request.',
  credentials: [
    { key: 'jsearch.apiKey', label: 'RapidAPI key', secret: true, required: true },
    {
      key: 'jsearch.pages',
      label: 'Pages per search (1–5, default 2)',
      secret: false,
      required: false,
      help: 'Each page returns up to 10 jobs and costs one request from your quota.'
    }
  ],
  defaultEnabled: true,
  rateLimit: { minIntervalMs: 1100, note: 'Results cached 6 hours to save quota.' },
  cacheTtlMs: 6 * 60 * 60_000,
  timeoutMs: 30_000,
  hosts: ['jsearch.p.rapidapi.com'],
  supports(q) {
    if (!q.keywords) return { ok: false, reason: 'Needs a job title or keyword' }
    return { ok: true }
  },
  isConfigured: (secret) => !!secret('jsearch.apiKey'),
  async fetch(q, ctx) {
    const loc = where(q)
    const remoteOnly = q.wantsRemote && !q.wantsOnsite
    const pages = Math.max(1, Math.min(5, Number(ctx.secret('jsearch.pages')) || 2))
    const params = new URLSearchParams({
      query: loc && !remoteOnly ? `${q.keywords} in ${loc}` : q.keywords,
      page: '1',
      num_pages: String(pages),
      date_posted: datePosted(q.postedWithinDays)
    })
    if (q.country) params.set('country', q.country.toLowerCase())
    if (remoteOnly) params.set('work_from_home', 'true')
    if (loc && q.radiusKm && !remoteOnly)
      params.set('radius', String(Math.max(1, Math.round(q.radiusKm))))
    const call = (
      p: URLSearchParams
    ): Promise<{ status?: string; data?: unknown[]; message?: string }> =>
      ctx.http.json({
        url: `https://jsearch.p.rapidapi.com/search?${p}`,
        headers: {
          'x-rapidapi-key': ctx.secret('jsearch.apiKey')!,
          'x-rapidapi-host': 'jsearch.p.rapidapi.com'
        },
        signal: ctx.signal,
        timeoutMs: this.timeoutMs
      })
    let data: { status?: string; data?: unknown[]; message?: string }
    try {
      data = await call(params)
    } catch (err) {
      // Some plan/endpoint combinations reject optional filters; retry with the basics.
      if (!(err instanceof HttpError) || ![400, 404, 422].includes(err.status)) throw err
      const basic = new URLSearchParams({
        query: params.get('query')!,
        page: '1',
        num_pages: '1'
      })
      data = await call(basic)
    }
    if (!Array.isArray(data?.data)) throw new Error(data?.message ?? 'Unexpected JSearch response')
    const out: RawRecord[] = []
    for (const j of data.data) {
      const p = JSearchJob.safeParse(j)
      if (p.success) out.push({ sourceJobId: p.data.job_id, payload: p.data })
    }
    return out
  },
  normalize(r) {
    const j = JSearchJob.parse(r.payload)
    const options = j.apply_options ?? []
    const direct = options.find(
      (o) => o.is_direct && !KNOWN_BOARDS.test(hostLabel(o.apply_link) ?? '')
    )
    const listedOn = [
      ...new Set([j.job_publisher, ...options.map((o) => o.publisher)].filter(Boolean))
    ] as string[]
    const types = [j.job_employment_type, ...(j.job_employment_types ?? [])]
      .map(
        (t) =>
          JS_TYPE[
            String(t ?? '')
              .toUpperCase()
              .replace(/[^A-Z]/g, '')
          ]
      )
      .filter(Boolean)
    const loc = [j.job_city, j.job_state, j.job_country].filter(Boolean).join(', ')
    const period = JS_PERIOD[String(j.job_salary_period ?? '').toUpperCase()]
    const draft: DraftJob = {
      sourceJobId: j.job_id,
      sourceUrl: j.job_apply_link,
      applyUrl: direct?.apply_link ?? j.job_apply_link,
      title: j.job_title,
      company: j.employer_name,
      companyWebsite: str(j.employer_website),
      descriptionText: j.job_description ?? '',
      locationText: loc || str(j.job_location) || (j.job_is_remote ? 'Remote' : ''),
      places:
        j.job_city || j.job_state
          ? [
              {
                city: str(j.job_city),
                region: str(j.job_state),
                country:
                  str(j.job_country)?.length === 2 ? j.job_country!.toUpperCase() : undefined,
                coordinates:
                  typeof j.job_latitude === 'number' && typeof j.job_longitude === 'number'
                    ? { lat: j.job_latitude, lon: j.job_longitude }
                    : undefined,
                label: loc
              }
            ]
          : undefined,
      workModes: j.job_is_remote ? ['remote'] : undefined,
      employmentTypes: types.length ? [...new Set(types)] : undefined,
      salary:
        (num(j.job_min_salary) || num(j.job_max_salary)) && period
          ? {
              min: num(j.job_min_salary),
              max: num(j.job_max_salary),
              currency: str(j.job_salary_currency),
              period
            }
          : undefined,
      postedAt:
        isoFromString(j.job_posted_at_datetime_utc) ?? isoFromUnix(j.job_posted_at_timestamp),
      expiresAt: isoFromString(j.job_offer_expiration_datetime_utc),
      employerDirect: false,
      countryHint: str(j.job_country),
      extraNotes: listedOn.length ? [`Listed on: ${listedOn.join(', ')}.`] : []
    }
    return draft
  }
}

// ---------------------------------------------------------------------------
// SerpApi — Google Jobs engine — https://serpapi.com/google-jobs-api
// ---------------------------------------------------------------------------

const SerpJob = z
  .object({
    title: z.string().min(2),
    company_name: z.string().min(1),
    location: z.string().nullish(),
    via: z.string().nullish(),
    description: z.string().nullish(),
    job_id: z.string().min(1),
    share_link: z.string().nullish(),
    detected_extensions: z
      .object({
        posted_at: z.string().nullish(),
        schedule_type: z.string().nullish(),
        work_from_home: z.boolean().nullish(),
        salary: z.string().nullish()
      })
      .passthrough()
      .nullish(),
    apply_options: z.array(z.object({ title: z.string().nullish(), link: z.string() })).nullish()
  })
  .passthrough()

/** "3 days ago" / "21 hours ago" → ISO date (relative to fetch time). */
export function relativeToIso(
  text: string | null | undefined,
  now = Date.now()
): string | undefined {
  const m = /(\d+)\s*(minute|hour|day|week|month)s?\s+ago/i.exec(text ?? '')
  if (!m) return undefined
  const unit = { minute: 60e3, hour: 3600e3, day: 86400e3, week: 7 * 86400e3, month: 30 * 86400e3 }[
    m[2].toLowerCase() as 'minute'
  ]
  return new Date(now - Number(m[1]) * unit).toISOString()
}

export const serpApiJobsProvider: JobProvider = {
  id: 'serpapi',
  name: 'SerpApi (Google Jobs)',
  kind: 'aggregator',
  description:
    'Google Jobs results — the same listings Google shows from LinkedIn, Indeed, Glassdoor, ZipRecruiter and employer sites.',
  markets: 'Worldwide',
  docsUrl: 'https://serpapi.com/google-jobs-api',
  signupUrl: 'https://serpapi.com/users/sign_up',
  termsNote:
    'Licensed API with a free monthly search quota. Each page of ~10 jobs uses one search.',
  credentials: [
    { key: 'serpapi.apiKey', label: 'API key', secret: true, required: true },
    {
      key: 'serpapi.pages',
      label: 'Pages per search (1–5, default 2)',
      secret: false,
      required: false
    }
  ],
  defaultEnabled: true,
  rateLimit: { minIntervalMs: 1100, note: 'Results cached 6 hours to save quota.' },
  cacheTtlMs: 6 * 60 * 60_000,
  timeoutMs: 30_000,
  hosts: ['serpapi.com'],
  supports(q) {
    if (!q.keywords) return { ok: false, reason: 'Needs a job title or keyword' }
    return { ok: true }
  },
  isConfigured: (secret) => !!secret('serpapi.apiKey'),
  async fetch(q, ctx) {
    const loc = googleLocation(q)
    const short = where(q)
    const remoteOnly = q.wantsRemote && !q.wantsOnsite
    const pages = Math.max(1, Math.min(5, Number(ctx.secret('serpapi.pages')) || 2))
    const out: RawRecord[] = []
    let token: string | undefined
    // Google only accepts locations it knows; if it rejects ours, put the place in the query.
    let useLocationParam = !!loc && !remoteOnly
    for (let page = 0; page < pages; page++) {
      const build = (): URLSearchParams => {
        const params = new URLSearchParams({
          engine: 'google_jobs',
          q: remoteOnly
            ? `${q.keywords} remote`
            : !useLocationParam && short
              ? `${q.keywords} near ${short}`
              : q.keywords,
          hl: 'en',
          api_key: ctx.secret('serpapi.apiKey')!
        })
        if (useLocationParam && loc) params.set('location', loc)
        if (q.country) params.set('gl', q.country.toLowerCase())
        if (useLocationParam && q.radiusKm)
          params.set('lrad', String(Math.max(1, Math.round(q.radiusKm))))
        if (token) params.set('next_page_token', token)
        return params
      }
      type SerpResponse = {
        jobs_results?: unknown[]
        error?: string
        serpapi_pagination?: { next_page_token?: string }
      }
      const get = (): Promise<SerpResponse> =>
        ctx.http.json<SerpResponse>({
          url: `https://serpapi.com/search.json?${build()}`,
          signal: ctx.signal,
          timeoutMs: this.timeoutMs
        })
      let data: SerpResponse
      try {
        data = await get()
      } catch (err) {
        if (!(err instanceof HttpError) || err.status !== 400 || !useLocationParam) throw err
        useLocationParam = false
        data = await get()
      }
      if (data?.error && !/hasn't returned any results/i.test(data.error))
        throw new Error(data.error)
      for (const j of data?.jobs_results ?? []) {
        const p = SerpJob.safeParse(j)
        if (p.success)
          out.push({
            sourceJobId: p.data.job_id,
            payload: p.data,
            context: { fetchedAt: Date.now() }
          })
      }
      token = data?.serpapi_pagination?.next_page_token
      if (!token) break
    }
    return out
  },
  normalize(r) {
    const j = SerpJob.parse(r.payload)
    const options = j.apply_options ?? []
    const direct = options.find((o) => !KNOWN_BOARDS.test(hostLabel(o.link) ?? ''))
    const first = options[0]?.link ?? str(j.share_link)
    if (!first) return null
    const ext = j.detected_extensions ?? {}
    const remote = !!ext.work_from_home || /\bremote\b|anywhere/i.test(j.location ?? '')
    const listedOn = options.map((o) => str(o.title)).filter(Boolean) as string[]
    return {
      // Google's job_id is a long opaque token; hash-sized ids keep keys readable.
      sourceJobId: j.job_id.slice(0, 200),
      sourceUrl: first,
      applyUrl: direct?.link ?? first,
      title: j.title,
      company: j.company_name,
      descriptionText: j.description ?? '',
      locationText: str(j.location) ?? (remote ? 'Remote' : ''),
      workModes: remote ? ['remote'] : undefined,
      employmentTypeText: str(ext.schedule_type),
      salaryText: str(ext.salary),
      postedAt: relativeToIso(ext.posted_at, Number(r.context?.fetchedAt) || Date.now()),
      employerDirect: false,
      extraNotes: [
        listedOn.length ? `Listed on: ${listedOn.join(', ')}.` : str(j.via) ? `${j.via}.` : ''
      ].filter(Boolean)
    }
  }
}
