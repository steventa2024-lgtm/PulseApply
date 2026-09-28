import type { GeoEligibility, MatchCriterion, MatchResult, NormalizedJob, Seniority } from '../../../shared/types'
import type { CandidateModel } from './candidateModel'
import { CRITERION_LABELS, DEFAULT_WEIGHTS, HARD_LICENSES, MATCH_DISCLAIMER } from './weights'
import { OCCUPATION_BY_ID } from '../jobs/search/taxonomy'
import { areRelated } from '../jobs/search/classify'
import { CERT_BY_ID, isTransferable, skillLabel } from '../jobs/search/skills'
import { annualize } from '../jobs/normalization/salary'

const SENIORITY_RANK: Record<Seniority, number> = { entry: 0, junior: 1, mid: 2, senior: 3, lead: 4, manager: 4, director: 5, executive: 6 }

const GEO_SCORE: Partial<Record<GeoEligibility, number>> = {
  within_radius: 1,
  remote_eligible: 1,
  in_country: 0.8,
  remote_unspecified: 0.5,
  unknown: 0.4,
  outside_radius: 0,
  outside_country: 0,
  remote_ineligible: 0
}

export interface MatchContext {
  geo?: { eligibility: GeoEligibility; note?: string }
  /** 0..1 cosine-derived similarity when local embeddings are active. */
  semantic?: { similarity: number; model: string }
  weights?: Record<string, number>
}

function monthsLabel(m: number): string {
  if (m < 12) return `${m} month${m === 1 ? '' : 's'}`
  const y = Math.round((m / 12) * 10) / 10
  return `${y} year${y === 1 ? '' : 's'}`
}

/**
 * Explainable multi-signal match. Occupational relevance and occupation-
 * specific qualifications dominate; transferable skills can add only a little
 * and can never lift an unrelated job into a strong match.
 */
