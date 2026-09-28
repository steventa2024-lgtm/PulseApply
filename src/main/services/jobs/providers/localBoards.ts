import { z } from 'zod'
import type { JobProvider, ProviderQuery, RawRecord } from './types'
import { isoFromString, str } from './types'
import { fromKm } from '../geo/geoService'

/**
 * Sources with good coverage of local, often hourly, U.S. jobs.
 *
 * - CareerOneStop (U.S. Department of Labor) exposes the National Labor
 *   Exchange (NLx): postings from state job banks and employers nationwide,
 *   searchable by keyword + location + radius. Free registration required.
 * - The Muse publishes a public jobs API filterable by city (no keyword
 *   search; results are filtered locally by occupation like every source).
 */

function cityState(q: ProviderQuery): string | undefined {
  const l = q.location
  if (!l || l.precision === 'none' || l.country !== 'US') return undefined
  if (l.city) return [l.city, l.region].filter(Boolean).join(', ')
  return l.region
}

// ---------------------------------------------------------------------------
// CareerOneStop — https://www.careeronestop.org/Developers/WebAPI/web-api.aspx
// ---------------------------------------------------------------------------

const CosJob = z
  .object({
    JvId: z.union([z.string(), z.number()]),
    JobTitle: z.string().min(2),
    Company: z.string().optional().nullable(),
    DatePosted: z.string().optional().nullable(),
    URL: z.string().url(),
    Location: z.string().optional().nullable(),
    Fc: z.string().optional().nullable()
  })
  .passthrough()

export const careerOneStopProvider: JobProvider = {
  id: 'careeronestop',
  name: 'CareerOneStop (U.S. Dept. of Labor)',
  kind: 'government',
  description:
    'National Labor Exchange postings from state job banks and employers — strong coverage of local and hourly jobs across the U.S.',
  markets: 'United States (all occupations, all states)',
  docsUrl: 'https://www.careeronestop.org/Developers/WebAPI/Jobs/list-jobs.aspx',
  signupUrl: 'https://www.careeronestop.org/Developers/WebAPI/registration.aspx',
  termsNote:
    'Free registration gives a User ID and an API token. Listings link to the original posting (state job bank or employer). The list API does not include full descriptions; open the listing for details.',
  credentials: [
    { key: 'careeronestop.userId', label: 'User ID', secret: false, required: true },
    { key: 'careeronestop.token', label: 'API token', secret: true, required: true }
  ],
  defaultEnabled: true,
  rateLimit: { minIntervalMs: 1000, note: 'Results cached 1 hour; up to 2 pages of 100.' },
  cacheTtlMs: 60 * 60_000,
  timeoutMs: 20_000,
  hosts: ['api.careeronestop.org'],
  supports(q) {
    if (!q.wantsOnsite) return { ok: false, reason: 'Local U.S. jobs only (remote not selected)' }
    if (!cityState(q)) return { ok: false, reason: 'Needs a U.S. city, state or ZIP' }
    if (!q.keywords) return { ok: false, reason: 'Needs a job title or keyword' }
    return { ok: true }
  },
  isConfigured: (secret) => !!secret('careeronestop.userId') && !!secret('careeronestop.token'),
  async fetch(q, ctx) {
    const out: RawRecord[] = []
    const where = cityState(q)!
    const radius = Math.max(5, Math.min(100, Math.round(fromKm(q.radiusKm ?? 40, 'mi'))))
    const days = q.postedWithinDays ? Math.min(60, q.postedWithinDays) : 0
    const user = encodeURIComponent(ctx.secret('careeronestop.userId')!)
    for (let page = 0; page < 2 && out.length < q.maxResults; page++) {
      const start = page * 100
      const url =
        `https://api.careeronestop.org/v2/jobsearch/${user}/${encodeURIComponent(q.keywords)}/` +
        `${encodeURIComponent(where)}/${radius}/0/0/${start}/100/${days}?source=NLx&showFilters=false`
      const data = await ctx.http.json<{ Jobs?: unknown[] }>({
        url,
        headers: { Authorization: `Bearer ${ctx.secret('careeronestop.token')}` },
        signal: ctx.signal,
        timeoutMs: this.timeoutMs
      })
      if (!data || !Array.isArray(data.Jobs)) throw new Error('Unexpected CareerOneStop response')
      for (const j of data.Jobs) {
        const p = CosJob.safeParse(j)
        if (p.success) out.push({ sourceJobId: String(p.data.JvId), payload: p.data })
      }
      if (data.Jobs.length < 100) break
    }
    return out
  },
  normalize(r) {
    const j = CosJob.parse(r.payload)
    return {
      sourceJobId: String(j.JvId),
      sourceUrl: j.URL,
      applyUrl: j.URL,
      title: j.JobTitle,
      company: str(j.Company) ?? 'Employer not stated',
      descriptionText: '',
      locationText: str(j.Location) ?? '',
      countryHint: 'US',
      postedAt: isoFromString(j.DatePosted),
      employerDirect: false,
      extraNotes: ['Listed through the National Labor Exchange (CareerOneStop).']
    }
  }
}

