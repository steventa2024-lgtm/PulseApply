import type { NormalizedJob, VerificationStatus } from '../../../../shared/types'
import type { HttpClient } from '../adapters/http'
import { HttpError, RateLimitedError } from '../adapters/http'
import { assertPublicUrl, baseDomain } from './urlSafety'
import { isKnownJobPlatform } from './scam'
import { extractJsonLd } from '../providers/careerPages'

export interface AvailabilityResult {
  status: VerificationStatus
  note: string
  redirectWarning?: string
}

const CLOSED_TEXT =
  /(no longer (available|accepting applications|open)|position has been filled|job (has )?(expired|closed)|this (job|posting|position) (is )?(closed|no longer)|not accepting applications|the job you are looking for (is no longer|was not found)|stelle (ist )?(nicht mehr|bereits besetzt))/i

/**
 * Re-checks whether a posting is still live.
 *  - Employer ATS postings are checked against the ATS API (authoritative).
 *  - Other postings: the listing page is fetched; 404/410 means removed,
 *    explicit "no longer accepting" text or a past validThrough means expired.
 *  - Rate limits, 401/403, timeouts and 5xx never mark a job closed: they
 *    yield VERIFICATION_FAILED with an explanation (status unknown).
 */
export async function checkAvailability(
  http: HttpClient,
  job: NormalizedJob,
  signal?: AbortSignal
): Promise<AvailabilityResult> {
  const ats = job.ats
  try {
    if (ats?.postingId && ats.board) {
      const url =
        ats.provider === 'greenhouse'
          ? `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(ats.board)}/jobs/${encodeURIComponent(ats.postingId)}`
          : ats.provider === 'lever'
            ? `https://api.lever.co/v0/postings/${encodeURIComponent(ats.board)}/${encodeURIComponent(ats.postingId)}`
            : ats.provider === 'smartrecruiters'
              ? `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(ats.board)}/postings/${encodeURIComponent(ats.postingId)}`
              : undefined
      if (url) {
        const res = await http.request({
          url,
          signal,
          acceptStatuses: [404, 410],
          retries: 1,
          timeoutMs: 15_000
        })
        if (res.status === 404 || res.status === 410)
          return {
            status: 'REMOVED',
            note: `The employer's ${ats.provider} board no longer lists this posting.`
          }
        return {
          status: 'EMPLOYER_CONFIRMED',
          note: `Still published on the employer's ${ats.provider} board.`
        }
      }
      if (ats.provider === 'ashby') {
        const res = await http.json<{ jobs?: { id: string }[] }>({
          url: `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(ats.board)}`,
          signal,
          retries: 1
        })
        return (res.jobs ?? []).some((j) => j.id === ats.postingId)
          ? { status: 'EMPLOYER_CONFIRMED', note: "Still published on the employer's Ashby board." }
          : { status: 'REMOVED', note: "The employer's Ashby board no longer lists this posting." }
      }
    }

    const target = job.canonicalJobUrl ?? job.sourceUrl
    await assertPublicUrl(target)
    const res = await http.request({
      url: target,
      signal,
      acceptStatuses: [404, 410],
      retries: 1,
      timeoutMs: 15_000,
      maxBytes: 3 * 1024 * 1024
    })
    let redirectWarning: string | undefined
    const from = baseDomain(target)
    const to = baseDomain(res.url)
    if (
      from &&
      to &&
      from !== to &&
      !isKnownJobPlatform(to) &&
      !(job.companyWebsite && baseDomain(job.companyWebsite) === to)
    ) {
      redirectWarning = `The listing redirects to an unrelated site (${to}).`
    }
    if (res.status === 404 || res.status === 410)
      return {
        status: 'REMOVED',
        note: `The listing page returned HTTP ${res.status}.`,
        redirectWarning
      }
    for (const jp of extractJsonLd(res.text)) {
      const until = typeof jp.validThrough === 'string' ? Date.parse(jp.validThrough) : NaN
      if (Number.isFinite(until) && until < Date.now())
        return {
          status: 'EXPIRED',
          note: `The posting's validThrough date (${String(jp.validThrough).slice(0, 10)}) has passed.`,
          redirectWarning
        }
    }
    const text = res.text.replace(/<[^>]+>/g, ' ').slice(0, 200_000)
    if (CLOSED_TEXT.test(text))
      return {
        status: 'EXPIRED',
        note: 'The listing page says the position is closed or no longer accepting applications.',
        redirectWarning
      }
    const direct = job.sources.some((s) => s.employerDirect)
    return {
      status: direct ? 'EMPLOYER_CONFIRMED' : 'SOURCE_CONFIRMED',
      note: `Listing page loaded (HTTP ${res.status}).`,
      redirectWarning
    }
  } catch (err) {
    const reason =
      err instanceof RateLimitedError
        ? 'the site rate-limited the check'
        : err instanceof HttpError && err.status
          ? `the site answered HTTP ${err.status}`
          : (err as Error).message
    return {
      status: 'VERIFICATION_FAILED',
      note: `Could not verify availability (${reason}). This does not mean the job is closed.`
    }
  }
}
