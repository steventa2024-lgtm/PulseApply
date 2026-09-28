import type { OccupationTag, SearchIntent } from '../../../../shared/types'
import { OCCUPATIONS, OCCUPATION_BY_ID } from './taxonomy'

/** Lowercases a job title and removes punctuation, seniority and shift annotations. */
export function normalizeTitle(title: string): string {
  return ` ${title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/front-end/g, 'front end')
    .replace(/back-end/g, 'back end')
    .replace(/full-stack/g, 'full stack')
    .replace(/[^a-z0-9+#./ ]+/g, ' ')
    .replace(/[./](?![a-z0-9])|(?<![a-z0-9])[./]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `
}

interface TitlePhrase {
  occ: string
  phrase: string
  words: number
}

const PHRASES: TitlePhrase[] = OCCUPATIONS.flatMap((o) =>
  o.titles.map((t) => {
    const phrase = normalizeTitle(t).trim()
    return { occ: o.id, phrase, words: phrase.split(' ').length }
  })
).sort((a, b) => b.words - a.words || b.phrase.length - a.phrase.length)

function bestPhraseMatch(normalized: string): { occ: string; words: number; index: number } | undefined {
  let best: { occ: string; words: number; index: number } | undefined
  for (const p of PHRASES) {
    if (best && p.words < best.words) break
    const idx = normalized.lastIndexOf(` ${p.phrase} `)
    if (idx < 0) continue
    // Among equally long phrases prefer the later one (English head noun: "Warehouse Cashier" -> cashier).
    if (!best || p.words > best.words || idx > best.index) best = { occ: p.occ, words: p.words, index: idx }
  }
  return best
}

/**
 * Classifies a job into the taxonomy from its title (primary signal). Falls
 * back to occupation phrases in the description with lower confidence.
 */
