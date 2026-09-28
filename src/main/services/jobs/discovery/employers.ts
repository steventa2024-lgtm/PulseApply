import type { AtsProvider, EmployerRecord, SearchIntent } from '../../../../shared/types'
import type { Store } from '../../persistence/store'
import type { HttpClient } from '../adapters/http'
import { validateBoard } from '../providers/ats'
import { detectAtsFromUrl, detectAtsInHtml, type AtsRef } from './atsDetect'
import { crawlCareerPage, extractJsonLd } from '../providers/careerPages'
import { assertPublicUrl, canonicalizeUrl } from '../verification/urlSafety'
import { isAllowed, robotsFor } from './robots'
import { OCCUPATION_BY_ID } from '../search/taxonomy'
import { log } from '../../logger'

export interface EmployerCandidate {
  provider: Exclude<AtsProvider, 'jsonld'>
  boardId: string
  name?: string
  jobCount?: number
  exampleUrl?: string
  alreadyRegistered: boolean
}

export class EmployerError extends Error {}

/**
 * Employer registry management: adding career pages or ATS boards (always
 * validated against the live public API before saving) and optional
 * search-engine-assisted discovery of boards for a local search.
 */
export class EmployerService {
  constructor(
    private readonly store: Store,
    private readonly http: HttpClient
  ) {}

  list(): EmployerRecord[] {
    return this.store.employers.list()
  }

  remove(id: string): void {
    this.store.employers.delete(id)
  }

  async addBoard(input: { provider: Exclude<AtsProvider, 'jsonld'>; boardId: string; name?: string; country?: string; careersUrl?: string; addedBy?: 'user' | 'discovery' }, signal?: AbortSignal): Promise<EmployerRecord> {
    const boardId = input.boardId.trim()
    if (!/^[A-Za-z0-9][A-Za-z0-9 ._%-]{0,99}$/.test(boardId) || (input.provider !== 'ashby' && boardId.includes(' '))) throw new EmployerError('That board identifier is not valid')
    const v = await validateBoard(this.http, input.provider, boardId, signal)
    if (!v.ok) throw new EmployerError(v.error ?? 'Could not validate that job board')
    return this.store.employers.upsert({
      name: input.name?.trim() || v.name || boardId,
      atsProvider: input.provider,
      boardId,
      careersUrl: input.careersUrl,
      country: input.country,
      locations: [],
      status: 'active',
      statusDetail: v.count !== undefined ? `Validated: ${v.count} open posting(s)` : 'Validated',
      jobCount: v.count,
      addedBy: input.addedBy ?? 'user'
    })
  }

