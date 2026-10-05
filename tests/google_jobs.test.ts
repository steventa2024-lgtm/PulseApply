import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Browser } from 'playwright'
import type { Services } from '../src/main/app/services'
import { readJobFromPage, type ClippedJob } from '../src/shared/clip'
import { relativeToIso } from '../src/main/services/jobs/providers/googleJobs'
import { CHROMIUM, fakeFetch, json, makeServices, warehouseBaristaProfile } from './helpers'

/** Synthetic responses in each API's documented shape (not real vacancies). */
const JSEARCH = {
  status: 'OK',
  data: [
    {
      job_id: 'js-1',
      job_title: 'Warehouse Associate',
      employer_name: 'Fixture Freight',
      employer_website: 'https://fixturefreight.example.com',
      job_publisher: 'LinkedIn',
      job_employment_type: 'FULLTIME',
      job_apply_link: 'https://www.linkedin.com/jobs/view/111',
      apply_options: [
        {
          publisher: 'LinkedIn',
          apply_link: 'https://www.linkedin.com/jobs/view/111',
          is_direct: false
        },
        {
          publisher: 'Indeed',
          apply_link: 'https://www.indeed.com/viewjob?jk=abc',
          is_direct: false
        },
        {
          publisher: 'Fixture Freight Careers',
          apply_link: 'https://careers.fixturefreight.example.com/77',
          is_direct: true
        }
      ],
      job_description: 'Pick and pack orders with RF scanners. Load trucks.',
      job_is_remote: false,
      job_posted_at_datetime_utc: '2026-09-30T12:00:00.000Z',
      job_city: 'Carson',
      job_state: 'CA',
      job_country: 'US',
      job_latitude: 33.8317,
      job_longitude: -118.282,
      job_min_salary: 19.5,
      job_max_salary: 21,
      job_salary_period: 'HOUR'
    },
    {
      job_id: 'js-2',
      job_title: 'Warehouse Associate',
      employer_name: 'Far Away Co',
      job_publisher: 'Indeed',
      job_apply_link: 'https://www.indeed.com/viewjob?jk=far',
      job_city: 'Sacramento',
      job_state: 'CA',
      job_country: 'US',
      job_latitude: 38.58,
      job_longitude: -121.49
    },
    {
      job_id: 'js-3',
      job_title: 'Hotline Paralegal',
      employer_name: 'Law Co',
      job_publisher: 'Glassdoor',
      job_apply_link: 'https://www.glassdoor.com/job-listing/x',
      job_city: 'Los Angeles',
      job_state: 'CA',
      job_country: 'US'
    }
  ]
}

const SERP_PAGE_1 = {
  jobs_results: [
    {
      title: 'Warehouse Worker',
      company_name: 'Fixture Grocery DC',
      location: 'Compton, CA',
      via: 'via ZipRecruiter',
      description: 'Order selector, pallet jack, forklift a plus.',
      job_id: 'serp-1',
      detected_extensions: {
        posted_at: '3 days ago',
        schedule_type: 'Full-time',
        salary: '$20–$23 an hour'
      },
      apply_options: [
        { title: 'ZipRecruiter', link: 'https://www.ziprecruiter.com/c/Fixture/Job/1' },
        { title: 'Fixture Grocery Careers', link: 'https://jobs.fixturegrocery.example.com/1' }
      ]
    }
  ],
  serpapi_pagination: { next_page_token: 'tok2' }
}
const SERP_PAGE_2 = {
  jobs_results: [
    {
      title: 'Barista',
      company_name: 'Bean Fixture',
      location: 'Long Beach, CA',
      via: 'via Indeed',
      job_id: 'serp-2',
      apply_options: [{ title: 'Indeed', link: 'https://www.indeed.com/viewjob?jk=b1' }]
    }
  ]
}

let svc: Services | undefined
afterEach(async () => {
  await svc?.shutdown()
  svc = undefined
})

