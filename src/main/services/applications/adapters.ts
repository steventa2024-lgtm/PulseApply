import type { Page } from 'playwright'
import type { ApplicationSupport } from '../../../shared/types'
import { detectAtsFromUrl } from '../jobs/discovery/atsDetect'
import { inspectPage } from './formInspector'

/**
 * ATS-specific knowledge. Adapters only handle navigation to the real form
 * and platform quirks; field filling is always done by the generic,
 * label-based inspector + mapper so layout changes do not silently break it.
 */
export interface ApplicationAdapter {
  id: ApplicationSupport
  label: string
  /** Moves from a job description page to the actual application form. */
  prepare(page: Page): Promise<void>
  /** Known limitations shown to the user. */
  notes: string[]
}

async function clickApplyIfNeeded(page: Page): Promise<void> {
  const insp = await inspectPage(page)
  const meaningful = insp.fields.filter((f) => f.kind !== 'checkbox' && f.kind !== 'checkbox-group')
  if (meaningful.length >= 2 || !insp.applyButton) return
  await page.locator(`[data-pa-button="${insp.applyButton.key}"]`).first().click({ timeout: 10_000 }).catch(() => undefined)
  await page.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => undefined)
  await page.waitForTimeout(800)
}

export const greenhouseAdapter: ApplicationAdapter = {
  id: 'greenhouse',
  label: 'Greenhouse',
  notes: ['Some Greenhouse forms include reCAPTCHA or custom questions that you must answer yourself.'],
  async prepare(page) {
    await clickApplyIfNeeded(page)
  }
}

export const leverAdapter: ApplicationAdapter = {
  id: 'lever',
  label: 'Lever',
  notes: ['Lever forms usually run an hCaptcha check when you submit; you may need to complete it in the browser.'],
  async prepare(page) {
    const url = new URL(page.url())
    if (url.hostname.endsWith('lever.co') && !/\/apply\/?$/.test(url.pathname) && /^\/[^/]+\/[0-9a-f-]{36}\/?$/i.test(url.pathname)) {
      await page.goto(`${url.origin}${url.pathname.replace(/\/$/, '')}/apply`, { waitUntil: 'domcontentloaded' })
      return
    }
    await clickApplyIfNeeded(page)
  }
}

export const ashbyAdapter: ApplicationAdapter = {
  id: 'ashby',
  label: 'Ashby',
  notes: ['Ashby renders its form with JavaScript; PulseApply waits for it to load. Some boards use reCAPTCHA.'],
  async prepare(page) {
    const url = new URL(page.url())
    if (url.hostname === 'jobs.ashbyhq.com' && /^\/[^/]+\/[0-9a-f-]{36}\/?$/i.test(url.pathname)) {
      await page.goto(`${url.origin}${url.pathname.replace(/\/$/, '')}/application`, { waitUntil: 'domcontentloaded' })
    }
    await page.waitForSelector('input, textarea', { timeout: 20_000 }).catch(() => undefined)
    await clickApplyIfNeeded(page)
  }
}

export const smartRecruitersAdapter: ApplicationAdapter = {
  id: 'smartrecruiters',
  label: 'SmartRecruiters',
  notes: ['SmartRecruiters often requires email verification or sign-in partway through; PulseApply pauses for you when that happens.'],
  async prepare(page) {
    await clickApplyIfNeeded(page)
    await page.waitForSelector('input, textarea', { timeout: 20_000 }).catch(() => undefined)
  }
}

export const genericAdapter: ApplicationAdapter = {
  id: 'generic',
  label: 'Generic form',
  notes: ['Unrecognised application site: fields are detected from their labels. Review every field before approving.'],
  async prepare(page) {
    await clickApplyIfNeeded(page)
  }
}

/** Platforms that need an account/login or heavy multi-step flows we cannot automate reliably. */
const MANUAL_PLATFORMS: [RegExp, string][] = [
  [/myworkdayjobs\.com|workday\.com/i, 'Workday requires creating an account and signing in; complete this application manually.'],
  [/icims\.com/i, 'iCIMS portals usually require an account and multi-step flows; complete this application manually.'],
  [/taleo\.net/i, 'Taleo requires an account; complete this application manually.'],
  [/workforcenow\.adp\.com|recruiting\.adp\.com/i, 'ADP Recruiting requires sign-in; complete this application manually.'],
  [/successfactors\.(com|eu)|jobs\.sap\.com/i, 'SAP SuccessFactors requires an account; complete this application manually.'],
  [/oraclecloud\.com/i, 'Oracle Recruiting Cloud requires email verification; complete this application manually.'],
  [/linkedin\.com|indeed\.com|ziprecruiter\.com|glassdoor\.com/i, 'This site requires signing in and does not permit automated applications; continue manually in the browser.']
]

export function manualReason(url: string): string | undefined {
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    return undefined
  }
  for (const [re, reason] of MANUAL_PLATFORMS) if (re.test(host)) return reason
  return undefined
}

export function adapterFor(url: string): ApplicationAdapter {
  const ats = detectAtsFromUrl(url)
  switch (ats?.provider) {
    case 'greenhouse':
      return greenhouseAdapter
    case 'lever':
      return leverAdapter
    case 'ashby':
      return ashbyAdapter
    case 'smartrecruiters':
      return smartRecruitersAdapter
    default:
      return genericAdapter
  }
}

/** HTML for the explicitly labelled development/demo form. Never used for real jobs. */
export function demoFormHtml(title: string, company: string): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
  return `<!doctype html><html><head><meta charset="utf-8"><title>DEMO — not a real application</title>
<style>body{font-family:system-ui;background:#0f172a;color:#e2e8f0;padding:32px}form{max-width:560px;margin:auto;background:#1e293b;padding:24px;border-radius:12px}
label{display:block;margin-top:12px;font-size:13px}input,select{width:100%;padding:8px;margin-top:4px;border-radius:6px;border:1px solid #475569;background:#0f172a;color:#fff}
.banner{background:#b45309;color:#fff;padding:10px;border-radius:8px;margin-bottom:16px;font-weight:700;text-align:center}button{margin-top:18px;padding:10px 16px}</style></head>
<body><form id="demo" onsubmit="event.preventDefault();document.body.innerHTML='<h1>Thank you for applying (DEMO)</h1><p>Demo reference number: DEMO-00001. No application was sent anywhere.</p>'">
<div class="banner">DEMO MODE — this is a local practice form. Nothing is sent to ${esc(company)}.</div>
<h2>${esc(title)}</h2>
<label for="first_name">First name *</label><input id="first_name" name="first_name" required>
<label for="last_name">Last name *</label><input id="last_name" name="last_name" required>
<label for="email">Email *</label><input id="email" type="email" name="email" required>
<label for="phone">Phone</label><input id="phone" type="tel" name="phone">
<label for="resume">Resume/CV *</label><input id="resume" type="file" name="resume" required>
<label for="auth">Are you legally authorized to work in this country? *</label><select id="auth" name="auth" required><option value="">Select…</option><option>Yes</option><option>No</option></select>
<button type="submit">Submit application</button></form></body></html>`
}
