import { afterEach, describe, expect, it } from 'vitest'
import type { JobProvider } from '../src/main/services/jobs/providers/types'
import { ALL_PROVIDERS } from '../src/main/services/jobs/providers'
import type { Services } from '../src/main/app/services'
import { adzunaPage, greenhouseJobs, leverPostings, remotiveBody, usajobsBody } from './fixtures/providerPayloads'
import { fakeFetch, json, makeServices, warehouseBaristaProfile, frontendProfile, type Route } from './helpers'

const routes = (calls: Record<string, number>): Route[] => [
  (u) => {
    if (u.hostname !== 'api.adzuna.com') return
    calls.adzuna = (calls.adzuna ?? 0) + 1
    const page = Number(u.pathname.split('/').pop())
    return json(adzunaPage(page))
  },
  (u) => (u.hostname === 'remotive.com' ? ((calls.remotive = (calls.remotive ?? 0) + 1), json(remotiveBody)) : undefined),
  (u) => {
    if (u.hostname !== 'boards-api.greenhouse.io') return
    calls.greenhouse = (calls.greenhouse ?? 0) + 1
    if (u.pathname === '/v1/boards/examplelogistics') return json({ name: 'Example Logistics', content: '' })
    if (u.pathname.startsWith('/v1/boards/examplelogistics/jobs')) return json(greenhouseJobs)
    return json({ status: 404, error: 'Job not found' }, 404)
  },
  (u) => (u.hostname === 'api.lever.co' && u.pathname.startsWith('/v0/postings/examplecoffee') ? json(leverPostings) : undefined),
  (u) => (u.hostname === 'data.usajobs.gov' ? ((calls.usajobs = (calls.usajobs ?? 0) + 1), json(usajobsBody)) : undefined),
  (u) => (u.hostname === 'remoteok.com' ? new Response('upstream error', { status: 500 }) : undefined)
]

let svc: Services | undefined
afterEach(async () => {
  await svc?.shutdown()
  svc = undefined
})

async function setup(extraProviders: JobProvider[] = [], calls: Record<string, number> = {}) {
  const made = await makeServices({ fetchImpl: fakeFetch(routes(calls)), providers: [...ALL_PROVIDERS, ...extraProviders] })
  svc = made.svc
  svc.store.secrets.set('adzuna.appId', 'test-app')
  svc.store.secrets.set('adzuna.appKey', 'test-key-123456')
  svc.store.secrets.set('usajobs.apiKey', 'usajobs-key-123')
  svc.store.secrets.set('usajobs.email', 'tester@example.com')
  await svc.employers.addBoard({ provider: 'greenhouse', boardId: 'examplelogistics' })
  svc.store.employers.upsert({ name: 'Example Coffee', atsProvider: 'lever', boardId: 'examplecoffee', locations: [], status: 'active', addedBy: 'user' })
  svc.store.candidate.save(warehouseBaristaProfile())
  return made
}

