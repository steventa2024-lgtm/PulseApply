import { describe, expect, it } from 'vitest'
import type { NormalizedJob } from '../src/shared/types'
import { dedupeJobs } from '../src/main/services/jobs/deduplication/dedupe'
import { normalizeDraft } from '../src/main/services/jobs/normalization/normalize'
import type { DraftJob } from '../src/main/services/jobs/providers/types'
import { GeoService } from '../src/main/services/jobs/geo/geoService'
import { Gazetteer } from '../src/main/services/jobs/geo/gazetteer'
import { buildIntent, parseQuery } from '../src/main/services/jobs/search/intent'
import { classifyJob, computeRelevance } from '../src/main/services/jobs/search/classify'
import { OCCUPATIONS } from '../src/main/services/jobs/search/taxonomy'
import { SKILL_BY_ID, CERT_BY_ID } from '../src/main/services/jobs/search/skills'
import { RESOURCES } from './helpers'

const geo = new GeoService(new Gazetteer(RESOURCES), null, null, () => false)
const norm = (d: Partial<DraftJob>, providerId = 'p'): NormalizedJob =>
  normalizeDraft(
    { sourceJobId: 'x', sourceUrl: 'https://example.com/x', title: 'T', company: 'C', locationText: 'Carson, CA', employerDirect: false, ...d } as DraftJob,
    { providerId, providerName: providerId, geo }
  ).job!

describe('cross-source deduplication', () => {
  it('merges the same requisition found through three sources and prefers the employer link', () => {
    const ats = norm(
      { sourceJobId: 'b:7001', sourceUrl: 'https://boards.greenhouse.io/acme/jobs/7001', applyUrl: 'https://job-boards.greenhouse.io/acme/jobs/7001', title: 'Warehouse Associate', company: 'Acme Logistics, Inc.', employerDirect: true, ats: { provider: 'greenhouse', board: 'acme', postingId: '7001' } },
      'greenhouse'
    )
    const adz = norm({ sourceJobId: 'a1', sourceUrl: 'https://www.adzuna.com/land/ad/1', title: 'Warehouse Associate', company: 'Acme Logistics' }, 'adzuna')
    const joo = norm({ sourceJobId: 'j1', sourceUrl: 'https://jooble.org/desc/1', title: 'Warehouse Associate', company: 'ACME LOGISTICS LLC' }, 'jooble')
    const { jobs, merged } = dedupeJobs([adz, joo, ats])
    expect(jobs).toHaveLength(1)
    expect(merged).toBe(2)
    expect(jobs[0].sources.map((s) => s.providerId).sort()).toEqual(['adzuna', 'greenhouse', 'jooble'])
    expect(jobs[0].applyUrl).toBe('https://job-boards.greenhouse.io/acme/jobs/7001')
    expect(jobs[0].verificationStatus).toBe('EMPLOYER_CONFIRMED')
  })

  it('keeps day and night shift postings separate', () => {
    const day = norm({ sourceJobId: 'd', sourceUrl: 'https://example.com/d', title: 'Warehouse Associate — Day Shift', company: 'Acme' })
    const night = norm({ sourceJobId: 'n', sourceUrl: 'https://example.com/n', title: 'Warehouse Associate — Night Shift', company: 'Acme' })
    expect(dedupeJobs([day, night]).jobs).toHaveLength(2)
  })

  it('never merges different postings on the same employer board', () => {
    const a = norm({ sourceJobId: 'b:1', sourceUrl: 'https://boards.greenhouse.io/acme/jobs/1', title: 'Barista', company: 'Acme', ats: { provider: 'greenhouse', board: 'acme', postingId: '1' }, employerDirect: true }, 'greenhouse')
    const b = norm({ sourceJobId: 'b:2', sourceUrl: 'https://boards.greenhouse.io/acme/jobs/2', title: 'Barista', company: 'Acme', ats: { provider: 'greenhouse', board: 'acme', postingId: '2' }, employerDirect: true }, 'greenhouse')
    expect(dedupeJobs([a, b]).jobs).toHaveLength(2)
  })

  it('does not merge same title/employer in different cities', () => {
    const a = norm({ sourceJobId: '1', sourceUrl: 'https://example.com/1', title: 'Barista', company: 'Acme', locationText: 'Long Beach, CA' })
    const b = norm({ sourceJobId: '2', sourceUrl: 'https://example.com/2', title: 'Barista', company: 'Acme', locationText: 'Seattle, WA' })
    expect(dedupeJobs([a, b]).jobs).toHaveLength(2)
  })
})

