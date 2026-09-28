import { z } from 'zod'
import type { EmploymentType, SalaryPeriod } from '../../../../shared/types'
import type { JobProvider, ProviderQuery, RawRecord } from './types'
import { isoFromString, num, str } from './types'
import { fromKm } from '../geo/geoService'

/**
 * Credentialed aggregators that support keyword + location search in local
 * markets. These are the backbone of local (non-remote) discovery.
 */

function placeQuery(q: ProviderQuery): string | undefined {
  const l = q.location
  if (!l || l.precision === 'none') return undefined
  if (l.city) return [l.city, l.region].filter(Boolean).join(', ')
  if (l.region) return l.region
  return undefined
}

// ---------------------------------------------------------------------------
// Adzuna — https://developer.adzuna.com/
// ---------------------------------------------------------------------------

export const ADZUNA_COUNTRIES = ['gb', 'us', 'at', 'au', 'be', 'br', 'ca', 'ch', 'de', 'es', 'fr', 'in', 'it', 'mx', 'nl', 'nz', 'pl', 'sg', 'za']

const AdzunaJob = z
  .object({
    id: z.union([z.string(), z.number()]),
    title: z.string(),
    description: z.string().optional(),
    created: z.string().optional(),
    redirect_url: z.string(),
    company: z.object({ display_name: z.string().optional() }).passthrough().optional(),
    location: z.object({ display_name: z.string().optional(), area: z.array(z.string()).optional() }).passthrough().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    salary_min: z.number().optional(),
    salary_max: z.number().optional(),
    salary_is_predicted: z.union([z.string(), z.number()]).optional(),
    contract_type: z.string().optional(),
    contract_time: z.string().optional(),
    category: z.object({ label: z.string().optional(), tag: z.string().optional() }).passthrough().optional()
  })
  .passthrough()

const ADZUNA_CURRENCY: Record<string, string> = {
  gb: 'GBP', us: 'USD', at: 'EUR', au: 'AUD', be: 'EUR', br: 'BRL', ca: 'CAD', ch: 'CHF', de: 'EUR', es: 'EUR', fr: 'EUR',
  in: 'INR', it: 'EUR', mx: 'MXN', nl: 'EUR', nz: 'NZD', pl: 'PLN', sg: 'SGD', za: 'ZAR'
}