describe('Google Jobs sources (LinkedIn, Indeed, Glassdoor, ZipRecruiter listings)', () => {
  it('JSearch returns big-board listings that go through the same filters', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = []
    svc = (
      await makeServices({
        fetchImpl: fakeFetch([
          (u, init) => {
            if (u.hostname !== 'jsearch.p.rapidapi.com') return undefined
            calls.push({ url: u.href, headers: init?.headers as Record<string, string> })
            return json(JSEARCH)
          }
        ])
      })
    ).svc
    svc.store.candidate.save(warehouseBaristaProfile())
    svc.store.secrets.set('jsearch.apiKey', 'rapid-key')
    const criteria = {
      query: 'Warehouse Associate',
      location: 'Los Angeles, CA',
      radius: 25,
      providerIds: ['jsearch']
    }
    await svc.criteria.setActive(criteria)
    const res = await svc.search.run(criteria, { trigger: 'manual' })

    const u = new URL(calls[0].url)
    expect(u.searchParams.get('query')).toBe('Warehouse Associate in Los Angeles, CA')
    expect(u.searchParams.get('country')).toBe('us')
    expect(calls[0].headers['x-rapidapi-key']).toBe('rapid-key')

    expect(res.jobs.map((j) => j.company)).toEqual(['Fixture Freight'])
    const job = res.jobs[0]
    expect(job.applyUrl).toBe('https://careers.fixturefreight.example.com/77') // employer's own link preferred
    expect(job.salary).toMatchObject({ min: 19.5, max: 21, period: 'hour' })
    expect(job.verificationNotes.join()).toMatch(
      /Listed on: LinkedIn, Indeed, Fixture Freight Careers/
    )
    expect(res.stats.excluded).toMatchObject({ outside_radius: 1, irrelevant_occupation: 1 })
  })

  it('SerpApi Google Jobs pages through results and keeps advertised pay', async () => {
    const tokens: (string | null)[] = []
    svc = (
      await makeServices({
        fetchImpl: fakeFetch([
          (u) => {
            if (u.hostname !== 'serpapi.com') return undefined
            tokens.push(u.searchParams.get('next_page_token'))
            return json(u.searchParams.get('next_page_token') ? SERP_PAGE_2 : SERP_PAGE_1)
          }
        ])
      })
    ).svc
    svc.store.candidate.save(warehouseBaristaProfile())
    svc.store.secrets.set('serpapi.apiKey', 'serp-key')
    const criteria = {
      query: '',
      targetOccupations: ['warehouse_associate', 'barista'],
      location: 'Lakewood, CA',
      radius: 15,
      providerIds: ['serpapi']
    }
    await svc.criteria.setActive(criteria)
    const res = await svc.search.run(criteria, { trigger: 'manual' })
    expect(tokens).toContain('tok2')
    const titles = res.jobs.map((j) => `${j.title} @ ${j.company}`).sort()
    expect(titles).toEqual(['Barista @ Bean Fixture', 'Warehouse Worker @ Fixture Grocery DC'])
    const wh = res.jobs.find((j) => j.company === 'Fixture Grocery DC')!
    expect(wh.applyUrl).toBe('https://jobs.fixturegrocery.example.com/1')
    expect(wh.salary).toMatchObject({ min: 20, max: 23, period: 'hour' })
  })

  it('restricted sites report Google Jobs coverage once a key is connected', async () => {
    svc = (await makeServices()).svc
    const before = svc.search.providerInfos().find((p) => p.id === 'indeed')!
    expect(before.statusDetail).toMatch(/connect JSearch or SerpApi/)
    svc.store.secrets.set('jsearch.apiKey', 'k')
    const after = svc.search.providerInfos().find((p) => p.id === 'indeed')!
    expect(after.statusDetail).toMatch(/included in your searches through JSearch/)
  })

  it('converts "3 days ago" to a date', () => {
    const now = Date.parse('2026-10-04T12:00:00Z')
    expect(relativeToIso('3 days ago', now)).toBe('2026-10-01T12:00:00.000Z')
    expect(relativeToIso('Full-time', now)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Browse & Save page reader, in a real browser
// ---------------------------------------------------------------------------

const LINKEDIN_GUEST = `<html><head><meta property="og:title" content="Warehouse Associate - Fixture Co"></head><body>
<h1 class="top-card-layout__title">Warehouse Associate</h1>
<a class="topcard__org-name-link" href="#">Fixture Co</a>
<span class="topcard__flavor--bullet">Long Beach, CA · 2 days ago</span>
<div class="show-more-less-html__markup"><p>Pick and pack orders.</p><ul><li>RF scanner</li></ul></div>
</body></html>`

const INDEED_VIEW = `<html><body>
<h1 class="jobsearch-JobInfoHeader-title"><span>Barista</span></h1>
<div data-testid="inlineHeader-companyName"><a>Bean Fixture</a></div>
<div data-testid="inlineHeader-companyLocation">Lakewood, CA 90712</div>
<div id="salaryInfoAndJobType"><span>$18 - $20 an hour</span></div>
<div id="jobDescriptionText">Make espresso drinks. Cash handling.</div>
</body></html>`

const WITH_JSONLD = `<html><head><script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'JobPosting',
  title: 'Stock Associate',
  hiringOrganization: { name: 'Fixture Retail' },
  jobLocation: {
    address: { addressLocality: 'Downey', addressRegion: 'CA', addressCountry: 'US' }
  },
  description: '<p>Stock shelves.</p>'
})}</script></head><body><h1>Stock Associate</h1></body></html>`

const BARE = `<html><body><h1>Delivery Driver</h1><p>Apply now.</p></body></html>`

describe.skipIf(!CHROMIUM)('Browse & Save page reader', () => {
  let browser: Browser
  beforeAll(async () => {
    const { chromium } = await import('playwright')
    browser = await chromium.launch({ executablePath: CHROMIUM })
  })
  afterAll(async () => browser?.close())

  const read = async (html: string, url: string): Promise<ClippedJob> => {
    const page = await browser.newPage()
    await page.setContent(html)
    const res = (await page.evaluate(
      `(${readJobFromPage.toString()})(document, ${JSON.stringify(url)})`
    )) as ClippedJob
    await page.close()
    return res
  }

  it('reads LinkedIn and Indeed job pages and normalizes their links', async () => {
    const li = await read(
      LINKEDIN_GUEST,
      'https://www.linkedin.com/jobs/search/?keywords=warehouse&currentJobId=4242'
    )
    expect(li).toMatchObject({
      url: 'https://www.linkedin.com/jobs/view/4242/',
      title: 'Warehouse Associate',
      company: 'Fixture Co',
      location: 'Long Beach, CA',
      method: 'page'
    })
    expect(li.description).toContain('Pick and pack orders.')

    const indeed = await read(
      INDEED_VIEW,
      'https://www.indeed.com/jobs?q=barista&l=Lakewood&vjk=abc123'
    )
    expect(indeed).toMatchObject({
      url: 'https://www.indeed.com/viewjob?jk=abc123',
      title: 'Barista',
      company: 'Bean Fixture',
      location: 'Lakewood, CA 90712',
      salary: '$18 - $20 an hour'
    })
  })

  it('saves clipped jobs through the normal filters, and asks for missing facts', async () => {
    svc = (await makeServices()).svc
    svc.store.candidate.save(warehouseBaristaProfile())
    await svc.criteria.setActive({ query: 'Barista', location: 'Lakewood, CA', radius: 10 })

    const indeed = await read(INDEED_VIEW, 'https://www.indeed.com/viewjob?jk=abc123')
    const saved = await svc.imports.importClip(indeed)
    expect(saved.saved).toBe(true)
    if (saved.saved) {
      expect(saved.jobs[0].eligibility?.status).toBe('eligible')
      expect(saved.jobs[0].salary).toMatchObject({ min: 18, max: 20, period: 'hour' })
      expect(saved.jobs[0].sources[0].providerName).toBe('Saved while browsing')
    }

    const ld = await read(WITH_JSONLD, 'https://jobs.fixtureretail.example.com/9')
    expect(ld.method).toBe('json-ld')
    const r2 = await svc.imports.importClip(ld)
    expect(r2.saved && r2.jobs[0].company).toBe('Fixture Retail')

    const bare = await read(BARE, 'https://example-dsp.example.com/jobs/1')
    const r3 = await svc.imports.importClip(bare)
    expect(r3).toMatchObject({ saved: false, needsDetails: true, missing: ['company', 'location'] })
    const r4 = await svc.imports.importClip(bare, {
      company: 'Fixture DSP',
      location: 'Bellflower, CA'
    })
    expect(r4.saved).toBe(true)
  })
})

describe('provider errors are explained and recovered', () => {
  it('shows the provider’s own error message', async () => {
    const { errorDetail } = await import('../src/main/services/jobs/adapters/http')
    expect(errorDetail('{"message":"You are not subscribed to this API."}')).toBe(
      'You are not subscribed to this API.'
    )
    expect(
      errorDetail('{"error":"Invalid API key. abcdefghijklmnopqrstuvwxyz0123456789ABCD"}')
    ).toBe('Invalid API key. …')
  })

  it('SerpApi retries with the place in the query when Google rejects the location', async () => {
    const seen: URLSearchParams[] = []
    svc = (
      await makeServices({
        fetchImpl: fakeFetch([
          (u) => {
            if (u.hostname !== 'serpapi.com') return undefined
            seen.push(u.searchParams)
            if (u.searchParams.get('location'))
              return json(
                {
                  error:
                    'Unsupported `Lakewood, California, United States` location - location parameter.'
                },
                400
              )
            return json({ jobs_results: SERP_PAGE_2.jobs_results })
          }
        ])
      })
    ).svc
    svc.store.secrets.set('serpapi.apiKey', 'serp-key')
    await svc.criteria.setActive({ query: 'Barista', location: 'Lakewood, CA', radius: 15 })
    const r = await svc.search.testProvider('serpapi')
    expect(seen[0].get('location')).toBe('Lakewood, California, United States')
    expect(seen[1].get('location')).toBeNull()
    expect(seen[1].get('q')).toBe('Barista near Lakewood, CA')
    expect(r).toMatchObject({ ok: true, count: 1 })
    expect(r.sample[0]).toContain('Barista — Bean Fixture')
  })

  it('JSearch finds its moved endpoint, accepts a pasted one, and the Test button reports real errors', async () => {
    const paths: string[] = []
    svc = (
      await makeServices({
        fetchImpl: fakeFetch([
          (u, init) => {
            if (!u.hostname.endsWith('rapidapi.com')) return undefined
            paths.push(
              `${(init?.headers as Record<string, string>)['x-rapidapi-host']}${u.pathname}`
            )
            return u.pathname === '/search-v2' || u.pathname === '/custom/jobs'
              ? json(JSEARCH)
              : json({ message: `Endpoint '${u.pathname}' does not exist` }, 404)
          }
        ])
      })
    ).svc
    svc.store.secrets.set('jsearch.apiKey', 'k')
    await svc.criteria.setActive({
      query: 'Warehouse Associate',
      location: 'Los Angeles, CA',
      radius: 25
    })
    const ok = await svc.search.testProvider('jsearch')
    expect(ok).toMatchObject({ ok: true, count: 3 })
    expect(paths).toEqual(['jsearch.p.rapidapi.com/search', 'jsearch.p.rapidapi.com/search-v2'])

    paths.length = 0
    svc.store.secrets.set('jsearch.endpoint', 'https://jsearch2.p.rapidapi.com/custom/jobs?query=x')
    expect((await svc.search.testProvider('jsearch')).ok).toBe(true)
    expect(paths[0]).toBe('jsearch2.p.rapidapi.com/custom/jobs')
    await svc.shutdown()

    svc = (
      await makeServices({
        fetchImpl: fakeFetch([
          (u) =>
            u.hostname === 'jsearch.p.rapidapi.com'
              ? json({ message: 'You are not subscribed to this API.' }, 403)
              : undefined
        ])
      })
    ).svc
    svc.store.secrets.set('jsearch.apiKey', 'k')
    const bad = await svc.search.testProvider('jsearch')
    expect(bad).toMatchObject({ ok: false })
    expect(bad.message).toBe('HTTP 403: You are not subscribed to this API.')
  })
})

describe('apply options', () => {
  it('keeps every place a job is posted, employer site first, merged across sources', async () => {
    const { mergeApplyOptions } =
      await import('../src/main/services/jobs/normalization/applyOptions')
    const merged = mergeApplyOptions(
      [
        { label: 'LinkedIn', url: 'https://www.linkedin.com/jobs/view/1?trk=abc', direct: false },
        { label: 'Acme', url: 'https://careers.acme.example.com/7', direct: true }
      ],
      [
        { label: 'LinkedIn', url: 'https://www.linkedin.com/jobs/view/1', direct: false },
        { label: 'Bad', url: 'http://127.0.0.1/x', direct: true }
      ]
    )!
    expect(merged.map((o) => o.label)).toEqual(['Acme', 'LinkedIn'])
  })

  it('JSearch jobs carry their apply options into storage', async () => {
    svc = (
      await makeServices({
        fetchImpl: fakeFetch([
          (u) => (u.hostname === 'jsearch.p.rapidapi.com' ? json(JSEARCH) : undefined)
        ])
      })
    ).svc
    svc.store.secrets.set('jsearch.apiKey', 'k')
    const c = {
      query: 'Warehouse Associate',
      location: 'Los Angeles, CA',
      radius: 25,
      providerIds: ['jsearch']
    }
    await svc.criteria.setActive(c)
    const res = await svc.search.run(c, { trigger: 'manual' })
    const stored = svc.store.jobs.get(res.jobs[0].id)!
    expect(stored.applyOptions!.map((o) => [o.label, o.direct])).toEqual([
      ['Fixture Freight Careers', true],
      ['LinkedIn', false],
      ['Indeed', false]
    ])
  })
})

describe('monthly API allowance', () => {
  it('counts real requests, shows usage, and stops at the limit', async () => {
    svc = (
      await makeServices({
        fetchImpl: fakeFetch([
          (u) => (u.hostname === 'jsearch.p.rapidapi.com' ? json(JSEARCH) : undefined)
        ])
      })
    ).svc
    svc.store.secrets.set('jsearch.apiKey', 'k')
    svc.store.secrets.set('jsearch.monthlyLimit', '2')
    const c = {
      query: 'Warehouse Associate',
      location: 'Los Angeles, CA',
      radius: 25,
      providerIds: ['jsearch']
    }
    await svc.criteria.setActive(c)
    await svc.search.run(c, { trigger: 'manual' })
    let info = svc.search.providerInfos().find((p) => p.id === 'jsearch')!
    expect(info.usage).toMatchObject({ used: 1, limit: 2 })
    // Cached results do not use the allowance.
    await svc.search.run(c, { trigger: 'manual' })
    expect(svc.search.providerInfos().find((p) => p.id === 'jsearch')!.usage!.used).toBe(1)
    await svc.search.testProvider('jsearch')
    info = svc.search.providerInfos().find((p) => p.id === 'jsearch')!
    expect(info).toMatchObject({ status: 'LIMITED', usage: { used: 2, limit: 2 } })
    const res = await svc.search.run({ ...c, query: 'Barista' }, { trigger: 'manual' })
    expect(res.stats.providers.find((p) => p.providerId === 'jsearch')).toMatchObject({
      status: 'skipped',
      reason: 'Monthly limit reached (2/2)'
    })
  })
})
