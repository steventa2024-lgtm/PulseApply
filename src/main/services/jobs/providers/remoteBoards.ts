import { z } from 'zod'
import type { EmploymentType } from '../../../../shared/types'
import type { DraftJob, JobProvider, ProviderQuery, ProviderSupport, RawRecord } from './types'
import { isoFromString, isoFromUnix, matchesKeywords, num, str } from './types'
import { MACRO_REGIONS } from '../geo/regions'

/**
 * Remote-job boards with free public APIs. They list (almost exclusively)
 * remote roles, so they are only queried when the user asks for remote work —
 * they must never dominate a local, on-site search.
 */

const remoteOnly = (q: ProviderQuery): ProviderSupport =>
  q.wantsRemote
    ? { ok: true }
    : { ok: false, reason: 'Remote-only board; remote work not requested' }

const phrases = (q: ProviderQuery): string[] => [q.keywords, ...q.alternateKeywords].filter(Boolean)

function employmentFrom(text: string | undefined): EmploymentType[] {
  const t = (text ?? '').toLowerCase().replace(/[_-]/g, ' ')
  const out: EmploymentType[] = []
  if (/full ?time/.test(t)) out.push('full_time')
  if (/part ?time/.test(t)) out.push('part_time')
  if (/contract|freelance/.test(t)) out.push('contract')
  if (/intern/.test(t)) out.push('internship')
  if (/temporary/.test(t)) out.push('temporary')
  return out
}

// ---------------------------------------------------------------------------
// Remote OK — https://remoteok.com/api
// ---------------------------------------------------------------------------

const RemoteOkItem = z
  .object({
    id: z.union([z.string(), z.number()]),
    slug: z.string().optional(),
    epoch: z.union([z.number(), z.string()]).optional(),
    date: z.string().optional(),
    company: z.string().optional(),
    position: z.string(),
    tags: z.array(z.string()).optional(),
    description: z.string().optional(),
    location: z.string().optional(),
    salary_min: z.union([z.number(), z.string()]).optional(),
    salary_max: z.union([z.number(), z.string()]).optional(),
    apply_url: z.string().optional(),
    url: z.string().optional()
  })
  .passthrough()

export const remoteOkProvider: JobProvider = {
  id: 'remoteok',
  name: 'Remote OK',
  kind: 'remote_board',
  description: 'Public feed of remote jobs (mostly technology, some support/marketing).',
  markets: 'Remote roles, worldwide listings',
  docsUrl: 'https://remoteok.com/api',
  termsNote:
    'Remote OK requires linking back to the original listing and naming Remote OK as the source.',
  credentials: [],
  defaultEnabled: true,
  rateLimit: { minIntervalMs: 2000, note: 'Cached for 1 hour; one request per search.' },
  cacheTtlMs: 60 * 60_000,
  timeoutMs: 20_000,
  hosts: ['remoteok.com'],
  supports: remoteOnly,
  isConfigured: () => true,
  async fetch(q, ctx) {
    const data = await ctx.http.json<unknown[]>({
      url: 'https://remoteok.com/api',
      signal: ctx.signal,
      timeoutMs: this.timeoutMs
    })
    if (!Array.isArray(data)) throw new Error('Unexpected Remote OK response shape')
    const out: RawRecord[] = []
    for (const item of data) {
      const p = RemoteOkItem.safeParse(item)
      if (!p.success) continue // first element is the legal notice
      const blob = `${p.data.position} ${(p.data.tags ?? []).join(' ')}`
      if (phrases(q).length && !matchesKeywords(blob, phrases(q))) continue
      out.push({ sourceJobId: String(p.data.id), payload: p.data })
      if (out.length >= q.maxResults) break
    }
    return out
  },
  normalize(r) {
    const d = RemoteOkItem.parse(r.payload)
    const min = num(d.salary_min)
    const max = num(d.salary_max)
    return {
      sourceJobId: String(d.id),
      sourceUrl: d.url ?? `https://remoteok.com/remote-jobs/${d.slug ?? d.id}`,
      applyUrl: d.apply_url,
      title: d.position,
      company: d.company ?? '',
      descriptionHtml: d.description,
      locationText: d.location || 'Remote',
      workModes: ['remote'],
      remoteEligibilityText: d.location || '',
      salary: min || max ? { min, max, currency: 'USD', period: 'year' } : undefined,
      postedAt: isoFromString(d.date) ?? isoFromUnix(d.epoch),
      tags: d.tags,
      employerDirect: false
    }
  }
}

// ---------------------------------------------------------------------------
// Remotive — https://remotive.com/api/remote-jobs
// ---------------------------------------------------------------------------

