import { afterEach, describe, expect, it } from 'vitest'
import type { JobProvider } from '../src/main/services/jobs/providers/types'
import type { DraftJob } from '../src/main/services/jobs/providers/types'
import type { SearchCriteria } from '../src/shared/types'
import type { Services } from '../src/main/app/services'
import { createHandlers } from '../src/main/ipc/handlers'
import { makeServices, tmpDir, warehouseBaristaProfile } from './helpers'

/** A provider that serves fixed drafts (synthetic fixtures, clearly not real vacancies). */
function fixtureProvider(drafts: DraftJob[], id = 'fixture'): JobProvider {
  return {
    id,
    name: 'Fixture source',
    kind: 'aggregator',
    description: 'test fixtures',
    markets: 'test',
    credentials: [],
    defaultEnabled: true,
    rateLimit: { minIntervalMs: 0, note: '' },
    cacheTtlMs: 0,
    timeoutMs: 5000,
    hosts: [],
    supports: () => ({ ok: true }),
    isConfigured: () => true,
    fetch: async () => drafts.map((d) => ({ sourceJobId: d.sourceJobId, payload: d })),
    normalize: (r) => r.payload as DraftJob
  }
}

const draft = (
  sourceJobId: string,
  title: string,
  locationText: string,
  extra: Partial<DraftJob> = {}
): DraftJob => ({
  sourceJobId,
  sourceUrl: `https://jobs.example.com/${sourceJobId}`,
  title,
  company: `Fixture Co ${sourceJobId}`,
  descriptionText:
    'Responsibilities: order picking, packing, loading trucks, RF scanner use, pallet jack. Full-time on-site role.',
  locationText,
  employerDirect: false,
  ...extra
})

const LA_FIXTURES = [
  draft('wh-la', 'Warehouse Associate', 'Los Angeles, CA'),
  draft('wh-lb', 'Warehouse Associate', 'Long Beach, CA'),
  draft('wh-berlin', 'Warehouse Associate', 'Berlin, Germany'),
  draft('para-ny', 'Hotline Paralegal', 'New York, NY', {
    descriptionText: 'Legal research, case files, customer service, attention to detail.'
  }),
  draft('swe-zurich', 'Software Engineer III', 'Zurich, Switzerland', {
    descriptionText: 'TypeScript, React, distributed systems, customer service mindset.'
  }),
  draft('wh-nowhere', 'Warehouse Associate', 'Multiple locations'),
  draft('wh-remote-eu', 'Warehouse Planner (Remote)', 'Remote - Europe only', {
    workModes: ['remote'],
    remoteEligibilityText: 'Europe only'
  })
]

const LA: SearchCriteria = {
  query: 'Warehouse Associate',
  location: 'Los Angeles, CA',
  radius: 20,
  radiusUnit: 'mi',
  workModes: ['onsite']
}

let svc: Services | undefined
afterEach(async () => {
  await svc?.shutdown()
  svc = undefined
})

async function setup(drafts = LA_FIXTURES, dir?: string): Promise<Services> {
  svc = (await makeServices({ providers: [fixtureProvider(drafts)], userDataDir: dir ?? tmpDir() }))
    .svc
  svc.store.candidate.save(warehouseBaristaProfile())
  return svc
}

describe('TEST 1 — strict location filter (Los Angeles, 20 mi)', () => {
  it('shows only LA-area warehouse jobs; everything else is excluded before scoring', async () => {
    const s = await setup()
    await s.criteria.setActive(LA)
    const res = await s.search.run(LA, { trigger: 'manual' })
    const titles = res.jobs.map((j) => `${j.title} @ ${j.locationText}`)
    expect(titles.sort()).toEqual([
      'Warehouse Associate @ Long Beach, CA',
      'Warehouse Associate @ Los Angeles, CA'
    ])
    // Unknown location is set aside for review, not mixed in.
    expect(res.review.map((j) => j.sourceJobId)).toEqual(['wh-nowhere'])
    // Counted by the first failing filter.
    expect(res.stats.excluded).toEqual({
      outside_radius: 1, // Berlin
      irrelevant_occupation: 2, // paralegal, software engineer
      remote_not_requested: 1 // remote-only planner on an on-site search
    })
    // Excluded jobs never receive a score.
    const stored = s.store.jobs.list({ view: 'excluded', limit: 100 })
    expect(stored.length).toBe(4)
    for (const j of stored) {
      expect(j.match).toBeUndefined()
      expect(j.eligibility?.exclusionReasons.length).toBeGreaterThan(0)
    }
    const berlin = stored.find((j) => j.sourceJobId === 'wh-berlin')!
    expect(berlin.eligibility).toMatchObject({
      status: 'excluded',
      locationStatus: 'outside',
      occupationStatus: 'match'
    })
    const para = stored.find((j) => j.sourceJobId === 'para-ny')!
    expect(para.eligibility!.exclusionReasons).toEqual(
      expect.arrayContaining(['irrelevant_occupation', 'outside_radius'])
    )
  })

  it('preferred-location mode is opt-in and labels far-away jobs instead of hiding them', async () => {
    const s = await setup()
    const res = await s.search.run({ ...LA, locationMode: 'preferred' }, { trigger: 'manual' })
    const byId = new Map(res.jobs.map((j) => [j.sourceJobId, j]))
    expect([...byId.keys()].sort()).toEqual(['wh-berlin', 'wh-la', 'wh-lb'])
    expect(byId.get('wh-berlin')!.eligibility!.locationStatus).toBe('outside_preferred')
    expect(byId.get('wh-berlin')!.match!.score).toBeLessThan(byId.get('wh-la')!.match!.score)
    // Occupation is still a hard filter.
    expect(byId.has('para-ny')).toBe(false)
    expect(byId.has('swe-zurich')).toBe(false)
  })
})

