import { createHash } from 'crypto'
import { z } from 'zod'
import type {
  EmploymentType,
  NormalizedJob,
  ResolvedPlace,
  Salary,
  Seniority,
  VerificationStatus,
  WorkMode
} from '../../../../shared/types'
import type { DraftJob } from '../providers/types'
import type { GeoService } from '../geo/geoService'
import { isHybridText, isRemoteText, parseRemoteEligibility } from '../geo/geoService'
import { cleanInline, htmlToText, splitSections } from './text'
import { annualize, parseSalaryText } from './salary'
import { classifyJob, normalizeTitle } from '../search/classify'
import { findCertifications, findSkills } from '../search/skills'
import { canonicalizeUrl, isPublicHttpUrl } from '../verification/urlSafety'
import { scamSignals } from '../verification/scam'
import { applicationSupportFor, detectAtsFromUrl } from '../discovery/atsDetect'

/** Runtime validation for provider output before anything enters the job index. */
export const DraftJobSchema = z.object({
  sourceJobId: z.string().trim().min(1).max(300),
  sourceUrl: z.string().refine((u) => isPublicHttpUrl(u), 'sourceUrl must be a public http(s) URL'),
  applyUrl: z.string().optional(),
  title: z.string().trim().min(2).max(300),
  company: z.string().trim().min(1).max(200),
  locationText: z.string().max(1000)
})

/** Validates the final normalized record (defence in depth). */
export const NormalizedJobSchema = z.object({
  id: z.string().min(8),
  canonicalKey: z.string().min(3),
  source: z.string().min(1),
  sourceJobId: z.string().min(1),
  sourceUrl: z.string().url(),
  title: z.string().min(2),
  company: z.string().min(1),
  description: z.string(),
  workModes: z.array(z.enum(['onsite', 'hybrid', 'remote'])).min(1),
  verificationStatus: z.enum([
    'SOURCE_CONFIRMED',
    'EMPLOYER_CONFIRMED',
    'UNVERIFIED',
    'STALE',
    'EXPIRED',
    'REMOVED',
    'VERIFICATION_FAILED'
  ]),
  sources: z.array(z.object({ providerId: z.string(), sourceUrl: z.string().url() })).min(1)
})

const EMPLOYMENT_PATTERNS: [RegExp, EmploymentType][] = [
  [/\b(full[- ]?time|fulltime|vollzeit|permanent full|temps plein)\b/i, 'full_time'],
  [/\b(part[- ]?time|parttime|teilzeit|temps partiel)\b/i, 'part_time'],
  [/\b(contract|contractor|freelance|fixed[- ]term|1099|c2c)\b/i, 'contract'],
  [/\b(temporary|temp(?!late)|temp[- ]to[- ]hire|befristet)\b/i, 'temporary'],
  [/\b(intern(ship)?|praktikum|werkstudent|stage)\b/i, 'internship'],
  [/\b(seasonal|holiday season|summer (job|help))\b/i, 'seasonal'],
  [/\b(per[- ]diem|prn)\b/i, 'per_diem'],
  [/\b(volunteer)\b/i, 'volunteer']
]

export function parseEmploymentTypes(text: string): EmploymentType[] {
  const out = new Set<EmploymentType>()
  for (const [re, t] of EMPLOYMENT_PATTERNS) if (re.test(text)) out.add(t)
  return [...out]
}

export function parseSeniority(title: string, extra = ''): Seniority | undefined {
  const t = `${title} ${extra}`.toLowerCase()
  if (/\b(chief|vp|vice president|c[eot]o)\b/.test(t)) return 'executive'
  if (/\b(director|head of)\b/.test(t)) return 'director'
  if (/\b(principal|staff engineer|lead|team lead|supervisor)\b/.test(t)) return 'lead'
  if (/\b(manager)\b/.test(t)) return 'manager'
  if (/\b(senior|sr\.?|iii|iv)\b/.test(t)) return 'senior'
  if (/\b(junior|jr)\b/.test(t)) return 'junior'
  if (/\b(entry[- ]level|graduate|new grad|trainee|apprentice|intern|no experience)\b/.test(t))
    return 'entry'
  if (/\b(mid[- ]level|intermediate|ii)\b/.test(t)) return 'mid'
  return undefined
}

