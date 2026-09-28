import type {
  DistanceUnit,
  EmploymentType,
  SalaryPeriod,
  SearchCriteria,
  SearchIntent,
  Seniority,
  WorkMode
} from '../../../../shared/types'
import { classifyQuery } from './classify'
import { OCCUPATION_BY_ID } from './taxonomy'

/**
 * Natural-language query interpretation. Examples:
 *   "Barista jobs near me"
 *   "Entry-level warehouse jobs in Los Angeles"
 *   "Part-time hotel front desk within 10 miles"
 *   "Night shift jobs paying at least $22/hour"
 *   "Remote junior frontend developer"
 */
export interface ParsedQuery {
  keywords: string
  locationText?: string
  radius?: number
  radiusUnit?: DistanceUnit
  nearMe: boolean
  workModes: WorkMode[]
  employmentTypes: EmploymentType[]
  seniority: Seniority[]
  minimumSalary?: number
  currency?: string
  salaryPeriod?: SalaryPeriod
  schedule: string[]
  postedWithinDays?: number
  excluded: string[]
  notes: string[]
}

const EMPLOYMENT: [RegExp, EmploymentType][] = [
  [/\bpart[- ]?time\b|\bpt\b/i, 'part_time'],
  [/\bfull[- ]?time\b|\bft\b/i, 'full_time'],
  [/\b(contract|contractor|freelance|1099)\b/i, 'contract'],
  [/\b(temporary|temp|temp-to-hire|temp to hire)\b/i, 'temporary'],
  [/\b(internships?|intern)\b/i, 'internship'],
  [/\bseasonal\b/i, 'seasonal'],
  [/\bper[- ]diem\b|\bprn\b/i, 'per_diem']
]

const SENIORITY: [RegExp, Seniority][] = [
  [
    /\b(entry[- ]level|no experience( required)?|beginner|trainee|graduate|new grad|apprentice)\b/i,
    'entry'
  ],
  [/\b(junior|jr\.?)\b/i, 'junior'],
  [/\b(mid[- ]level|intermediate)\b/i, 'mid'],
  [/\b(senior|sr\.?|experienced)\b/i, 'senior'],
  [/\b(lead|principal|staff)\b/i, 'lead'],
  [/\b(manager|supervisor)\b/i, 'manager']
]

const SCHEDULE: [RegExp, string][] = [
  [/\b(night shift|overnight|graveyard|nights)\b/i, 'night'],
  [/\b(day shift|days)\b/i, 'day'],
  [/\b(evening shift|evenings|swing shift)\b/i, 'evening'],
  [/\b(weekends?|weekend shift)\b/i, 'weekend'],
  [/\b(weekdays only|monday[- ]friday|mon[- ]fri)\b/i, 'weekday']
]

const FILLER =
  /\b(find|show|search|looking|look|want|need|get|me|my|i|am|for|a|an|the|some|any|jobs?|positions?|roles?|openings?|vacanc(y|ies)|careers?|work|hiring|opportunit(y|ies)|that|which|who|with|please|available|paying|pays|pay|now|immediately|asap|near me|nearby|close to me|local)\b/gi

