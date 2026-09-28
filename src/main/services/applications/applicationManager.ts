import fs from 'fs'
import type { Page } from 'playwright'
import type { ApplicationRecord, ApplicationState, FieldIssue } from '../../../shared/types'
import type { Store } from '../persistence/store'
import type { BrowserManager } from './browserManager'
import { adapterFor, demoFormHtml, manualReason } from './adapters'
import { frameFor, inspectPage, type FormInspection } from './formInspector'
import { mapFields, type FillAction } from './fieldMapper'
import { evaluateSubmission, type AtsResponseSignal } from './submissionVerifier'
import { isPublicHttpUrl, parseHttpUrl } from '../jobs/verification/urlSafety'
import { ACTIVE_STATES } from './stateMachine'
import { log } from '../logger'

export class ApplicationError extends Error {}

/**
 * Real-world application workflow:
 *   OPENING -> AUTOFILLING -> (NEEDS_USER_INPUT | READY_FOR_REVIEW | MANUAL_COMPLETION_REQUIRED)
 *   READY_FOR_REVIEW --(explicit user approval)--> APPROVED -> SUBMITTING
 *   SUBMITTING -> SUBMITTED only with observed confirmation, otherwise
 *   SUBMISSION_UNVERIFIED / FAILED / NEEDS_USER_INPUT. No automatic retries.
 */
export class ApplicationManager {
  private readonly locks = new Map<string, Promise<unknown>>()

  constructor(
    private readonly deps: {
      store: Store
      browser: BrowserManager
      emit: (app: ApplicationRecord) => void
      /** Tests only: allow navigating to a local controlled test server. */
      allowPrivateHosts?: boolean
    }
  ) {}

  private get store(): Store {
    return this.deps.store
  }

