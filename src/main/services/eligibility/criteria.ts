import { createHash } from 'crypto'
import type {
  CandidateProfile,
  ResolvedPlace,
  SearchCriteria,
  SearchIntent
} from '../../../shared/types'
import { buildIntent } from '../jobs/search/intent'
import { OCCUPATION_BY_ID } from '../jobs/search/taxonomy'
import type { GeoService } from '../jobs/geo/geoService'

/** Defaults applied to every criteria object before use. Strict location filtering is the default. */
export const CRITERIA_DEFAULTS = {
  locationMode: 'strict',
  occupationMatch: 'related',
  radiusUnit: 'mi'
} as const

function cleanList(list: string[] | undefined): string[] | undefined {
  const out = [...new Set((list ?? []).map((x) => x.trim()).filter(Boolean))]
  return out.length ? out : undefined
}

/** Canonical form: trimmed strings, empty values removed, defaults filled in. */
export function normalizeCriteria(c: SearchCriteria): SearchCriteria {
  const out: SearchCriteria = {
    ...c,
    query: (c.query ?? '').trim(),
    location: c.location?.trim() || undefined,
    locationMode: c.locationMode ?? CRITERIA_DEFAULTS.locationMode,
    occupationMatch: c.occupationMatch ?? CRITERIA_DEFAULTS.occupationMatch,
    radiusUnit: c.radiusUnit ?? CRITERIA_DEFAULTS.radiusUnit,
    targetOccupations: cleanList(c.targetOccupations),
    excludedOccupations: cleanList(c.excludedOccupations),
    excludedKeywords: cleanList(c.excludedKeywords),
    excludedCompanies: cleanList(c.excludedCompanies),
    requiredSkills: cleanList(c.requiredSkills),
    preferredSkills: cleanList(c.preferredSkills),
    workModes: c.workModes?.length ? [...new Set(c.workModes)] : undefined,
    employmentTypes: c.employmentTypes?.length ? [...new Set(c.employmentTypes)] : undefined,
    seniority: c.seniority?.length ? [...new Set(c.seniority)] : undefined,
    providerIds: c.providerIds?.length ? [...new Set(c.providerIds)] : undefined,
    minimumMatchScore: c.minimumMatchScore
      ? Math.max(0, Math.min(100, c.minimumMatchScore))
      : undefined
  }
  delete out.includeUnknownLocations
  for (const k of Object.keys(out) as (keyof SearchCriteria)[])
    if (out[k] === undefined) delete out[k]
  return out
}

/** Stable key for a criteria object (order-independent). */
export function criteriaKey(c: SearchCriteria): string {
  const n = normalizeCriteria(c)
  // providerIds only select sources; they do not change which jobs are eligible.
  delete n.providerIds
  const sorted = Object.fromEntries(
    Object.entries(n)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, Array.isArray(v) ? [...v].sort() : v])
  )
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0, 16)
}

export function describeCriteria(c: SearchCriteria, intent?: SearchIntent): string {
  const occ = (c.targetOccupations ?? []).map((id) => OCCUPATION_BY_ID.get(id)?.label ?? id)
  const parts = [[c.query, ...occ].filter(Boolean).join(' + ') || 'Any occupation']
  const loc = c.location || intent?.locationText
  if (loc) {
    const r = intent?.radius ?? c.radius
    parts.push(
      `${loc}${r ? ` (${r} ${intent?.radiusUnit ?? c.radiusUnit ?? 'mi'})` : ''}${c.locationMode === 'preferred' ? ' — preferred, not required' : ''}`
    )
  }
  const modes = intent?.workModes ?? c.workModes
  if (modes?.length) parts.push(modes.join('/'))
  if (c.minimumMatchScore) parts.push(`match ≥ ${c.minimumMatchScore}`)
  return parts.join(' · ')
}

/** Criteria plus everything derived from them that the filters need (resolved location, parsed intent). */
export interface CriteriaContext {
  criteria: SearchCriteria
  intent: SearchIntent
  key: string
  label: string
}

export function profileDefaults(profile: CandidateProfile): {
  location?: string
  radius?: number
  radiusUnit?: 'mi' | 'km'
} {
  return {
    location: profile.preferences.location || profile.location.value || undefined,
    radius: profile.preferences.radius,
    radiusUnit: profile.preferences.radiusUnit
  }
}

/**
 * Builds the evaluation context. Location is resolved offline first and, when
 * enabled, online; an unresolvable location is recorded in `intent.notes` and
 * no distance filter can be applied (such jobs go to the review group).
 */
export async function resolveCriteria(
  criteria: SearchCriteria,
  deps: { geo: GeoService; profile: CandidateProfile; signal?: AbortSignal; online?: boolean }
): Promise<CriteriaContext> {
  const c = normalizeCriteria(criteria)
  const intent = buildIntent(c, profileDefaults(deps.profile))
  // Unknown locations are never mixed into the main results.
  intent.includeUnknownLocations = false
  if (intent.locationText) {
    let place: ResolvedPlace
    if (deps.online === false) place = deps.geo.resolveOffline(intent.locationText)
    else place = await deps.geo.resolveSearchLocation(intent.locationText, deps.signal)
    if (place.precision === 'none') {
      intent.notes.push(
        `Could not recognise the location “${intent.locationText}”. Jobs cannot be checked against a distance, so they are listed under “Location could not be verified”.`
      )
    } else intent.location = place
  }
  if (c.country && intent.location?.country && c.country !== intent.location.country) {
    intent.notes.push(
      `Location “${intent.location.label}” is not in the selected country ${c.country}; the location wins.`
    )
  }
  if (!intent.location && c.country && intent.workModes.includes('remote')) {
    intent.location = {
      label: c.country,
      country: c.country,
      precision: 'country',
      resolution: 'gazetteer',
      confidence: 1
    }
  }
  return { criteria: c, intent, key: criteriaKey(c), label: describeCriteria(c, intent) }
}
