import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import { z } from 'zod'
import type { EmploymentType, NormalizedJob, ScoredJob, WorkMode } from '../../../../shared/types'
import type { Store } from '../../persistence/store'
import type { GeoService } from '../geo/geoService'
import type { HttpClient } from '../adapters/http'
import type { CriteriaService } from '../../eligibility/criteriaService'
import type { DraftJob } from '../providers/types'
import { extractJsonLd, jobPostingToDraft } from '../providers/careerPages'
import { normalizeDraft } from '../normalization/normalize'
import { assertPublicUrl, canonicalizeUrl, isPublicHttpUrl } from '../verification/urlSafety'
import { log } from '../../logger'
import type { ClippedJob } from '../../../../shared/clip'
import { OCCUPATION_BY_ID } from '../search/taxonomy'

/**
 * Jobs that arrive from outside the API providers:
 *
 * - "Add by link": the user pastes a job URL; PulseApply fetches that one page
 *   and reads its schema.org JobPosting data (what Google for Jobs uses).
 * - "Enter details": the user types the facts of a job they found.
 * - Job inbox: JSON files dropped into `<userData>/inbox` — for example by a
 *   browser assistant (see .claude/skills/find-jobs-near-me) — are imported
 *   automatically.
 *
 * Every job needs a real, public link to the original posting. Imported jobs
 * go through the same normalization, de-duplication, eligibility filters and
 * scoring as jobs from API sources.
 */

const httpUrl = z
  .string()
  .max(2048)
  .refine((u) => isPublicHttpUrl(u), 'must be a public http(s) link to the original posting')

/** Simple job shape accepted from the inbox and the manual form. */
export const SimpleJobSchema = z.object({
  title: z.string().trim().min(2).max(300),
  company: z.string().trim().min(1).max(200),
  location: z.string().trim().max(300).default(''),
  url: httpUrl,
  applyUrl: httpUrl.optional(),
  description: z.string().max(50_000).optional(),
  postedAt: z.string().max(40).optional(),
  salary: z.string().max(200).optional(),
  employmentType: z.string().max(60).optional(),
  workMode: z.enum(['onsite', 'hybrid', 'remote']).optional(),
  /** Where it was found, e.g. "Google Jobs", "Target careers". */
  foundOn: z.string().max(120).optional()
})
export type SimpleJob = z.infer<typeof SimpleJobSchema>

const EMPLOYMENT: [RegExp, EmploymentType][] = [
  [/full/i, 'full_time'],
  [/part/i, 'part_time'],
  [/contract/i, 'contract'],
  [/temp/i, 'temporary'],
  [/intern/i, 'internship'],
  [/season/i, 'seasonal']
]

function idFor(url: string): string {
  return createHash('sha256')
    .update(canonicalizeUrl(url) ?? url)
    .digest('hex')
    .slice(0, 20)
}

export function simpleToDraft(j: SimpleJob): DraftJob {
  const types = j.employmentType
    ? EMPLOYMENT.filter(([re]) => re.test(j.employmentType!)).map(([, t]) => t)
    : []
  const remote = j.workMode === 'remote' || /^remote\b/i.test(j.location)
  const modes: WorkMode[] | undefined = j.workMode ? [j.workMode] : remote ? ['remote'] : undefined
  return {
    sourceJobId: idFor(j.url),
    sourceUrl: j.url,
    applyUrl: j.applyUrl ?? j.url,
    title: j.title,
    company: j.company,
    descriptionText: j.description ?? '',
    locationText: j.location,
    workModes: modes,
    employmentTypes: types.length ? types : undefined,
    salaryText: j.salary,
    postedAt:
      j.postedAt && !Number.isNaN(Date.parse(j.postedAt))
        ? new Date(j.postedAt).toISOString()
        : undefined,
    employerDirect: false,
    extraNotes: j.foundOn ? [`Found on ${j.foundOn}.`] : []
  }
}

/**
 * Parses an inbox file: a JobPosting (schema.org JSON-LD), our simple shape,
 * an array of either, or `{ "jobs": [...] }`.
 */
