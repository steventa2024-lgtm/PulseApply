import { z } from 'zod'
import type {
  AtsProvider,
  EmployerRecord,
  EmploymentType,
  SalaryPeriod,
  WorkMode
} from '../../../../shared/types'
import type { JobProvider, ProviderContext, ProviderQuery, RawRecord } from './types'
import { isoFromString, isoFromUnix, matchesKeywords, num, str } from './types'
import type { HttpClient } from '../adapters/http'
import { HttpError } from '../adapters/http'
import { lookupCountry } from '../geo/regions'

/**
 * Direct employer ATS job boards. Each public API is company-specific: one
 * call returns one employer's openings. Coverage therefore comes from the
 * employer registry (user-added boards and validated discoveries), not from a
 * single global query.
 */

export interface BoardValidation {
  ok: boolean
  name?: string
  count?: number
  error?: string
}

const MAX_JOBS_PER_BOARD = 500

function employersFor(
  provider: AtsProvider,
  ctx: ProviderContext,
  q: ProviderQuery
): EmployerRecord[] {
  return ctx.employers.filter((e) => {
    if (e.atsProvider !== provider || e.status === 'invalid' || e.status === 'disabled')
      return false
    // Skip employers pinned to a different country when the search is local to one country.
    if (e.country && q.country && !q.wantsRemote && e.country !== q.country) return false
    return true
  })
}

async function perEmployer(
  provider: AtsProvider,
  q: ProviderQuery,
  ctx: ProviderContext,
  fetchOne: (e: EmployerRecord) => Promise<RawRecord[]>
): Promise<RawRecord[]> {
  const employers = employersFor(provider, ctx, q)
  const out: RawRecord[] = []
  const errors: string[] = []
  // Bounded concurrency: 3 boards at a time.
  for (let i = 0; i < employers.length; i += 3) {
    const batch = employers.slice(i, i + 3)
    const results = await Promise.allSettled(batch.map((e) => fetchOne(e)))
    results.forEach((res, idx) => {
      const e = batch[idx]
      if (res.status === 'fulfilled') {
        ctx.onEmployerSynced?.(e.id, 'active', null, res.value.length)
        out.push(...res.value)
      } else {
        const err = res.reason as Error
        const invalid = err instanceof HttpError && err.status === 404
        ctx.onEmployerSynced?.(
          e.id,
          invalid ? 'invalid' : 'error',
          invalid ? 'Board not found (404)' : err.message
        )
        errors.push(`${e.name}: ${err.message}`)
      }
    })
    if (ctx.signal.aborted) break
  }
  if (employers.length && out.length === 0 && errors.length === employers.length) {
    throw new Error(
      `All ${employers.length} employer board(s) failed: ${errors.slice(0, 3).join('; ')}`
    )
  }
  return out
}

function keywordFilter(q: ProviderQuery, title: string, extra = ''): boolean {
  const phrases = [q.keywords, ...q.alternateKeywords].filter(Boolean)
  return phrases.length === 0 || matchesKeywords(`${title} ${extra}`, phrases)
}

// ---------------------------------------------------------------------------
// Greenhouse Job Board API — https://developers.greenhouse.io/job-board.html
// ---------------------------------------------------------------------------

const GhJob = z
  .object({
    id: z.number(),
    internal_job_id: z.number().nullable().optional(),
    title: z.string(),
    updated_at: z.string().optional(),
    first_published: z.string().optional(),
    requisition_id: z.string().nullable().optional(),
    location: z
      .object({ name: z.string().nullable().optional() })
      .passthrough()
      .nullable()
      .optional(),
    absolute_url: z.string(),
    content: z.string().optional(),
    departments: z.array(z.object({ name: z.string().optional() }).passthrough()).optional(),
    offices: z
      .array(
        z
          .object({ name: z.string().optional(), location: z.string().nullable().optional() })
          .passthrough()
      )
      .optional(),
    company_name: z.string().optional()
  })
  .passthrough()

