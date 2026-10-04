import fs from 'fs'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Services } from '../src/main/app/services'
import { parseInboxPayload } from '../src/main/services/jobs/import/jobImport'
import { fakeFetch, makeServices, warehouseBaristaProfile } from './helpers'

const LA = {
  query: 'Warehouse Associate',
  location: 'Los Angeles, CA',
  radius: 20,
  radiusUnit: 'mi' as const,
  workModes: ['onsite' as const]
}

/** Synthetic job page with schema.org JobPosting data (not a real vacancy). */
const JOB_PAGE = `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'JobPosting',
  title: 'Warehouse Associate - Day Shift',
  description: '<p>Pick and pack orders with an RF scanner.</p>',
  datePosted: '2026-09-29',
  employmentType: 'FULL_TIME',
  hiringOrganization: { '@type': 'Organization', name: 'Fixture Logistics' },
  jobLocation: {
    '@type': 'Place',
    address: { addressLocality: 'Carson', addressRegion: 'CA', addressCountry: 'US' }
  },
  baseSalary: {
    '@type': 'MonetaryAmount',
    currency: 'USD',
    value: { minValue: 19.5, maxValue: 21, unitText: 'HOUR' }
  },
  url: 'https://careers.fixture-logistics.test/jobs/77'
})}</script></head><body>Job</body></html>`

let svc: Services | undefined
afterEach(async () => {
  await svc?.shutdown()
  svc = undefined
})

async function setup(): Promise<{ svc: Services; dir: string }> {
  const made = await makeServices({
    allowPrivateHosts: true,
    fetchImpl: fakeFetch([
      (u) =>
        u.hostname === 'careers.fixture-logistics.test'
          ? new Response(JOB_PAGE, { headers: { 'content-type': 'text/html' } })
          : u.hostname === 'plain.fixture.test'
            ? new Response('<html><body>No data</body></html>', {
                headers: { 'content-type': 'text/html' }
              })
            : undefined
    ])
  })
  svc = made.svc
  svc.store.candidate.save(warehouseBaristaProfile())
  await svc.criteria.setActive(LA)
  return { svc: made.svc, dir: made.dir }
}

describe('job inbox format', () => {
  it('accepts simple jobs and JobPosting objects, rejects jobs without a real link', () => {
    const { drafts, errors } = parseInboxPayload({
      jobs: [
        {
          title: 'Barista',
          company: 'Cafe',
          location: 'Long Beach, CA',
          url: 'https://cafe.example.com/jobs/1'
        },
        { title: 'Invented', company: 'Nowhere', location: 'LA' },
        { title: 'Local', company: 'X', location: 'LA', url: 'http://127.0.0.1/job' },
        {
          '@type': 'JobPosting',
          title: 'Stocker',
          hiringOrganization: { name: 'Store' },
          url: 'https://store.example.com/jobs/9'
        }
      ]
    })
    expect(drafts.map((d) => d.title)).toEqual(['Barista', 'Stocker'])
    expect(errors).toHaveLength(2)
    expect(errors.join()).toMatch(/url/)
  })
})

describe('importing jobs from outside the API sources', () => {
  it('reads a pasted job link and filters it like any other job', async () => {
    const { svc } = await setup()
    const res = await svc.imports.importUrl('https://careers.fixture-logistics.test/jobs/77')
    expect(res.added).toBe(1)
    const job = res.jobs[0]
    expect(job).toMatchObject({
      title: 'Warehouse Associate - Day Shift',
      company: 'Fixture Logistics'
    })
    expect(job.description).toBe('Pick and pack orders with an RF scanner.')
    expect(job.salary).toMatchObject({ min: 19.5, max: 21, period: 'hour' })
    expect(job.eligibility?.status).toBe('eligible')
    expect(job.match?.score).toBeGreaterThan(50)
    // Same link again updates instead of duplicating.
    expect(
      (await svc.imports.importUrl('https://careers.fixture-logistics.test/jobs/77')).added
    ).toBe(0)
  })

  it('refuses sites that forbid automated access and pages without job data', async () => {
    const { svc } = await setup()
    await expect(svc.imports.importUrl('https://www.linkedin.com/jobs/view/123')).rejects.toThrow(
      /does not allow automated access/
    )
    await expect(svc.imports.importUrl('https://plain.fixture.test/job')).rejects.toThrow(
      /Enter details/
    )
  })

  it('adds a job entered by hand as unverified', async () => {
    const { svc } = await setup()
    const res = await svc.imports.importManual({
      title: 'Warehouse Associate',
      company: 'Corner Supply',
      location: 'Downey, CA',
      url: 'https://www.indeed.com/viewjob?jk=abc'
    })
    expect(res.jobs[0].verificationStatus).toBe('UNVERIFIED')
    expect(res.jobs[0].eligibility?.status).toBe('eligible')
    expect(res.jobs[0].sources[0].providerName).toBe('Added by you')
  })

  it('imports inbox files, moves them, and publishes the search request', async () => {
    const { svc } = await setup()
    const inbox = svc.imports.status().path
    await svc.imports.writeSearchRequest()
    const req = JSON.parse(fs.readFileSync(path.join(inbox, '_search-request.json'), 'utf8'))
    expect(req).toMatchObject({ occupations: ['Warehouse Associate'], radius: 20 })
    const file = path.join(inbox, 'jobs-1.json')
    fs.writeFileSync(
      file,
      JSON.stringify({
        jobs: [
          {
            title: 'Warehouse Associate',
            company: 'Near Co',
            location: 'Compton, CA',
            url: 'https://near.example.com/j/1',
            description: 'Order picking and loading.'
          },
          {
            title: 'Warehouse Associate',
            company: 'Far Co',
            location: 'Berlin, Germany',
            url: 'https://far.example.com/j/2'
          },
          { title: 'No link', company: 'Bad', location: 'LA' }
        ]
      })
    )
    const old = new Date(Date.now() - 10_000)
    fs.utimesSync(file, old, old)
    const result = await svc.imports.scanInbox()
    expect(result).toMatchObject({ files: 1, added: 2 })
    expect(result!.errors).toHaveLength(1)
    expect(fs.existsSync(file)).toBe(false)
    expect(
      fs.readdirSync(path.join(inbox, 'imported')).some((f) => f.endsWith('jobs-1.json'))
    ).toBe(true)
    // The search request file is never treated as a job file.
    expect(fs.existsSync(path.join(inbox, '_search-request.json'))).toBe(true)
    const eligible = svc.store.jobs.list({ view: 'eligible' }).map((j) => j.company)
    expect(eligible).toEqual(['Near Co'])
    const excluded = svc.store.jobs.list({ view: 'excluded' }).map((j) => j.company)
    expect(excluded).toEqual(['Far Co'])
  })
})
