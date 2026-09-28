import type {
  ExclusionReason,
  JobEligibility,
  NormalizedJob,
  ScoredJob,
  Seniority
} from '../../../shared/types'
import { evaluateGeo } from '../jobs/geo/geoService'
import { computeRelevance, RELEVANCE_THRESHOLD } from '../jobs/search/classify'
import { annualize } from '../jobs/normalization/salary'
import { normalizeCompany } from '../jobs/deduplication/dedupe'
import type { CriteriaContext } from './criteria'

const SENIOR_LEVELS = new Set<Seniority>(['senior', 'lead', 'manager', 'director', 'executive'])

export const EXCLUSION_TEXT: Record<ExclusionReason, string> = {
  irrelevant_occupation: 'Different occupation from the one you are looking for',
  excluded_occupation: 'Occupation you excluded',
  outside_radius: 'Outside your search radius',
  outside_country: 'Outside your country / region',
  remote_not_requested: 'Remote-only role; remote work not selected',
  remote_ineligible: 'Remote role not open to your country',
  onsite_not_requested: 'On-site role; only remote work selected',
  unknown_location: 'Location could not be verified',
  salary_below_minimum: 'Advertised pay below your minimum',
  employment_type: 'Different employment type',
  seniority: 'Seniority above what you selected',
  too_old: 'Posted before your “posted within” limit',
  excluded_keyword: 'Title contains a keyword you excluded',
  excluded_company: 'Company you excluded',
  malformed: 'Incomplete listing',
  expired: 'Listing expired or removed',
  work_mode: 'Work mode you did not select',
  missing_required_skill: 'Does not mention a skill you marked as required',
  below_minimum_score: 'Below your minimum match score'
}

export interface EligibilityOutcome {
  eligibility: JobEligibility
  geo: ScoredJob['geo']
  relevance: ScoredJob['relevance']
}

function mentions(job: NormalizedJob, term: string): boolean {
  const t = term.toLowerCase()
  const hay = `${job.title}\n${job.description}\n${job.requiredSkills.join(' ')}\n${job.preferredSkills.join(' ')}`
  return hay.toLowerCase().includes(t)
}

/**
 * The single hard-filter step. Runs BEFORE any scoring, in this order:
 * availability → occupation → exclusions → location → work mode → employment
 * type → seniority → pay → age → required skills.
 *
 * - `eligible`: passed every filter.
 * - `review`: passed every filter that could be checked, but the location could
 *   not be verified — shown in a separate “Location could not be verified” group,
 *   never mixed into the main results.
 * - `excluded`: failed at least one filter (all reasons are listed).
 *
 * The minimum match score is applied afterwards, by {@link applyMinimumScore}.
 */