  /** Serializes all operations on one application (prevents double submits). */
  private serialize<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve()
    const next = prev.catch(() => undefined).then(fn)
    this.locks.set(id, next)
    return next.finally(() => {
      if (this.locks.get(id) === next) this.locks.delete(id)
    })
  }

  private move(id: string, to: ApplicationState, message: string, patch: Parameters<Store['applications']['transition']>[3] = {}): ApplicationRecord {
    const app = this.store.applications.transition(id, to, message, patch)
    this.deps.emit(app)
    return app
  }

  private get(id: string): ApplicationRecord {
    const app = this.store.applications.get(id)
    if (!app) throw new ApplicationError('Application not found')
    return app
  }

  private urlAllowed(url: string | undefined): boolean {
    if (!url) return false
    if (this.deps.allowPrivateHosts) return !!parseHttpUrl(url)
    return isPublicHttpUrl(url)
  }

  /** Queues an application for later (used by Telegram; no browser is opened remotely). */
  queue(jobId: string, origin: ApplicationRecord['origin']): ApplicationRecord {
    const job = this.store.jobs.get(jobId)
    if (!job) throw new ApplicationError('This job is no longer in PulseApply')
    const url = job.applyUrl ?? job.sourceUrl
    const app = this.store.applications.create({
      jobId,
      state: 'QUEUED',
      adapter: job.isDemo ? 'demo' : job.applicationSupport,
      sourceUrl: job.sourceUrl,
      applyUrl: url,
      resumeId: this.store.candidate.defaultResume()?.id,
      origin,
      isDemo: !!job.isDemo,
      message: origin === 'telegram' ? 'Queued from Telegram' : 'Queued'
    })
    this.deps.emit(app)
    return app
  }

  /** Opens the real application page in a visible browser and autofills it. */
  async start(jobId: string, opts: { resumeId?: string; origin?: ApplicationRecord['origin'] } = {}): Promise<ApplicationRecord> {
    const job = this.store.jobs.get(jobId)
    if (!job) throw new ApplicationError('Job not found')
    const demo = !!job.isDemo
    const settings = this.store.settings.get()
    if (demo && !settings.demoMode) throw new ApplicationError('Demo jobs can only be used in demo mode')
    const url = job.applyUrl ?? job.sourceUrl
    if (!demo && !this.urlAllowed(url)) throw new ApplicationError('This job has no valid application link')
    const resume = opts.resumeId ? this.store.candidate.resume(opts.resumeId) : this.store.candidate.defaultResume()
    const latest = this.store.applications.latestForJob(jobId)
    let app: ApplicationRecord
    if (latest && latest.state === 'QUEUED') {
      app = this.move(latest.id, 'OPENING', 'Opening application page')
    } else {
      app = this.store.applications.create({
        jobId,
        state: 'OPENING',
        adapter: demo ? 'demo' : job.applicationSupport,
        sourceUrl: job.sourceUrl,
        applyUrl: url,
        resumeId: resume?.id,
        origin: opts.origin ?? 'desktop',
        isDemo: demo,
        message: demo ? 'Opening DEMO practice form (not a real application)' : `Opening ${url}`
      })
      this.deps.emit(app)
    }
    void this.serialize(app.id, () => this.openAndFill(app.id)).catch((err) => log.error('apply', err))
    return app
  }

  private async openAndFill(id: string): Promise<void> {
    const app = this.get(id)
    const job = this.store.jobs.get(app.jobId)
    try {
      const session = await this.deps.browser.open(id, () => this.onBrowserClosed(id))
      const page = session.page
      if (app.isDemo) {
        await page.setContent(demoFormHtml(job?.title ?? 'Demo job', job?.company ?? 'Demo employer'))
      } else {
        await page.goto(app.applyUrl ?? app.sourceUrl, { waitUntil: 'domcontentloaded' })
        await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined)
      }
      const finalUrl = page.url()
      if (!app.isDemo && !this.urlAllowed(finalUrl)) {
        this.move(id, 'FAILED', 'Application link redirected to an unsafe address', { error: `Redirected to ${finalUrl}` })
        await this.deps.browser.close(id)
        return
      }
      const manual = app.isDemo ? undefined : manualReason(finalUrl)
      if (manual) {
        this.move(id, 'MANUAL_COMPLETION_REQUIRED', manual, { currentUrl: finalUrl, blockers: [manual] })
        await page.bringToFront().catch(() => undefined)
        return
      }
      const adapter = adapterFor(finalUrl)
      this.move(id, 'AUTOFILLING', `Detected ${app.isDemo ? 'demo form' : adapter.label}; filling fields`, { currentUrl: finalUrl, adapter: app.isDemo ? 'demo' : adapter.id })
      if (!app.isDemo) await adapter.prepare(page)
      await this.fillAndAssess(id, page, adapter.notes)
    } catch (err) {
      const msg = (err as Error).message.split('\n')[0]
      const cur = this.store.applications.get(id)
      if (cur && ACTIVE_STATES.includes(cur.state) && cur.state !== 'SUBMITTING') {
        this.move(id, 'FAILED', `Could not open or fill the application: ${msg}`, { error: msg })
      }
      await this.deps.browser.close(id)
    }
  }

  private async perform(page: Page, a: FillAction): Promise<boolean> {
    const { frame, localKey } = frameFor(page, a.field.key)
    const loc = frame.locator(`[data-pa-field="${localKey}"]`).first()
    try {
      switch (a.action) {
        case 'fill':
          await loc.fill(a.value)
          return (await loc.inputValue()).trim() === a.value.trim()
        case 'select':
          await loc.selectOption({ index: a.optionIndex! })
          return true
        case 'radio': {
          const opt = frame.locator(`[data-pa-field="${localKey}"][data-pa-option="${a.optionIndex}"]`).first()
          await opt.check().catch(() => opt.check({ force: true }))
          return await opt.isChecked()
        }
        case 'check':
          await loc.check().catch(() => loc.check({ force: true }))
          return await loc.isChecked()
        case 'upload':
          if (!fs.existsSync(a.value)) return false
          await loc.setInputFiles(a.value)
          return (await loc.evaluate((el) => (el as unknown as { files: { length: number } }).files.length)) === 1
      }
    } catch (err) {
      log.warn('apply', `Could not fill "${a.field.label}": ${(err as Error).message.split('\n')[0]}`)
      return false
    }
  }

  private requiredIssues(insp: FormInspection): FieldIssue[] {
    return insp.fields
      .filter((f) => f.required && !f.filled)
      .map((f) => ({ label: f.label || f.name, reason: 'required_empty' as const, required: true, type: f.kind }))
  }

  /** One inspection -> mapping -> fill -> re-inspection pass, then decides the next state. */
  private async fillAndAssess(id: string, page: Page, notes: string[] = []): Promise<void> {
    const app = this.get(id)
    const job = this.store.jobs.get(app.jobId)
    const profile = this.store.candidate.get()
    const resume = app.resumeId ? this.store.candidate.resume(app.resumeId) : this.store.candidate.defaultResume()
    let insp = await inspectPage(page)
    const formFields = insp.fields.filter((f) => f.kind !== 'checkbox')

    if (insp.hasPasswordField && formFields.length <= 3) {
      this.move(id, 'NEEDS_USER_INPUT', 'This site asks you to sign in or create an account. Do that in the browser window, then click “Re-scan form”.', {
        currentUrl: page.url(),
        blockers: ['Sign-in / account creation required']
      })
      return
    }
    if (formFields.length === 0) {
      this.move(id, 'MANUAL_COMPLETION_REQUIRED', 'No application form was detected on this page. Continue in the browser window.', {
        currentUrl: page.url(),
        blockers: ['No application form detected']
      })
      return
    }

    const mapping = mapFields(insp.fields, {
      profile,
      resumePath: resume?.storedPath && fs.existsSync(resume.storedPath) ? resume.storedPath : undefined,
      jobCountry: job?.locations.find((l) => l.country)?.country
    })
    const filled = [...app.filledFields]
    const issues: FieldIssue[] = [...mapping.issues]
    for (const a of mapping.actions) {
      const ok = await this.perform(page, a)
      if (ok) {
        if (!filled.some((f) => f.label === a.field.label)) filled.push({ label: a.field.label || a.field.name, profileKey: a.profileKey })
      } else {
        issues.push({ label: a.field.label || a.field.name, reason: 'unsupported_input', required: a.field.required, type: a.field.kind })
      }
    }

    insp = await inspectPage(page)
    const stillEmpty = this.requiredIssues(insp)
    const merged = [...issues]
    for (const r of stillEmpty) if (!merged.some((i) => i.label === r.label)) merged.push(r)
    // Drop issues for fields the user has since filled.
    const openIssues = merged.filter((i) => {
      const f = insp.fields.find((x) => (x.label || x.name) === i.label)
      return !f || !f.filled
    })
    const blockers: string[] = []
    if (insp.hasCaptcha) blockers.push('CAPTCHA/verification present — you must complete it yourself; PulseApply will not solve it.')
    if (!insp.submitButton && insp.nextButton) blockers.push(`Multi-step form: this page has “${insp.nextButton.text}” instead of Submit. Review it, then use “Continue to next step”.`)
    if (!resume) blockers.push('No resume uploaded — add one on the Profile page.')
    for (const n of notes) if (insp.hasCaptcha && /captcha/i.test(n)) blockers.push(n)

    const needsUser = openIssues.some((i) => i.required) || insp.hasCaptcha || (!insp.submitButton && !insp.nextButton)
    await page.bringToFront().catch(() => undefined)
    if (needsUser) {
      this.move(id, 'NEEDS_USER_INPUT', `Filled ${filled.length} field(s); ${openIssues.filter((i) => i.required).length} required item(s) need your input`, {
        filledFields: filled,
        issues: openIssues,
        blockers,
        currentUrl: page.url()
      })
    } else {
      this.move(id, 'READY_FOR_REVIEW', `Filled ${filled.length} field(s). Review the form in the browser, then approve to submit.`, {
        filledFields: filled,
        issues: openIssues,
        blockers,
        currentUrl: page.url()
      })
    }
  }

  /** Re-inspects after the user typed answers or signed in; fills anything still empty. */
  rescan(id: string): Promise<ApplicationRecord> {
    return this.serialize(id, async () => {
      const app = this.get(id)
      const session = this.deps.browser.get(id)
      if (!session) throw new ApplicationError('The browser window for this application is closed. Use “Reopen”.')
      if (!['NEEDS_USER_INPUT', 'READY_FOR_REVIEW', 'MANUAL_COMPLETION_REQUIRED'].includes(app.state)) {
        throw new ApplicationError(`Cannot re-scan in state ${app.state}`)
      }
      this.move(id, 'AUTOFILLING', 'Re-scanning form')
      await this.fillAndAssess(id, session.page)
      return this.get(id)
    })
  }

  /** Clicks the form's Next/Continue button (multi-step forms), then fills the next step. */
  advance(id: string): Promise<ApplicationRecord> {
    return this.serialize(id, async () => {
      const app = this.get(id)
      const session = this.deps.browser.get(id)
      if (!session) throw new ApplicationError('The browser window for this application is closed.')
      if (!['NEEDS_USER_INPUT', 'READY_FOR_REVIEW'].includes(app.state)) throw new ApplicationError(`Cannot continue in state ${app.state}`)
      const insp = await inspectPage(session.page)
      if (!insp.nextButton) throw new ApplicationError('No “Next/Continue” button found on this page.')
      if (this.requiredIssues(insp).length) throw new ApplicationError('Fill the required fields on this step first.')
      this.move(id, 'AUTOFILLING', `Continuing to next step (“${insp.nextButton.text}”)`)
      const { frame, localKey } = frameFor(session.page, insp.nextButton.key)
      await frame.locator(`[data-pa-button="${localKey}"]`).first().click()
      await session.page.waitForLoadState('domcontentloaded').catch(() => undefined)
      await session.page.waitForTimeout(1000)
      await this.fillAndAssess(id, session.page)
      return this.get(id)
    })
  }

  /**
   * Explicit, per-application approval followed by submission. The result is
   * SUBMITTED only when the destination confirms it.
   */
  approveAndSubmit(id: string): Promise<ApplicationRecord> {
    return this.serialize(id, async () => {
      const app = this.get(id)
      if (app.state !== 'READY_FOR_REVIEW') throw new ApplicationError(`Only applications that are ready for review can be approved (current: ${app.state})`)
      const session = this.deps.browser.get(id)
      if (!session) throw new ApplicationError('The browser window for this application is closed. Reopen it before approving.')
      const page = session.page
      const pre = await inspectPage(page)
      const missing = this.requiredIssues(pre)
      if (pre.hasCaptcha || missing.length || !pre.submitButton) {
        return this.move(id, 'NEEDS_USER_INPUT', pre.hasCaptcha ? 'A CAPTCHA must be completed by you before submitting' : !pre.submitButton ? 'No submit button found on this page' : 'Required fields are empty', {
          issues: missing,
          blockers: pre.hasCaptcha ? ['CAPTCHA present — complete it, submit yourself, then use “Check confirmation”.'] : []
        })
      }
      this.move(id, 'APPROVED', 'Approved for submission by you')
      this.move(id, 'SUBMITTING', `Clicking “${pre.submitButton.text}”`)
      const before = { url: page.url(), hadForm: true }
      const origin = new URL(page.url()).origin
      const responses: AtsResponseSignal[] = []
      const onResponse = async (res: import('playwright').Response) => {
        try {
          const req = res.request()
          if (req.method() !== 'POST' || !res.url().startsWith(origin)) return
          const ct = res.headers()['content-type'] ?? ''
          if (!/json/.test(ct)) return
          responses.push({ url: res.url(), status: res.status(), body: (await res.text()).slice(0, 5000) })
        } catch {
          // body unavailable
        }
      }
      page.on('response', onResponse)
      try {
        const { frame, localKey } = frameFor(page, pre.submitButton.key)
        await Promise.all([
          page.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => undefined),
          frame.locator(`[data-pa-button="${localKey}"]`).first().click({ timeout: 10_000 })
        ])
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined)
        await page.waitForTimeout(1500)
        const after = await inspectPage(page)
        const verdict = evaluateSubmission(before, after, responses)
        switch (verdict.outcome) {
          case 'submitted':
            return this.move(id, 'SUBMITTED', 'Submission confirmed by the application site', { addEvidence: verdict.evidence, currentUrl: page.url() })
          case 'failed':
            return this.move(id, 'FAILED', verdict.reason, { error: verdict.reason, currentUrl: page.url() })
          case 'blocked':
            return this.move(id, 'NEEDS_USER_INPUT', verdict.reason, { blockers: [verdict.reason], currentUrl: page.url() })
          default:
            return this.move(id, 'SUBMISSION_UNVERIFIED', verdict.reason, { currentUrl: page.url() })
        }
      } catch (err) {
        const msg = (err as Error).message.split('\n')[0]
        return this.move(id, 'SUBMISSION_UNVERIFIED', `Submission outcome unknown: ${msg}. Do not re-submit until you have checked the site or your email.`, { error: msg })
      } finally {
        page.off('response', onResponse)
      }
    })
  }

  /** For forms the user submitted themselves: looks for confirmation on the current page. */
  checkConfirmation(id: string): Promise<{ app: ApplicationRecord; confirmed: boolean; message: string }> {
    return this.serialize(id, async () => {
      const app = this.get(id)
      const session = this.deps.browser.get(id)
      if (!session) throw new ApplicationError('The browser window is closed, so the page cannot be checked.')
      const insp = await inspectPage(session.page)
      const verdict = evaluateSubmission({ url: '', hadForm: true }, insp)
      if (verdict.outcome === 'submitted') {
        if (app.state === 'SUBMITTED') return { app, confirmed: true, message: 'Already confirmed.' }
        const moved = this.move(id, 'SUBMITTED', 'Confirmation observed on the application site', { addEvidence: verdict.evidence, currentUrl: insp.url })
        return { app: moved, confirmed: true, message: 'Submission confirmed.' }
      }
      return { app, confirmed: false, message: 'reason' in verdict ? verdict.reason : 'No confirmation found on this page.' }
    })
  }

  /** User says they submitted outside PulseApply's view: recorded as unverified, never as SUBMITTED. */
  reportManualSubmission(id: string, note?: string): Promise<ApplicationRecord> {
    return this.serialize(id, async () => {
      const app = this.get(id)
      if (!['NEEDS_USER_INPUT', 'READY_FOR_REVIEW', 'MANUAL_COMPLETION_REQUIRED'].includes(app.state)) {
        throw new ApplicationError(`Cannot record a manual submission in state ${app.state}`)
      }
      return this.move(id, 'SUBMISSION_UNVERIFIED', 'You reported submitting this application yourself', {
        addEvidence: [{ kind: 'user_report', detail: note?.slice(0, 300) || 'Reported by you; not observed by PulseApply', observedAt: new Date().toISOString() }]
      })
    })
  }

  /** Reopens the browser for an application whose window was closed or that failed. */
  reopen(id: string): Promise<ApplicationRecord> {
    return this.serialize(id, async () => {
      const app = this.get(id)
      if (['NEEDS_USER_INPUT', 'MANUAL_COMPLETION_REQUIRED', 'READY_FOR_REVIEW'].includes(app.state)) {
        this.move(id, 'AUTOFILLING', 'Reopening application page')
      } else if (app.state === 'FAILED') {
        this.move(id, 'OPENING', 'Retrying (started by you)')
      } else if (app.state === 'QUEUED') {
        this.move(id, 'OPENING', 'Opening application page')
      } else {
        throw new ApplicationError(`Cannot reopen in state ${app.state}`)
      }
      await this.openAndFill(id)
      return this.get(id)
    })
  }

  cancel(id: string): Promise<ApplicationRecord> {
    return this.serialize(id, async () => {
      const app = this.get(id)
      await this.deps.browser.close(id)
      if (['SUBMITTED', 'SUBMISSION_UNVERIFIED', 'CANCELLED', 'SUBMITTING'].includes(app.state)) return app
      return this.move(id, 'CANCELLED', 'Cancelled by you')
    })
  }

  private onBrowserClosed(id: string): void {
    const app = this.store.applications.get(id)
    if (!app) return
    if (app.state === 'SUBMITTING') {
      this.move(id, 'SUBMISSION_UNVERIFIED', 'The browser closed while submitting; the outcome could not be verified.')
    } else if (ACTIVE_STATES.includes(app.state) && app.state !== 'QUEUED') {
      this.move(id, app.state === 'OPENING' || app.state === 'AUTOFILLING' ? 'FAILED' : app.state, 'Browser window closed', {
        blockers: [...app.blockers.filter((b) => !/window closed/.test(b)), 'Browser window closed — use “Reopen” to continue.'],
        error: app.state === 'OPENING' || app.state === 'AUTOFILLING' ? 'Browser window closed' : undefined
      })
    }
  }

  async shutdown(): Promise<void> {
    await this.deps.browser.closeAll()
  }
}