export function parseInboxPayload(data: unknown): { drafts: DraftJob[]; errors: string[] } {
  const items: unknown[] = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { jobs?: unknown[] }).jobs)
      ? (data as { jobs: unknown[] }).jobs
      : [data]
  const drafts: DraftJob[] = []
  const errors: string[] = []
  items.forEach((it, i) => {
    const obj = it as Record<string, unknown> | null
    if (
      obj &&
      (obj['@type'] === 'JobPosting' ||
        (Array.isArray(obj['@type']) && obj['@type'].includes('JobPosting')))
    ) {
      const url = typeof obj.url === 'string' ? obj.url : ''
      if (!isPublicHttpUrl(url)) {
        errors.push(`#${i + 1}: JobPosting needs a public "url" to the original posting`)
        return
      }
      const d = jobPostingToDraft(obj, url, 'Employer not stated')
      if (d) drafts.push({ ...d, sourceJobId: idFor(url), employerDirect: false })
      else errors.push(`#${i + 1}: JobPosting has no title`)
      return
    }
    const p = SimpleJobSchema.safeParse(it)
    if (p.success) drafts.push(simpleToDraft(p.data))
    else
      errors.push(
        `#${i + 1}: ${p.error.issues.map((x) => `${x.path.join('.') || 'job'} ${x.message}`).join('; ')}`
      )
  })
  return { drafts, errors }
}

export interface ImportResult {
  added: number
  updated: number
  jobs: ScoredJob[]
  errors: string[]
}

export interface InboxStatus {
  path: string
  pending: number
  imported: number
  failed: number
  lastScanAt?: string
  lastResult?: { files: number; added: number; updated: number; errors: string[] }
}

const SOURCES = {
  link: { id: 'import-link', name: 'Added by link' },
  manual: { id: 'import-manual', name: 'Added by you' },
  inbox: { id: 'import-inbox', name: 'Job inbox' },
  clip: { id: 'browse-save', name: 'Saved while browsing' }
} as const

export type ClipOutcome =
  | ({ saved: true } & ImportResult)
  | {
      saved: false
      needsDetails: true
      missing: string[]
      prefill: { title?: string; company?: string; location?: string; url: string }
    }

export class JobImportService {
  private watcher: fs.FSWatcher | null = null
  private timer: NodeJS.Timeout | null = null
  private scanning: Promise<InboxStatus['lastResult']> | null = null
  private lastScanAt?: string
  private lastResult?: InboxStatus['lastResult']

  constructor(
    private readonly deps: {
      store: Store
      geo: GeoService
      http: HttpClient
      criteria: CriteriaService
      inboxDir: string
      onImported?: () => void
      /** Tests only: skip the DNS check of pasted links. */
      skipDnsCheck?: boolean
    }
  ) {}

  /** Normalizes, evaluates against the active criteria, and stores jobs. */
  async importDrafts(
    drafts: DraftJob[],
    kind: keyof typeof SOURCES,
    opts: { verified: boolean; note: string }
  ): Promise<ImportResult> {
    const { store, geo, criteria } = this.deps
    const src = SOURCES[kind]
    const errors: string[] = []
    const jobs: NormalizedJob[] = []
    for (const d of drafts) {
      const res = normalizeDraft(d, { providerId: src.id, providerName: src.name, geo })
      if (!res.job) {
        errors.push(`${d.title || d.sourceUrl}: ${res.error}`)
        continue
      }
      const existing = store.jobs.findJobIdBySourceRecord(src.id, d.sourceJobId)
      const job: NormalizedJob = {
        ...res.job,
        id: existing ?? res.job.id,
        verificationStatus: opts.verified ? res.job.verificationStatus : 'UNVERIFIED',
        verificationNotes: [...res.job.verificationNotes, opts.note]
      }
      jobs.push(job)
    }
    if (!jobs.length) return { added: 0, updated: 0, jobs: [], errors }
    const evals = await criteria.evaluate(jobs, await criteria.context())
    const { inserted, updated } = store.jobs.upsertMany(
      evals.map((e) => ({
        ...e.job,
        match: e.match,
        geo: e.geo,
        relevance: e.relevance,
        eligibility: e.eligibility,
        state: { saved: false, dismissed: false }
      }))
    )
    const stored = store.jobs.list({ ids: jobs.map((j) => j.id), view: 'archive', limit: 5000 })
    this.deps.onImported?.()
    return { added: inserted.length, updated: updated.length, jobs: stored, errors }
  }

