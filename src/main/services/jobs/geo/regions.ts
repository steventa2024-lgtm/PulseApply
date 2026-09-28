/**
 * Administrative-region and country reference data used to interpret free-text
 * locations. Country names come from ICU (`Intl.DisplayNames`), so every ISO
 * 3166-1 country is recognised without a hand-maintained list.
 */

export function normalizePlace(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bst\b/g, 'saint')
    .replace(/\bste\b/g, 'sainte')
    .replace(/\bft\b/g, 'fort')
    .replace(/\bmt\b/g, 'mount')
    .trim()
}

/** US states + DC + territories: [code, name]. GeoNames uses the postal code as admin1 for the US. */
export const US_STATES: [string, string][] = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'],
  ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'], ['DC', 'District of Columbia'], ['FL', 'Florida'],
  ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'],
  ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'],
  ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'], ['MO', 'Missouri'],
  ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'],
  ['NM', 'New Mexico'], ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'],
  ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'],
  ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'],
  ['VA', 'Virginia'], ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
  ['PR', 'Puerto Rico'], ['GU', 'Guam'], ['VI', 'Virgin Islands']
]

/** [postal abbreviation, GeoNames admin1 code, name] */
export const CA_PROVINCES: [string, string, string][] = [
  ['AB', '01', 'Alberta'], ['BC', '02', 'British Columbia'], ['MB', '03', 'Manitoba'], ['NB', '04', 'New Brunswick'],
  ['NL', '05', 'Newfoundland and Labrador'], ['NS', '07', 'Nova Scotia'], ['ON', '08', 'Ontario'],
  ['PE', '09', 'Prince Edward Island'], ['QC', '10', 'Quebec'], ['SK', '11', 'Saskatchewan'], ['YT', '12', 'Yukon'],
  ['NT', '13', 'Northwest Territories'], ['NU', '14', 'Nunavut']
]

export const AU_STATES: [string, string, string][] = [
  ['ACT', '01', 'Australian Capital Territory'], ['NSW', '02', 'New South Wales'], ['NT', '03', 'Northern Territory'],
  ['QLD', '04', 'Queensland'], ['SA', '05', 'South Australia'], ['TAS', '06', 'Tasmania'], ['VIC', '07', 'Victoria'],
  ['WA', '08', 'Western Australia']
]

export const GB_NATIONS: [string, string][] = [
  ['ENG', 'England'], ['SCT', 'Scotland'], ['WLS', 'Wales'], ['NIR', 'Northern Ireland']
]

export interface RegionMatch {
  country: string
  admin1: string
  name: string
}

const regionIndex = new Map<string, RegionMatch[]>()
function addRegion(key: string, m: RegionMatch): void {
  const k = normalizePlace(key)
  const list = regionIndex.get(k) ?? []
  list.push(m)
  regionIndex.set(k, list)
}
for (const [code, name] of US_STATES) {
  addRegion(code, { country: 'US', admin1: code, name })
  addRegion(name, { country: 'US', admin1: code, name })
}
addRegion('Washington DC', { country: 'US', admin1: 'DC', name: 'District of Columbia' })
addRegion('D.C.', { country: 'US', admin1: 'DC', name: 'District of Columbia' })
for (const [abbr, code, name] of CA_PROVINCES) {
  addRegion(abbr, { country: 'CA', admin1: code, name })
  addRegion(name, { country: 'CA', admin1: code, name })
}
for (const [abbr, code, name] of AU_STATES) {
  addRegion(abbr, { country: 'AU', admin1: code, name })
  addRegion(name, { country: 'AU', admin1: code, name })
}
for (const [code, name] of GB_NATIONS) {
  addRegion(name, { country: 'GB', admin1: code, name })
}

export function lookupRegion(text: string): RegionMatch[] {
  return regionIndex.get(normalizePlace(text)) ?? []
}

export function regionName(country: string | undefined, admin1: string | undefined): string | undefined {
  if (!country || !admin1) return undefined
  if (country === 'US') return US_STATES.find(([c]) => c === admin1)?.[0]
  if (country === 'CA') return CA_PROVINCES.find(([, c]) => c === admin1)?.[0]
  if (country === 'AU') return AU_STATES.find(([, c]) => c === admin1)?.[0]
  if (country === 'GB') return GB_NATIONS.find(([c]) => c === admin1)?.[1]
  return undefined
}

// ---------------------------------------------------------------------------
// Countries
// ---------------------------------------------------------------------------

const COUNTRY_ALIASES: Record<string, string> = {
  usa: 'US', 'u s a': 'US', 'u s': 'US', us: 'US', america: 'US', 'united states of america': 'US',
  uk: 'GB', 'u k': 'GB', britain: 'GB', 'great britain': 'GB', england: 'GB', scotland: 'GB', wales: 'GB',
  'northern ireland': 'GB', uae: 'AE', 'south korea': 'KR', korea: 'KR', 'north korea': 'KP', russia: 'RU',
  'czech republic': 'CZ', czechia: 'CZ', holland: 'NL', 'the netherlands': 'NL', deutschland: 'DE',
  espana: 'ES', 'hong kong': 'HK', 'ivory coast': 'CI', turkey: 'TR', turkiye: 'TR', vietnam: 'VN',
  'viet nam': 'VN', 'mainland china': 'CN', prc: 'CN', taiwan: 'TW', 'the philippines': 'PH', ksa: 'SA'
}

