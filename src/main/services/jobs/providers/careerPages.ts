import type { EmploymentType, SalaryPeriod, WorkMode } from '../../../../shared/types'
import type { DraftJob, JobProvider, RawRecord } from './types'
import { isoFromString, matchesKeywords, num, str } from './types'
import type { HttpClient } from '../adapters/http'
import { assertPublicUrl } from '../verification/urlSafety'
import { isAllowed, robotsFor } from '../discovery/robots'
import { lookupCountry } from '../geo/regions'

/**
 * Employer career pages that publish schema.org `JobPosting` structured data
 * (the format search engines index). Only pages permitted by robots.txt are
 * fetched, with a small per-site page budget.
 */

type Json = Record<string, unknown>

export function extractJsonLd(html: string): Json[] {
  const out: Json[] = []
  const re = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  for (const m of html.matchAll(re)) {
    try {
      const parsed = JSON.parse(m[1].trim().replace(/^<!\[CDATA\[|\]\]>$/g, ''))
      const stack: unknown[] = Array.isArray(parsed) ? parsed : [parsed]
      while (stack.length) {
        const node = stack.pop()
        if (!node || typeof node !== 'object') continue
        const obj = node as Json
        if (Array.isArray(obj['@graph'])) stack.push(...(obj['@graph'] as unknown[]))
        if (Array.isArray(obj.itemListElement)) stack.push(...(obj.itemListElement as unknown[]).map((i) => (i as Json)?.item ?? i))
        const type = obj['@type']
        if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) out.push(obj)
      }
    } catch {
      // malformed JSON-LD block: ignore
    }
  }
  return out
}

const TYPE_MAP: Record<string, EmploymentType> = {
  FULL_TIME: 'full_time', PART_TIME: 'part_time', CONTRACTOR: 'contract', TEMPORARY: 'temporary', INTERN: 'internship',
  PER_DIEM: 'per_diem', VOLUNTEER: 'volunteer', SEASONAL: 'seasonal'
}

const UNIT_MAP: Record<string, SalaryPeriod> = { HOUR: 'hour', DAY: 'day', WEEK: 'week', MONTH: 'month', YEAR: 'year' }

function asArray<T>(v: T | T[] | undefined): T[] {
  return v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]
}

export function jobPostingToDraft(jp: Json, pageUrl: string, fallbackCompany: string): DraftJob | null {
  const title = str(jp.title)
  if (!title) return null
  const org = jp.hiringOrganization as Json | undefined
  const company = str(org?.name) ?? fallbackCompany
  const identifier = jp.identifier as Json | string | undefined
  const idValue = typeof identifier === 'object' ? str(identifier?.value) : str(identifier)
  const url = str(jp.url) ?? pageUrl
  const places = asArray(jp.jobLocation as Json | Json[]).map((loc) => {
    const addr = (loc?.address ?? {}) as Json
    const geo = (loc?.geo ?? {}) as Json
    const countryRaw = typeof addr.addressCountry === 'object' ? str((addr.addressCountry as Json).name) : str(addr.addressCountry)
    const lat = num(geo.latitude)
    const lon = geo.longitude !== undefined ? Number(geo.longitude) : undefined
    return {
      city: str(addr.addressLocality),
      region: str(addr.addressRegion),
      country: countryRaw ? (lookupCountry(countryRaw) ?? (countryRaw.length === 2 ? countryRaw.toUpperCase() : undefined)) : undefined,
      coordinates: lat !== undefined && lon !== undefined && Number.isFinite(lon) ? { lat, lon } : undefined,
      label: [str(addr.addressLocality), str(addr.addressRegion), countryRaw].filter(Boolean).join(', ')
    }
  })
  const telecommute = String(jp.jobLocationType ?? '').toUpperCase() === 'TELECOMMUTE'
  const workModes: WorkMode[] | undefined = telecommute ? (places.length ? ['remote', 'hybrid'] : ['remote']) : places.length ? ['onsite'] : undefined
  const applicantReq = asArray(jp.applicantLocationRequirements as Json | Json[]).map((r) => str(r?.name)).filter(Boolean).join(', ')
  const base = jp.baseSalary as Json | undefined
  const value = (base?.value ?? {}) as Json
  const min = num(value.minValue) ?? num(value.value)
  const max = num(value.maxValue)
  const types = asArray(jp.employmentType as string | string[]).map((t) => TYPE_MAP[String(t).toUpperCase().replace(/[- ]/g, '_')]).filter(Boolean)
  return {
    sourceJobId: idValue ?? url,
    sourceUrl: url,
    applyUrl: url,
    title,
    company,
    companyWebsite: str(org?.sameAs) ?? str(org?.url),
    descriptionHtml: str(jp.description),
    locationText: places.map((p) => p.label).filter(Boolean).join('; ') || (telecommute ? 'Remote' : ''),
    places: places.filter((p) => p.city || p.country || p.coordinates),
    workModes,
    remoteEligibilityText: telecommute ? applicantReq || undefined : undefined,
    employmentTypes: types.length ? types : undefined,
    salary: min || max ? { min, max, currency: str(base?.currency), period: UNIT_MAP[String(value.unitText ?? '').toUpperCase()] } : undefined,
    postedAt: isoFromString(jp.datePosted),
    expiresAt: isoFromString(jp.validThrough),
    employerDirect: true
  }
}