const RemotiveJob = z
  .object({
    id: z.union([z.number(), z.string()]),
    url: z.string(),
    title: z.string(),
    company_name: z.string().optional(),
    category: z.string().optional(),
    tags: z.array(z.string()).optional(),
    job_type: z.string().optional(),
    publication_date: z.string().optional(),
    candidate_required_location: z.string().optional(),
    salary: z.string().optional(),
    description: z.string().optional()
  })
  .passthrough()

export const remotiveProvider: JobProvider = {
  id: 'remotive',
  name: 'Remotive',
  kind: 'remote_board',
  description: 'Curated remote jobs across software, support, sales, marketing, design and more.',
  markets: 'Remote roles with stated candidate-location requirements',
  docsUrl: 'https://remotive.com/api-documentation',
  termsNote:
    'Remotive asks API users to link back to the listing, credit Remotive, and keep request volume low (results are cached for 6 hours).',
  credentials: [],
  defaultEnabled: true,
  rateLimit: {
    minIntervalMs: 5000,
    note: 'Cached for 6 hours per query to respect Remotive’s low-volume request policy.'
  },
  cacheTtlMs: 6 * 60 * 60_000,
  timeoutMs: 20_000,
  hosts: ['remotive.com'],
  supports: remoteOnly,
  isConfigured: () => true,
  async fetch(q, ctx) {
    const params = new URLSearchParams({ limit: String(Math.min(q.maxResults, 100)) })
    if (q.keywords) params.set('search', q.keywords)
    const data = await ctx.http.json<{ jobs?: unknown[] }>({
      url: `https://remotive.com/api/remote-jobs?${params}`,
      signal: ctx.signal,
      timeoutMs: this.timeoutMs
    })
    if (!data || !Array.isArray(data.jobs)) throw new Error('Unexpected Remotive response shape')
    return data.jobs
      .map((j) => RemotiveJob.safeParse(j))
      .filter((p) => p.success)
      .map((p) => ({ sourceJobId: String(p.data!.id), payload: p.data }))
  },
  normalize(r) {
    const d = RemotiveJob.parse(r.payload)
    return {
      sourceJobId: String(d.id),
      sourceUrl: d.url,
      applyUrl: d.url,
      title: d.title,
      company: d.company_name ?? '',
      descriptionHtml: d.description,
      locationText: `Remote${d.candidate_required_location ? ' - ' + d.candidate_required_location : ''}`,
      workModes: ['remote'],
      remoteEligibilityText: d.candidate_required_location ?? '',
      employmentTypes: employmentFrom(d.job_type),
      salaryText: d.salary,
      postedAt: isoFromString(d.publication_date),
      tags: [...(d.tags ?? []), ...(d.category ? [d.category] : [])],
      employerDirect: false
    }
  }
}

// ---------------------------------------------------------------------------
// Arbeitnow — https://www.arbeitnow.com/api/job-board-api
// ---------------------------------------------------------------------------

const ArbeitnowJob = z
  .object({
    slug: z.string(),
    company_name: z.string().optional(),
    title: z.string(),
    description: z.string().optional(),
    remote: z.boolean().optional(),
    url: z.string(),
    tags: z.array(z.string()).optional(),
    job_types: z.array(z.string()).optional(),
    location: z.string().optional(),
    created_at: z.union([z.number(), z.string()]).optional()
  })
  .passthrough()

export const arbeitnowProvider: JobProvider = {
  id: 'arbeitnow',
  name: 'Arbeitnow',
  kind: 'remote_board',
  description:
    'European job board (primarily Germany), on-site and remote, many with visa sponsorship.',
  markets: 'Germany and wider Europe',
  docsUrl: 'https://www.arbeitnow.com/blog/job-board-api',
  termsNote: 'Free API; link back to the Arbeitnow listing.',
  credentials: [],
  defaultEnabled: true,
  rateLimit: { minIntervalMs: 1500, note: 'Up to 3 pages per search, cached for 1 hour.' },
  cacheTtlMs: 60 * 60_000,
  timeoutMs: 20_000,
  hosts: ['www.arbeitnow.com'],
  supports(q) {
    const eu = q.country ? MACRO_REGIONS.europe.includes(q.country) : false
    if (eu) return { ok: true }
    if (q.wantsRemote) return { ok: true }
    return {
      ok: false,
      reason: 'Arbeitnow lists European jobs; your search location is outside Europe'
    }
  },
  isConfigured: () => true,
  async fetch(q, ctx) {
    const out: RawRecord[] = []
    for (let page = 1; page <= 3 && out.length < q.maxResults; page++) {
      const data = await ctx.http.json<{ data?: unknown[]; links?: { next?: string | null } }>({
        url: `https://www.arbeitnow.com/api/job-board-api?page=${page}`,
        signal: ctx.signal,
        timeoutMs: this.timeoutMs
      })
      if (!data || !Array.isArray(data.data)) throw new Error('Unexpected Arbeitnow response shape')
      for (const item of data.data) {
        const p = ArbeitnowJob.safeParse(item)
        if (!p.success) continue
        const blob = `${p.data.title} ${(p.data.tags ?? []).join(' ')}`
        if (phrases(q).length && !matchesKeywords(blob, phrases(q))) continue
        if (!q.wantsOnsite && !p.data.remote) continue
        out.push({ sourceJobId: p.data.slug, payload: p.data })
      }
      if (!data.links?.next) break
    }
    return out
  },
  normalize(r) {
    const d = ArbeitnowJob.parse(r.payload)
    const types = (d.job_types ?? []).join(' ')
    return {
      sourceJobId: d.slug,
      sourceUrl: d.url,
      applyUrl: d.url,
      title: d.title,
      company: d.company_name ?? '',
      descriptionHtml: d.description,
      locationText: d.location ?? '',
      workModes: d.remote ? ['remote'] : undefined,
      employmentTypes: employmentFrom(types),
      employmentTypeText: types,
      postedAt: isoFromUnix(d.created_at),
      tags: d.tags,
      countryHint: 'DE',
      employerDirect: false
    }
  }
}

