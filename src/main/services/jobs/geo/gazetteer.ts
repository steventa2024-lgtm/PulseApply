import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import type { GeoPoint, ResolvedPlace } from '../../../../shared/types'
import { countryName, lookupCountry, lookupRegion, normalizePlace, regionName } from './regions'

/**
 * Offline gazetteer built from GeoNames (CC BY 4.0): every populated place with
 * at least 1,000 inhabitants plus US ZIP centroids. See scripts/build-gazetteer.mjs.
 */
interface City {
  name: string
  country: string
  admin1: string
  lat: number
  lon: number
  population: number
}

const CITY_ALIASES: Record<string, string> = {
  nyc: 'new york city',
  'new york': 'new york city',
  'new york ny': 'new york city',
  manhattan: 'new york city',
  la: 'los angeles',
  sf: 'san francisco',
  bangalore: 'bengaluru',
  bombay: 'mumbai',
  calcutta: 'kolkata',
  madras: 'chennai',
  cologne: 'koln',
  munchen: 'munich',
  frankfurt: 'frankfurt am main',
  'washington dc': 'washington d c',
  saigon: 'ho chi minh city',
  'ciudad de mexico': 'mexico city',
  cdmx: 'mexico city'
}

/** Places missing from the population-based dataset but common in job postings. */
const EXTRA_PLACES: City[] = [
  {
    name: 'Washington D.C.',
    country: 'US',
    admin1: 'DC',
    lat: 38.8951,
    lon: -77.0364,
    population: 689545
  },
  {
    name: 'Washington',
    country: 'US',
    admin1: 'DC',
    lat: 38.8951,
    lon: -77.0364,
    population: 689545
  }
]

export class Gazetteer {
  private readonly byName = new Map<string, City[]>()
  private readonly zips: Record<string, [number, number]>
  readonly size: number

  constructor(resourcesDir: string) {
    const cities = JSON.parse(
      zlib
        .gunzipSync(fs.readFileSync(path.join(resourcesDir, 'geo', 'cities.json.gz')))
        .toString('utf8')
    )
    for (const r of cities.rows as [string, string, string, string, number, number, number][]) {
      this.add({ name: r[0], country: r[2], admin1: r[3], lat: r[4], lon: r[5], population: r[6] })
    }
    for (const c of EXTRA_PLACES) this.add(c)
    this.size = cities.rows.length
    const zips = JSON.parse(
      zlib
        .gunzipSync(fs.readFileSync(path.join(resourcesDir, 'geo', 'us-zips.json.gz')))
        .toString('utf8')
    )
    this.zips = zips.zips
  }

  private add(c: City): void {
    const key = normalizePlace(c.name)
    const list = this.byName.get(key) ?? []
    list.push(c)
    this.byName.set(key, list)
  }

  private candidates(name: string): City[] {
    const key = normalizePlace(name)
    return this.byName.get(CITY_ALIASES[key] ?? key) ?? this.byName.get(key) ?? []
  }

  /** Ambiguous when another place with the same name has at least 10% of the largest one's population. */
  private isAmbiguous(name: string): boolean {
    const pops = this.candidates(name)
      .map((c) => c.population)
      .sort((a, b) => b - a)
    return pops.length > 1 && pops[1] >= pops[0] * 0.1
  }

  zip(zip: string): GeoPoint | undefined {
    const z = this.zips[zip.slice(0, 5)]
    return z ? { lat: z[0], lon: z[1] } : undefined
  }

  /** Finds the most plausible city given optional region / country constraints. */
  findCity(name: string, opts: { country?: string; admin1?: string } = {}): City | undefined {
    let list = this.candidates(name)
    if (opts.country) list = list.filter((c) => c.country === opts.country)
    if (opts.admin1) list = list.filter((c) => c.admin1 === opts.admin1)
    if (list.length === 0) return undefined
    return list.reduce((a, b) => (b.population > a.population ? b : a))
  }

  /** Autocomplete for the search form. */
  suggest(prefix: string, limit = 8): { label: string; country: string }[] {
    const p = normalizePlace(prefix)
    if (p.length < 2) return []
    const out: City[] = []
    for (const [key, list] of this.byName) {
      if (key.startsWith(p)) out.push(...list)
    }
    return out
      .sort((a, b) => b.population - a.population)
      .slice(0, limit)
      .map((c) => ({ label: formatPlace(c), country: c.country }))
  }

