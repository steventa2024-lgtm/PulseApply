import type { SearchCriteria } from '../../../shared/types'

export const EMPTY_CRITERIA: SearchCriteria = {
  query: '',
  radius: 25,
  radiusUnit: 'mi',
  locationMode: 'strict',
  occupationMatch: 'related',
  workModes: [],
  employmentTypes: [],
  seniority: []
}

const list = (v?: string[]): string[] | undefined => {
  const out = (v ?? []).map((x) => x.trim()).filter(Boolean)
  return out.length ? out : undefined
}

/** Drops empty values so the main-process validator and intent builder see only real choices. */
export function clean(c: SearchCriteria): SearchCriteria {
  const out: SearchCriteria = { query: c.query.trim() }
  if (c.location?.trim()) out.location = c.location.trim()
  if (c.radius) out.radius = c.radius
  if (c.radiusUnit) out.radiusUnit = c.radiusUnit
  out.locationMode = c.locationMode ?? 'strict'
  out.occupationMatch = c.occupationMatch ?? 'related'
  if (c.country) out.country = c.country
  if (c.workModes?.length) out.workModes = c.workModes
  if (c.employmentTypes?.length) out.employmentTypes = c.employmentTypes
  if (c.seniority?.length) out.seniority = c.seniority
  if (c.minSalary) out.minSalary = c.minSalary
  if (c.salaryPeriod) out.salaryPeriod = c.salaryPeriod
  if (c.salaryCurrency) out.salaryCurrency = c.salaryCurrency
  if (c.postedWithinDays) out.postedWithinDays = c.postedWithinDays
  if (c.providerIds?.length) out.providerIds = c.providerIds
  if (c.minimumMatchScore) out.minimumMatchScore = Math.round(c.minimumMatchScore)
  const lists = [
    'excludedKeywords',
    'excludedCompanies',
    'targetOccupations',
    'excludedOccupations',
    'requiredSkills',
    'preferredSkills'
  ] as const
  for (const k of lists) {
    const v = list(c[k])
    if (v) out[k] = v
  }
  return out
}

/** "a, b ,c" -> ['a','b','c'] */
export function splitList(text: string): string[] {
  return text
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
}
