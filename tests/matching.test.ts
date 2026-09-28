import { describe, expect, it } from 'vitest'
import type { NormalizedJob } from '../src/shared/types'
import { buildCandidateModel } from '../src/main/services/matching/candidateModel'
import { scoreMatch } from '../src/main/services/matching/matcher'
import { normalizeDraft } from '../src/main/services/jobs/normalization/normalize'
import { GeoService } from '../src/main/services/jobs/geo/geoService'
import { Gazetteer } from '../src/main/services/jobs/geo/gazetteer'
import { emptyProfile } from '../src/main/services/persistence/candidateRepo'
import { RESOURCES, warehouseBaristaProfile } from './helpers'

const geo = new GeoService(new Gazetteer(RESOURCES), null, null, () => false)

function job(title: string, description: string, extra: Partial<Parameters<typeof normalizeDraft>[0]> = {}): NormalizedJob {
  const res = normalizeDraft(
    { sourceJobId: title, sourceUrl: `https://example.com/jobs/${encodeURIComponent(title)}`, title, company: 'Example Co', descriptionText: description, locationText: 'Los Angeles, CA', employerDirect: false, ...extra },
    { providerId: 'test', providerName: 'Test', geo }
  )
  if (!res.job) throw new Error(res.error)
  return res.job
}

const warehouse = buildCandidateModel(warehouseBaristaProfile(), '')
const within = { geo: { eligibility: 'within_radius' as const, note: '8 mi from Lakewood' } }

describe('matching engine', () => {
  it('a warehouse candidate gets a low score for paralegal and HR roles', () => {
    const para = scoreMatch(job('Paralegal', 'Requirements:\n• Legal research and drafting pleadings\n• Excellent customer service\n• Teamwork and attention to detail'), warehouse, within)!
    const hr = scoreMatch(job('HR Generalist', 'Requirements:\n• HRIS, onboarding, employee relations\n• Customer service mindset and teamwork'), warehouse, within)!
    expect(para.score).toBeLessThanOrEqual(35)
    expect(hr.score).toBeLessThanOrEqual(35)
    expect(para.occupationRelevance).toBe('none')
    expect(para.explanation[0]).toMatch(/Occupation relevance: None/)
    expect(para.band).toBe('weak')
  })

  it('a barista candidate strongly matches a coffee-service job', () => {
    const r = scoreMatch(job('Barista', 'Requirements:\n• Espresso drinks and milk steaming\n• POS and cash handling\n• Food safety'), warehouse, within)!
    expect(r.score).toBeGreaterThanOrEqual(75)
    expect(r.band).toBe('strong')
    expect(r.matchedSkills).toEqual(expect.arrayContaining(['Espresso preparation', 'Milk steaming', 'POS systems', 'Cash handling']))
  })

  it('transferable skills give partial credit without claiming specific qualification', () => {
    const r = scoreMatch(job('Retail Sales Associate', 'Requirements:\n• Customer service and teamwork\n• Merchandising and visual displays\n• Cash handling'), warehouse, within)!
    expect(r.score).toBeGreaterThan(30)
    expect(r.score).toBeLessThanOrEqual(75)
    expect(r.occupationRelevance).not.toBe('strong')
  })

  it('missing required license caps the score and is explained', () => {
    const r = scoreMatch(job('CDL Truck Driver', 'Requirements:\n• Valid Class A CDL required\n• Clean driving record'), warehouse, within)!
    expect(r.score).toBeLessThanOrEqual(55)
    expect(r.missingQualifications.join()).toMatch(/CDL/)
  })

  it('a stated forklift certification requirement is listed as missing', () => {
    const r = scoreMatch(job('Warehouse Associate', 'Requirements:\n• Forklift certification required\n• RF scanner and order picking'), warehouse, within)!
    expect(r.missingQualifications).toContain('Forklift certification')
    expect(r.explanation.join('\n')).toMatch(/Missing qualification: Forklift certification/)
    expect(r.score).toBeLessThanOrEqual(80)
    expect(r.score).toBeGreaterThanOrEqual(60)
  })

  it('has no artificial minimum score', () => {
    const r = scoreMatch(job('Registered Nurse', 'Requirements:\n• Active RN license\n• Medication administration, IV therapy'), warehouse, within)!
    expect(r.score).toBeLessThan(30)
  })

  it('does not evaluate undisclosed salary and says so', () => {
    const r = scoreMatch(job('Barista', 'Espresso and POS'), warehouse, within)!
    const sal = r.criteria.find((c) => c.key === 'salary')!
    expect(sal.score).toBeNull()
    expect(sal.evidence).toMatch(/not disclosed|No salary preference/)
  })

  it('returns no score for an empty profile rather than a fake one', () => {
    const empty = buildCandidateModel(emptyProfile(), '')
    expect(scoreMatch(job('Barista', 'Espresso'), empty, within)).toBeUndefined()
  })
})