export const adzunaProvider: JobProvider = {
  id: 'adzuna',
  name: 'Adzuna',
  kind: 'aggregator',
  description: 'Large job search engine aggregating local listings (hourly and salaried) with keyword + location + radius search.',
  markets: 'UK, US, Canada, Australia, New Zealand, Germany, France, Netherlands, Belgium, Austria, Switzerland, Spain, Italy, Poland, Brazil, Mexico, India, Singapore, South Africa',
  docsUrl: 'https://developer.adzuna.com/docs/search',
  signupUrl: 'https://developer.adzuna.com/signup',
  termsNote: 'Requires a free Adzuna developer app id/key. Salaries Adzuna marks as “predicted” are discarded, never shown as advertised pay.',
  credentials: [
    { key: 'adzuna.appId', label: 'Application ID', secret: false, required: true },
    { key: 'adzuna.appKey', label: 'Application key', secret: true, required: true }
  ],
  defaultEnabled: true,
  rateLimit: { minIntervalMs: 1200, note: 'Quota is set by Adzuna for your key; 429 responses pause the provider until the reported reset.' },
  cacheTtlMs: 30 * 60_000,
  timeoutMs: 20_000,
  hosts: ['api.adzuna.com'],
  supports(q) {
    const cc = (q.country ?? '').toLowerCase()
    if (!cc) return { ok: false, reason: 'Adzuna searches are country-specific; set a location or country' }
    if (!ADZUNA_COUNTRIES.includes(cc)) return { ok: false, reason: `Adzuna does not cover ${q.country}` }
    return { ok: true }
  },
  isConfigured: (secret) => !!secret('adzuna.appId') && !!secret('adzuna.appKey'),
  async fetch(q, ctx) {
    const cc = q.country!.toLowerCase()
    const out: RawRecord[] = []
    const perPage = 50
    const queries = [q.keywords, ...q.alternateKeywords].filter(Boolean).slice(0, 3)
    for (const what of queries.length ? queries : ['']) {
      for (let page = 1; page <= Math.ceil(q.maxResults / perPage) && page <= 3; page++) {
        const params = new URLSearchParams({
          app_id: ctx.secret('adzuna.appId')!,
          app_key: ctx.secret('adzuna.appKey')!,
          results_per_page: String(perPage),
          'content-type': 'application/json'
        })
        if (what) params.set('what', what)
        const where = placeQuery(q)
        if (where) params.set('where', where)
        if (where && q.radiusKm) params.set('distance', String(Math.round(q.radiusKm)))
        if (q.postedWithinDays) params.set('max_days_old', String(q.postedWithinDays))
        const data = await ctx.http.json<{ results?: unknown[]; count?: number }>({
          url: `https://api.adzuna.com/v1/api/jobs/${cc}/search/${page}?${params}`,
          signal: ctx.signal,
          timeoutMs: this.timeoutMs
        })
        if (!data || !Array.isArray(data.results)) throw new Error('Unexpected Adzuna response shape')
        for (const r of data.results) {
          const p = AdzunaJob.safeParse(r)
          if (p.success) out.push({ sourceJobId: String(p.data.id), payload: p.data, context: { cc } })
        }
        if (data.results.length < perPage) break
      }
      // Occupational synonyms are only spent (quota) when the primary query is thin.
      if (out.length >= Math.min(q.maxResults, 25)) break
    }
    return out
  },
  normalize(r) {
    const d = AdzunaJob.parse(r.payload)
    const cc = String(r.context?.cc ?? 'us')
    const predicted = String(d.salary_is_predicted ?? '0') === '1'
    const types: EmploymentType[] = []
    if (d.contract_time === 'full_time') types.push('full_time')
    if (d.contract_time === 'part_time') types.push('part_time')
    if (d.contract_type === 'contract') types.push('contract')
    const area = d.location?.area ?? []
    return {
      sourceJobId: String(d.id),
      sourceUrl: d.redirect_url,
      applyUrl: d.redirect_url,
      title: d.title,
      company: d.company?.display_name ?? '',
      descriptionText: d.description,
      locationText: d.location?.display_name ?? area.slice(1).reverse().join(', '),
      places: [
        {
          label: d.location?.display_name,
          city: area[3] ?? area[2],
          region: area[1],
          country: cc.toUpperCase() === 'GB' ? 'GB' : cc.toUpperCase(),
          coordinates: d.latitude !== undefined && d.longitude !== undefined ? { lat: d.latitude, lon: d.longitude } : undefined
        }
      ],
      employmentTypes: types,
      salary: !predicted && (d.salary_min || d.salary_max) ? { min: d.salary_min, max: d.salary_max, currency: ADZUNA_CURRENCY[cc], period: 'year' } : undefined,
      salaryIsEstimate: predicted && !!(d.salary_min || d.salary_max),
      postedAt: isoFromString(d.created),
      tags: d.category?.label ? [d.category.label] : [],
      countryHint: cc.toUpperCase(),
      employerDirect: false,
      extraNotes: ['Adzuna provides a description excerpt; open the listing for full details.']
    }
  }
}

// ---------------------------------------------------------------------------
// Jooble — https://jooble.org/api/about
// ---------------------------------------------------------------------------

const JoobleJob = z
  .object({
    id: z.union([z.string(), z.number()]),
    title: z.string(),
    location: z.string().optional(),
    snippet: z.string().optional(),
    salary: z.string().optional(),
    source: z.string().optional(),
    type: z.string().optional(),
    link: z.string(),
    company: z.string().optional(),
    updated: z.string().optional()
  })
  .passthrough()

/** Parses "gb=KEY, de=KEY2" into a map of regional API keys. */
export function parseRegionalKeys(value: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (value ?? '').split(/[,;\n]/)) {
    const m = /^\s*([a-z]{2})\s*[=:]\s*([A-Za-z0-9-]{8,})\s*$/i.exec(part)
    if (m) out[m[1].toLowerCase()] = m[2]
  }
  return out
}