describe('local warehouse search (Los Angeles, 20 mi)', () => {
  it('returns only relevant, in-radius jobs with traceable sources', async () => {
    const calls: Record<string, number> = {}
    await setup([], calls)
    const res = await svc!.search.run({ query: 'Warehouse Associate', location: 'Los Angeles, CA', radius: 20, radiusUnit: 'mi' }, { trigger: 'manual' })
    const titles = res.jobs.map((j) => `${j.title} @ ${j.company}`)

    expect(titles).toContain('Warehouse Associate @ Pacific Coast Logistics')
    expect(titles).toContain('Warehouse Associate @ Example Logistics')
    expect(titles).toContain('Warehouse Associate - Night Shift @ Example Logistics')
    expect(titles).toContain('Materials Handler @ Defense Logistics Agency — Department of Defense')
    // Irrelevant occupations never appear even though they share generic terms.
    expect(titles.some((t) => /Paralegal|HR Generalist/.test(t))).toBe(false)
    // Riverside is ~50 miles away.
    expect(titles.some((t) => t.startsWith('Material Handler - Night Shift'))).toBe(false)
    expect(res.stats.excluded.irrelevant_occupation).toBeGreaterThanOrEqual(2)
    expect(res.stats.excluded.outside_radius).toBe(1)
    // Remote-only boards are not queried for a local on-site search.
    expect(calls.remotive).toBeUndefined()
    expect(res.stats.providers.find((p) => p.providerId === 'remotive')?.status).toBe('skipped')
    // Every result is traceable.
    for (const j of res.jobs) {
      expect(j.sourceUrl).toMatch(/^https:\/\//)
      expect(j.sources.length).toBeGreaterThan(0)
      expect(j.geo.eligibility).toBe('within_radius')
    }
    // Adzuna pagination: page 2 was requested and its record processed.
    expect(calls.adzuna).toBeGreaterThanOrEqual(2)
    expect(res.stats.fetched).toBeGreaterThanOrEqual(3 + 3 + 1)
  })

  it('discards provider-predicted salaries and shows only advertised pay', async () => {
    await setup()
    const res = await svc!.search.run({ query: 'paralegal', location: 'Los Angeles, CA', radius: 20 }, { trigger: 'manual' })
    const para = res.jobs.find((j) => j.title === 'Paralegal')!
    expect(para).toBeDefined()
    expect(para.salary).toBeUndefined()
    expect(para.salaryEstimateDiscarded).toBe(true)
  })

  it('scores a warehouse candidate honestly (no floor, explanation present)', async () => {
    await setup()
    const res = await svc!.search.run({ query: 'Warehouse Associate', location: 'Los Angeles, CA', radius: 20 }, { trigger: 'manual' })
    const wa = res.jobs.find((j) => j.company === 'Example Logistics' && j.title === 'Warehouse Associate')!
    expect(wa.match!.score).toBeGreaterThanOrEqual(70)
    expect(wa.match!.occupationRelevance).toBe('strong')
    expect(wa.match!.explanation.join('\n')).toMatch(/Occupation relevance: Strong/)
    expect(wa.match!.disclaimer).toMatch(/not a hiring probability/)
  })

  it('keeps day and night shift requisitions separate', async () => {
    await setup()
    const res = await svc!.search.run({ query: 'Warehouse Associate', location: 'Los Angeles, CA', radius: 20 }, { trigger: 'manual' })
    const gh = res.jobs.filter((j) => j.company === 'Example Logistics')
    expect(gh.map((j) => j.title).sort()).toEqual(['Warehouse Associate', 'Warehouse Associate - Night Shift'])
  })
})

describe('barista search', () => {
  it('finds the coffee job and not software jobs', async () => {
    await setup()
    const res = await svc!.search.run({ query: 'Barista', location: 'Los Angeles, CA', radius: 15 }, { trigger: 'manual' })
    // Long Beach is ~20 miles from downtown LA: outside 15 mi.
    expect(res.jobs.find((j) => j.title === 'Barista')).toBeUndefined()
    const wider = await svc!.search.run({ query: 'Barista', location: 'Lakewood, CA', radius: 15 }, { trigger: 'manual' })
    const b = wider.jobs.find((j) => j.title === 'Barista')!
    expect(b).toBeDefined()
    expect(b.salary).toMatchObject({ min: 19, max: 22, period: 'hour', currency: 'USD' })
    expect(b.match!.score).toBeGreaterThanOrEqual(75)
    expect(wider.jobs.some((j) => /developer|engineer/i.test(j.title))).toBe(false)
  })
})

describe('remote software search', () => {
  it('respects remote eligibility', async () => {
    await setup()
    svc!.store.candidate.save(frontendProfile())
    const res = await svc!.search.run({ query: 'Junior Frontend Developer', location: 'United States', workModes: ['remote'] }, { trigger: 'manual' })
    const titles = res.jobs.map((j) => j.title)
    expect(titles).toContain('Junior Frontend Developer')
    // "Europe" only role is not eligible for a US candidate.
    expect(titles).not.toContain('Frontend Engineer')
    expect(res.stats.excluded.remote_ineligible).toBe(1)
    const job = res.jobs.find((j) => j.title === 'Junior Frontend Developer')!
    expect(job.description).not.toMatch(/alert\(1\)|<script/)
    expect(job.geo.eligibility).toBe('remote_eligible')
    // Remote OK failed with HTTP 500 but did not stop the search.
    const rok = res.stats.providers.find((p) => p.providerId === 'remoteok')!
    expect(rok.status).toBe('error')
  })
})

describe('fault tolerance', () => {
  const thrower: JobProvider = {
    ...ALL_PROVIDERS.find((p) => p.id === 'remoteok')!,
    id: 'broken',
    name: 'Broken provider',
    hosts: [],
    supports: () => ({ ok: true }),
    fetch: async () => {
      throw new Error('boom')
    }
  }
  const malformed: JobProvider = {
    ...ALL_PROVIDERS.find((p) => p.id === 'remoteok')!,
    id: 'malformed',
    name: 'Malformed provider',
    hosts: [],
    supports: () => ({ ok: true }),
    fetch: async () => [
      { sourceJobId: 'm1', payload: { title: 'Warehouse Associate', url: 'javascript:alert(1)' } },
      { sourceJobId: 'm2', payload: { title: '', url: 'https://ok.example.com/job' } }
    ],
    normalize: (r) => {
      const p = r.payload as { title: string; url: string }
      return { sourceJobId: r.sourceJobId, sourceUrl: p.url, title: p.title, company: 'X', locationText: 'Los Angeles, CA', employerDirect: false }
    }
  }

  it('a failing provider does not stop the others; malformed records are rejected', async () => {
    await setup([thrower, malformed])
    const res = await svc!.search.run({ query: 'Warehouse Associate', location: 'Los Angeles, CA', radius: 20 }, { trigger: 'manual' })
    expect(res.stats.providers.find((p) => p.providerId === 'broken')).toMatchObject({ status: 'error', reason: 'boom' })
    expect(res.stats.providers.find((p) => p.providerId === 'malformed')).toMatchObject({ rejected: 2, normalized: 0 })
    expect(res.stats.rejectedMalformed).toBe(2)
    expect(res.jobs.length).toBeGreaterThan(0)
    expect(res.jobs.some((j) => j.source === 'malformed')).toBe(false)
  })

  it('missing credentials produce an actionable skipped state', async () => {
    await setup()
    svc!.store.secrets.delete('adzuna.appKey')
    const res = await svc!.search.run({ query: 'Warehouse Associate', location: 'Los Angeles, CA', radius: 20 }, { trigger: 'manual' })
    expect(res.stats.providers.find((p) => p.providerId === 'adzuna')).toMatchObject({ status: 'skipped', reason: expect.stringContaining('Requires credentials') })
    const info = svc!.search.providerInfos().find((p) => p.id === 'adzuna')!
    expect(info.status).toBe('REQUIRES_CREDENTIALS')
    expect(info.statusDetail).toMatch(/Application key/)
    expect(svc!.search.providerInfos().find((p) => p.id === 'linkedin')!.status).toBe('MANUAL')
  })

  it('rate limits are recorded and the provider is paused', async () => {
    const made = await makeServices({
      fetchImpl: fakeFetch([(u) => (u.hostname === 'api.adzuna.com' ? json({ error: 'quota' }, 429, { 'retry-after': '3600' }) : undefined)])
    })
    svc = made.svc
    svc.store.secrets.set('adzuna.appId', 'a')
    svc.store.secrets.set('adzuna.appKey', 'bbbbbbbb')
    const res = await svc.search.run({ query: 'cashier', location: 'Los Angeles, CA' }, { trigger: 'manual' })
    expect(res.stats.providers.find((p) => p.providerId === 'adzuna')!.status).toBe('error')
    const info = svc.search.providerInfos().find((p) => p.id === 'adzuna')!
    expect(info.status).toBe('LIMITED')
    const again = await svc.search.run({ query: 'cashier', location: 'Los Angeles, CA' }, { trigger: 'manual' })
    expect(again.stats.providers.find((p) => p.providerId === 'adzuna')!.reason).toMatch(/Rate-limited/)
  })

  it('caches provider responses and reuses stable job ids', async () => {
    const calls: Record<string, number> = {}
    await setup([], calls)
    const a = await svc!.search.run({ query: 'Warehouse Associate', location: 'Los Angeles, CA', radius: 20 }, { trigger: 'manual' })
    const before = calls.adzuna
    const b = await svc!.search.run({ query: 'Warehouse Associate', location: 'Los Angeles, CA', radius: 20 }, { trigger: 'manual' })
    expect(calls.adzuna).toBe(before)
    expect(b.stats.providers.find((p) => p.providerId === 'adzuna')!.status).toBe('cached')
    expect(b.jobs.map((j) => j.id).sort()).toEqual(a.jobs.map((j) => j.id).sort())
    expect(b.stats.newJobs).toBe(0)
  })

  it('cancellation stops a run', async () => {
    const slow: JobProvider = {
      ...thrower,
      id: 'slow',
      fetch: (_q, ctx) => new Promise((_r, rej) => ctx.signal.addEventListener('abort', () => rej(new Error('aborted'))))
    }
    await setup([slow])
    const events: string[] = []
    const p = svc!.search.run({ query: 'Warehouse Associate', location: 'Los Angeles, CA' }, { trigger: 'manual', onProgress: (e) => events.push(e.runId) })
    await new Promise((r) => setTimeout(r, 300))
    expect(svc!.search.cancel(events[0])).toBe(true)
    const res = await p
    expect(res.cancelled).toBe(true)
  })
})
