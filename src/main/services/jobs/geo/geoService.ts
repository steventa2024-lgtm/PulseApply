import type {
  DistanceUnit,
  GeoEligibility,
  GeoPoint,
  RemoteEligibility,
  ResolvedPlace,
  SearchIntent,
  WorkMode
} from '../../../../shared/types'
import type { Gazetteer } from './gazetteer'
import type { HttpClient } from '../adapters/http'
import type { AppDb } from '../../persistence/database'
import { json } from '../../persistence/database'
import { countryInMacroRegion, countryName, detectMacroRegions, lookupCountry, normalizePlace } from './regions'
import { log } from '../../logger'

const EARTH_RADIUS_KM = 6371.0088
export const KM_PER_MILE = 1.609344

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function toKm(value: number, unit: DistanceUnit): number {
  return unit === 'mi' ? value * KM_PER_MILE : value
}

export function fromKm(km: number, unit: DistanceUnit): number {
  return unit === 'mi' ? km / KM_PER_MILE : km
}

// ---------------------------------------------------------------------------
// Remote / work-mode text interpretation
// ---------------------------------------------------------------------------

const REMOTE_RE = /\b(remote|work from home|wfh|telecommut\w*|home[- ]based|distributed|anywhere)\b/i
const HYBRID_RE = /\bhybrid\b/i
const WORLDWIDE_RE = /\b(worldwide|world ?wide|anywhere( in the world)?|global(ly)?|any (country|location)|all countries|international)\b/i

export function isRemoteText(text: string): boolean {
  return REMOTE_RE.test(text)
}

export function isHybridText(text: string): boolean {
  return HYBRID_RE.test(text)
}

/**
 * Interprets a remote-eligibility statement such as "USA Only", "Europe",
 * "Anywhere in the World", "US, Canada", "EMEA". Never assumes worldwide:
 * a remote posting without a statement is `unspecified`.
 */
export function parseRemoteEligibility(text: string | undefined): RemoteEligibility {
  const raw = (text ?? '').trim()
  if (!raw) return { kind: 'unspecified', countries: [], regions: [], raw }
  if (WORLDWIDE_RE.test(raw) && !/\b(only|based in|must reside)\b/i.test(raw.replace(WORLDWIDE_RE, ''))) {
    return { kind: 'worldwide', countries: [], regions: [], raw }
  }
  const regions = detectMacroRegions(raw)
  const countries = new Set<string>()
  for (const token of raw.split(/[,/;|()&+]|\band\b|\bor\b/i)) {
    const t = token
      .replace(/\b(remote|only|based|within|in|the|residents?|timezones?|time zone|citizens?|work from home|anywhere|hybrid)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!t) continue
    const cc = lookupCountry(t, /^[A-Z]{2}$/.test(t))
    if (cc) countries.add(cc)
  }
  if (countries.size) return { kind: 'countries', countries: [...countries], regions, raw }
  if (regions.length) return { kind: 'regions', countries: [], regions, raw }
  return { kind: 'unspecified', countries: [], regions: [], raw }
}

export function remoteAllowsCountry(el: RemoteEligibility | undefined, country: string | undefined): boolean | null {
  if (!el || el.kind === 'unspecified') return null
  if (el.kind === 'worldwide') return true
  if (!country) return null
  if (el.countries.includes(country)) return true
  if (el.regions.some((r) => countryInMacroRegion(country, r))) return true
  return false
}

// ---------------------------------------------------------------------------
// Geo service
// ---------------------------------------------------------------------------

export class GeoService {
  private lastNominatim = 0

  constructor(
    readonly gazetteer: Gazetteer,
    private readonly db: AppDb | null,
    private readonly http: HttpClient | null,
    private readonly onlineEnabled: () => boolean
  ) {}

  /** Resolves a job's location string offline (no network per job). */
  resolveOffline(text: string): ResolvedPlace {
    return this.gazetteer.resolve(text)
  }