// ---------------------------------------------------------------------------
// Jobicy — https://jobicy.com/api/v2/remote-jobs
// ---------------------------------------------------------------------------

const JobicyJob = z
  .object({
    id: z.union([z.number(), z.string()]),
    url: z.string(),
    jobTitle: z.string(),
    companyName: z.string().optional(),
    jobIndustry: z.union([z.array(z.string()), z.string()]).optional(),
    jobType: z.union([z.array(z.string()), z.string()]).optional(),
    jobGeo: z.string().optional(),
    jobLevel: z.string().optional(),
    jobExcerpt: z.string().optional(),
    jobDescription: z.string().optional(),
    pubDate: z.string().optional(),
    annualSalaryMin: z.union([z.number(), z.string()]).optional(),
    annualSalaryMax: z.union([z.number(), z.string()]).optional(),
    salaryCurrency: z.string().optional()
  })
  .passthrough()

/** Jobicy dates look like "2024-05-01 10:00:00" (UTC). */
function jobicyDate(value: string | undefined): string | undefined {
  if (!value) return undefined
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(value)
    ? value.replace(' ', 'T') + 'Z'
    : value
  return isoFromString(iso)
}

const JOBICY_GEO: Record<string, string> = {
  US: 'usa',
  CA: 'canada',
  GB: 'uk',
  DE: 'germany',
  FR: 'france',
  ES: 'spain',
  NL: 'netherlands',
  AU: 'australia',
  BR: 'brazil',
  MX: 'mexico',
  IN: 'india',
  PL: 'poland'
}

export const jobicyProvider: JobProvider = {
  id: 'jobicy',
  name: 'Jobicy',
  kind: 'remote_board',
  description: 'Remote jobs with region eligibility (USA, UK, Europe, LATAM, APAC, anywhere).',
  markets: 'Remote roles with stated geographic eligibility',
  docsUrl: 'https://jobicy.com/jobs-rss-feed',
  termsNote:
    'Jobicy requires attribution and linking to the original listing; avoid frequent polling (cached 1 hour).',
  credentials: [],
  defaultEnabled: true,
  rateLimit: { minIntervalMs: 2000, note: 'One request per search, cached for 1 hour.' },
  cacheTtlMs: 60 * 60_000,
  timeoutMs: 20_000,
  hosts: ['jobicy.com'],
  supports: remoteOnly,
  isConfigured: () => true,
  async fetch(q, ctx) {
    const params = new URLSearchParams({ count: String(Math.min(q.maxResults, 50)) })
    const geo = q.country ? JOBICY_GEO[q.country] : undefined
    if (geo) params.set('geo', geo)
    if (q.keywords) params.set('tag', q.keywords)
    const data = await ctx.http.json<{ jobs?: unknown[] }>({
      url: `https://jobicy.com/api/v2/remote-jobs?${params}`,
      signal: ctx.signal,
      timeoutMs: this.timeoutMs
    })
    if (!data || !Array.isArray(data.jobs)) throw new Error('Unexpected Jobicy response shape')
    return data.jobs
      .map((j) => JobicyJob.safeParse(j))
      .filter((p) => p.success)
      .map((p) => ({ sourceJobId: String(p.data!.id), payload: p.data }))
  },
  normalize(r) {
    const d = JobicyJob.parse(r.payload)
    const types = Array.isArray(d.jobType) ? d.jobType.join(' ') : (d.jobType ?? '')
    const min = num(d.annualSalaryMin)
    const max = num(d.annualSalaryMax)
    return {
      sourceJobId: String(d.id),
      sourceUrl: d.url,
      applyUrl: d.url,
      title: d.jobTitle,
      company: d.companyName ?? '',
      descriptionHtml: d.jobDescription ?? d.jobExcerpt,
      locationText: `Remote${d.jobGeo ? ' - ' + d.jobGeo : ''}`,
      workModes: ['remote'],
      remoteEligibilityText: d.jobGeo ?? '',
      employmentTypes: employmentFrom(types),
      seniorityText: d.jobLevel,
      salary:
        min || max
          ? { min, max, currency: str(d.salaryCurrency) ?? 'USD', period: 'year' }
          : undefined,
      postedAt: jobicyDate(d.pubDate),
      tags: Array.isArray(d.jobIndustry) ? d.jobIndustry : d.jobIndustry ? [d.jobIndustry] : [],
      employerDirect: false
    }
  }
}

