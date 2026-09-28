import type { NormalizedJob } from '../../../../shared/types'
import { normalizeTitle } from '../search/classify'
import { canonicalizeUrl } from '../verification/urlSafety'
import { haversineKm } from '../geo/geoService'

/**
 * Cross-source deduplication.
 *
 * Merge rules, in order of confidence:
 *  1. Same ATS posting identity (provider + board + posting id).
 *  2. Same canonical listing or application URL.
 *  3. Same normalized employer + same normalized title (including shift and
 *     schedule qualifiers) + compatible location (+ no conflicting requisition
 *     ids). "Warehouse Associate — Day Shift" and "— Night Shift" never merge.
 *
 * Merged jobs keep every source record ("Found through 3 sources"). The
 * representative record prefers employer-direct sources.
 */

const COMPANY_SUFFIXES = /\b(inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|plc|gmbh|ag|sa|s\.a|bv|b\.v|pty|llp|lp|the|group|holdings)\b/g

export function normalizeCompany(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(COMPANY_SUFFIXES, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const QUALIFIER_RE = /\b(day|days|night|nights|overnight|evening|evenings|weekend|weekends|morning|afternoon|swing|graveyard|1st|2nd|3rd|first|second|third|part time|full time|seasonal|temporary|temp|prn|per diem|remote|hybrid|i{1,3}|iv|[1-5])\b/g

export function titleQualifiers(title: string): string {
  const t = normalizeTitle(title)
  return [...new Set((t.match(QUALIFIER_RE) ?? []).map((q) => q.trim()))].sort().join('|')
}

export function titleKey(title: string): string {
  return normalizeTitle(title)
    .replace(QUALIFIER_RE, ' ')
    .replace(/\b(shift|m\/w\/d|m\/f\/d|w\/m\/d|h\/f|f\/h)\b/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ')
}

function locationsCompatible(a: NormalizedJob, b: NormalizedJob): boolean {
  const la = a.locations.filter((l) => l.precision !== 'none')
  const lb = b.locations.filter((l) => l.precision !== 'none')
  const remoteA = a.workModes.includes('remote')
  const remoteB = b.workModes.includes('remote')
  if (la.length === 0 || lb.length === 0) {
    // Both remote with no physical location: compatible. Otherwise require a matching description start.
    if (remoteA && remoteB) return true
    const da = a.description.slice(0, 300).toLowerCase()
    const db = b.description.slice(0, 300).toLowerCase()
    return da.length > 80 && da === db
  }
  for (const x of la) {
    for (const y of lb) {
      if (x.coordinates && y.coordinates && haversineKm(x.coordinates, y.coordinates) <= 15) return true
      if (x.city && y.city && x.city.toLowerCase() === y.city.toLowerCase() && (!x.country || !y.country || x.country === y.country)) return true
    }
  }
  return false
}

function fuzzyKey(j: NormalizedJob): string {
  return `${normalizeCompany(j.company)}::${titleKey(j.title)}::${titleQualifiers(j.title)}`
}

function requisitionConflict(a: NormalizedJob, b: NormalizedJob): boolean {
  const ra = a.ats?.requisitionId
  const rb = b.ats?.requisitionId
  if (ra && rb && ra !== rb) return true
  const pa = a.ats?.postingId
  const pb = b.ats?.postingId
  if (pa && pb && a.ats?.provider === b.ats?.provider && pa !== pb) return true
  return false
}

function rank(j: NormalizedJob): number {
  const direct = j.sources.some((s) => s.employerDirect) ? 1000 : 0
  return direct + Math.min(j.description.length, 5000) / 10 + (j.salary ? 50 : 0) + (j.applyUrl ? 20 : 0)
}

function mergeInto(target: NormalizedJob, other: NormalizedJob): NormalizedJob {
  const [primary, secondary] = rank(other) > rank(target) ? [other, target] : [target, other]
  const sources = [...primary.sources]
  for (const s of secondary.sources) {
    if (!sources.some((x) => x.providerId === s.providerId && x.sourceJobId === s.sourceJobId)) sources.push(s)
  }
  const directApply = sources.find((s) => s.employerDirect && s.applyUrl)?.applyUrl
  const earliestPosted = [primary.postedAt, secondary.postedAt].filter(Boolean).sort()[0]
  return {
    ...primary,
    applyUrl: directApply ?? primary.applyUrl ?? secondary.applyUrl,
    salary: primary.salary ?? secondary.salary,
    postedAt: earliestPosted ?? primary.postedAt,
    locations: primary.locations.length ? primary.locations : secondary.locations,
    verificationStatus: sources.some((s) => s.employerDirect) && primary.verificationStatus === 'SOURCE_CONFIRMED' ? 'EMPLOYER_CONFIRMED' : primary.verificationStatus,
    verificationNotes: [...new Set([...primary.verificationNotes, ...secondary.verificationNotes])].slice(0, 8),
    scamSignals: [...new Set([...primary.scamSignals, ...secondary.scamSignals])],
    sources
  }
}

export interface DedupeResult {
  jobs: NormalizedJob[]
  merged: number
}

export function dedupeJobs(input: NormalizedJob[]): DedupeResult {
  const byKey = new Map<string, NormalizedJob>()
  let merged = 0

  // 1. exact canonical identity
  for (const j of input) {
    const prev = byKey.get(j.canonicalKey)
    if (prev) {
      byKey.set(j.canonicalKey, mergeInto(prev, j))
      merged++
    } else byKey.set(j.canonicalKey, j)
  }

  // 2. same canonical URL
  const byUrl = new Map<string, string>()
  for (const [key, j] of [...byKey.entries()]) {
    const urls = [j.sourceUrl, j.applyUrl, ...j.sources.map((s) => s.applyUrl)].map((u) => canonicalizeUrl(u)).filter(Boolean) as string[]
    let target: string | undefined
    for (const u of urls) {
      const k = byUrl.get(u)
      if (k && k !== key && byKey.has(k) && !requisitionConflict(byKey.get(k)!, j)) {
        target = k
        break
      }
    }
    if (target) {
      byKey.set(target, mergeInto(byKey.get(target)!, j))
      byKey.delete(key)
      merged++
    } else {
      for (const u of urls) if (!byUrl.has(u)) byUrl.set(u, key)
    }
  }

  // 3. fuzzy employer + title + qualifiers + location
  const buckets = new Map<string, string[]>()
  for (const [key, j] of byKey) {
    const fk = fuzzyKey(j)
    const list = buckets.get(fk) ?? []
    let mergedHere = false
    for (const otherKey of list) {
      const other = byKey.get(otherKey)
      if (!other) continue
      if (requisitionConflict(other, j) || !locationsCompatible(other, j)) continue
      // Two different postings on the same employer board are separate openings.
      if (other.ats?.postingId && j.ats?.postingId && other.ats.provider === j.ats.provider) continue
      byKey.set(otherKey, mergeInto(other, j))
      byKey.delete(key)
      merged++
      mergedHere = true
      break
    }
    if (!mergedHere) {
      list.push(key)
      buckets.set(fk, list)
    }
  }

  return { jobs: [...byKey.values()], merged }
}