// ---------------------------------------------------------------------------
// The Muse — https://www.themuse.com/developers/api/v2
// ---------------------------------------------------------------------------

const MuseJob = z
  .object({
    id: z.union([z.number(), z.string()]),
    name: z.string().min(2),
    contents: z.string().optional().nullable(),
    publication_date: z.string().optional().nullable(),
    locations: z.array(z.object({ name: z.string() })).optional(),
    levels: z.array(z.object({ name: z.string() })).optional(),
    company: z.object({ name: z.string() }),
    refs: z.object({ landing_page: z.string().url() })
  })
  .passthrough()

export const theMuseProvider: JobProvider = {
  id: 'themuse',
  name: 'The Muse',
  kind: 'aggregator',
  description:
    'Public job API from The Muse, filterable by U.S. city. Mostly salaried office roles at mid-size and large employers.',
  markets: 'United States (major metro areas), some international',
  docsUrl: 'https://www.themuse.com/developers/api/v2',
  termsNote:
    'Public API; an optional key raises the hourly limit. No keyword search — PulseApply filters results by occupation locally.',
  credentials: [
    { key: 'themuse.apiKey', label: 'API key (optional)', secret: true, required: false }
  ],
  defaultEnabled: true,
  rateLimit: { minIntervalMs: 1200, note: '500 requests/hour without a key; cached 3 hours.' },
  cacheTtlMs: 3 * 60 * 60_000,
  timeoutMs: 20_000,
  hosts: ['www.themuse.com'],
  supports(q) {
    if (q.wantsOnsite && cityState(q) && q.location?.city) return { ok: true }
    if (q.wantsRemote) return { ok: true }
    return { ok: false, reason: 'Needs a U.S. city (or a remote search)' }
  },
  isConfigured: () => true,
  async fetch(q, ctx) {
    const out: RawRecord[] = []
    const locs: string[] = []
    if (q.wantsOnsite && q.location?.city && cityState(q)) locs.push(cityState(q)!)
    if (q.wantsRemote) locs.push('Flexible / Remote')
    const key = ctx.secret('themuse.apiKey')
    for (let page = 0; page < 5 && out.length < q.maxResults * 2; page++) {
      const params = new URLSearchParams({ page: String(page), descending: 'true' })
      for (const l of locs) params.append('location', l)
      if (key) params.set('api_key', key)
      const data = await ctx.http.json<{ results?: unknown[]; page_count?: number }>({
        url: `https://www.themuse.com/api/public/jobs?${params}`,
        signal: ctx.signal,
        timeoutMs: this.timeoutMs
      })
      if (!data || !Array.isArray(data.results)) throw new Error('Unexpected The Muse response')
      for (const j of data.results) {
        const p = MuseJob.safeParse(j)
        if (p.success) out.push({ sourceJobId: String(p.data.id), payload: p.data })
      }
      if (!data.page_count || page + 1 >= data.page_count) break
    }
    return out
  },
  normalize(r) {
    const j = MuseJob.parse(r.payload)
    const names = (j.locations ?? []).map((l) => l.name)
    const remote = names.some((n) => /remote|flexible/i.test(n))
    const physical = names.filter((n) => !/remote|flexible/i.test(n))
    return {
      sourceJobId: String(j.id),
      sourceUrl: j.refs.landing_page,
      title: j.name,
      company: j.company.name,
      descriptionHtml: j.contents ?? '',
      locationText: physical[0] ?? (remote ? 'Remote' : ''),
      extraLocations: physical.slice(1),
      workModes:
        remote && !physical.length ? ['remote'] : remote ? ['onsite', 'remote'] : undefined,
      seniorityText: (j.levels ?? []).map((l) => l.name).join(' '),
      postedAt: isoFromString(j.publication_date),
      employerDirect: false
    }
  }
}