describe('TEST 2 — no score inflation', () => {
  it('filters are not scored twice and unrelated occupations cannot be scored at all', async () => {
    const s = await setup()
    const res = await s.search.run(LA, { trigger: 'manual' })
    const la = res.jobs.find((j) => j.sourceJobId === 'wh-la')!
    const loc = la.match!.criteria.find((c) => c.key === 'location')!
    expect(loc.score).toBeNull()
    expect(loc.evidence).toMatch(/filter/)
    // A different occupation evaluated in isolation is capped far below a real match.
    const ctx = await s.criteria.context({ ...LA, query: 'Paralegal', location: 'New York, NY' })
    const para = (await s.criteria.evaluate(s.store.jobs.forEvaluation(), ctx)).find(
      (e) => e.job.sourceJobId === 'para-ny'
    )!
    expect(para.eligibility.status).toBe('eligible')
    expect(para.match!.score).toBeLessThanOrEqual(35)
  })

  it('applies the minimum match score after scoring', async () => {
    const s = await setup()
    const res = await s.search.run({ ...LA, minimumMatchScore: 99 }, { trigger: 'manual' })
    expect(res.jobs).toHaveLength(0)
    // The two eligible jobs and the location-unverified one all fall below 99.
    expect(res.stats.belowMinimumScore).toBe(3)
    expect(res.review).toHaveLength(0)
  })
})

describe('TEST 3 — remote eligibility', () => {
  it('includes remote jobs only when requested and only where the candidate may work', async () => {
    const s = await setup([
      draft('r-us', 'Warehouse Associate (Remote)', 'Remote - US only', {
        workModes: ['remote'],
        remoteEligibilityText: 'US only'
      }),
      draft('r-eu', 'Warehouse Associate (Remote)', 'Remote - EU only', {
        workModes: ['remote'],
        remoteEligibilityText: 'Remote within the European Union only'
      }),
      draft('r-any', 'Warehouse Associate (Remote)', 'Remote', { workModes: ['remote'] })
    ])
    const onsite = await s.search.run(LA, { trigger: 'manual' })
    expect(onsite.jobs).toHaveLength(0)
    expect(onsite.stats.excluded.remote_not_requested).toBeGreaterThan(0)

    const remote = await s.search.run(
      { ...LA, workModes: ['onsite', 'remote'] },
      { trigger: 'manual' }
    )
    expect(remote.jobs.map((j) => j.sourceJobId)).toEqual(['r-us'])
    expect(remote.review.map((j) => j.sourceJobId)).toEqual(['r-any'])
    expect(remote.stats.excluded.remote_ineligible).toBe(1)
  })
})

describe('TEST 4 — saved criteria are authoritative and survive restart', () => {
  it('editing criteria recalculates stored jobs and counters without a new search', async () => {
    const dir = tmpDir()
    const s = await setup(LA_FIXTURES, dir)
    const handlers = createHandlers(
      s,
      {
        pickResumeFile: async () => null,
        saveJsonFile: async () => null,
        confirm: async () => true,
        openExternal: async () => undefined,
        appInfo: () => ({ version: 't', isPackaged: false })
      },
      () => undefined
    )
    await handlers['search:run'](LA)
    let counters = await handlers['jobs:counters']()
    expect(counters).toMatchObject({ historical: 7, eligible: 2, review: 1, excluded: 4 })
    expect(counters.excludedBy.location).toBe(1)
    expect(counters.lastRun?.fetched).toBe(7)

    // Widen to 50 km in Long Beach only: LA downtown (~31 km away) stays in, Berlin stays out.
    await handlers['criteria:save']({ ...LA, location: 'Long Beach, CA', radius: 5 })
    const eligible = await handlers['jobs:list']({ view: 'eligible' })
    expect(eligible.map((j) => j.sourceJobId)).toEqual(['wh-lb'])
    counters = await handlers['jobs:counters']()
    expect(counters.eligible).toBe(1)

    // A search for a different occupation never shows the old warehouse jobs.
    await handlers['criteria:save']({ ...LA, query: 'Barista' })
    expect(await handlers['jobs:list']({ view: 'eligible' })).toHaveLength(0)
    expect((await handlers['jobs:list']({ view: 'archive' })).length).toBe(7)

    await s.shutdown()
    svc = undefined
    const again = await setup(LA_FIXTURES, dir)
    expect(again.criteria.getActive()).toMatchObject({
      query: 'Barista',
      location: 'Los Angeles, CA',
      locationMode: 'strict'
    })
    expect(again.store.jobs.list({ view: 'eligible' })).toHaveLength(0)
  })

  it('a scheduled search is evaluated with its own criteria while stored results follow the active ones', async () => {
    const s = await setup()
    await s.criteria.setActive({ ...LA, query: 'Barista' })
    const saved = s.store.searches.save({
      name: 'Warehouse LA',
      criteria: LA,
      enabled: true,
      intervalMinutes: 60,
      notify: false,
      minScoreToNotify: 0
    })
    const out = await s.scheduler.runNow(saved.id)
    expect(out?.resultCount).toBe(2)
    // Results page (active = Barista) is unaffected by the warehouse run.
    expect(s.store.jobs.list({ view: 'eligible' })).toHaveLength(0)
  })
})
