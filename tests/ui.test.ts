import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Browser, Page } from 'playwright'
import type { Services } from '../src/main/app/services'
import { startUiHarness } from './fixtures/uiHarness'
import { adzunaPage, greenhouseJobs } from './fixtures/providerPayloads'
import { CHROMIUM, fakeFetch, json, makeServices } from './helpers'

const BUILT = fs.existsSync(path.join(__dirname, '..', 'out', 'renderer', 'index.html'))
const SHOTS = process.env.PULSEAPPLY_SCREENSHOTS ?? path.join(os.tmpdir(), 'pulseapply-ui')
const RESUME = path.join(__dirname, 'fixtures', 'resumes', 'warehouse_barista.pdf')

let svc: Services
let browser: Browser
let page: Page
let harness: { url: string; close: () => Promise<void> }
const consoleErrors: string[] = []

beforeAll(async () => {
  if (!BUILT || !CHROMIUM) return
  fs.mkdirSync(SHOTS, { recursive: true })
  svc = (
    await makeServices({
      fetchImpl: fakeFetch([
        (u) =>
          u.hostname === 'api.adzuna.com'
            ? json(adzunaPage(Number(u.pathname.split('/').pop())))
            : undefined,
        (u) =>
          u.hostname === 'boards-api.greenhouse.io'
            ? u.pathname === '/v1/boards/examplelogistics'
              ? json({ name: 'Example Logistics' })
              : json(greenhouseJobs)
            : undefined
      ])
    })
  ).svc
  svc.store.secrets.set('adzuna.appId', 'test-app')
  svc.store.secrets.set('adzuna.appKey', 'test-key-123456')
  await svc.employers.addBoard({ provider: 'greenhouse', boardId: 'examplelogistics' })
  harness = await startUiHarness(svc, { pickResume: RESUME })
  const { chromium } = await import('playwright')
  browser = await chromium.launch({ executablePath: CHROMIUM })
  page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
  page.on('pageerror', (e) => consoleErrors.push(e.message))
  page.on(
    'response',
    (r) =>
      r.status() >= 400 &&
      !r.url().endsWith('/favicon.ico') &&
      consoleErrors.push(`HTTP ${r.status()} ${r.url()}`)
  )
  await page.goto(harness.url)
}, 60_000)

afterAll(async () => {
  await browser?.close()
  await harness?.close()
  await svc?.shutdown()
})

const nav = (label: string): Promise<void> =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: label }).click()

describe.skipIf(!BUILT || !CHROMIUM)('renderer UI against the real IPC handlers', () => {
  it('renders the dashboard with live counts and no placeholder data', async () => {
    await page.getByRole('heading', { name: 'Dashboard' }).waitFor()
    await expect(
      page.getByText('Upload your resume to get match scores').isVisible()
    ).resolves.toBe(true)
    await page.screenshot({ path: path.join(SHOTS, '01-dashboard.png') })
  })

  it('uploads and parses a resume through the profile page', async () => {
    await nav('Profile')
    await page.getByRole('button', { name: 'Choose file…' }).click()
    await page.getByText('warehouse_barista').waitFor({ timeout: 20_000 })
    await expect(page.getByLabel('Full name', { exact: false }).first().inputValue()).resolves.toBe(
      'Jordan Rivera'
    )
    await page.screenshot({ path: path.join(SHOTS, '02-profile.png'), fullPage: true })
  })

  it('runs a local search and shows relevant, explained results', async () => {
    await nav('Search')
    await page.getByLabel('What job are you looking for?').fill('Warehouse Associate')
    await page.locator('#loc').fill('Los Angeles, CA')
    await page.locator('#rad').selectOption('20')
    await page.getByText('Occupation').first().waitFor()
    await page.screenshot({ path: path.join(SHOTS, '03-search.png'), fullPage: true })
    await page.getByRole('main').getByRole('button', { name: 'Search', exact: true }).click()
    await page.getByRole('heading', { name: 'Results' }).waitFor({ timeout: 30_000 })
    const titles = await page.locator('article h3').allInnerTexts()
    expect(titles).toEqual(
      expect.arrayContaining(['Warehouse Associate', 'Warehouse Associate - Night Shift'])
    )
    expect(titles.join()).not.toMatch(/Paralegal|HR Generalist|Accounts Payable/)
    await expect(page.getByText(/Filtered out:.*different occupation/).isVisible()).resolves.toBe(
      true
    )
    // Sidebar badge equals the number of cards rendered.
    const badge = await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('button', { name: /Results/ })
      .innerText()
    expect(badge).toContain(String(titles.length))
    await page.screenshot({ path: path.join(SHOTS, '04-results.png'), fullPage: true })

    await page
      .locator('article')
      .first()
      .getByRole('button', { name: /Details/ })
      .click()
    await page.getByText(/Match \d+\/100/).waitFor()
    await expect(
      page.getByText('not a hiring probability', { exact: false }).isVisible()
    ).resolves.toBe(true)
    await page.screenshot({ path: path.join(SHOTS, '05-job-detail.png') })
    await page.keyboard.press('Escape')
    await page.mouse.click(50, 450)
  }, 60_000)

  it('renders the remaining pages without errors', async () => {
    for (const [label, file] of [
      ['Applications', '06-applications'],
      ['Automation', '07-automation'],
      ['Sources', '08-sources'],
      ['Settings', '09-settings']
    ]) {
      await nav(label)
      await page.getByRole('heading', { name: label }).waitFor()
      await page.screenshot({ path: path.join(SHOTS, `${file}.png`), fullPage: true })
    }
    expect(consoleErrors.filter((e) => !/Failed to load resource/.test(e))).toEqual([])
  }, 60_000)
})