  /**
   * Resolves the user's search location. Falls back to OpenStreetMap
   * Nominatim (cached, max 1 request/second, per its usage policy) when the
   * offline gazetteer cannot place it and online geocoding is enabled.
   */
  async resolveSearchLocation(text: string, signal?: AbortSignal): Promise<ResolvedPlace> {
    const offline = this.gazetteer.resolve(text)
    if (offline.precision !== 'none' || !this.onlineEnabled() || !this.http) return offline
    const key = normalizePlace(text)
    const cached = this.db?.get<{ result: string | null }>('SELECT result FROM geocode_cache WHERE query = ?', [key])
    if (cached) return json<ResolvedPlace>(cached.result, offline)
    try {
      const wait = this.lastNominatim + 1100 - Date.now()
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      this.lastNominatim = Date.now()
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&q=${encodeURIComponent(text)}`
      const res = await this.http.json<
        { lat: string; lon: string; display_name: string; address?: { city?: string; town?: string; village?: string; state?: string; country_code?: string } }[]
      >({ url, timeoutMs: 10_000, retries: 1, signal })
      const hit = res[0]
      let result: ResolvedPlace = offline
      if (hit) {
        result = {
          label: hit.display_name,
          city: hit.address?.city ?? hit.address?.town ?? hit.address?.village,
          region: hit.address?.state,
          country: hit.address?.country_code?.toUpperCase(),
          coordinates: { lat: Number(hit.lat), lon: Number(hit.lon) },
          precision: 'point',
          resolution: 'geocoder',
          confidence: 0.8
        }
      }
      this.db?.run('INSERT OR REPLACE INTO geocode_cache (query, result, created_at) VALUES (?, ?, ?)', [
        key,
        JSON.stringify(result),
        new Date().toISOString()
      ])
      return result
    } catch (err) {
      log.warn('geo', `Online geocoding failed: ${(err as Error).message}`)
      return offline
    }
  }

  suggest(prefix: string): { label: string; country: string }[] {
    const out = this.gazetteer.suggest(prefix)
    const cc = lookupCountry(prefix, false)
    if (cc) out.unshift({ label: countryName(cc)!, country: cc })
    return out.slice(0, 8)
  }
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

export interface GeoEvaluation {
  eligibility: GeoEligibility
  distance?: number
  unit?: DistanceUnit
  note: string
  include: boolean
  exclusion?: 'outside_radius' | 'outside_country' | 'remote_not_requested' | 'remote_ineligible' | 'onsite_not_requested' | 'unknown_location'
}

/**
 * Decides whether a job is geographically compatible with the search.
 *
 *  - On-site/hybrid jobs with coordinates are measured against the radius.
 *  - Jobs whose confirmed country differs from the search country are excluded.
 *  - Remote jobs only qualify when remote work was requested, and only if the
 *    posting's stated eligibility covers the user's country (unspecified
 *    eligibility is kept but flagged, never presented as confirmed).
 *  - Unresolvable locations are marked unknown, never treated as local.
 */
export function evaluateGeo(
  job: { workModes: WorkMode[]; locations: ResolvedPlace[]; remoteEligibility?: RemoteEligibility },
  intent: SearchIntent
): GeoEvaluation {
  const wantsRemote = intent.workModes.includes('remote')
  const wantsOnsite = intent.workModes.includes('onsite') || intent.workModes.includes('hybrid')
  const unit = intent.radiusUnit
  const center = intent.location
  const userCountry = center?.country

  const isRemote = job.workModes.includes('remote')
  const hasPhysical = job.workModes.includes('onsite') || job.workModes.includes('hybrid') || !isRemote

  // --- Remote-capable posting ------------------------------------------------
  if (isRemote && (wantsRemote || !hasPhysical)) {
    if (!wantsRemote) {
      return { eligibility: 'remote_unspecified', include: false, exclusion: 'remote_not_requested', note: 'Remote-only role; remote work not requested' }
    }
    const allowed = remoteAllowsCountry(job.remoteEligibility, userCountry)
    if (allowed === true) {
      return {
        eligibility: 'remote_eligible',
        include: true,
        note: job.remoteEligibility?.kind === 'worldwide' ? 'Remote — worldwide (as advertised)' : `Remote — open to ${countryName(userCountry) ?? 'your country'}`
      }
    }
    if (allowed === false) {
      return {
        eligibility: 'remote_ineligible',
        include: false,
        exclusion: 'remote_ineligible',
        note: `Remote, restricted to ${job.remoteEligibility?.raw || 'other locations'}`
      }
    }
    // Unspecified eligibility: fall back to the physical/company location when it is known.
    const loc = job.locations.find((l) => l.country)
    if (loc?.country && userCountry && loc.country !== userCountry && !hasPhysical) {
      return {
        eligibility: 'remote_unspecified',
        include: intent.includeUnknownLocations,
        exclusion: intent.includeUnknownLocations ? undefined : 'unknown_location',
        note: `Remote; eligibility not stated (employer located in ${countryName(loc.country) ?? loc.country})`
      }
    }
    return {
      eligibility: 'remote_unspecified',
      include: intent.includeUnknownLocations,
      exclusion: intent.includeUnknownLocations ? undefined : 'unknown_location',
      note: 'Remote; the posting does not say which countries are eligible'
    }
  }

  // --- On-site / hybrid posting -------------------------------------------
  if (!wantsOnsite) {
    return { eligibility: 'unknown', include: false, exclusion: 'onsite_not_requested', note: 'On-site role; only remote work requested' }
  }
  if (!center || center.precision === 'none') {
    return { eligibility: 'unknown', include: true, note: 'No search location given' }
  }

  const located = job.locations.filter((l) => l.precision !== 'none')
  if (located.length === 0) {
    return {
      eligibility: 'unknown',
      include: intent.includeUnknownLocations,
      exclusion: intent.includeUnknownLocations ? undefined : 'unknown_location',
      note: 'Job location could not be determined'
    }
  }

  // Country-level search (e.g. "Germany"): match on country only.
  if (center.precision === 'country' || !center.coordinates || !intent.radius) {
    const inCountry = located.some((l) => l.country && l.country === center.country)
    const regionMatch =
      center.precision === 'region' ? located.some((l) => l.region && l.region === center.region && l.country === center.country) : true
    if (inCountry && regionMatch) return { eligibility: 'in_country', include: true, note: `In ${center.region ?? countryName(center.country) ?? center.country}` }
    if (located.every((l) => l.country && l.country !== center.country)) {
      return { eligibility: 'outside_country', include: false, exclusion: 'outside_country', note: `Located in ${located[0].label}` }
    }
    return { eligibility: 'unknown', include: intent.includeUnknownLocations, exclusion: intent.includeUnknownLocations ? undefined : 'unknown_location', note: 'Location only partly known' }
  }

  const radiusKm = toKm(intent.radius, unit)
  let best: number | undefined
  for (const l of located) {
    if (!l.coordinates) continue
    const d = haversineKm(center.coordinates, l.coordinates)
    if (best === undefined || d < best) best = d
  }
  if (best !== undefined) {
    const shown = Math.round(fromKm(best, unit) * 10) / 10
    // City-centroid precision: allow a small tolerance for large metro areas.
    const tolerance = located.some((l) => l.precision === 'city') ? 3 : 0
    if (best <= radiusKm + tolerance) {
      return { eligibility: 'within_radius', distance: shown, unit, include: true, note: `${shown} ${unit} from ${center.city ?? center.label}` }
    }
    return { eligibility: 'outside_radius', distance: shown, unit, include: false, exclusion: 'outside_radius', note: `${shown} ${unit} away (outside ${intent.radius} ${unit})` }
  }
  // Only coarse locations (country/region) known.
  if (located.every((l) => l.country && l.country !== center.country)) {
    return { eligibility: 'outside_country', include: false, exclusion: 'outside_country', note: `Located in ${located[0].label}` }
  }
  return {
    eligibility: 'unknown',
    include: intent.includeUnknownLocations,
    exclusion: intent.includeUnknownLocations ? undefined : 'unknown_location',
    note: `Only "${located[0].label}" is known; distance cannot be measured`
  }
}