export async function validateGreenhouse(
  http: HttpClient,
  board: string,
  signal?: AbortSignal
): Promise<BoardValidation> {
  try {
    const info = await http.json<{ name?: string }>({
      url: `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}`,
      signal,
      retries: 1
    })
    const jobs = await http.json<{ jobs?: unknown[] }>({
      url: `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs`,
      signal,
      retries: 1
    })
    return {
      ok: true,
      name: info?.name,
      count: Array.isArray(jobs?.jobs) ? jobs.jobs.length : undefined
    }
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof HttpError && err.status === 404
          ? 'No Greenhouse board with that identifier'
          : (err as Error).message
    }
  }
}

export const greenhouseProvider: JobProvider = {
  id: 'greenhouse',
  name: 'Greenhouse (employer boards)',
  kind: 'ats',
  description:
    'Official public job boards of employers that use Greenhouse. Add employers on the Sources page.',
  markets: 'Any employer with a public Greenhouse board you add',
  docsUrl: 'https://developers.greenhouse.io/job-board.html',
  termsNote: 'Public Job Board API; no key needed. Each request covers one employer.',
  credentials: [],
  defaultEnabled: true,
  rateLimit: {
    minIntervalMs: 300,
    note: 'One request per registered employer, 3 in parallel, cached 1 hour.'
  },
  cacheTtlMs: 60 * 60_000,
  timeoutMs: 20_000,
  hosts: ['boards-api.greenhouse.io'],
  supports: () => ({ ok: true }),
  isConfigured: () => true,
  fetch(q, ctx) {
    return perEmployer('greenhouse', q, ctx, async (e) => {
      const data = await ctx.http.json<{ jobs?: unknown[] }>({
        url: `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(e.boardId)}/jobs?content=true`,
        signal: ctx.signal,
        timeoutMs: this.timeoutMs
      })
      if (!data || !Array.isArray(data.jobs))
        throw new Error('Unexpected Greenhouse response shape')
      const out: RawRecord[] = []
      for (const j of data.jobs.slice(0, MAX_JOBS_PER_BOARD)) {
        const p = GhJob.safeParse(j)
        if (!p.success) continue
        if (
          !keywordFilter(q, p.data.title, (p.data.departments ?? []).map((d) => d.name).join(' '))
        )
          continue
        out.push({
          sourceJobId: `${e.boardId}:${p.data.id}`,
          payload: p.data,
          context: { board: e.boardId, company: e.name }
        })
      }
      return out
    })
  },
  normalize(r) {
    const d = GhJob.parse(r.payload)
    const board = String(r.context?.board)
    const offices = (d.offices ?? []).map((o) => o.location || o.name).filter(Boolean) as string[]
    return {
      sourceJobId: `${board}:${d.id}`,
      sourceUrl: d.absolute_url,
      applyUrl: `https://job-boards.greenhouse.io/${encodeURIComponent(board)}/jobs/${d.id}`,
      title: d.title,
      company: d.company_name ?? String(r.context?.company ?? board),
      descriptionHtml: d.content,
      locationText: d.location?.name ?? '',
      extraLocations: offices,
      postedAt: isoFromString(d.first_published) ?? isoFromString(d.updated_at),
      tags: (d.departments ?? []).map((x) => x.name ?? '').filter(Boolean),
      employerDirect: true,
      ats: {
        provider: 'greenhouse',
        board,
        postingId: String(d.id),
        requisitionId: d.requisition_id ?? undefined
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Lever Postings API — https://github.com/lever/postings-api
// ---------------------------------------------------------------------------

const LeverPosting = z
  .object({
    id: z.string(),
    text: z.string(),
    hostedUrl: z.string(),
    applyUrl: z.string().optional(),
    createdAt: z.number().optional(),
    country: z.string().nullable().optional(),
    workplaceType: z.string().optional(),
    categories: z
      .object({
        commitment: z.string().optional(),
        department: z.string().optional(),
        location: z.string().optional(),
        team: z.string().optional(),
        allLocations: z.array(z.string()).optional()
      })
      .passthrough()
      .optional(),
    description: z.string().optional(),
    descriptionPlain: z.string().optional(),
    lists: z
      .array(
        z.object({ text: z.string().optional(), content: z.string().optional() }).passthrough()
      )
      .optional(),
    additional: z.string().optional(),
    salaryRange: z
      .object({
        min: z.number().optional(),
        max: z.number().optional(),
        currency: z.string().optional(),
        interval: z.string().optional()
      })
      .passthrough()
      .nullable()
      .optional()
  })
  .passthrough()

const LEVER_INTERVAL: Record<string, SalaryPeriod> = {
  'per-year-salary': 'year',
  'per-month-salary': 'month',
  'per-week-salary': 'week',
  'per-day-wage': 'day',
  'per-hour-wage': 'hour'
}

async function leverList(
  http: HttpClient,
  company: string,
  signal: AbortSignal | undefined,
  timeoutMs: number
): Promise<{ host: string; items: unknown[] }> {
  for (const host of ['https://api.lever.co', 'https://api.eu.lever.co']) {
    try {
      const out: unknown[] = []
      for (let skip = 0; skip < MAX_JOBS_PER_BOARD; skip += 100) {
        const items = await http.json<unknown[]>({
          url: `${host}/v0/postings/${encodeURIComponent(company)}?mode=json&limit=100&skip=${skip}`,
          signal,
          timeoutMs
        })
        if (!Array.isArray(items)) throw new Error('Unexpected Lever response shape')
        out.push(...items)
        if (items.length < 100) break
      }
      return { host, items: out }
    } catch (err) {
      if (
        err instanceof HttpError &&
        err.status === 404 &&
        host.includes('api.lever.co') &&
        !host.includes('.eu.')
      )
        continue
      throw err
    }
  }
  throw new HttpError('Lever company not found', 404, company)
}

export async function validateLever(
  http: HttpClient,
  company: string,
  signal?: AbortSignal
): Promise<BoardValidation> {
  try {
    const { items } = await leverList(http, company, signal, 15_000)
    return { ok: true, count: items.length }
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof HttpError && err.status === 404
          ? 'No Lever postings site with that identifier'
          : (err as Error).message
    }
  }
}

export const leverProvider: JobProvider = {
  id: 'lever',
  name: 'Lever (employer boards)',
  kind: 'ats',
  description:
    'Official public postings of employers that use Lever. Add employers on the Sources page.',
  markets: 'Any employer with a public Lever postings site you add',
  docsUrl: 'https://github.com/lever/postings-api',
  termsNote: 'Public Postings API; no key needed. Each request covers one employer.',
  credentials: [],
  defaultEnabled: true,
  rateLimit: {
    minIntervalMs: 300,
    note: 'One request per registered employer, 3 in parallel, cached 1 hour.'
  },
  cacheTtlMs: 60 * 60_000,
  timeoutMs: 20_000,
  hosts: ['api.lever.co', 'api.eu.lever.co'],
  supports: () => ({ ok: true }),
  isConfigured: () => true,
  fetch(q, ctx) {
    return perEmployer('lever', q, ctx, async (e) => {
      const { items } = await leverList(ctx.http, e.boardId, ctx.signal, this.timeoutMs)
      const out: RawRecord[] = []
      for (const j of items) {
        const p = LeverPosting.safeParse(j)
        if (!p.success) continue
        if (
          !keywordFilter(
            q,
            p.data.text,
            `${p.data.categories?.team ?? ''} ${p.data.categories?.department ?? ''}`
          )
        )
          continue
        out.push({
          sourceJobId: p.data.id,
          payload: p.data,
          context: { board: e.boardId, company: e.name }
        })
      }
      return out
    })
  },
  normalize(r) {
    const d = LeverPosting.parse(r.payload)
    const lists = (d.lists ?? [])
      .map((l) => `<h3>${l.text ?? ''}</h3><ul>${l.content ?? ''}</ul>`)
      .join('')
    const wt = (d.workplaceType ?? '').toLowerCase()
    const modes: WorkMode[] | undefined =
      wt === 'remote'
        ? ['remote']
        : wt === 'hybrid'
          ? ['hybrid']
          : wt === 'on-site' || wt === 'onsite'
            ? ['onsite']
            : undefined
    const commitment = d.categories?.commitment ?? ''
    const sr = d.salaryRange
    const cc = str(d.country)?.toUpperCase()
    return {
      sourceJobId: d.id,
      sourceUrl: d.hostedUrl,
      applyUrl: d.applyUrl ?? `${d.hostedUrl.replace(/\/$/, '')}/apply`,
      title: d.text,
      company: String(r.context?.company ?? r.context?.board),
      descriptionHtml: `${d.description ?? ''}${lists}${d.additional ?? ''}`,
      locationText: d.categories?.location ?? '',
      extraLocations: (d.categories?.allLocations ?? []).filter(
        (l) => l !== d.categories?.location
      ),
      places:
        cc && cc.length === 2 && !modes?.includes('remote')
          ? [{ country: cc, label: d.categories?.location }]
          : undefined,
      workModes: modes,
      remoteEligibilityText: modes?.includes('remote')
        ? (d.categories?.location ?? (cc ? cc : undefined))
        : undefined,
      employmentTypeText: commitment,
      salary:
        sr && (sr.min || sr.max)
          ? {
              min: sr.min,
              max: sr.max,
              currency: sr.currency,
              period: LEVER_INTERVAL[sr.interval ?? '']
            }
          : undefined,
      postedAt: isoFromUnix(d.createdAt),
      tags: [d.categories?.team, d.categories?.department].filter(Boolean) as string[],
      employerDirect: true,
      ats: { provider: 'lever', board: String(r.context?.board), postingId: d.id }
    }
  }
}

// ---------------------------------------------------------------------------
// Ashby public Job Postings API — https://developers.ashbyhq.com/docs/public-job-posting-api
// ---------------------------------------------------------------------------

const AshbyJob = z
  .object({
    id: z.string(),
    title: z.string(),
    location: z.string().optional(),
    secondaryLocations: z
      .array(z.object({ location: z.string().optional() }).passthrough())
      .optional(),
    department: z.string().optional(),
    team: z.string().optional(),
    isListed: z.boolean().optional(),
    isRemote: z.boolean().optional(),
    workplaceType: z.string().nullable().optional(),
    descriptionHtml: z.string().optional(),
    descriptionPlain: z.string().optional(),
    publishedAt: z.string().optional(),
    employmentType: z.string().optional(),
    address: z
      .object({
        postalAddress: z
          .object({
            addressLocality: z.string().optional(),
            addressRegion: z.string().optional(),
            addressCountry: z.string().optional()
          })
          .passthrough()
          .optional()
      })
      .passthrough()
      .nullable()
      .optional(),
    jobUrl: z.string(),
    applyUrl: z.string().optional(),
    compensation: z
      .object({
        summaryComponents: z
          .array(
            z
              .object({
                compensationType: z.string().optional(),
                interval: z.string().optional(),
                currencyCode: z.string().nullable().optional(),
                minValue: z.number().nullable().optional(),
                maxValue: z.number().nullable().optional()
              })
              .passthrough()
          )
          .optional()
      })
      .passthrough()
      .nullable()
      .optional()
  })
  .passthrough()

const ASHBY_TYPES: Record<string, EmploymentType> = {
  FullTime: 'full_time',
  PartTime: 'part_time',
  Intern: 'internship',
  Contract: 'contract',
  Temporary: 'temporary'
}

export async function validateAshby(
  http: HttpClient,
  board: string,
  signal?: AbortSignal
): Promise<BoardValidation> {
  try {
    const data = await http.json<{ jobs?: unknown[] }>({
      url: `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}`,
      signal,
      retries: 1
    })
    if (!Array.isArray(data?.jobs)) return { ok: false, error: 'Unexpected Ashby response' }
    return { ok: true, count: data.jobs.length }
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof HttpError && err.status === 404
          ? 'No Ashby job board with that name'
          : (err as Error).message
    }
  }
}

export const ashbyProvider: JobProvider = {
  id: 'ashby',
  name: 'Ashby (employer boards)',
  kind: 'ats',
  description:
    'Official public job boards of employers that use Ashby. Add employers on the Sources page.',
  markets: 'Any employer with a public Ashby board you add',
  docsUrl: 'https://developers.ashbyhq.com/docs/public-job-posting-api',
  termsNote: 'Public Job Postings API; no key needed. Each request covers one employer.',
  credentials: [],
  defaultEnabled: true,
  rateLimit: {
    minIntervalMs: 300,
    note: 'One request per registered employer, 3 in parallel, cached 1 hour.'
  },
  cacheTtlMs: 60 * 60_000,
  timeoutMs: 20_000,
  hosts: ['api.ashbyhq.com'],
  supports: () => ({ ok: true }),
  isConfigured: () => true,
  fetch(q, ctx) {
    return perEmployer('ashby', q, ctx, async (e) => {
      const data = await ctx.http.json<{ jobs?: unknown[] }>({
        url: `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(e.boardId)}?includeCompensation=true`,
        signal: ctx.signal,
        timeoutMs: this.timeoutMs
      })
      if (!data || !Array.isArray(data.jobs)) throw new Error('Unexpected Ashby response shape')
      const out: RawRecord[] = []
      for (const j of data.jobs.slice(0, MAX_JOBS_PER_BOARD)) {
        const p = AshbyJob.safeParse(j)
        if (!p.success || p.data.isListed === false) continue
        if (!keywordFilter(q, p.data.title, `${p.data.department ?? ''} ${p.data.team ?? ''}`))
          continue
        out.push({
          sourceJobId: p.data.id,
          payload: p.data,
          context: { board: e.boardId, company: e.name }
        })
      }
      return out
    })
  },
  normalize(r) {
    const d = AshbyJob.parse(r.payload)
    const wt = (d.workplaceType ?? '').toLowerCase()
    const modes: WorkMode[] | undefined =
      wt === 'remote' || (d.isRemote && !wt)
        ? ['remote']
        : wt === 'hybrid'
          ? ['hybrid']
          : wt === 'onsite'
            ? ['onsite']
            : undefined
    const pa = d.address?.postalAddress
    const comp = d.compensation?.summaryComponents?.find((c) =>
      /salary|hourly/i.test(c.compensationType ?? '')
    )
    const interval = (comp?.interval ?? '').toUpperCase()
    const period: SalaryPeriod | undefined = /YEAR/.test(interval)
      ? 'year'
      : /HOUR/.test(interval)
        ? 'hour'
        : /MONTH/.test(interval)
          ? 'month'
          : /WEEK/.test(interval)
            ? 'week'
            : undefined
    const country = pa?.addressCountry ? lookupCountry(pa.addressCountry) : undefined
    return {
      sourceJobId: d.id,
      sourceUrl: d.jobUrl,
      applyUrl: d.applyUrl ?? `${d.jobUrl.replace(/\/$/, '')}/application`,
      title: d.title,
      company: String(r.context?.company ?? r.context?.board),
      descriptionHtml: d.descriptionHtml ?? d.descriptionPlain,
      locationText: d.location ?? '',
      extraLocations: (d.secondaryLocations ?? []).map((l) => l.location ?? '').filter(Boolean),
      places:
        pa && (pa.addressLocality || country)
          ? [{ city: pa.addressLocality, region: pa.addressRegion, country, label: d.location }]
          : undefined,
      workModes: modes,
      remoteEligibilityText: modes?.includes('remote') ? d.location : undefined,
      employmentTypes:
        d.employmentType && ASHBY_TYPES[d.employmentType]
          ? [ASHBY_TYPES[d.employmentType]]
          : undefined,
      salary:
        comp && (comp.minValue || comp.maxValue)
          ? {
              min: comp.minValue ?? undefined,
              max: comp.maxValue ?? undefined,
              currency: comp.currencyCode ?? undefined,
              period
            }
          : undefined,
      postedAt: isoFromString(d.publishedAt),
      tags: [d.department, d.team].filter(Boolean) as string[],
      employerDirect: true,
      ats: { provider: 'ashby', board: String(r.context?.board), postingId: d.id }
    }
  }
}

// ---------------------------------------------------------------------------
// SmartRecruiters Posting API — https://developers.smartrecruiters.com/docs/posting-api
// ---------------------------------------------------------------------------

const SrPosting = z
  .object({
    id: z.string(),
    uuid: z.string().optional(),
    name: z.string(),
    refNumber: z.string().optional(),
    releasedDate: z.string().optional(),
    company: z
      .object({ name: z.string().optional(), identifier: z.string().optional() })
      .passthrough()
      .optional(),
    location: z
      .object({
        city: z.string().optional(),
        region: z.string().optional(),
        country: z.string().optional(),
        remote: z.boolean().optional(),
        hybrid: z.boolean().optional(),
        latitude: z.union([z.string(), z.number()]).optional(),
        longitude: z.union([z.string(), z.number()]).optional(),
        fullLocation: z.string().optional()
      })
      .passthrough()
      .optional(),
    typeOfEmployment: z.object({ label: z.string().optional() }).passthrough().optional(),
    experienceLevel: z.object({ label: z.string().optional() }).passthrough().optional(),
    department: z.object({ label: z.string().optional() }).passthrough().optional(),
    jobAd: z
      .object({
        sections: z
          .record(
            z.string(),
            z.object({ title: z.string().optional(), text: z.string().optional() }).passthrough()
          )
          .optional()
      })
      .passthrough()
      .optional(),
    applyUrl: z.string().optional(),
    postingUrl: z.string().optional()
  })
  .passthrough()

export async function validateSmartRecruiters(
  http: HttpClient,
  company: string,
  signal?: AbortSignal
): Promise<BoardValidation> {
  try {
    const data = await http.json<{
      totalFound?: number
      content?: { company?: { name?: string } }[]
    }>({
      url: `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings?limit=1`,
      signal,
      retries: 1
    })
    if (typeof data?.totalFound !== 'number')
      return { ok: false, error: 'Unexpected SmartRecruiters response' }
    if (data.totalFound === 0)
      return { ok: false, error: 'No public SmartRecruiters postings for that company identifier' }
    return { ok: true, count: data.totalFound, name: data.content?.[0]?.company?.name }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export const smartRecruitersProvider: JobProvider = {
  id: 'smartrecruiters',
  name: 'SmartRecruiters (employer boards)',
  kind: 'ats',
  description:
    'Official public postings of employers that use SmartRecruiters (common in retail, hospitality and logistics).',
  markets: 'Any employer with public SmartRecruiters postings you add',
  docsUrl: 'https://developers.smartrecruiters.com/docs/posting-api',
  termsNote: 'Public Posting API; no key needed. Details fetched for matching postings only.',
  credentials: [],
  defaultEnabled: true,
  rateLimit: {
    minIntervalMs: 300,
    note: 'Listing + up to 25 detail requests per employer, cached 1 hour.'
  },
  cacheTtlMs: 60 * 60_000,
  timeoutMs: 20_000,
  hosts: ['api.smartrecruiters.com'],
  supports: () => ({ ok: true }),
  isConfigured: () => true,
  fetch(q, ctx) {
    return perEmployer('smartrecruiters', q, ctx, async (e) => {
      const base = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(e.boardId)}/postings`
      const list: z.infer<typeof SrPosting>[] = []
      for (let offset = 0; offset < MAX_JOBS_PER_BOARD; offset += 100) {
        const params = new URLSearchParams({ limit: '100', offset: String(offset) })
        if (q.keywords) params.set('q', q.keywords)
        if (q.country && !q.wantsRemote) params.set('country', q.country.toLowerCase())
        const data = await ctx.http.json<{ content?: unknown[]; totalFound?: number }>({
          url: `${base}?${params}`,
          signal: ctx.signal,
          timeoutMs: this.timeoutMs
        })
        if (!data || !Array.isArray(data.content))
          throw new Error('Unexpected SmartRecruiters response shape')
        for (const item of data.content) {
          const p = SrPosting.safeParse(item)
          if (p.success) list.push(p.data)
        }
        if (data.content.length < 100) break
      }
      const out: RawRecord[] = []
      const wanted = list
        .filter((p) => keywordFilter(q, p.name, p.department?.label ?? ''))
        .slice(0, 25)
      for (let i = 0; i < wanted.length; i += 3) {
        const details = await Promise.allSettled(
          wanted.slice(i, i + 3).map((p) =>
            ctx.http.json<unknown>({
              url: `${base}/${encodeURIComponent(p.id)}`,
              signal: ctx.signal,
              timeoutMs: this.timeoutMs
            })
          )
        )
        details.forEach((d, idx) => {
          const summary = wanted[i + idx]
          const detail = d.status === 'fulfilled' ? SrPosting.safeParse(d.value) : undefined
          out.push({
            sourceJobId: summary.id,
            payload: detail?.success ? { ...summary, ...detail.data } : summary,
            context: { board: e.boardId, company: e.name }
          })
        })
      }
      return out
    })
  },
  normalize(r) {
    const d = SrPosting.parse(r.payload)
    const board = String(r.context?.board)
    const sections = d.jobAd?.sections ?? {}
    const html = ['companyDescription', 'jobDescription', 'qualifications', 'additionalInformation']
      .map((k) =>
        sections[k]?.text ? `<h3>${sections[k]?.title ?? ''}</h3>${sections[k]?.text}` : ''
      )
      .join('')
    const loc = d.location
    const lat = num(loc?.latitude)
    const lon = loc?.longitude !== undefined ? Number(loc.longitude) : undefined
    const modes: WorkMode[] | undefined = loc?.remote
      ? ['remote']
      : loc?.hybrid
        ? ['hybrid']
        : loc
          ? ['onsite']
          : undefined
    const cc = loc?.country?.toUpperCase()
    return {
      sourceJobId: d.id,
      sourceUrl:
        d.postingUrl ?? `https://jobs.smartrecruiters.com/${encodeURIComponent(board)}/${d.id}`,
      applyUrl:
        d.applyUrl ?? `https://jobs.smartrecruiters.com/${encodeURIComponent(board)}/${d.id}`,
      title: d.name,
      company: d.company?.name ?? String(r.context?.company ?? board),
      descriptionHtml: html || undefined,
      locationText: loc?.fullLocation ?? [loc?.city, loc?.region, cc].filter(Boolean).join(', '),
      places: loc
        ? [
            {
              city: loc.city,
              region: loc.region,
              country: cc,
              coordinates:
                lat !== undefined && lon !== undefined && Number.isFinite(lon)
                  ? { lat, lon }
                  : undefined
            }
          ]
        : undefined,
      workModes: modes,
      remoteEligibilityText: loc?.remote ? cc : undefined,
      employmentTypeText: d.typeOfEmployment?.label,
      seniorityText: d.experienceLevel?.label,
      postedAt: isoFromString(d.releasedDate),
      tags: d.department?.label ? [d.department.label] : [],
      employerDirect: true,
      ats: { provider: 'smartrecruiters', board, postingId: d.id, requisitionId: d.refNumber }
    }
  }
}

export async function validateBoard(
  http: HttpClient,
  provider: AtsProvider,
  board: string,
  signal?: AbortSignal
): Promise<BoardValidation> {
  switch (provider) {
    case 'greenhouse':
      return validateGreenhouse(http, board, signal)
    case 'lever':
      return validateLever(http, board, signal)
    case 'ashby':
      return validateAshby(http, board, signal)
    case 'smartrecruiters':
      return validateSmartRecruiters(http, board, signal)
    default:
      return { ok: false, error: 'Unsupported provider' }
  }
}
