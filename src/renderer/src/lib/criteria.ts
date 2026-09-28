import type { SearchCriteria } from '../../../shared/types'

export const EMPTY_CRITERIA: SearchCriteria = {
  query: '',
  radius: 25,
  radiusUnit: 'mi',
  workModes: [],
  employmentTypes: [],
  seniority: [],
  includeUnknownLocations: true
}

/** Drops empty values so the main-process validator and intent builder see only real choices. */
export function clean(c: SearchCriteria): SearchCriteria {
  const out: SearchCriteria = { query: c.query.trim() }
  if (c.location?.trim()) out.location = c.location.trim()
  if (c.radius) out.radius = c.radius
  if (c.radiusUnit) out.radiusUnit = c.radiusUnit
  if (c.country) out.country = c.country
  if (c.workModes?.length) out.workModes = c.workModes
  if (c.employmentTypes?.length) out.employmentTypes = c.employmentTypes
  if (c.seniority?.length) out.seniority = c.seniority
  if (c.minSalary) out.minSalary = c.minSalary
  if (c.salaryPeriod) out.salaryPeriod = c.salaryPeriod
  if (c.salaryCurrency) out.salaryCurrency = c.salaryCurrency
  if (c.postedWithinDays) out.postedWithinDays = c.postedWithinDays
  if (c.providerIds?.length) out.providerIds = c.providerIds
  if (c.includeUnknownLocations === false) out.includeUnknownLocations = false
  if (c.excludedKeywords?.length) out.excludedKeywords = c.excludedKeywords
  if (c.excludedCompanies?.length) out.excludedCompanies = c.excludedCompanies
  return out
}