  /**
   * Parses a free-text location ("Los Angeles, CA", "Toronto, Ontario",
   * "90712", "Berlin, Germany", "United Kingdom") into a ResolvedPlace. Returns
   * precision 'none' when nothing reliable can be determined — callers must
   * treat that as unknown, never as a match.
   */
  resolve(text: string): ResolvedPlace {
    const raw = text.trim()
    const unresolved: ResolvedPlace = {
      label: raw,
      precision: 'none',
      resolution: 'unresolved',
      confidence: 0
    }
    if (!raw) return unresolved

    const zipMatch = /\b(\d{5})(?:-\d{4})?\b/.exec(raw)
    if (
      zipMatch &&
      (/\b(US|USA|United States)\b/i.test(raw) ||
        /^\s*\d{5}(-\d{4})?\s*$/.test(raw) ||
        /,\s*[A-Z]{2}\s+\d{5}/.test(raw))
    ) {
      const p = this.zip(zipMatch[1])
      if (p) {
        return {
          label: raw,
          country: 'US',
          coordinates: p,
          precision: 'postal',
          resolution: 'postal',
          confidence: 0.9
        }
      }
    }

    const cleaned = raw
      .replace(/\((?:[^)]*)\)/g, ' ')
      .replace(/\b(metro(politan)? area|greater|area|region|hq|headquarters|office)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    const parts = cleaned
      .split(/\s*[,/|;·•–—]\s*|\s+-\s+/)
      .map((p) => p.trim())
      .filter(Boolean)
    if (parts.length === 0) return unresolved

    // Build candidate interpretations of the trailing qualifiers. "CA" may be
    // California or Canada, "DE" Delaware or Germany, "IN" Indiana or India:
    // each reading is tried in order and the first one that yields a known city
    // wins. Two-letter uppercase US state codes are tried as states first
    // because that is how US postings are written ("Richmond, CA").
    interface Interp {
      country?: string
      admin1?: string
      cityParts: string[]
    }
    const n = parts.length
    if (n === 1) {
      const key = normalizePlace(parts[0])
      if (!CITY_ALIASES[key]) {
        const region = lookupRegion(parts[0]).find((r) => normalizePlace(r.name) === key)
        if (region) {
          return {
            label: region.name,
            region: regionName(region.country, region.admin1) ?? region.name,
            country: region.country,
            precision: 'region',
            resolution: 'gazetteer',
            confidence: 0.85
          }
        }
        const cc = lookupCountry(parts[0], false)
        if (cc)
          return {
            label: countryName(cc) ?? raw,
            country: cc,
            precision: 'country',
            resolution: 'gazetteer',
            confidence: 0.9
          }
      }
      // "Sydney NSW", "Austin TX", "Leeds United Kingdom": try trailing words as qualifiers.
      const words = parts[0].split(' ')
      for (let k = Math.min(3, words.length - 1); k >= 1; k--) {
        const tail = words.slice(words.length - k).join(' ')
        if (lookupRegion(tail).length || lookupCountry(tail, true)) {
          const r = this.resolve(`${words.slice(0, words.length - k).join(' ')}, ${tail}`)
          if (r.precision === 'city') return { ...r, confidence: Math.min(r.confidence, 0.8) }
        }
      }
    }
    const last = parts[n - 1]
    const prev = n >= 2 ? parts[n - 2] : undefined
    const lastCountry = lookupCountry(last, true)
    const lastRegions = lookupRegion(last)
    const regionInterps: Interp[] = lastRegions.map((r) => ({
      country: r.country,
      admin1: r.admin1,
      cityParts: parts.slice(0, n - 1)
    }))
    const countryInterps: Interp[] = []
    if (lastCountry) {
      if (prev) {
        for (const r of lookupRegion(prev).filter((r) => r.country === lastCountry)) {
          countryInterps.push({
            country: lastCountry,
            admin1: r.admin1,
            cityParts: parts.slice(0, n - 2)
          })
        }
      }
      countryInterps.push({ country: lastCountry, cityParts: parts.slice(0, n - 1) })
    }
    const stateCodeFirst =
      /^[A-Z]{2}$/.test(last) && lastRegions.some((r) => r.country === 'US') && n === 2
    const interps: Interp[] = stateCodeFirst
      ? [...regionInterps, ...countryInterps]
      : [...countryInterps, ...regionInterps]
    interps.push({ cityParts: parts })

    for (const it of interps) {
      if (it.cityParts.length === 0) continue
      const candidates = [it.cityParts[it.cityParts.length - 1], it.cityParts[0]]
      for (const name of candidates) {
        const city = this.findCity(name, { country: it.country, admin1: it.admin1 })
        if (!city) continue
        const ambiguous = !it.country && !it.admin1 && this.isAmbiguous(name)
        return {
          label: formatPlace(city),
          city: city.name,
          region: regionLabel(city.country, city.admin1),
          country: city.country,
          coordinates: { lat: city.lat, lon: city.lon },
          precision: 'city',
          resolution: 'gazetteer',
          confidence: ambiguous ? 0.55 : it.admin1 ? 0.9 : it.country ? 0.85 : 0.75
        }
      }
    }

    // No city: fall back to the coarsest reliable reading.
    const coarse =
      interps.find((it) => it.admin1 && it.cityParts.length === 0) ??
      interps.find((it) => it.admin1)
    const lone = n === 1
    if (coarse?.admin1 && coarse.country && (lone || coarse.cityParts.length === 0)) {
      return {
        label: raw,
        region: regionName(coarse.country, coarse.admin1) ?? coarse.admin1,
        country: coarse.country,
        precision: 'region',
        resolution: 'gazetteer',
        confidence: 0.8
      }
    }
    if (lastCountry && (lone || !lastRegions.length)) {
      return {
        label: lone ? (countryName(lastCountry) ?? raw) : raw,
        country: lastCountry,
        precision: 'country',
        resolution: 'gazetteer',
        confidence: lone ? 0.9 : 0.6
      }
    }
    if (coarse?.admin1 && coarse.country) {
      return {
        label: raw,
        region: regionName(coarse.country, coarse.admin1) ?? coarse.admin1,
        country: coarse.country,
        precision: 'region',
        resolution: 'gazetteer',
        confidence: 0.6
      }
    }
    return unresolved
  }
}

export function formatPlace(c: City): string {
  const region = regionName(c.country, c.admin1)
  if (c.country === 'US' || c.country === 'CA' || c.country === 'AU')
    return `${c.name}, ${region ?? c.admin1}${c.country === 'US' ? '' : ', ' + (countryName(c.country) ?? c.country)}`
  return `${c.name}, ${countryName(c.country) ?? c.country}`
}

function regionLabel(country: string, admin1: string): string | undefined {
  const named = regionName(country, admin1)
  if (named) return named
  return admin1 && !/^\d+$/.test(admin1) ? admin1 : undefined
}
