import type { ApplicationSupport, AtsProvider } from '../../../../shared/types'
import { parseHttpUrl } from '../verification/urlSafety'

export interface AtsRef {
  provider: Exclude<AtsProvider, 'jsonld'>
  board: string
  postingId?: string
}

const BOARD_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/
/** Ashby job-board names may contain spaces (URL-encoded in links). */
const ASHBY_BOARD_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,99}$/

/**
 * Recognises public ATS job-board and posting URLs:
 *  - Greenhouse: boards.greenhouse.io/{board}[/jobs/{id}], job-boards.greenhouse.io/{board}/jobs/{id},
 *    boards.greenhouse.io/embed/job_board?for={board}
 *  - Lever: jobs.lever.co/{company}[/{uuid}[/apply]] (also jobs.eu.lever.co)
 *  - Ashby: jobs.ashbyhq.com/{board}[/{uuid}[/application]]
 *  - SmartRecruiters: jobs.smartrecruiters.com/{company}[/{id-slug}], careers.smartrecruiters.com/{company}
 */
export function detectAtsFromUrl(value: string | undefined): AtsRef | undefined {
  const url = parseHttpUrl(value)
  if (!url) return undefined
  const host = url.hostname.toLowerCase()
  const seg = url.pathname.split('/').filter(Boolean)

  if (host === 'boards.greenhouse.io' || host === 'job-boards.greenhouse.io' || host === 'job-boards.eu.greenhouse.io' || host === 'boards.eu.greenhouse.io') {
    if (seg[0] === 'embed') {
      const board = url.searchParams.get('for') ?? undefined
      const postingId = url.searchParams.get('token') ?? undefined
      return board && BOARD_RE.test(board) ? { provider: 'greenhouse', board, postingId } : undefined
    }
    if (!seg[0] || !BOARD_RE.test(seg[0])) return undefined
    const jobIdx = seg.indexOf('jobs')
    return { provider: 'greenhouse', board: seg[0], postingId: jobIdx >= 0 && /^\d+$/.test(seg[jobIdx + 1] ?? '') ? seg[jobIdx + 1] : undefined }
  }
  if (host === 'jobs.lever.co' || host === 'jobs.eu.lever.co') {
    if (!seg[0] || !BOARD_RE.test(seg[0])) return undefined
    return { provider: 'lever', board: seg[0], postingId: /^[0-9a-f-]{36}$/i.test(seg[1] ?? '') ? seg[1] : undefined }
  }
  if (host === 'jobs.ashbyhq.com') {
    if (!seg[0] || !ASHBY_BOARD_RE.test(decodeURIComponent(seg[0]))) return undefined
    return { provider: 'ashby', board: decodeURIComponent(seg[0]), postingId: /^[0-9a-f-]{36}$/i.test(seg[1] ?? '') ? seg[1] : undefined }
  }
  if (host === 'jobs.smartrecruiters.com' || host === 'careers.smartrecruiters.com') {
    if (!seg[0] || !BOARD_RE.test(seg[0])) return undefined
    const idMatch = /^(\d{6,})/.exec(seg[1] ?? '')
    return { provider: 'smartrecruiters', board: seg[0], postingId: idMatch?.[1] }
  }
  return undefined
}

/** Finds ATS board references inside careers-page HTML (links, iframes, embed scripts). */
export function detectAtsInHtml(html: string): AtsRef[] {
  const found = new Map<string, AtsRef>()
  const urlRe = /https?:\/\/(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/[^\s"'<>)]+|https?:\/\/jobs(?:\.eu)?\.lever\.co\/[^\s"'<>)]+|https?:\/\/jobs\.ashbyhq\.com\/[^\s"'<>)]+|https?:\/\/(?:jobs|careers)\.smartrecruiters\.com\/[^\s"'<>)]+/gi
  for (const m of html.matchAll(urlRe)) {
    const ref = detectAtsFromUrl(m[0].replace(/&amp;/g, '&'))
    if (ref) found.set(`${ref.provider}:${ref.board.toLowerCase()}`, { provider: ref.provider, board: ref.board })
  }
  const ghEmbed = /greenhouse\.io\/embed\/job_board\/js\?for=([A-Za-z0-9._-]+)/i.exec(html)
  if (ghEmbed) found.set(`greenhouse:${ghEmbed[1].toLowerCase()}`, { provider: 'greenhouse', board: ghEmbed[1] })
  const ashbyEmbed = /jobs\.ashbyhq\.com\/([A-Za-z0-9._%-]+)\/embed/i.exec(html)
  if (ashbyEmbed) found.set(`ashby:${ashbyEmbed[1].toLowerCase()}`, { provider: 'ashby', board: decodeURIComponent(ashbyEmbed[1]) })
  return [...found.values()]
}

/** Which application adapter should handle a URL. */
export function applicationSupportFor(applyUrl: string | undefined, sourceUrl: string | undefined): ApplicationSupport {
  const ref = detectAtsFromUrl(applyUrl) ?? detectAtsFromUrl(sourceUrl)
  if (ref) return ref.provider
  return applyUrl || sourceUrl ? 'generic' : 'manual'
}
