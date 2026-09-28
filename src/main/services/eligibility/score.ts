import type { MatchResult, NormalizedJob, ScoredJob } from '../../../shared/types'
import type { CandidateModel } from '../matching/candidateModel'
import { scoreMatch } from '../matching/matcher'
import type { CriteriaContext } from './criteria'

/**
 * Scores a job that already passed {@link evaluateJobEligibility}. Criteria
 * that were enforced as hard filters are not scored again (they would add the
 * same points to every job); in "preferred location" mode the location is a
 * scored criterion instead of a filter.
 */
export function scoreEligibleJob(
  job: NormalizedJob,
  candidate: CandidateModel,
  ctx: CriteriaContext,
  opts: {
    geo: ScoredJob['geo']
    weights?: Record<string, number>
    semantic?: { similarity: number; model: string }
  }
): MatchResult | undefined {
  const { criteria, intent } = ctx
  const strictLocation = criteria.locationMode !== 'preferred' && !!intent.location
  return scoreMatch(job, candidate, {
    geo: opts.geo,
    weights: opts.weights,
    semantic: opts.semantic,
    filters: {
      location: strictLocation ? (opts.geo.note ?? intent.location!.label) : undefined,
      workMode: !!criteria.workModes?.length || !!intent.location,
      employmentType: !!intent.employmentTypes.length,
      salary: !!intent.minimumSalary
    },
    preferences: {
      workModes: intent.workModes,
      employmentTypes: intent.employmentTypes,
      minSalary: intent.minimumSalary,
      salaryCurrency: intent.currency,
      salaryPeriod: intent.salaryPeriod
    },
    preferredSkills: criteria.preferredSkills
  })
}