// ---------------------------------------------------------------------------
// Himalayas — https://himalayas.app/jobs/api
// ---------------------------------------------------------------------------

const HimalayasJob = z
  .object({
    title: z.string(),
    excerpt: z.string().optional(),
    companyName: z.string().optional(),
    companySlug: z.string().optional(),
    employmentType: z.string().optional(),
    minSalary: z.union([z.number(), z.string(), z.null()]).optional(),
    maxSalary: z.union([z.number(), z.string(), z.null()]).optional(),
    currency: z.string().nullable().optional(),
    seniority: z.array(z.string()).optional(),
    locationRestrictions: z.array(z.string()).optional(),
    categories: z.array(z.string()).optional(),
    description: z.string().optional(),
    pubDate: z.union([z.number(), z.string()]).optional(),
    expiryDate: z.union([z.number(), z.string()]).optional(),
    applicationLink: z.string().optional(),
    guid: z.string()
  })
  .passthrough()

export const himalayasProvider: JobProvider = {
  id: 'himalayas',
  name: 'Himalayas',
  kind: 'remote_board',
  description: 'Remote jobs with explicit country restrictions and published salary ranges.',
  markets: 'Remote roles; eligibility countries listed per job',
  docsUrl: 'https://himalayas.app/api',
  termsNote: 'Free API; link back to the Himalayas listing and credit Himalayas.',
  credentials: [],
  defaultEnabled: true,
  rateLimit: {
    minIntervalMs: 1500,
    note: 'Up to 5 pages (20 jobs each) per search, cached for 1 hour.'
  },
  cacheTtlMs: 60 * 60_000,
  timeoutMs: 20_000,
  hosts: ['himalayas.app'],
  supports: remoteOnly,
  isConfigured: () => true,
  async fetch(q, ctx) {
    const out: RawRecord[] = []
    for (let page = 0; page < 5 && out.length < q.maxResults; page++) {
      const data = await ctx.http.json<{ jobs?: unknown[]; totalCount?: number }>({
        url: `https://himalayas.app/jobs/api?limit=20&offset=${page * 20}`,
        signal: ctx.signal,
        timeoutMs: this.timeoutMs
      })
      if (!data || !Array.isArray(data.jobs)) throw new Error('Unexpected Himalayas response shape')
      for (const item of data.jobs) {
        const p = HimalayasJob.safeParse(item)
        if (!p.success) continue
        const blob = `${p.data.title} ${(p.data.categories ?? []).join(' ')}`
        if (phrases(q).length && !matchesKeywords(blob, phrases(q))) continue
        out.push({ sourceJobId: p.data.guid, payload: p.data })
      }
      if (data.jobs.length < 20) break
    }
    return out
  },
  normalize(r) {
    const d = HimalayasJob.parse(r.payload)
    const restrictions = d.locationRestrictions ?? []
    const min = num(d.minSalary)
    const max = num(d.maxSalary)
    const draft: DraftJob = {
      sourceJobId: d.guid,
      sourceUrl: d.guid,
      applyUrl: d.applicationLink,
      title: d.title,
      company: d.companyName ?? '',
      descriptionHtml: d.description ?? d.excerpt,
      locationText: restrictions.length ? `Remote - ${restrictions.join(', ')}` : 'Remote',
      workModes: ['remote'],
      // Himalayas: an empty restriction list means the role is open worldwide.
      remoteEligibilityText: restrictions.length ? restrictions.join(', ') : 'Worldwide',
      employmentTypes: employmentFrom(d.employmentType),
      seniorityText: (d.seniority ?? []).join(' '),
      salary: min || max ? { min, max, currency: d.currency ?? 'USD', period: 'year' } : undefined,
      postedAt: isoFromUnix(d.pubDate),
      expiresAt: isoFromUnix(d.expiryDate),
      tags: d.categories,
      employerDirect: false
    }
    return draft
  }
}
