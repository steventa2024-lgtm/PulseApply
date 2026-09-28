import path from 'path'
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest'
import type { ApplicationState, ScoredJob } from '../src/shared/types'
import type { Services } from '../src/main/app/services'
import { DuplicateApplicationError } from '../src/main/services/persistence/applicationsRepo'
import { manualReason } from '../src/main/services/applications/adapters'
import { sensitiveCategory } from '../src/main/services/applications/fieldMapper'
import { normalizeDraft } from '../src/main/services/jobs/normalization/normalize'
import { CHROMIUM, makeServices, warehouseBaristaProfile } from './helpers'
import { startTestEmployerSite, type Submission } from './fixtures/testEmployerSite'

const RESUME = path.join(__dirname, 'fixtures', 'resumes', 'warehouse_barista.pdf')
let site: { url: string; submissions: Submission[]; close: () => Promise<void> }
let svc: Services

beforeAll(async () => {
  site = await startTestEmployerSite()
})
afterAll(async () => {
  await site.close()
})

beforeEach(async () => {
  svc = (
    await makeServices({
      allowPrivateHosts: true,
      browserOptions: () => ({ headless: true, executablePath: CHROMIUM })
    })
  ).svc
  const profile = warehouseBaristaProfile()
  profile.sensitive.authorizedToWork = { US: 'yes' }
  profile.sensitive.allowAutofill.workAuthorization = true
  svc.store.candidate.save(profile)
  await svc.resumes.importFile(RESUME)
  site.submissions.length = 0
})
afterEach(async () => {
  await svc.shutdown()
})

function seedJob(applyPath: string, title = 'Warehouse Associate'): ScoredJob {
  const j = normalizeDraft(
    { sourceJobId: applyPath, sourceUrl: `https://example.com/jobs${applyPath}`, title, company: 'Test Employer', locationText: 'Carson, CA', employerDirect: true },
    { providerId: 'test', providerName: 'Test', geo: svc.geo }
  ).job!
  const job: ScoredJob = { ...j, applyUrl: `${site.url}${applyPath}`, geo: { eligibility: 'within_radius' }, relevance: { score: 1, basis: '' }, state: { saved: false, dismissed: false } }
  svc.store.jobs.upsertMany([job])
  return job
}