export function evaluateJobEligibility(
  job: NormalizedJob,
  ctx: CriteriaContext,
  now: number = Date.now()
): EligibilityOutcome {
  const { intent, criteria } = ctx
  const reasons: ExclusionReason[] = []
  const missingData: string[] = []
  const add = (r: ExclusionReason): void => {
    if (!reasons.includes(r)) reasons.push(r)
  }

  // 1. availability
  if (job.verificationStatus === 'EXPIRED' || job.verificationStatus === 'REMOVED') add('expired')
  else if (job.expiresAt && Date.parse(job.expiresAt) < now) add('expired')

  // 2. occupation
  const relevance = computeRelevance(job, intent)
  let occupationStatus: JobEligibility['occupationStatus']
  if (job.occupation && intent.excludedOccupations.includes(job.occupation.id)) {
    occupationStatus = 'excluded'
    add('excluded_occupation')
  } else if (
    relevance.score >= 0.95 ||
    (relevance.score >= 0.75 && relevance.basis.startsWith('Same'))
  ) {
    occupationStatus = 'match'
  } else if (relevance.score >= RELEVANCE_THRESHOLD) {
    occupationStatus = relevance.basis.startsWith('Related') ? 'related' : 'match'
    if (criteria.occupationMatch === 'exact' && occupationStatus === 'related')
      add('irrelevant_occupation')
  } else {
    occupationStatus = job.occupation ? 'unrelated' : 'unknown'
    add('irrelevant_occupation')
  }
  if (!job.occupation) missingData.push('occupation')

  // 3. explicit exclusions
  if (intent.excludedKeywords.some((k) => k && job.title.toLowerCase().includes(k.toLowerCase())))
    add('excluded_keyword')
  const excludedCompanies = intent.excludedCompanies.map(normalizeCompany)
  if (excludedCompanies.includes(normalizeCompany(job.company))) add('excluded_company')

  // 4. location and 5. work mode
  const g = evaluateGeo(job, intent)
  let locationStatus: JobEligibility['locationStatus']
  let workModeStatus: JobEligibility['workModeStatus'] = job.inferredFields.includes('workModes')
    ? 'unknown'
    : 'match'
  const preferred = criteria.locationMode === 'preferred'
  if (g.include) {
    locationStatus = intent.location ? 'match' : 'not_applied'
  } else {
    switch (g.exclusion) {
      case 'remote_not_requested':
      case 'onsite_not_requested':
        workModeStatus = 'mismatch'
        locationStatus = 'not_applied'
        add(g.exclusion)
        break
      case 'unknown_location':
        locationStatus = 'unverified'
        missingData.push('location')
        break
      case 'outside_radius':
      case 'outside_country':
        if (preferred) locationStatus = 'outside_preferred'
        else {
          locationStatus = 'outside'
          add(g.exclusion)
        }
        break
      case 'remote_ineligible':
      default:
        // Remote eligibility is a legal restriction, so it applies in both modes.
        locationStatus = 'outside'
        add(g.exclusion ?? 'unknown_location')
    }
  }
  // Explicit single-mode choices (e.g. only "hybrid") are enforced when the posting states its mode.
  if (
    criteria.workModes?.length &&
    workModeStatus !== 'unknown' &&
    !job.workModes.some((m) => intent.workModes.includes(m))
  ) {
    workModeStatus = 'mismatch'
    if (!reasons.includes('remote_not_requested') && !reasons.includes('onsite_not_requested'))
      add('work_mode')
  }

  // 6. employment type
  if (intent.employmentTypes.length) {
    if (!job.employmentTypes.length) missingData.push('employment type')
    else if (!job.employmentTypes.some((t) => intent.employmentTypes.includes(t)))
      add('employment_type')
  }

  // 7. seniority (only filters senior roles out of entry/junior searches)
  if (
    intent.seniority.length &&
    job.seniority &&
    intent.seniority.every((s) => s === 'entry' || s === 'junior') &&
    SENIOR_LEVELS.has(job.seniority)
  )
    add('seniority')

  // 8. pay — only confirmed pay below the minimum excludes; undisclosed pay is kept.
  if (intent.minimumSalary) {
    const top = job.salary ? (job.salary.max ?? job.salary.min) : undefined
    if (top === undefined) missingData.push('salary')
    else if (!intent.currency || !job.salary?.currency || job.salary.currency === intent.currency) {
      const minAnnual = annualize(intent.minimumSalary, intent.salaryPeriod)
      const jobAnnual = annualize(top, job.salary!.period)
      if (minAnnual !== undefined && jobAnnual !== undefined && jobAnnual < minAnnual)
        add('salary_below_minimum')
    }
  }

  // 9. age
  if (intent.postedWithinDays) {
    if (!job.postedAt) missingData.push('posting date')
    else if (Date.parse(job.postedAt) < now - intent.postedWithinDays * 86400_000) add('too_old')
  }

  // 10. required skills
  for (const s of criteria.requiredSkills ?? []) {
    if (!mentions(job, s)) {
      add('missing_required_skill')
      break
    }
  }

  const status: JobEligibility['status'] = reasons.length
    ? 'excluded'
    : locationStatus === 'unverified'
      ? 'review'
      : 'eligible'
  const summary = reasons.length
    ? reasons.map((r) => EXCLUSION_TEXT[r]).join('; ')
    : status === 'review'
      ? 'Location could not be verified.'
      : locationStatus === 'outside_preferred'
        ? `Outside your preferred area (${g.note ?? 'distance unknown'})`
        : 'Meets all of your criteria'

  return {
    eligibility: {
      status,
      eligible: status === 'eligible',
      exclusionReasons: reasons,
      summary,
      locationStatus,
      occupationStatus,
      workModeStatus,
      missingData,
      criteriaKey: ctx.key
    },
    geo: { eligibility: g.eligibility, distance: g.distance, unit: g.unit, note: g.note },
    relevance
  }
}

/** Applies the minimum match score after scoring. Jobs without a score (no profile yet) are not filtered. */
export function applyMinimumScore(
  e: JobEligibility,
  score: number | undefined,
  minimum: number | undefined
): JobEligibility {
  if (!minimum || score === undefined || score >= minimum || e.status === 'excluded') return e
  return {
    ...e,
    status: 'excluded',
    eligible: false,
    exclusionReasons: [...e.exclusionReasons, 'below_minimum_score'],
    summary: `Match ${score} is below your minimum of ${minimum}`
  }
}

/** Primary reason used for grouping counters. */
export function primaryReason(e: JobEligibility): ExclusionReason | undefined {
  return e.exclusionReasons[0]
}