  /** Reads one job page the user pasted and imports its JobPosting data. */
  async importUrl(url: string, signal?: AbortSignal): Promise<ImportResult> {
    const trimmed = url.trim()
    if (!isPublicHttpUrl(trimmed)) throw new Error('Enter a public http(s) link to the job posting')
    const u = this.deps.skipDnsCheck ? new URL(trimmed) : await assertPublicUrl(trimmed)
    const host = u.hostname.replace(/^www\./, '')
    if (/(^|\.)(linkedin\.com|indeed\.[a-z.]+|glassdoor\.[a-z.]+|ziprecruiter\.com)$/.test(host))
      throw new Error(
        `${host} does not allow automated access. Open the posting in your browser and use “Enter details” (or the employer's own careers page link) instead.`
      )
    const res = await this.deps.http.request({
      url: u.toString(),
      signal,
      timeoutMs: 20_000,
      retries: 1,
      maxBytes: 4 * 1024 * 1024,
      headers: { Accept: 'text/html,application/xhtml+xml' }
    })
    const postings = extractJsonLd(res.text)
    const drafts = postings
      .map((p) => jobPostingToDraft(p, u.toString(), host))
      .filter((d): d is DraftJob => !!d)
    if (!drafts.length)
      throw new Error(
        'This page does not publish structured job data PulseApply can read. Use “Enter details” to add it by hand — the link is kept with the job.'
      )
    return this.importDrafts(drafts, 'link', {
      verified: true,
      note: `Read from ${host} on ${new Date().toISOString().slice(0, 10)}.`
    })
  }

  importManual(input: SimpleJob): Promise<ImportResult> {
    const p = SimpleJobSchema.parse(input)
    return this.importDrafts([simpleToDraft(p)], 'manual', {
      verified: false,
      note: 'Entered by you; use “Check availability” to confirm it is still open.'
    })
  }

  /**
   * Saves the job the user is viewing in the Browse & Save window. Uses the
   * page's JobPosting data when present, otherwise the visible title, company
   * and location; anything missing is asked from the user, never guessed.
   */
  async importClip(
    c: ClippedJob,
    overrides: { title?: string; company?: string; location?: string } = {}
  ): Promise<ClipOutcome> {
    if (!isPublicHttpUrl(c.url)) throw new Error('This page has no public link to save')
    const note = `Saved from ${c.site || 'the web'} while you were viewing it (${new Date().toISOString().slice(0, 10)}).`
    const ld = c.jsonLd[0]
    let draft: DraftJob | null = null
    if (ld && !overrides.title) {
      draft = jobPostingToDraft(ld, c.url, overrides.company ?? c.company ?? '')
      if (draft) {
        draft = {
          ...draft,
          sourceJobId: idFor(c.url),
          sourceUrl: c.url,
          applyUrl: draft.applyUrl && isPublicHttpUrl(draft.applyUrl) ? draft.applyUrl : c.url,
          employerDirect: false,
          descriptionText: draft.descriptionHtml ? undefined : c.description,
          locationText: draft.locationText || overrides.location || c.location || ''
        }
        if (!draft.company) draft = null
      }
    }
    if (!draft) {
      const fields = {
        title: overrides.title?.trim() || c.title,
        company: overrides.company?.trim() || c.company,
        location: overrides.location?.trim() || c.location
      }
      const missing = (['title', 'company', 'location'] as const).filter((k) => !fields[k])
      if (missing.length)
        return { saved: false, needsDetails: true, missing, prefill: { ...fields, url: c.url } }
      draft = simpleToDraft(
        SimpleJobSchema.parse({
          ...fields,
          url: c.url,
          description: c.description,
          salary: c.salary,
          employmentType: c.employmentType,
          workMode: c.remote ? 'remote' : undefined,
          foundOn: c.site
        })
      )
    }
    const res = await this.importDrafts([draft], 'clip', { verified: true, note })
    return { saved: true, ...res }
  }

  // -------------------------------------------------------------------------
  // Inbox
  // -------------------------------------------------------------------------

  private dirs(): { inbox: string; done: string; failed: string } {
    const inbox = this.deps.inboxDir
    return { inbox, done: path.join(inbox, 'imported'), failed: path.join(inbox, 'failed') }
  }

  status(): InboxStatus {
    const d = this.dirs()
    const count = (dir: string, re: RegExp): number => {
      try {
        return fs.readdirSync(dir).filter((f) => re.test(f)).length
      } catch {
        return 0
      }
    }
    return {
      path: d.inbox,
      pending: count(d.inbox, /^[^_].*\.json$/i),
      imported: count(d.done, /\.json$/i),
      failed: count(d.failed, /\.json$/i),
      lastScanAt: this.lastScanAt,
      lastResult: this.lastResult
    }
  }

  /** Imports every *.json file in the inbox, then moves it to imported/ or failed/. */
  scanInbox(): Promise<InboxStatus['lastResult']> {
    if (this.scanning) return this.scanning
    this.scanning = this.doScan().finally(() => (this.scanning = null))
    return this.scanning
  }