export function parseQuery(text: string): ParsedQuery {
  let q = ` ${text.trim()} `
  const out: ParsedQuery = {
    keywords: '',
    nearMe: false,
    workModes: [],
    employmentTypes: [],
    seniority: [],
    schedule: [],
    excluded: [],
    notes: []
  }
  const take = (re: RegExp, fn: (m: RegExpExecArray) => void): void => {
    const m = re.exec(q)
    if (m) {
      fn(m)
      q = q.replace(m[0], ' ')
    }
  }

  // radius: "within 15 miles", "15mi radius", "under 20 km"
  take(
    /\b(?:within|under|less than|up to|inside)\s+(\d+(?:\.\d+)?)\s*(mi|miles?|km|kms|kilometers?|kilometres?)\b(?:\s+(?:of|from|radius))?/i,
    (m) => {
      out.radius = Number(m[1])
      out.radiusUnit = /^k/i.test(m[2]) ? 'km' : 'mi'
    }
  )
  if (out.radius === undefined) {
    take(
      /\b(\d+(?:\.\d+)?)\s*[- ]?(mi|miles?|km|kms|kilometers?)\s*(?:radius|away|commute)?\b/i,
      (m) => {
        out.radius = Number(m[1])
        out.radiusUnit = /^k/i.test(m[2]) ? 'km' : 'mi'
      }
    )
  }

  // salary: "at least $22/hour", "paying 60k", "over €45,000 a year"
  take(
    /\b(?:at least|minimum(?: of)?|min\.?|over|above|paying|pays|starting at|from)?\s*([$€£¥₹]|usd|eur|gbp|cad|aud)?\s?(\d{1,3}(?:[,.]\d{3})+|\d+(?:\.\d+)?)\s*(k)?\s*(?:\/|per|an|a)?\s*(hour|hr|h|hourly|year|yr|annually|annual|month|mo|week|wk)?\b/i,
    (m) => {
      const hasSignal =
        m[1] || m[3] || m[4] || /at least|minimum|min|over|above|paying|pays|starting/i.test(m[0])
      if (!hasSignal) return
      let value = Number(m[2].replace(/[,](?=\d{3})/g, '').replace(/\.(?=\d{3}\b)/g, ''))
      if (m[3]) value *= 1000
      out.minimumSalary = value
      const cur = (m[1] ?? '').toLowerCase()
      out.currency =
        cur === '€' || cur === 'eur'
          ? 'EUR'
          : cur === '£' || cur === 'gbp'
            ? 'GBP'
            : cur === 'cad'
              ? 'CAD'
              : cur === 'aud'
                ? 'AUD'
                : cur === '₹'
                  ? 'INR'
                  : cur
                    ? 'USD'
                    : undefined
      const p = (m[4] ?? '').toLowerCase()
      out.salaryPeriod = /^h/.test(p)
        ? 'hour'
        : /^(y|annual)/.test(p)
          ? 'year'
          : /^mo/.test(p)
            ? 'month'
            : /^w/.test(p)
              ? 'week'
              : value < 300
                ? 'hour'
                : 'year'
    }
  )
  // Guard: a lone number that was not salary must not remain as a keyword.
  if (out.minimumSalary === undefined) q = q.replace(/\$\s?\d+/g, ' ')

  take(
    /\bposted (?:today|in the last day|in the last 24 hours)\b|\blast 24 hours\b/i,
    () => (out.postedWithinDays = 1)
  )
  take(
    /\b(?:posted )?(?:in the )?(?:last|past) (\d+) days?\b/i,
    (m) => (out.postedWithinDays = Number(m[1]))
  )
  take(/\b(?:posted )?(?:this|last|past) week\b/i, () => (out.postedWithinDays = 7))
  take(/\b(?:posted )?(?:this|last|past) month\b/i, () => (out.postedWithinDays = 30))

  if (/\b(remote|work from home|wfh|telecommute)\b/i.test(q)) {
    out.workModes.push('remote')
    q = q.replace(/\b(fully |100% )?(remote|work from home|wfh|telecommute)\b/gi, ' ')
  }
  if (/\bhybrid\b/i.test(q)) {
    out.workModes.push('hybrid')
    q = q.replace(/\bhybrid\b/gi, ' ')
  }
  if (/\b(on[- ]?site|in[- ]person|in office)\b/i.test(q)) {
    out.workModes.push('onsite')
    q = q.replace(/\b(on[- ]?site|in[- ]person|in office)\b/gi, ' ')
  }

  for (const [re, t] of EMPLOYMENT) {
    if (re.test(q)) {
      out.employmentTypes.push(t)
      q = q.replace(re, ' ')
    }
  }
  for (const [re, s] of SCHEDULE) {
    if (re.test(q)) {
      out.schedule.push(s)
      q = q.replace(re, ' ')
    }
  }
  // Seniority words that are part of occupation titles ("shift supervisor", "store manager") stay in keywords.
  for (const [re, s] of SENIORITY) {
    if (s === 'manager') continue
    if (re.test(q)) {
      out.seniority.push(s)
      q = q.replace(re, ' ')
    }
  }

  // exclusions: "not retail", "no call center", "-sales", "excluding driving"
  q = q.replace(
    /(?:\bnot|\bno|\bexcluding|\bexcept|\bwithout)\s+([a-z][a-z -]{1,30}?)(?=\s*(?:,|$|\bin\b|\bnear\b|\bwithin\b))/gi,
    (_, w: string) => {
      out.excluded.push(w.trim())
      return ' '
    }
  )
  q = q.replace(/(?:^|\s)-([a-z][\w-]{1,30})/gi, (_, w: string) => {
    out.excluded.push(w)
    return ' '
  })

  if (/\b(near me|nearby|close to me|around me|in my area|local)\b/i.test(q)) {
    out.nearMe = true
  }
  const hadRadius = out.radius !== undefined

  // location: trailing "in X", "near X", "around X", "at X"
  take(/\b(?:in|near|around|close to|based in)\s+([A-Z0-9][\w .,'’-]*?)\s*$/i, (m) => {
    const loc = m[1].trim().replace(/[.,]+$/, '')
    if (!/^(me|my area|the area)$/i.test(loc)) out.locationText = loc
  })

  if (hadRadius && !out.locationText) out.nearMe = true
  out.keywords = q.replace(FILLER, ' ').replace(/[,;]+/g, ' ').replace(/\s+/g, ' ').trim()
  return out
}

/**
 * Combines parsed natural-language hints with explicit form criteria. Explicit
 * form values always win over values parsed from text.
 */
export function buildIntent(
  criteria: SearchCriteria,
  defaults: { location?: string; radius?: number; radiusUnit?: DistanceUnit } = {}
): SearchIntent {
  const parsed = parseQuery(criteria.query ?? '')
  const notes: string[] = [...parsed.notes]
  const occupations = [
    ...new Set([
      ...classifyQuery(parsed.keywords || criteria.query || ''),
      ...(criteria.targetOccupations ?? []).filter((o) => OCCUPATION_BY_ID.has(o))
    ])
  ]
  const synonyms = new Set<string>()
  for (const id of occupations) {
    for (const t of OCCUPATION_BY_ID.get(id)?.titles.slice(0, 6) ?? []) {
      if (t.split(' ').length >= 1 && /^[a-z .&-]+$/i.test(t)) synonyms.add(t)
    }
  }
  let locationText = criteria.location?.trim() || parsed.locationText
  if (!locationText && parsed.nearMe && defaults.location) {
    locationText = defaults.location
    notes.push(`"Near me" interpreted as your profile location (${defaults.location}).`)
  }
  if (!locationText && parsed.nearMe && !defaults.location) {
    notes.push('"Near me" was requested but no location is set in your profile.')
  }
  const explicitModes =
    criteria.workModes && criteria.workModes.length ? criteria.workModes : undefined
  let workModes: WorkMode[] = explicitModes ?? (parsed.workModes.length ? parsed.workModes : [])
  if (workModes.length === 0) {
    workModes = locationText ? ['onsite', 'hybrid'] : ['onsite', 'hybrid', 'remote']
    if (locationText)
      notes.push(
        'Showing on-site and hybrid roles for this location. Tick "Remote" to include remote roles.'
      )
  }
  if (workModes.includes('remote') && workModes.length === 1 && !locationText && criteria.country) {
    locationText = criteria.country
  }
  const radius =
    criteria.radius ?? parsed.radius ?? (locationText ? (defaults.radius ?? 25) : undefined)
  const excludedOcc = [
    ...[...(criteria.excludedKeywords ?? []), ...parsed.excluded].flatMap((e) => classifyQuery(e)),
    ...(criteria.excludedOccupations ?? []).filter((o) => OCCUPATION_BY_ID.has(o))
  ]
  return {
    rawQuery: criteria.query ?? '',
    keywords: parsed.keywords ? [parsed.keywords] : [],
    normalizedOccupations: occupations,
    occupationSynonyms: [...synonyms],
    excludedOccupations: [...new Set(excludedOcc)].filter((o) => !occupations.includes(o)),
    locationText,
    radius,
    radiusUnit: criteria.radiusUnit ?? parsed.radiusUnit ?? defaults.radiusUnit ?? 'mi',
    workModes,
    employmentTypes: criteria.employmentTypes?.length
      ? criteria.employmentTypes
      : parsed.employmentTypes,
    seniority: criteria.seniority?.length ? criteria.seniority : parsed.seniority,
    minimumSalary: criteria.minSalary ?? parsed.minimumSalary,
    currency: criteria.salaryCurrency ?? parsed.currency,
    salaryPeriod: criteria.salaryPeriod ?? parsed.salaryPeriod,
    schedule: parsed.schedule,
    postedWithinDays: criteria.postedWithinDays ?? parsed.postedWithinDays,
    requiredQualifications: [],
    nearMe: parsed.nearMe,
    excludedKeywords: [...(criteria.excludedKeywords ?? []), ...parsed.excluded],
    excludedCompanies: criteria.excludedCompanies ?? [],
    includeUnknownLocations: criteria.includeUnknownLocations ?? true,
    notes
  }
}