let countryIndex: Map<string, string> | null = null
let countryNames: Map<string, string> | null = null

function buildCountryIndex(): void {
  countryIndex = new Map()
  countryNames = new Map()
  const dn = new Intl.DisplayNames(['en'], { type: 'region' })
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  for (const a of A) {
    for (const b of A) {
      const code = a + b
      let name: string | undefined
      try {
        name = dn.of(code)
      } catch {
        name = undefined
      }
      if (!name || name === code || /unknown/i.test(name)) continue
      countryNames.set(code, name)
      countryIndex.set(normalizePlace(name), code)
    }
  }
  for (const [alias, code] of Object.entries(COUNTRY_ALIASES)) countryIndex.set(normalizePlace(alias), code)
}

/** Resolves a country name, alias, or ISO alpha-2/alpha-3-ish code. Two-letter codes must be uppercase in the source. */
export function lookupCountry(text: string, allowBareCode = true): string | undefined {
  if (!countryIndex) buildCountryIndex()
  const trimmed = text.trim()
  if (allowBareCode && /^[A-Z]{2}$/.test(trimmed) && countryNames!.has(trimmed)) {
    return trimmed === 'UK' ? 'GB' : trimmed
  }
  if (trimmed === 'UK') return 'GB'
  if (/^(USA|U\.S\.A?\.?)$/.test(trimmed)) return 'US'
  return countryIndex!.get(normalizePlace(trimmed))
}

export function countryName(code: string | undefined): string | undefined {
  if (!code) return undefined
  if (!countryNames) buildCountryIndex()
  return countryNames!.get(code)
}

export function allCountries(): { code: string; name: string }[] {
  if (!countryNames) buildCountryIndex()
  return [...countryNames!.entries()]
    .filter(([code]) => !['EU', 'UN', 'EZ', 'QO', 'XA', 'XB', 'ZZ'].includes(code))
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// ---------------------------------------------------------------------------
// Macro regions used by remote-work eligibility statements
// ---------------------------------------------------------------------------

const EU = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE']
const EUROPE = [...EU, 'GB', 'NO', 'CH', 'IS', 'LI', 'AL', 'BA', 'ME', 'MK', 'RS', 'XK', 'MD', 'UA', 'BY', 'AD', 'MC', 'SM', 'VA', 'GI']
const MIDDLE_EAST = ['AE', 'SA', 'QA', 'KW', 'BH', 'OM', 'IL', 'JO', 'LB', 'TR', 'EG', 'IQ', 'IR', 'YE', 'PS', 'SY']
const AFRICA = ['ZA', 'NG', 'KE', 'EG', 'MA', 'GH', 'TN', 'DZ', 'ET', 'UG', 'TZ', 'RW', 'SN', 'CI', 'CM', 'ZW', 'ZM', 'BW', 'NA', 'MU', 'AO', 'MZ']
const LATAM = ['MX', 'BR', 'AR', 'CL', 'CO', 'PE', 'UY', 'PY', 'BO', 'EC', 'VE', 'CR', 'PA', 'GT', 'HN', 'SV', 'NI', 'DO', 'CU', 'PR', 'JM', 'TT']
const APAC = ['AU', 'NZ', 'JP', 'KR', 'CN', 'HK', 'TW', 'SG', 'MY', 'TH', 'VN', 'PH', 'ID', 'IN', 'PK', 'BD', 'LK', 'NP', 'KH', 'MM', 'MN']

export const MACRO_REGIONS: Record<string, string[]> = {
  'north-america': ['US', 'CA', 'MX'],
  americas: ['US', 'CA', ...LATAM],
  latam: LATAM,
  europe: EUROPE,
  eu: EU,
  emea: [...EUROPE, ...MIDDLE_EAST, ...AFRICA],
  'middle-east': MIDDLE_EAST,
  africa: AFRICA,
  apac: APAC,
  asia: APAC.filter((c) => !['AU', 'NZ'].includes(c)),
  oceania: ['AU', 'NZ']
}

const MACRO_ALIASES: [RegExp, string][] = [
  [/\bnorth america(n)?\b/i, 'north-america'],
  [/\b(the )?americas\b/i, 'americas'],
  [/\b(latam|latin america|south america|central america)\b/i, 'latam'],
  [/\bemea\b/i, 'emea'],
  [/\b(europe|european|cet|cest)\b/i, 'europe'],
  [/\b(eu|european union)\b/, 'eu'],
  [/\b(apac|asia[- ]pacific)\b/i, 'apac'],
  [/\basia\b/i, 'asia'],
  [/\b(middle east|mena)\b/i, 'middle-east'],
  [/\bafrica\b/i, 'africa'],
  [/\boceania\b/i, 'oceania']
]

export function detectMacroRegions(text: string): string[] {
  const out = new Set<string>()
  for (const [re, key] of MACRO_ALIASES) if (re.test(text)) out.add(key)
  return [...out]
}

export function countryInMacroRegion(country: string, region: string): boolean {
  return MACRO_REGIONS[region]?.includes(country) ?? false
}