export function classifyJob(title: string, description = ''): OccupationTag | undefined {
  const t = normalizeTitle(title)
  const m = bestPhraseMatch(t)
  if (m) {
    const occ = OCCUPATION_BY_ID.get(m.occ)!
    return { id: occ.id, label: occ.label, confidence: m.words >= 2 ? 0.95 : 0.8, basis: 'title' }
  }
  if (!description) return undefined
  const d = normalizeTitle(description.slice(0, 3000))
  const counts = new Map<string, number>()
  for (const p of PHRASES) {
    // Single generic words in descriptions ("server", "developer") are too noisy.
    if (p.words < 2 && !['barista', 'cashier', 'paralegal', 'bartender', 'housekeeper', 'janitor', 'custodian', 'phlebotomist', 'caregiver', 'receptionist', 'bookkeeper', 'dishwasher', 'electrician', 'plumber', 'welder', 'machinist'].includes(p.phrase)) continue
    let idx = d.indexOf(` ${p.phrase} `)
    while (idx >= 0) {
      counts.set(p.occ, (counts.get(p.occ) ?? 0) + p.words)
      idx = d.indexOf(` ${p.phrase} `, idx + 1)
    }
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  if (!top || top[1] < 2) return undefined
  const occ = OCCUPATION_BY_ID.get(top[0])!
  return { id: occ.id, label: occ.label, confidence: 0.5, basis: 'description' }
}

/** Maps search text onto occupations (primary first). */
export function classifyQuery(text: string): string[] {
  const t = normalizeTitle(text)
  const out: string[] = []
  const m = bestPhraseMatch(t)
  if (m) out.push(m.occ)
  for (const o of OCCUPATIONS) {
    for (const w of o.queryWords ?? []) {
      if (t.includes(` ${normalizeTitle(w).trim()} `) && !out.includes(o.id)) {
        // Query words only add occupations when no more specific title phrase matched in the same family.
        if (!m || OCCUPATION_BY_ID.get(m.occ)!.family !== o.family || m.words < 2) out.push(o.id)
      }
    }
  }
  if (/\bdrivers?\b/.test(t) && !out.some((o) => o.includes('driver'))) out.push('delivery_driver', 'truck_driver')
  return out.slice(0, 4)
}

export function areRelated(a: string, b: string): boolean {
  return !!(OCCUPATION_BY_ID.get(a)?.related.includes(b) || OCCUPATION_BY_ID.get(b)?.related.includes(a))
}

const GENERIC_QUERY_WORDS = new Set([
  'job', 'jobs', 'work', 'position', 'positions', 'role', 'roles', 'opening', 'openings', 'hiring', 'career', 'careers',
  'vacancy', 'vacancies', 'associate', 'specialist', 'assistant', 'worker', 'staff', 'team', 'member', 'the', 'and', 'or',
  'a', 'an', 'of', 'for', 'with', 'in', 'at', 'to', 'senior', 'junior', 'entry', 'level', 'lead', 'i', 'ii', 'iii', 'sr', 'jr'
])

export function significantTokens(text: string): string[] {
  return normalizeTitle(text)
    .trim()
    .split(' ')
    .filter((w) => w.length > 1 && !GENERIC_QUERY_WORDS.has(w))
}

export interface Relevance {
  score: number
  basis: string
}

/** Minimum relevance for a job to appear in search results at all. */
export const RELEVANCE_THRESHOLD = 0.45

/**
 * Occupational relevance of a job to the search, 0..1. Title and occupation are
 * the primary signals; the description is secondary evidence only.
 */
export function computeRelevance(
  job: { title: string; description: string; occupation?: OccupationTag },
  intent: Pick<SearchIntent, 'normalizedOccupations' | 'excludedOccupations' | 'keywords'>
): Relevance {
  const jobOcc = job.occupation?.id
  if (jobOcc && intent.excludedOccupations.includes(jobOcc)) {
    return { score: 0, basis: `Excluded occupation (${job.occupation!.label})` }
  }
  const titleNorm = normalizeTitle(job.title)
  const tokens = intent.keywords.flatMap((k) => significantTokens(k))
  const titleHits = tokens.filter((t) => titleNorm.includes(` ${t} `)).length
  const titleFrac = tokens.length ? titleHits / tokens.length : 0

  if (intent.normalizedOccupations.length) {
    if (jobOcc && intent.normalizedOccupations.includes(jobOcc)) {
      return job.occupation!.basis === 'title'
        ? { score: 1, basis: `Same occupation (${job.occupation!.label})` }
        : { score: 0.75, basis: `Same occupation, inferred from description (${job.occupation!.label})` }
    }
    if (jobOcc && intent.normalizedOccupations.some((o) => areRelated(o, jobOcc))) {
      return { score: Math.min(0.85, 0.6 + 0.25 * titleFrac), basis: `Related occupation (${job.occupation!.label})` }
    }
    if (titleFrac >= 0.5) {
      return { score: 0.5 + 0.2 * titleFrac, basis: 'Search terms appear in the job title' }
    }
    return {
      score: jobOcc ? 0.05 : 0.15 * titleFrac,
      basis: jobOcc ? `Different occupation (${job.occupation!.label})` : 'Job title does not match the searched occupation'
    }
  }

  // Query not understood as a known occupation: fall back to term matching.
  if (tokens.length === 0) return { score: 0.5, basis: 'No specific occupation requested' }
  const descNorm = normalizeTitle(job.description.slice(0, 4000))
  const descFrac = tokens.filter((t) => descNorm.includes(` ${t} `)).length / tokens.length
  if (titleFrac >= 0.5) return { score: 0.6 + 0.4 * titleFrac, basis: 'Search terms appear in the job title' }
  if (titleFrac > 0) return { score: 0.5, basis: 'Some search terms appear in the job title' }
  if (descFrac === 1) return { score: 0.4, basis: 'Search terms appear only in the description' }
  return { score: 0.1 * descFrac, basis: 'Search terms not found in the title' }
}