const JOB_LINK_RE = /href\s*=\s*["']([^"'#]+)["']/gi
const JOB_PATH_RE = /\/(jobs?|careers?|positions?|openings?|vacanc(y|ies)|opportunit(y|ies)|stellen|emplois?|empleos?)\b[^?#]*[/-][\w-]*\d|\/(job|position|posting|requisition|req)[/-]/i

/** Collects same-site links that look like individual job pages. */
export function candidateJobLinks(html: string, pageUrl: string, limit = 20): string[] {
  const base = new URL(pageUrl)
  const out = new Set<string>()
  for (const m of html.matchAll(JOB_LINK_RE)) {
    try {
      const u = new URL(m[1].replace(/&amp;/g, '&'), base)
      if (u.hostname !== base.hostname || !/^https?:$/.test(u.protocol)) continue
      if (!JOB_PATH_RE.test(u.pathname)) continue
      u.hash = ''
      out.add(u.toString())
      if (out.size >= limit) break
    } catch {
      // ignore bad href
    }
  }
  return [...out]
}

async function fetchPage(http: HttpClient, url: string, signal: AbortSignal): Promise<string | null> {
  const u = await assertPublicUrl(url)
  const rules = await robotsFor(http, u.origin, signal)
  if (!isAllowed(rules, u.pathname + u.search)) return null
  const res = await http.request({ url: u.toString(), signal, timeoutMs: 15_000, retries: 1, maxBytes: 3 * 1024 * 1024, headers: { Accept: 'text/html,application/xhtml+xml' } })
  return res.text
}

export async function crawlCareerPage(http: HttpClient, careersUrl: string, company: string, signal: AbortSignal, pageBudget = 20): Promise<{ drafts: DraftJob[]; pagesFetched: number; blockedByRobots: boolean }> {
  const drafts: DraftJob[] = []
  const html = await fetchPage(http, careersUrl, signal)
  if (html === null) return { drafts, pagesFetched: 0, blockedByRobots: true }
  let pages = 1
  for (const jp of extractJsonLd(html)) {
    const d = jobPostingToDraft(jp, careersUrl, company)
    if (d) drafts.push(d)
  }
  if (drafts.length <= 1) {
    for (const link of candidateJobLinks(html, careersUrl, pageBudget)) {
      if (signal.aborted || pages >= pageBudget) break
      try {
        const page = await fetchPage(http, link, signal)
        pages++
        if (!page) continue
        for (const jp of extractJsonLd(page)) {
          const d = jobPostingToDraft(jp, link, company)
          if (d && !drafts.some((x) => x.sourceUrl === d.sourceUrl)) drafts.push(d)
        }
      } catch {
        // skip unreachable job page
      }
    }
  }
  return { drafts, pagesFetched: pages, blockedByRobots: false }
}

export const careerPagesProvider: JobProvider = {
  id: 'careerpages',
  name: 'Employer career pages',
  kind: 'employer_site',
  description: 'Career pages you add that publish structured JobPosting data (the format used by search engines).',
  markets: 'Any employer career site you add',
  termsNote: 'Only pages allowed by the site’s robots.txt are fetched; at most 20 pages per site per search.',
  credentials: [],
  defaultEnabled: true,
  rateLimit: { minIntervalMs: 1000, note: 'One site at a time, 1 request/second per host, cached 3 hours.' },
  cacheTtlMs: 3 * 60 * 60_000,
  timeoutMs: 60_000,
  hosts: [],
  supports: () => ({ ok: true }),
  isConfigured: () => true,
  async fetch(q, ctx) {
    const employers = ctx.employers.filter((e) => e.atsProvider === 'jsonld' && e.status !== 'invalid' && e.status !== 'disabled')
    const out: RawRecord[] = []
    const phrases = [q.keywords, ...q.alternateKeywords].filter(Boolean)
    for (const e of employers) {
      if (ctx.signal.aborted) break
      try {
        const { drafts, blockedByRobots } = await crawlCareerPage(ctx.http, e.boardId, e.name, ctx.signal)
        if (blockedByRobots) {
          ctx.onEmployerSynced?.(e.id, 'error', 'robots.txt does not permit automated access to this page')
          continue
        }
        ctx.onEmployerSynced?.(e.id, drafts.length ? 'active' : 'pending', drafts.length ? null : 'No structured job postings found on this page', drafts.length)
        for (const d of drafts) {
          if (phrases.length && !matchesKeywords(d.title, phrases)) continue
          out.push({ sourceJobId: d.sourceJobId, payload: d })
        }
      } catch (err) {
        ctx.onEmployerSynced?.(e.id, 'error', (err as Error).message)
      }
    }
    return out
  },
  normalize(r) {
    return r.payload as DraftJob
  }
}
