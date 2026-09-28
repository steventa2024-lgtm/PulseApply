import { afterEach, describe, expect, it } from 'vitest'
import type { Services } from '../src/main/app/services'
import { fakeFetch, json, makeServices, warehouseBaristaProfile } from './helpers'

/** Synthetic fixtures in each provider's documented response shape (not real vacancies). */
const COS_JOBS = {
  JobCount: '3',
  Jobs: [
    {
      JvId: 'NLX-1',
      JobTitle: 'Warehouse Associate',
      Company: 'Fixture Freight LLC',
      DatePosted: '2026-09-25T00:00:00',
      URL: 'https://jobs.example-statebank.test/NLX-1',
      Location: 'Carson, CA',
      Fc: ''
    },
    {
      JvId: 'NLX-2',
      JobTitle: 'Barista',
      Company: 'Fixture Coffee',
      DatePosted: '2026-09-26T00:00:00',
      URL: 'https://jobs.example-statebank.test/NLX-2',
      Location: 'Los Angeles, CA'
    },
    {
      JvId: 'NLX-3',
      JobTitle: 'Warehouse Associate',
      Company: 'Fixture Distribution',
      DatePosted: '2026-09-26T00:00:00',
      URL: 'https://jobs.example-statebank.test/NLX-3',
      Location: 'Sacramento, CA'
    }
  ]
}

const MUSE = {
  page: 0,
  page_count: 1,
  results: [
    {
      id: 101,
      name: 'Warehouse Operations Associate',
      contents: '&lt;p&gt;Pick, pack and ship orders.&lt;/p&gt;',
      publication_date: '2026-09-20T00:00:00Z',
      locations: [{ name: 'Los Angeles, CA' }],
      levels: [{ name: 'Entry Level' }],
      company: { name: 'Fixture Retail Co' },
      refs: { landing_page: 'https://www.themuse.com/jobs/fixtureretail/warehouse-101' }
    },
    {
      id: 102,
      name: 'Senior Software Engineer',
      contents: '<p>Build services.</p>',
      locations: [{ name: 'Los Angeles, CA' }],
      company: { name: 'Fixture Tech' },
      refs: { landing_page: 'https://www.themuse.com/jobs/fixturetech/swe-102' }
    }
  ]
}

let svc: Services | undefined
afterEach(async () => {
  await svc?.shutdown()
  svc = undefined
})

describe('local U.S. sources', () => {
  it('CareerOneStop and The Muse return local jobs that pass the same filters', async () => {
    const calls: string[] = []
    svc = (
      await makeServices({
        fetchImpl: fakeFetch(
          [
            (u, init) =>
              u.hostname === 'api.careeronestop.org'
                ? (init?.headers as Record<string, string>)?.Authorization === 'Bearer cos-token'
                  ? json(COS_JOBS)
                  : json({ error: 'unauthorized' }, 401)
                : undefined,
            (u) => (u.hostname === 'www.themuse.com' ? json(MUSE) : undefined)
          ],
          calls
        )
      })
    ).svc
    svc.store.candidate.save(warehouseBaristaProfile())
    svc.store.secrets.set('careeronestop.userId', 'user-1')
    svc.store.secrets.set('careeronestop.token', 'cos-token')
    const res = await svc.search.run(
      {
        query: 'Warehouse Associate',
        location: 'Los Angeles, CA',
        radius: 20,
        providerIds: ['careeronestop', 'themuse']
      },
      { trigger: 'manual' }
    )
    const cos = calls.find((c) => c.includes('api.careeronestop.org'))!
    expect(cos).toContain('/v2/jobsearch/user-1/Warehouse%20Associate/Los%20Angeles%2C%20CA/20/')
    expect(cos).toContain('source=NLx')
    expect(calls.find((c) => c.includes('themuse'))).toContain('location=Los+Angeles%2C+CA')
    const got = res.jobs.map((j) => `${j.title} | ${j.company} | ${j.locationText}`).sort()
    expect(got).toEqual([
      'Warehouse Associate | Fixture Freight LLC | Carson, CA',
      'Warehouse Operations Associate | Fixture Retail Co | Los Angeles, CA'
    ])
    // Escaped HTML from the provider is shown as plain text.
    const muse = res.jobs.find((j) => j.company === 'Fixture Retail Co')!
    expect(muse.description).toBe('Pick, pack and ship orders.')
    expect(res.stats.excluded.outside_radius).toBe(1) // Sacramento
    expect(res.stats.excluded.irrelevant_occupation).toBe(2) // Barista, Software Engineer
  })

  it('CareerOneStop is skipped with an actionable reason when not configured', async () => {
    svc = (await makeServices({ fetchImpl: fakeFetch([]) })).svc
    const info = svc.search.providerInfos().find((p) => p.id === 'careeronestop')!
    expect(info.status).toBe('REQUIRES_CREDENTIALS')
    expect(info.signupUrl).toMatch(/careeronestop\.org/)
    const remote = svc.search.providerInfos().find((p) => p.id === 'themuse')!
    expect(remote.status).toBe('AVAILABLE')
  })
})