export function scoreMatch(job: NormalizedJob, cand: CandidateModel, ctx: MatchContext = {}): MatchResult | undefined {
  if (cand.empty) return undefined
  const weights = { ...DEFAULT_WEIGHTS, ...(ctx.weights ?? {}) }
  const criteria: MatchCriterion[] = []
  const caps: string[] = []
  const explanation: string[] = []
  const add = (key: string, score: number | null, evidence: string) =>
    criteria.push({ key, label: CRITERION_LABELS[key] ?? key, weight: weights[key] ?? 0, score: score === null ? null : Math.max(0, Math.min(1, score)), evidence })

  // --- 1. occupational relevance -------------------------------------------
  const jobOcc = job.occupation?.id
  let occScore = 0
  let occEvidence = 'Job occupation could not be identified from its title'
  let relevance: MatchResult['occupationRelevance'] = 'none'
  let relevantMonths = 0
  if (jobOcc) {
    const label = job.occupation!.label
    for (const c of cand.occupations) {
      let s = 0
      if (c.id === jobOcc) {
        s = c.strength
        relevantMonths += c.months
      } else if (areRelated(c.id, jobOcc)) {
        s = 0.6 * c.strength
        relevantMonths += Math.round(c.months * 0.5)
      } else if (OCCUPATION_BY_ID.get(c.id)?.family === OCCUPATION_BY_ID.get(jobOcc)?.family) {
        s = 0.3 * c.strength
      }
      if (s > occScore) {
        occScore = s
        const cl = OCCUPATION_BY_ID.get(c.id)?.label ?? c.id
        occEvidence =
          c.id === jobOcc
            ? c.source === 'history'
              ? `You have worked as ${cl} (${monthsLabel(c.months)})`
              : `${label} is one of your target roles (no direct experience listed)`
            : s >= 0.35
              ? `Related to your ${c.source === 'history' ? 'experience' : 'target role'} as ${cl}`
              : `Same field as your ${c.source === 'history' ? 'experience' : 'target'} (${cl}), different role`
      }
    }
    if (occScore === 0) occEvidence = `${label} does not match your experience or target roles`
    if (job.occupation!.basis === 'description') occScore *= 0.85
    relevance = occScore >= 0.8 ? 'strong' : occScore >= 0.45 ? 'related' : occScore > 0 ? 'weak' : 'none'
  }
  add('occupation', occScore, occEvidence)

  // --- 2. occupation-specific skills ----------------------------------------
  let required = job.requiredSkills.filter((s) => !isTransferable(s))
  let skillsBasis = 'listed in the posting'
  if (required.length === 0 && jobOcc) {
    required = (OCCUPATION_BY_ID.get(jobOcc)?.skills ?? []).slice(0, 6)
    skillsBasis = `typical for ${job.occupation!.label} (posting lists none)`
  }
  const matchedSkills = required.filter((s) => cand.specificSkills.has(s))
  const missingSkills = required.filter((s) => !cand.specificSkills.has(s))
  if (required.length) {
    const denom = skillsBasis.startsWith('typical') ? Math.min(required.length, 4) : required.length
    add('specificSkills', Math.min(1, matchedSkills.length / denom), `${matchedSkills.length} of ${required.length} skills ${skillsBasis}`)
  } else {
    add('specificSkills', null, 'No specific skills could be identified for this job')
  }

  // --- 3. required certifications / licenses ---------------------------------
  const missingQualifications: string[] = []
  if (job.requiredCertifications.length) {
    const held = job.requiredCertifications.filter((c) => cand.certifications.has(c))
    for (const c of job.requiredCertifications) if (!cand.certifications.has(c)) missingQualifications.push(CERT_BY_ID.get(c)?.label ?? c)
    add('qualifications', held.length / job.requiredCertifications.length, held.length === job.requiredCertifications.length ? 'You list every required certification' : `Missing: ${missingQualifications.join(', ')}`)
    const missingHard = job.requiredCertifications.filter((c) => HARD_LICENSES.has(c) && !cand.certifications.has(c))
    if (missingHard.length) caps.push(`cap:55:Missing required license (${missingHard.map((c) => CERT_BY_ID.get(c)?.label ?? c).join(', ')})`)
    else if (missingQualifications.length) caps.push(`cap:80:Missing stated certification (${missingQualifications.join(', ')})`)
  } else {
    add('qualifications', null, 'The posting states no certification requirements')
  }

  // --- 4. relevant experience -----------------------------------------------
  if (job.minYearsExperience !== undefined) {
    const needMonths = job.minYearsExperience * 12
    const s = needMonths === 0 ? 1 : relevantMonths >= needMonths ? 1 : relevantMonths / needMonths
    add('experience', s, `Posting asks for ${job.minYearsExperience}+ years; you show about ${monthsLabel(relevantMonths)} of relevant experience`)
  } else {
    const s = relevantMonths >= 24 ? 1 : relevantMonths >= 12 ? 0.8 : relevantMonths >= 6 ? 0.6 : relevantMonths > 0 ? 0.4 : 0
    add('experience', s, relevantMonths ? `About ${monthsLabel(relevantMonths)} of relevant experience` : 'No directly relevant work history listed')
  }

  // --- 5. transferable skills (small weight, never decisive) --------------------
  const jobTransferable = job.requiredSkills.filter((s) => isTransferable(s))
  const transferableSkills = [...cand.transferableSkills].filter((s) => jobTransferable.length === 0 || jobTransferable.includes(s))
  if (jobTransferable.length) {
    const matched = jobTransferable.filter((s) => cand.transferableSkills.has(s))
    add('transferable', matched.length / jobTransferable.length, matched.length ? matched.map(skillLabel).join(', ') : 'None of the listed soft skills appear in your profile')
  } else {
    add('transferable', cand.transferableSkills.size >= 2 ? 0.5 : cand.transferableSkills.size ? 0.3 : 0, 'Posting lists no soft-skill requirements')
  }

  // --- 6. seniority ---------------------------------------------------------
  if (job.seniority && cand.seniority) {
    const gap = SENIORITY_RANK[job.seniority] - SENIORITY_RANK[cand.seniority]
    const s = gap <= 0 ? (gap < -2 ? 0.7 : 1) : gap === 1 ? 0.6 : gap === 2 ? 0.3 : 0.1
    add('seniority', s, `Role is ${job.seniority}; your experience suggests ${cand.seniority}`)
  } else {
    add('seniority', null, 'Seniority not stated')
  }

  // --- 7. location ----------------------------------------------------------
  if (ctx.geo) {
    add('location', GEO_SCORE[ctx.geo.eligibility] ?? 0.4, ctx.geo.note ?? ctx.geo.eligibility)
  } else {
    add('location', null, 'No search location to compare')
  }

  // --- 8. work mode ---------------------------------------------------------
  const prefModes = cand.preferences.workModes
  if (prefModes.length) {
    const ok = job.workModes.some((m) => prefModes.includes(m))
    add('workMode', ok ? 1 : 0, ok ? `Matches your preference (${job.workModes.join('/')})` : `Job is ${job.workModes.join('/')}; you prefer ${prefModes.join('/')}`)
  } else add('workMode', null, 'No work-mode preference set')

  // --- 9. salary ------------------------------------------------------------
  const pref = cand.preferences
  if (pref.minSalary && job.salary && (job.salary.max ?? job.salary.min)) {
    const top = annualize((job.salary.max ?? job.salary.min)!, job.salary.period)
    const want = annualize(pref.minSalary, pref.salaryPeriod ?? (pref.minSalary < 300 ? 'hour' : 'year'))
    const sameCurrency = !pref.salaryCurrency || !job.salary.currency || pref.salaryCurrency === job.salary.currency
    if (top && want && sameCurrency) {
      add('salary', top >= want ? 1 : top >= want * 0.9 ? 0.6 : 0.2, top >= want ? 'Advertised pay meets your minimum' : 'Advertised pay is below your minimum')
    } else add('salary', null, 'Salary not comparable (different currency or period)')
  } else {
    add('salary', null, job.salary ? 'No salary preference set' : 'Salary not disclosed — not evaluated')
  }

  // --- 10. employment type --------------------------------------------------
  if (pref.employmentTypes.length && job.employmentTypes.length) {
    const ok = job.employmentTypes.some((t) => pref.employmentTypes.includes(t))
    add('employmentType', ok ? 1 : 0, ok ? 'Matches your preferred employment type' : `Job is ${job.employmentTypes.join(', ').replace(/_/g, '-')}`)
  } else add('employmentType', null, 'Employment type preference or job type unknown')

  // --- 11. semantic similarity (optional) -----------------------------------
  if (ctx.semantic) {
    add('semantic', ctx.semantic.similarity, `Embedding similarity via ${ctx.semantic.model}: ${Math.round(ctx.semantic.similarity * 100)}%`)
  }

  // --- aggregate --------------------------------------------------------------
  const evaluated = criteria.filter((c) => c.score !== null && c.weight > 0)
  const totalWeight = evaluated.reduce((a, c) => a + c.weight, 0)
  let score = totalWeight ? (evaluated.reduce((a, c) => a + c.weight * (c.score as number), 0) / totalWeight) * 100 : 0

  if (relevance === 'none' || relevance === 'weak') caps.push('cap:35:Different occupation — general or transferable skills alone are not enough for a strong match')
  else if (relevance === 'related') caps.push('cap:75:Related, not identical, occupation')
  if (!jobOcc) caps.push('cap:60:Job occupation could not be determined')

  const appliedCaps: string[] = []
  for (const c of caps) {
    const [, limit, reason] = /^cap:(\d+):(.*)$/.exec(c)!
    if (score > Number(limit)) {
      score = Number(limit)
      appliedCaps.push(reason)
    }
  }
  score = Math.round(score)
  const band: MatchResult['band'] = score >= 75 ? 'strong' : score >= 60 ? 'good' : score >= 40 ? 'partial' : 'weak'

  explanation.push(`Occupation relevance: ${relevance === 'none' ? 'None' : relevance[0].toUpperCase() + relevance.slice(1)} — ${occEvidence}`)
  if (matchedSkills.length) explanation.push(`Matched skills: ${matchedSkills.map(skillLabel).join(', ')}`)
  if (transferableSkills.length) explanation.push(`Transferable skills: ${transferableSkills.slice(0, 5).map(skillLabel).join(', ')}`)
  if (ctx.geo?.note) explanation.push(`Location: ${ctx.geo.note}`)
  for (const q of missingQualifications) explanation.push(`Missing qualification: ${q}`)
  if (missingSkills.length && skillsBasis === 'listed in the posting') explanation.push(`Not found in your profile: ${missingSkills.slice(0, 6).map(skillLabel).join(', ')}`)
  for (const c of appliedCaps) explanation.push(`Score limited: ${c}`)

  return {
    score,
    band,
    occupationRelevance: relevance,
    criteria,
    matchedSkills: matchedSkills.map(skillLabel),
    transferableSkills: transferableSkills.map(skillLabel),
    missingSkills: missingSkills.map(skillLabel),
    missingQualifications,
    caps: appliedCaps,
    semanticActive: !!ctx.semantic,
    semanticModel: ctx.semantic?.model,
    explanation,
    disclaimer: MATCH_DISCLAIMER
  }
}
