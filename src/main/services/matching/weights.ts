/**
 * Transparent weighting of match criteria (sums to 100). Criteria that cannot
 * be evaluated for a job (e.g. salary not disclosed) are left out of the
 * weighted average rather than counted as a pass or a fail.
 */
export const DEFAULT_WEIGHTS: Record<string, number> = {
  occupation: 25,
  specificSkills: 20,
  qualifications: 15,
  experience: 12,
  transferable: 5,
  seniority: 5,
  location: 8,
  workMode: 4,
  salary: 3,
  employmentType: 3,
  /** Only used when Ollama embeddings are active. */
  semantic: 10
}

export const CRITERION_LABELS: Record<string, string> = {
  occupation: 'Occupational relevance',
  specificSkills: 'Occupation-specific skills',
  qualifications: 'Required certifications/licenses',
  experience: 'Relevant experience',
  transferable: 'Transferable skills',
  seniority: 'Seniority fit',
  location: 'Location eligibility',
  workMode: 'Work-mode preference',
  salary: 'Salary preference',
  employmentType: 'Employment type',
  semantic: 'Semantic similarity (local embeddings)'
}

/** Licenses without which an applicant generally cannot legally do the job. */
export const HARD_LICENSES = new Set([
  'cdl',
  'rn_license',
  'lpn_license',
  'np_license',
  'bar_admission',
  'electrician_license',
  'cna_cert',
  'guard_card',
  'teaching_credential',
  'cpa',
  'security_clearance'
])

export const MATCH_DISCLAIMER =
  'This is a heuristic comparison of your profile with the posting text. It is not a hiring probability and does not predict an employer’s decision.'