describe('search intent', () => {
  it('parses the documented example queries', () => {
    expect(parseQuery('Barista jobs near me')).toMatchObject({ keywords: 'Barista', nearMe: true })
    expect(parseQuery('Entry-level warehouse jobs in Los Angeles')).toMatchObject({ keywords: 'warehouse', locationText: 'Los Angeles', seniority: ['entry'] })
    expect(parseQuery('Remote junior frontend developer')).toMatchObject({ keywords: 'frontend developer', workModes: ['remote'], seniority: ['junior'] })
    expect(parseQuery('Part-time hotel front desk within 10 miles')).toMatchObject({ keywords: 'hotel front desk', radius: 10, radiusUnit: 'mi', employmentTypes: ['part_time'], nearMe: true })
    expect(parseQuery('Night shift jobs paying at least $22/hour')).toMatchObject({ minimumSalary: 22, salaryPeriod: 'hour', currency: 'USD', schedule: ['night'] })
    expect(parseQuery('Software engineer positions in Toronto')).toMatchObject({ keywords: 'Software engineer', locationText: 'Toronto' })
  })

  it('maps queries to occupations and synonyms', () => {
    const i = buildIntent({ query: 'Warehouse Associate' })
    expect(i.normalizedOccupations[0]).toBe('warehouse_associate')
    expect(i.occupationSynonyms).toEqual(expect.arrayContaining(['material handler', 'order picker']))
    expect(buildIntent({ query: 'barista' }).normalizedOccupations).toContain('barista')
    expect(buildIntent({ query: 'Remote junior frontend developer' }).normalizedOccupations).toContain('frontend_developer')
  })

  it('uses titles as primary evidence and never matches paralegal to warehouse', () => {
    const intent = buildIntent({ query: 'warehouse associate' })
    const para = { title: 'Paralegal', description: 'Customer service, inventory of case files, warehouse of documents', occupation: classifyJob('Paralegal') }
    expect(computeRelevance(para, intent).score).toBeLessThan(0.45)
    const handler = { title: 'Material Handler II', description: '', occupation: classifyJob('Material Handler II') }
    expect(computeRelevance(handler, intent).score).toBe(1)
  })

  it('taxonomy references only defined skills and certifications', () => {
    for (const o of OCCUPATIONS) {
      for (const s of o.skills) expect(SKILL_BY_ID.has(s), `${o.id} skill ${s}`).toBe(true)
      for (const c of o.certifications ?? []) expect(CERT_BY_ID.has(c), `${o.id} cert ${c}`).toBe(true)
      for (const r of o.related) expect(OCCUPATIONS.some((x) => x.id === r), `${o.id} related ${r}`).toBe(true)
    }
  })
})

describe('normalization', () => {
  it('keeps inferred fields separate and never invents salary', () => {
    const j = normalizeDraft(
      { sourceJobId: '1', sourceUrl: 'https://example.com/1', title: 'Line Cook', company: 'Diner', descriptionHtml: '<p>We raised $5M in funding.</p><p>Pay: $19.50 - $22.00 per hour</p>', locationText: 'Austin, TX', employerDirect: false },
      { providerId: 't', providerName: 'T', geo }
    ).job!
    expect(j.salary).toMatchObject({ min: 19.5, max: 22, period: 'hour', currency: 'USD' })
    expect(j.inferredFields).toContain('salary')
    expect(j.inferredFields).toContain('workModes')
    const none = normalizeDraft(
      { sourceJobId: '2', sourceUrl: 'https://example.com/2', title: 'Line Cook', company: 'Diner', descriptionText: 'Great team.', locationText: 'Austin, TX', employerDirect: false },
      { providerId: 't', providerName: 'T', geo }
    ).job!
    expect(none.salary).toBeUndefined()
  })

  it('rejects malformed records', () => {
    expect(normalizeDraft({ sourceJobId: '', sourceUrl: 'https://e.com', title: 'x', company: 'c', locationText: '', employerDirect: false }, { providerId: 't', providerName: 'T', geo }).error).toBeTruthy()
    expect(normalizeDraft({ sourceJobId: '1', sourceUrl: 'http://127.0.0.1/admin', title: 'Barista', company: 'c', locationText: '', employerDirect: false }, { providerId: 't', providerName: 'T', geo }).error).toMatch(/sourceUrl/)
    const bad = normalizeDraft({ sourceJobId: '1', sourceUrl: 'https://e.com/j', applyUrl: 'javascript:alert(1)', title: 'Barista', company: 'c', locationText: '', employerDirect: false }, { providerId: 't', providerName: 'T', geo }).job!
    expect(bad.applyUrl).toBeUndefined()
    expect(bad.verificationNotes.join()).toMatch(/malformed/)
  })

  it('flags scam signals without flagging legitimate recruiters', () => {
    const scam = normalizeDraft(
      { sourceJobId: '1', sourceUrl: 'https://e.com/j', title: 'Package Reshipping Coordinator', company: 'Global Freight', descriptionText: 'Work from home! Pay a $99 training fee. Contact us on Telegram.', locationText: 'Remote', employerDirect: false },
      { providerId: 't', providerName: 'T', geo }
    ).job!
    expect(scam.scamSignals.length).toBeGreaterThanOrEqual(2)
    const recruiter = normalizeDraft(
      { sourceJobId: '2', sourceUrl: 'https://e.com/k', title: 'Warehouse Associate', company: 'Staffing Partners Inc', descriptionText: 'Our staffing agency is hiring for a client warehouse.', locationText: 'Carson, CA', employerDirect: false },
      { providerId: 't', providerName: 'T', geo }
    ).job!
    expect(recruiter.scamSignals).toEqual([])
  })
})