  /**
   * Adds an employer from any careers URL: a direct ATS link, a career page
   * that embeds/links an ATS board, or a page publishing JobPosting data.
   */
  async addFromUrl(rawUrl: string, opts: { name?: string; country?: string } = {}, signal?: AbortSignal): Promise<EmployerRecord[]> {
    const url = canonicalizeUrl(rawUrl.trim())
    if (!url) throw new EmployerError('Enter a valid http(s) URL')
    const direct = detectAtsFromUrl(url)
    if (direct) return [await this.addBoard({ provider: direct.provider, boardId: direct.board, name: opts.name, country: opts.country, careersUrl: url }, signal)]

    const u = await assertPublicUrl(url).catch((e: Error) => {
      throw new EmployerError(e.message)
    })
    const rules = await robotsFor(this.http, u.origin, signal)
    if (!isAllowed(rules, u.pathname + u.search)) {
      throw new EmployerError('This site’s robots.txt does not allow automated access to that page. Open it manually instead.')
    }
    const res = await this.http.request({ url: u.toString(), signal, timeoutMs: 15_000, retries: 1, maxBytes: 3 * 1024 * 1024 })
    const refs = detectAtsInHtml(res.text)
    const added: EmployerRecord[] = []
    const errors: string[] = []
    for (const ref of refs.slice(0, 3)) {
      try {
        added.push(await this.addBoard({ provider: ref.provider, boardId: ref.board, name: opts.name, country: opts.country, careersUrl: url }, signal))
      } catch (err) {
        errors.push(`${ref.provider}/${ref.board}: ${(err as Error).message}`)
      }
    }
    if (added.length) return added

    const postings = extractJsonLd(res.text)
    const crawl = postings.length ? { drafts: postings, pagesFetched: 1 } : await crawlCareerPage(this.http, u.toString(), opts.name ?? u.hostname, signal ?? new AbortController().signal, 5)
    const found = 'drafts' in crawl ? crawl.drafts.length : 0
    if (found > 0) {
      const name =
        opts.name ??
        ((postings[0]?.hiringOrganization as Record<string, unknown> | undefined)?.name as string | undefined) ??
        u.hostname.replace(/^www\./, '')
      return [
        this.store.employers.upsert({
          name,
          atsProvider: 'jsonld',
          boardId: u.toString(),
          careersUrl: u.toString(),
          country: opts.country,
          locations: [],
          status: 'active',
          statusDetail: `Found ${found} structured job posting(s)`,
          jobCount: found,
          addedBy: 'user'
        })
      ]
    }
    throw new EmployerError(
      errors.length
        ? `Found job board links but none validated: ${errors.join('; ')}`
        : 'No supported job board (Greenhouse, Lever, Ashby, SmartRecruiters) or structured JobPosting data was found on that page.'
    )
  }

  /**
   * Uses the Brave Search API (licensed, key required) to find public ATS
   * boards mentioning the searched occupation near the searched city.
   * Results are validated before being suggested; nothing is saved until the
   * user chooses to add a board.
   */
  async discover(intent: SearchIntent, signal?: AbortSignal): Promise<EmployerCandidate[]> {
    const key = this.store.secrets.get('brave.apiKey')
    if (!key) throw new EmployerError('Add a Brave Search API key on the Sources page to enable employer discovery.')
    const occ = intent.normalizedOccupations[0] ? OCCUPATION_BY_ID.get(intent.normalizedOccupations[0])?.label : undefined
    const what = occ ?? intent.keywords[0] ?? ''
    const where = intent.location?.city ?? intent.location?.region ?? intent.locationText ?? ''
    if (!what) throw new EmployerError('Enter an occupation or keywords first.')
    const sites = ['boards.greenhouse.io', 'job-boards.greenhouse.io', 'jobs.lever.co', 'jobs.ashbyhq.com', 'jobs.smartrecruiters.com']
    const refs = new Map<string, AtsRef & { url: string }>()
    for (const site of sites) {
      if (signal?.aborted) break
      const q = `site:${site} "${what}"${where ? ` "${where}"` : ''}`
      try {
        const data = await this.http.json<{ web?: { results?: { url: string }[] } }>({
          url: `https://api.search.brave.com/res/v1/web/search?count=20&q=${encodeURIComponent(q)}`,
          headers: { 'X-Subscription-Token': key, Accept: 'application/json' },
          signal,
          timeoutMs: 15_000
        })
        for (const r of data.web?.results ?? []) {
          const ref = detectAtsFromUrl(r.url)
          if (ref) refs.set(`${ref.provider}:${ref.board.toLowerCase()}`, { ...ref, url: r.url })
        }
      } catch (err) {
        log.warn('discovery', `Brave search failed for ${site}: ${(err as Error).message}`)
      }
    }
    const out: EmployerCandidate[] = []
    for (const ref of [...refs.values()].slice(0, 15)) {
      const v = await validateBoard(this.http, ref.provider, ref.board, signal)
      if (!v.ok) continue
      out.push({
        provider: ref.provider,
        boardId: ref.board,
        name: v.name,
        jobCount: v.count,
        exampleUrl: ref.url,
        alreadyRegistered: !!this.store.employers.find(ref.provider, ref.board)
      })
    }
    return out
  }
}