async function waitState(id: string, states: ApplicationState[], ms = 30_000) {
  const t0 = Date.now()
  for (;;) {
    const a = svc.store.applications.get(id)!
    if (states.includes(a.state)) return a
    if (Date.now() - t0 > ms) throw new Error(`Timed out in state ${a.state}: ${a.error ?? ''}`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

describe.skipIf(!CHROMIUM)('application automation against a controlled test site', () => {
  it('fills a Greenhouse-style form, escalates sensitive questions, and submits only after approval with confirmation', async () => {
    const job = seedJob('/gh/jobs/1')
    const started = await svc.applications.start(job.id)
    expect(started.state).toBe('OPENING')
    const app = await waitState(started.id, ['NEEDS_USER_INPUT', 'READY_FOR_REVIEW', 'FAILED', 'MANUAL_COMPLETION_REQUIRED'])
    expect(app.state).toBe('NEEDS_USER_INPUT')

    const filled = app.filledFields.map((f) => f.profileKey)
    expect(filled).toEqual(expect.arrayContaining(['firstName', 'lastName', 'email', 'phone', 'resume', 'approved:work_authorization']))
    const issues = Object.fromEntries(app.issues.map((i) => [i.label.replace(/\s*\*$/, ''), i.reason]))
    // Sponsorship and certification declarations are never invented.
    expect(issues['Will you now or in the future require sponsorship for employment visa status?']).toBe('sensitive_requires_user')
    expect(issues['Do you have a current forklift certification?']).toBe('sensitive_requires_user')
    // Demographic question escalated (optional, not blocking).
    expect(app.issues.find((i) => /Gender/.test(i.label))).toMatchObject({ reason: 'sensitive_requires_user', required: false })

    // Approval is refused while required answers are missing.
    await expect(svc.applications.approveAndSubmit(app.id)).rejects.toThrow(/ready for review/)
    expect(site.submissions).toHaveLength(0)

    // The user answers the two questions in the browser, then re-scans.
    const page = svc.browser.get(app.id)!.page
    await page.selectOption('#q_sponsor', { label: 'No' })
    await page.selectOption('#q_forklift', { label: 'No' })
    const ready = await svc.applications.rescan(app.id)
    expect(ready.state).toBe('READY_FOR_REVIEW')
    // Ready-for-review does not submit anything by itself.
    expect(site.submissions).toHaveLength(0)

    const done = await svc.applications.approveAndSubmit(app.id)
    expect(done.state).toBe('SUBMITTED')
    expect(done.evidence.map((e) => e.kind)).toEqual(expect.arrayContaining(['confirmation_text', 'reference_number']))
    expect(done.evidence.find((e) => e.kind === 'reference_number')!.detail).toMatch(/GH-48213/)
    expect(site.submissions).toHaveLength(1)
    expect(site.submissions[0].fields).toMatchObject({ first_name: 'Jordan', last_name: 'Rivera', email: 'jordan.rivera.test@example.com', q_auth: '1', q_sponsor: '0' })
    expect(site.submissions[0].files[0]).toMatch(/\.pdf$/)
    const events = svc.store.applications.events(app.id).map((e) => e.toState)
    expect(events).toEqual(expect.arrayContaining(['APPROVED', 'SUBMITTING', 'SUBMITTED']))
    expect(events.indexOf('APPROVED')).toBeLessThan(events.indexOf('SUBMITTED'))

    // Repeated submission is prevented.
    await expect(svc.applications.start(job.id)).rejects.toBeInstanceOf(DuplicateApplicationError)
  }, 90_000)

  it('does not mark a submission with server-side errors as successful', async () => {
    const job = seedJob('/generic/apply', 'Cashier')
    const app = await waitState((await svc.applications.start(job.id)).id, ['READY_FOR_REVIEW', 'NEEDS_USER_INPUT', 'FAILED'])
    expect(app.state).toBe('READY_FOR_REVIEW')
    const res = await svc.applications.approveAndSubmit(app.id)
    expect(res.state).toBe('FAILED')
    expect(res.error).toMatch(/Phone number is invalid|Phone/)
    expect(site.submissions).toHaveLength(1)
  }, 60_000)

  it('records ambiguous outcomes as unverified and never retries automatically', async () => {
    const job = seedJob('/ambiguous/apply', 'Barista')
    const app = await waitState((await svc.applications.start(job.id)).id, ['READY_FOR_REVIEW', 'NEEDS_USER_INPUT', 'FAILED'])
    const res = await svc.applications.approveAndSubmit(app.id)
    expect(res.state).toBe('SUBMISSION_UNVERIFIED')
    await new Promise((r) => setTimeout(r, 1000))
    expect(site.submissions).toHaveLength(1)
    await expect(svc.applications.start(job.id)).rejects.toThrow(/may have gone through/)
  }, 60_000)

  it('pauses for CAPTCHA and never interacts with it', async () => {
    const job = seedJob('/captcha/apply', 'Barista')
    const app = await waitState((await svc.applications.start(job.id)).id, ['READY_FOR_REVIEW', 'NEEDS_USER_INPUT', 'FAILED'])
    expect(app.state).toBe('NEEDS_USER_INPUT')
    expect(app.blockers.join()).toMatch(/CAPTCHA/)
    expect(site.submissions).toHaveLength(0)
  }, 60_000)

  it('handles multi-step forms with an explicit continue step', async () => {
    const job = seedJob('/multi/1', 'Barista')
    const app = await waitState((await svc.applications.start(job.id)).id, ['READY_FOR_REVIEW', 'NEEDS_USER_INPUT', 'FAILED'])
    expect(app.blockers.join()).toMatch(/Multi-step/)
    const step2 = await svc.applications.advance(app.id)
    expect(step2.state).toBe('READY_FOR_REVIEW')
    expect(step2.filledFields.map((f) => f.profileKey)).toContain('resume')
    const done = await svc.applications.approveAndSubmit(app.id)
    expect(done.state).toBe('SUBMITTED')
    expect(site.submissions[0].files).toHaveLength(1)
  }, 60_000)

  it('asks the user to sign in instead of automating login pages', async () => {
    const job = seedJob('/login', 'Barista')
    const app = await waitState((await svc.applications.start(job.id)).id, ['READY_FOR_REVIEW', 'NEEDS_USER_INPUT', 'FAILED', 'MANUAL_COMPLETION_REQUIRED'])
    expect(app.state).toBe('NEEDS_USER_INPUT')
    expect(app.blockers.join()).toMatch(/Sign-in/)
  }, 60_000)

  it('user-reported submissions stay unverified; confirmation check upgrades only with evidence', async () => {
    const job = seedJob('/gh/jobs/1')
    const app = await waitState((await svc.applications.start(job.id)).id, ['NEEDS_USER_INPUT'])
    const page = svc.browser.get(app.id)!.page
    await page.selectOption('#q_sponsor', { label: 'No' })
    await page.selectOption('#q_forklift', { label: 'Yes' })
    const noConfirm = await svc.applications.checkConfirmation(app.id)
    expect(noConfirm.confirmed).toBe(false)
    // User submits in the browser themselves.
    await Promise.all([page.waitForURL(/confirmation/), page.click('#submit_app')])
    const check = await svc.applications.checkConfirmation(app.id)
    expect(check.confirmed).toBe(true)
    expect(check.app.state).toBe('SUBMITTED')
  }, 60_000)
})

describe('application safety rules', () => {
  it('classifies sensitive questions', () => {
    expect(sensitiveCategory('Are you legally authorized to work in the US?')).toBe('work_authorization')
    expect(sensitiveCategory('Will you require visa sponsorship?')).toBe('sponsorship')
    expect(sensitiveCategory('Have you ever been convicted of a felony?')).toBe('criminal_history')
    expect(sensitiveCategory('Race / Ethnicity')).toBe('demographic')
    expect(sensitiveCategory('Do you have a disability?')).toBe('disability')
    expect(sensitiveCategory('Protected veteran status')).toBe('veteran')
    expect(sensitiveCategory('How many years of experience do you have with forklifts?')).toBe('experience_years')
    expect(sensitiveCategory('I certify that the information provided is accurate and complete')).toBe('declaration')
    expect(sensitiveCategory('First Name')).toBeUndefined()
    expect(sensitiveCategory('How did you embrace teamwork?')).toBeUndefined()
  })

  it('routes account-based ATS portals to manual completion', () => {
    expect(manualReason('https://acme.wd5.myworkdayjobs.com/en-US/careers/job/123')).toMatch(/Workday/)
    expect(manualReason('https://careers-acme.icims.com/jobs/1/apply')).toMatch(/iCIMS/)
    expect(manualReason('https://example.com/careers/myworkdayjobs.com')).toBeUndefined()
  })

  it('refuses demo jobs outside demo mode and non-public URLs', async () => {
    const { svc: s } = await makeServices()
    const j = normalizeDraft(
      { sourceJobId: 'x', sourceUrl: 'https://example.com/x', applyUrl: 'https://example.com/apply', title: 'Barista', company: 'X', locationText: '', employerDirect: false },
      { providerId: 't', providerName: 'T', geo: s.geo }
    ).job!
    s.store.jobs.upsertMany([{ ...j, applyUrl: 'http://192.168.1.10/admin', sourceUrl: 'http://10.0.0.1/x', geo: { eligibility: 'unknown' }, relevance: { score: 1, basis: '' }, state: { saved: false, dismissed: false } }])
    await expect(s.applications.start(j.id)).rejects.toThrow(/no valid application link/)
    await s.shutdown()
  })
})