const JOOBLE_RADIUS_KM = [0, 4, 8, 16, 26, 40, 80]

export const joobleProvider: JobProvider = {
  id: 'jooble',
  name: 'Jooble',
  kind: 'aggregator',
  description: 'International job aggregator with keyword + location search across ~70 countries.',
  markets: 'Worldwide (country determined by the API key’s regional domain)',
  docsUrl: 'https://jooble.org/api/about',
  signupUrl: 'https://jooble.org/api/about',
  termsNote: 'Requires a free Jooble partner API key. Keys are issued per regional site; add extra regional keys as "gb=KEY, de=KEY".',
  credentials: [
    { key: 'jooble.apiKey', label: 'API key (jooble.org / US)', secret: true, required: true },
    { key: 'jooble.regionalKeys', label: 'Regional keys (optional, cc=KEY list)', secret: true, required: false, help: 'e.g. gb=xxxx, de=yyyy — used for searches in those countries' }
  ],
  defaultEnabled: true,
  rateLimit: { minIntervalMs: 1500, note: 'Quota set by Jooble per key; results cached 30 minutes.' },
  cacheTtlMs: 30 * 60_000,
  timeoutMs: 20_000,
  hosts: ['jooble.org'],
  supports(q) {
    if (!q.location && !q.country) return { ok: false, reason: 'Jooble needs a location or country' }
    return { ok: true }
  },
  isConfigured: (secret) => !!secret('jooble.apiKey') || Object.keys(parseRegionalKeys(secret('jooble.regionalKeys'))).length > 0,
  async fetch(q, ctx) {
    const cc = (q.country ?? 'us').toLowerCase()
    const regional = parseRegionalKeys(ctx.secret('jooble.regionalKeys'))
    const key = regional[cc] ?? ctx.secret('jooble.apiKey')
    if (!key) throw new Error('No Jooble key configured for this country')
    const host = regional[cc] ? `https://${cc}.jooble.org` : 'https://jooble.org'
    const radius = q.radiusKm ? JOOBLE_RADIUS_KM.find((r) => r >= q.radiusKm!) ?? 80 : undefined
    const out: RawRecord[] = []
    for (let page = 1; page <= 2 && out.length < q.maxResults; page++) {
      const body: Record<string, string> = {
        keywords: q.keywords,
        location: placeQuery(q) ?? '',
        page: String(page),
        ResultOnPage: '50'
      }
      if (radius !== undefined) body.radius = String(radius)
      const data = await ctx.http.json<{ jobs?: unknown[]; totalCount?: number }>({
        url: `${host}/api/${encodeURIComponent(key)}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctx.signal,
        timeoutMs: this.timeoutMs
      })
      if (!data || !Array.isArray(data.jobs)) throw new Error('Unexpected Jooble response shape')
      for (const j of data.jobs) {
        const p = JoobleJob.safeParse(j)
        if (p.success) out.push({ sourceJobId: String(p.data.id), payload: p.data, context: { cc } })
      }
      if (data.jobs.length < 50) break
    }
    return out
  },
  normalize(r) {
    const d = JoobleJob.parse(r.payload)
    return {
      sourceJobId: String(d.id),
      sourceUrl: d.link,
      applyUrl: d.link,
      title: d.title,
      company: d.company ?? '',
      descriptionHtml: d.snippet,
      locationText: d.location ?? '',
      employmentTypeText: d.type,
      salaryText: d.salary,
      postedAt: isoFromString(d.updated),
      countryHint: String(r.context?.cc ?? '').toUpperCase() || undefined,
      employerDirect: false,
      extraNotes: [d.source ? `Jooble found this listing on ${d.source}.` : 'Jooble aggregates listings from other sites.']
    }
  }
}

// ---------------------------------------------------------------------------
// USAJOBS — https://developer.usajobs.gov/
// ---------------------------------------------------------------------------

const UsaJobsItem = z
  .object({
    MatchedObjectId: z.union([z.string(), z.number()]).optional(),
    MatchedObjectDescriptor: z
      .object({
        PositionID: z.string().optional(),
        PositionTitle: z.string(),
        PositionURI: z.string(),
        ApplyURI: z.array(z.string()).optional(),
        PositionLocationDisplay: z.string().optional(),
        PositionLocation: z
          .array(
            z
              .object({
                LocationName: z.string().optional(),
                CountryCode: z.string().optional(),
                CountrySubDivisionCode: z.string().optional(),
                CityName: z.string().optional(),
                Longitude: z.number().optional(),
                Latitude: z.number().optional()
              })
              .passthrough()
          )
          .optional(),
        OrganizationName: z.string().optional(),
        DepartmentName: z.string().optional(),
        PositionSchedule: z.array(z.object({ Name: z.string().optional() }).passthrough()).optional(),
        PositionOfferingType: z.array(z.object({ Name: z.string().optional() }).passthrough()).optional(),
        QualificationSummary: z.string().optional(),
        PositionRemuneration: z
          .array(z.object({ MinimumRange: z.string().optional(), MaximumRange: z.string().optional(), RateIntervalCode: z.string().optional() }).passthrough())
          .optional(),
        PublicationStartDate: z.string().optional(),
        ApplicationCloseDate: z.string().optional(),
        UserArea: z
          .object({
            Details: z
              .object({
                JobSummary: z.string().optional(),
                MajorDuties: z.union([z.array(z.string()), z.string()]).optional(),
                WhoMayApply: z.object({ Name: z.string().optional() }).passthrough().optional(),
                HiringPath: z.array(z.string()).optional(),
                TeleworkEligible: z.boolean().optional(),
                RemoteIndicator: z.boolean().optional(),
                LowGrade: z.string().optional(),
                HighGrade: z.string().optional()
              })
              .passthrough()
              .optional()
          })
          .passthrough()
          .optional()
      })
      .passthrough()
  })
  .passthrough()

const USAJOBS_INTERVAL: Record<string, SalaryPeriod> = { PA: 'year', PH: 'hour', PD: 'day', PW: 'week', PM: 'month' }

export const usajobsProvider: JobProvider = {
  id: 'usajobs',
  name: 'USAJOBS',
  kind: 'government',
  description: 'Official U.S. federal government job site (all agencies), with location + radius search.',
  markets: 'United States federal jobs (including some overseas posts)',
  docsUrl: 'https://developer.usajobs.gov/api-reference/get-api-search',
  signupUrl: 'https://developer.usajobs.gov/apirequest/',
  termsNote: 'Requires a free USAJOBS API key and the email address it was issued to. Federal “who may apply” rules are shown per job — being listed does not mean you are eligible.',
  credentials: [
    { key: 'usajobs.apiKey', label: 'Authorization key', secret: true, required: true },
    { key: 'usajobs.email', label: 'Registered email (sent as User-Agent)', secret: false, required: true }
  ],
  defaultEnabled: true,
  rateLimit: { minIntervalMs: 1000, note: 'Results cached 1 hour; up to 2 pages of 100 per search.' },
  cacheTtlMs: 60 * 60_000,
  timeoutMs: 20_000,
  hosts: ['data.usajobs.gov'],
  supports(q) {
    if (q.country && q.country !== 'US' && !q.wantsRemote) return { ok: false, reason: 'USAJOBS lists U.S. federal jobs' }
    return { ok: true }
  },
  isConfigured: (secret) => !!secret('usajobs.apiKey') && !!secret('usajobs.email'),
  async fetch(q, ctx) {
    const out: RawRecord[] = []
    for (let page = 1; page <= 2 && out.length < q.maxResults; page++) {
      const params = new URLSearchParams({ ResultsPerPage: '100', Page: String(page) })
      if (q.keywords) params.set('Keyword', q.keywords)
      const where = placeQuery(q)
      if (where) {
        params.set('LocationName', where)
        if (q.radiusKm) params.set('Radius', String(Math.round(fromKm(q.radiusKm, 'mi'))))
      }
      if (q.postedWithinDays) params.set('DatePosted', String(Math.min(60, q.postedWithinDays)))
      if (q.wantsRemote && !q.wantsOnsite) params.set('RemoteIndicator', 'True')
      const data = await ctx.http.json<{ SearchResult?: { SearchResultItems?: unknown[]; SearchResultCountAll?: number } }>({
        url: `https://data.usajobs.gov/api/search?${params}`,
        headers: {
          Host: 'data.usajobs.gov',
          'User-Agent': ctx.secret('usajobs.email')!,
          'Authorization-Key': ctx.secret('usajobs.apiKey')!
        },
        signal: ctx.signal,
        timeoutMs: this.timeoutMs
      })
      const items = data?.SearchResult?.SearchResultItems
      if (!Array.isArray(items)) throw new Error('Unexpected USAJOBS response shape')
      for (const it of items) {
        const p = UsaJobsItem.safeParse(it)
        if (!p.success) continue
        const d = p.data.MatchedObjectDescriptor
        out.push({ sourceJobId: String(d.PositionID ?? p.data.MatchedObjectId ?? d.PositionURI), payload: p.data })
      }
      if (items.length < 100) break
    }
    return out
  },
  normalize(r) {
    const d = UsaJobsItem.parse(r.payload).MatchedObjectDescriptor
    const det = d.UserArea?.Details
    const pay = d.PositionRemuneration?.[0]
    const duties = Array.isArray(det?.MajorDuties) ? det?.MajorDuties.join('\n• ') : det?.MajorDuties
    const description = [det?.JobSummary, duties ? `Major duties:\n• ${duties}` : '', d.QualificationSummary ? `Qualifications:\n${d.QualificationSummary}` : '']
      .filter(Boolean)
      .join('\n\n')
    const who = det?.WhoMayApply?.Name
    const schedule = (d.PositionSchedule ?? []).map((s) => s.Name ?? '').join(' ')
    const types: EmploymentType[] = []
    if (/full/i.test(schedule)) types.push('full_time')
    if (/part/i.test(schedule)) types.push('part_time')
    if (/(temporary|term)/i.test((d.PositionOfferingType ?? []).map((s) => s.Name).join(' '))) types.push('temporary')
    return {
      sourceJobId: String(d.PositionID ?? d.PositionURI),
      sourceUrl: d.PositionURI,
      applyUrl: d.ApplyURI?.[0],
      title: d.PositionTitle,
      company: [d.OrganizationName, d.DepartmentName && d.DepartmentName !== d.OrganizationName ? d.DepartmentName : undefined].filter(Boolean).join(' — '),
      companyWebsite: 'https://www.usajobs.gov',
      descriptionText: description,
      locationText: d.PositionLocationDisplay ?? (d.PositionLocation ?? []).map((l) => l.LocationName).filter(Boolean).join('; '),
      places: (d.PositionLocation ?? []).map((l) => ({
        label: l.LocationName,
        city: l.CityName?.split(',')[0],
        region: l.CountrySubDivisionCode,
        country: l.CountryCode === 'United States' ? 'US' : str(l.CountryCode)?.length === 2 ? l.CountryCode : undefined,
        coordinates: l.Latitude !== undefined && l.Longitude !== undefined ? { lat: l.Latitude, lon: l.Longitude } : undefined
      })),
      workModes: det?.RemoteIndicator ? ['remote'] : det?.TeleworkEligible ? ['onsite', 'hybrid'] : undefined,
      remoteEligibilityText: det?.RemoteIndicator ? 'United States' : undefined,
      employmentTypes: types,
      salary: pay ? { min: num(pay.MinimumRange), max: num(pay.MaximumRange), currency: 'USD', period: USAJOBS_INTERVAL[pay.RateIntervalCode ?? ''] } : undefined,
      postedAt: isoFromString(d.PublicationStartDate),
      expiresAt: isoFromString(d.ApplicationCloseDate),
      countryHint: 'US',
      employerDirect: true,
      extraNotes: [
        'Published by the hiring agency on USAJOBS, the official U.S. federal hiring site.',
        who ? `Federal eligibility — who may apply: ${who}. Check that you qualify before applying.` : 'Check the “Who may apply” section: many federal jobs are limited to specific groups.'
      ]
    }
  }
}