  private async doScan(): Promise<InboxStatus['lastResult']> {
    const d = this.dirs()
    for (const dir of [d.inbox, d.done, d.failed]) fs.mkdirSync(dir, { recursive: true })
    // Files starting with "_" (e.g. _search-request.json) are written by PulseApply itself.
    const files = fs.readdirSync(d.inbox).filter((f) => /\.json$/i.test(f) && !f.startsWith('_'))
    const result = { files: 0, added: 0, updated: 0, errors: [] as string[] }
    for (const f of files) {
      const full = path.join(d.inbox, f)
      const stamp = `${Date.now()}-${f}`
      try {
        const st = fs.statSync(full)
        if (st.size > 5 * 1024 * 1024) throw new Error('file larger than 5 MB')
        // Skip files that are still being written.
        if (Date.now() - st.mtimeMs < 1500) continue
        const { drafts, errors } = parseInboxPayload(JSON.parse(fs.readFileSync(full, 'utf8')))
        const res = await this.importDrafts(drafts, 'inbox', {
          verified: false,
          note: `Imported from the job inbox (${f}); use “Check availability” to confirm it is still open.`
        })
        result.files++
        result.added += res.added
        result.updated += res.updated
        const errs = [...errors, ...res.errors]
        result.errors.push(...errs.map((e) => `${f} ${e}`))
        const target = res.added + res.updated > 0 ? d.done : d.failed
        fs.renameSync(full, path.join(target, stamp))
        if (errs.length) fs.writeFileSync(path.join(target, `${stamp}.errors.txt`), errs.join('\n'))
      } catch (err) {
        result.files++
        result.errors.push(`${f}: ${(err as Error).message}`)
        try {
          fs.renameSync(full, path.join(d.failed, stamp))
          fs.writeFileSync(path.join(d.failed, `${stamp}.errors.txt`), (err as Error).message)
        } catch {
          // file vanished meanwhile
        }
      }
    }
    this.lastScanAt = new Date().toISOString()
    this.lastResult = result
    if (result.files)
      log.info(
        'import',
        `Job inbox: ${result.files} file(s), ${result.added} new, ${result.updated} updated, ${result.errors.length} problem(s)`
      )
    return result
  }

  /**
   * Publishes the active criteria as `_search-request.json` so a browser
   * assistant knows which occupations and area to look for.
   */
  async writeSearchRequest(): Promise<void> {
    try {
      const { criteria } = this.deps
      const ctx = await criteria.context()
      const occ = ctx.intent.normalizedOccupations
        .map((id) => OCCUPATION_BY_ID.get(id)?.label)
        .filter(Boolean)
      const req = {
        about:
          'Written by PulseApply. Drop job files (JSON) in this folder; see .claude/skills/find-jobs-near-me/SKILL.md for the format.',
        updatedAt: new Date().toISOString(),
        query: ctx.criteria.query || undefined,
        occupations: occ,
        location: ctx.intent.location?.label ?? ctx.intent.locationText ?? null,
        radius: ctx.intent.radius ?? null,
        radiusUnit: ctx.intent.radiusUnit,
        workModes: ctx.intent.workModes,
        locationMode: ctx.criteria.locationMode ?? 'strict',
        excludedOccupations: ctx.intent.excludedOccupations
          .map((id) => OCCUPATION_BY_ID.get(id)?.label)
          .filter(Boolean)
      }
      fs.mkdirSync(this.deps.inboxDir, { recursive: true })
      const file = path.join(this.deps.inboxDir, '_search-request.json')
      fs.writeFileSync(file + '.tmp', JSON.stringify(req, null, 2))
      fs.renameSync(file + '.tmp', file)
    } catch (err) {
      log.warn('import', `Could not write the search request: ${(err as Error).message}`)
    }
  }

  /** Watches the inbox folder (with a periodic rescan as a fallback). */
  startWatching(intervalMs = 60_000): void {
    if (this.timer) return
    fs.mkdirSync(this.dirs().inbox, { recursive: true })
    let debounce: NodeJS.Timeout | null = null
    try {
      this.watcher = fs.watch(this.dirs().inbox, () => {
        if (debounce) clearTimeout(debounce)
        debounce = setTimeout(() => void this.scanInbox().catch(() => undefined), 2000)
      })
    } catch (err) {
      log.warn('import', `Cannot watch the job inbox: ${(err as Error).message}`)
    }
    this.timer = setInterval(() => void this.scanInbox().catch(() => undefined), intervalMs)
    this.timer.unref?.()
    void this.writeSearchRequest()
    void this.scanInbox().catch(() => undefined)
  }

  stop(): void {
    this.watcher?.close()
    this.watcher = null
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