const SCHEDULE_PATTERNS: [RegExp, string][] = [
  [/\b(night shift|overnight|graveyard|3rd shift|third shift|nights)\b/i, 'night'],
  [/\b(day shift|1st shift|first shift)\b/i, 'day'],
  [/\b(evening shift|swing shift|2nd shift|second shift|evenings)\b/i, 'evening'],
  [/\b(weekend shift|weekends required|saturday and sunday|weekend availability)\b/i, 'weekend']
]

const YEARS_RE =
  /(\d{1,2})\s*\+?\s*(?:-\s*\d{1,2}\s*)?(?:years?|yrs?)(?:'|’)?\s+(?:of\s+)?(?:relevant\s+|related\s+|professional\s+|work\s+|hands-on\s+|industry\s+)?(?:experience|exp\b)/i

const STRONG_REMOTE_RE =
  /\b(fully remote|100% remote|remote[- ]first|remote position|remote role|this is a remote|work from home position|work from anywhere)\b/i
const STRONG_HYBRID_RE =
  /\b(hybrid (work|role|position|schedule|model)|\d days? (a|per) week in (the )?office|in[- ]office \d days)\b/i
const PAY_LINE_RE =
  /\b(pay|salary|compensation|wage|rate|hourly|per hour|base pay|pay range|salary range|starting at|earn)\b/i

function hash(s: string, len = 20): string {
  return createHash('sha256').update(s).digest('hex').slice(0, len)
}

/** Splits a combined location field ("New York, NY; Remote - US | London") into parts. */
export function splitLocations(text: string): string[] {
  if (!text) return []
  return text
    .split(/\s*(?:;|\||\n|\s+or\s+|\s+\/\s+)\s*/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length < 200)
    .slice(0, 12)
}

export interface NormalizeResult {
  job?: NormalizedJob
  error?: string
}

export interface NormalizeOptions {
  providerId: string
  providerName: string
  geo: GeoService
  now?: Date
  /** Aggregator postings older than this are marked STALE. */
  staleAfterDays?: number
}

/**
 * Converts a provider draft into the normalized job model. Fields derived by
 * PulseApply (not stated by the provider) are listed in `inferredFields`.
 */
export function normalizeDraft(draft: DraftJob, opts: NormalizeOptions): NormalizeResult {
  const parsed = DraftJobSchema.safeParse(draft)
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }
  }
  const now = opts.now ?? new Date()
  const nowIso = now.toISOString()
  const inferred = new Set<string>()
  const notes: string[] = [...(draft.extraNotes ?? [])]

  const title = cleanInline(draft.title, 300)
  const company = cleanInline(draft.company, 200)
  const description = draft.descriptionText
    ? htmlToText(draft.descriptionText.replace(/\n/g, '<br>'))
    : htmlToText(draft.descriptionHtml)
  const sections = splitSections(description)
  const sourceUrl = canonicalizeUrl(draft.sourceUrl)!
  let applyUrl = draft.applyUrl ? canonicalizeUrl(draft.applyUrl) : undefined
  if (draft.applyUrl && (!applyUrl || !isPublicHttpUrl(applyUrl))) {
    notes.push('Provider application link was malformed and was discarded.')
    applyUrl = undefined
  }

  // ---- work mode ---------------------------------------------------------
  const workModes: WorkMode[] = draft.workModes?.length ? [...new Set(draft.workModes)] : []
  const locBlob = [
    ...new Map(
      [draft.locationText, ...(draft.extraLocations ?? [])]
        .map((l) => l?.trim())
        .filter((l): l is string => !!l)
        .map((l) => [l.toLowerCase(), l] as const)
    ).values()
  ].join(' | ')
  if (!workModes.length) {
    if (isRemoteText(`${title} ${locBlob}`)) workModes.push('remote')
    if (isHybridText(`${title} ${locBlob}`)) workModes.push('hybrid')
    if (!workModes.length) {
      if (STRONG_HYBRID_RE.test(description)) workModes.push('hybrid')
      else if (STRONG_REMOTE_RE.test(description)) workModes.push('remote')
    }
    if (!workModes.length) workModes.push('onsite')
    inferred.add('workModes')
  }

  // ---- locations ---------------------------------------------------------
  const locations: ResolvedPlace[] = []
  for (const p of draft.places ?? []) {
    if (p.coordinates || p.city || p.country) {
      locations.push({
        label: p.label ?? [p.city, p.region, p.country].filter(Boolean).join(', '),
        city: p.city,
        region: p.region,
        country: p.country,
        coordinates: p.coordinates,
        precision: p.coordinates ? 'point' : p.city ? 'city' : p.region ? 'region' : 'country',
        resolution: 'source',
        confidence: 1
      })
    }
  }
  if (locations.length === 0 || locations.every((l) => !l.coordinates)) {
    for (const part of splitLocations(locBlob)) {
      const physical = part
        .replace(
          /\b(remote|hybrid|on[- ]?site|work from home|wfh|anywhere|worldwide|in[- ]office)\b/gi,
          ' '
        )
        .replace(/^[\s,()\-–:]+|[\s,()\-–:]+$/g, '')
        .trim()
      if (!physical) continue
      const place = opts.geo.resolveOffline(physical)
      if (place.precision === 'none') continue
      if (
        place.coordinates &&
        locations.some(
          (l) =>
            l.coordinates &&
            Math.abs(l.coordinates.lat - place.coordinates!.lat) < 0.01 &&
            Math.abs(l.coordinates.lon - place.coordinates!.lon) < 0.01
        )
      )
        continue
      // Enrich a provider place that lacked coordinates instead of duplicating it.
      const same = locations.find(
        (l) =>
          !l.coordinates &&
          l.city &&
          place.city &&
          l.city.toLowerCase() === place.city.toLowerCase()
      )
      if (same) {
        same.coordinates = place.coordinates
        same.precision = place.precision
        inferred.add('coordinates')
        continue
      }
      locations.push(place)
      inferred.add('locations')
    }
  }
  if (
    draft.countryHint &&
    locations.length === 0 &&
    !workModes.includes('remote') &&
    draft.locationText
  ) {
    notes.push('Location text could not be resolved to a place.')
  }

  // ---- remote eligibility --------------------------------------------------
  const remoteEligibility = workModes.includes('remote')
    ? parseRemoteEligibility(draft.remoteEligibilityText ?? locBlob.replace(/\bremote\b/gi, ' '))
    : undefined
  if (remoteEligibility && !draft.remoteEligibilityText) inferred.add('remoteEligibility')

  // ---- employment type / seniority / schedule --------------------------------
  let employmentTypes = draft.employmentTypes?.length ? [...new Set(draft.employmentTypes)] : []
  if (!employmentTypes.length) {
    employmentTypes = parseEmploymentTypes(
      `${draft.employmentTypeText ?? ''} ${title} ${description.slice(0, 1500)}`
    )
    if (employmentTypes.length) inferred.add('employmentTypes')
  }
  const seniority = parseSeniority(title, draft.seniorityText)
  if (seniority && !draft.seniorityText) inferred.add('seniority')
  const schedule = SCHEDULE_PATTERNS.filter(([re]) =>
    re.test(`${title}\n${description.slice(0, 4000)}`)
  ).map(([, s]) => s)

  // ---- salary --------------------------------------------------------------
  let salary: Salary | undefined
  let salaryEstimateDiscarded = false
  if (draft.salaryIsEstimate) {
    salaryEstimateDiscarded = true
  } else if (draft.salary && (draft.salary.min || draft.salary.max)) {
    salary = draft.salary
  } else if (draft.salaryText) {
    salary = parseSalaryText(draft.salaryText)
  }
  if (!salary && !salaryEstimateDiscarded) {
    const line = description
      .split('\n')
      .find((l) => PAY_LINE_RE.test(l) && /[$€£₹]|\b(USD|EUR|GBP|CAD|AUD)\b/.test(l))
    const fromText = line ? parseSalaryText(line) : undefined
    if (fromText) {
      salary = fromText
      inferred.add('salary')
      notes.push(`Pay parsed from the posting text: "${fromText.raw}"`)
    }
  }

  // ---- requirements --------------------------------------------------------
  const tagText = (draft.tags ?? []).join(', ')
  const reqText = sections.required.length ? sections.required.join('\n') : description
  const prefText = sections.preferred.join('\n')
  const preferredSkills = prefText ? findSkills(prefText) : []
  const requiredSkills = [
    ...new Set([
      ...findSkills(`${title}\n${reqText}`),
      ...(tagText ? findSkills(tagText, { strict: false }) : [])
    ])
  ].filter((s) => !preferredSkills.includes(s) || findSkills(reqText).includes(s))
  const certRequired = findCertifications(reqText)
  const certPreferred = prefText ? findCertifications(prefText) : []
  const requiredCertifications = certRequired.filter(
    (c) => !certPreferred.includes(c) || sections.required.length === 0
  )
  const yearsMatch = YEARS_RE.exec(reqText)
  const minYearsExperience = yearsMatch ? Math.min(Number(yearsMatch[1]), 30) : undefined
  inferred.add('requiredSkills')
  inferred.add('occupation')

  const occupation = classifyJob(title, description)

  // ---- identity ------------------------------------------------------------
  const ats: DraftJob['ats'] =
    draft.ats ??
    (() => {
      const ref = detectAtsFromUrl(applyUrl) ?? detectAtsFromUrl(sourceUrl)
      return ref?.postingId
        ? { provider: ref.provider, board: ref.board, postingId: ref.postingId }
        : undefined
    })()
  const canonicalKey = ats?.postingId
    ? `ats:${ats.provider}:${(ats.board ?? '').toLowerCase()}:${ats.postingId}`
    : `src:${opts.providerId}:${draft.sourceJobId}`
  const id = hash(canonicalKey)

  // ---- verification --------------------------------------------------------
  let verificationStatus: VerificationStatus = draft.employerDirect
    ? 'EMPLOYER_CONFIRMED'
    : 'SOURCE_CONFIRMED'
  const verificationNotes = [
    draft.employerDirect
      ? `Currently published on the employer's own job board (${opts.providerName}).`
      : `Currently listed by ${opts.providerName}; not independently confirmed with the employer.`
  ]
  if (draft.expiresAt && draft.expiresAt < nowIso) {
    verificationStatus = 'EXPIRED'
    verificationNotes.push(`Listing expired on ${draft.expiresAt.slice(0, 10)}.`)
  } else if (
    !draft.employerDirect &&
    draft.postedAt &&
    Date.parse(draft.postedAt) < now.getTime() - (opts.staleAfterDays ?? 60) * 86400_000
  ) {
    verificationStatus = 'STALE'
    verificationNotes.push(
      `Posted ${draft.postedAt.slice(0, 10)}; older postings are often filled.`
    )
  }
  verificationNotes.push(...notes)

  const annualMax = salary?.max ?? salary?.min
  const signals = scamSignals({
    title,
    company,
    description,
    sourceUrl,
    applyUrl,
    companyWebsite: draft.companyWebsite,
    salaryMaxAnnual: annualMax ? annualize(annualMax, salary?.period) : undefined,
    occupationId: occupation?.id
  })

  const job: NormalizedJob = {
    id,
    canonicalKey,
    source: opts.providerId,
    sourceJobId: draft.sourceJobId,
    sourceUrl,
    canonicalJobUrl: sourceUrl,
    applyUrl,
    title,
    normalizedTitle: normalizeTitle(title).trim(),
    company,
    companyWebsite:
      draft.companyWebsite && isPublicHttpUrl(draft.companyWebsite)
        ? draft.companyWebsite
        : undefined,
    description,
    responsibilities: sections.responsibilities.slice(0, 30),
    qualifications: sections.required.slice(0, 30),
    requiredSkills,
    preferredSkills: preferredSkills.filter((s) => !requiredSkills.includes(s)),
    requiredCertifications,
    minYearsExperience,
    employmentTypes,
    seniority,
    workModes,
    schedule,
    locationText: cleanInline(locBlob, 500),
    locations,
    remoteEligibility,
    salary,
    salaryEstimateDiscarded: salaryEstimateDiscarded || undefined,
    postedAt: draft.postedAt,
    expiresAt: draft.expiresAt,
    discoveredAt: nowIso,
    lastSeenAt: nowIso,
    verificationStatus,
    verificationNotes,
    scamSignals: signals,
    ats: ats
      ? {
          provider: ats.provider,
          board: ats.board,
          requisitionId: ats.requisitionId,
          postingId: ats.postingId
        }
      : undefined,
    occupation,
    inferredFields: [...inferred],
    sources: [
      {
        providerId: opts.providerId,
        providerName: opts.providerName,
        sourceJobId: draft.sourceJobId,
        sourceUrl,
        applyUrl,
        fetchedAt: nowIso,
        employerDirect: draft.employerDirect
      }
    ],
    applicationSupport: applicationSupportFor(applyUrl, sourceUrl)
  }
  const check = NormalizedJobSchema.safeParse(job)
  if (!check.success)
    return { error: check.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }
  return { job }
}
