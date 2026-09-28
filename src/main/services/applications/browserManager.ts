import type { Browser, BrowserContext, Page } from 'playwright'
import { log } from '../logger'

export interface BrowserSession {
  browser: Browser
  context: BrowserContext
  page: Page
  closed: boolean
}

export interface BrowserOptions {
  headless?: boolean
  executablePath?: string
  channel?: 'chromium' | 'chrome' | 'msedge'
}

/**
 * Visible Playwright browser sessions, one isolated (non-persistent) context
 * per application so no cookies or passwords are stored between applications.
 *
 * Launch order: explicit executable path -> Playwright's bundled Chromium ->
 * installed Chrome -> installed Edge (always present on Windows). No stealth
 * or anti-detection flags are used; sites see an ordinary browser.
 */
export class BrowserManager {
  private readonly sessions = new Map<string, BrowserSession>()

  constructor(private readonly options: () => BrowserOptions) {}

  async open(id: string, onClosed: () => void): Promise<BrowserSession> {
    await this.close(id)
    const { chromium } = await import('playwright')
    const opts = this.options()
    const headless = opts.headless ?? false
    const attempts: { label: string; launch: () => Promise<Browser> }[] = []
    const args = ['--window-size=1280,900']
    if (opts.executablePath) attempts.push({ label: opts.executablePath, launch: () => chromium.launch({ headless, executablePath: opts.executablePath, args }) })
    if (opts.channel && opts.channel !== 'chromium') attempts.push({ label: opts.channel, launch: () => chromium.launch({ headless, channel: opts.channel, args }) })
    attempts.push({ label: 'bundled Chromium', launch: () => chromium.launch({ headless, args }) })
    attempts.push({ label: 'Google Chrome', launch: () => chromium.launch({ headless, channel: 'chrome', args }) })
    attempts.push({ label: 'Microsoft Edge', launch: () => chromium.launch({ headless, channel: 'msedge', args }) })
    let browser: Browser | undefined
    const errors: string[] = []
    for (const a of attempts) {
      try {
        browser = await a.launch()
        log.info('browser', `Launched ${a.label}`)
        break
      } catch (err) {
        errors.push(`${a.label}: ${(err as Error).message.split('\n')[0]}`)
      }
    }
    if (!browser) {
      throw new Error(
        `Could not start a browser for application automation. Install one with "npx playwright install chromium", or install Google Chrome / Microsoft Edge. (${errors.join(' | ')})`
      )
    }
    const context = await browser.newContext({ viewport: headless ? { width: 1280, height: 900 } : null, acceptDownloads: false })
    context.setDefaultTimeout(15_000)
    context.setDefaultNavigationTimeout(45_000)
    const page = await context.newPage()
    const session: BrowserSession = { browser, context, page, closed: false }
    const markClosed = () => {
      if (session.closed) return
      session.closed = true
      if (this.sessions.get(id) === session) this.sessions.delete(id)
      onClosed()
    }
    browser.on('disconnected', markClosed)
    page.on('close', () => {
      if (context.pages().length === 0) markClosed()
    })
    this.sessions.set(id, session)
    return session
  }

  get(id: string): BrowserSession | undefined {
    const s = this.sessions.get(id)
    return s && !s.closed ? s : undefined
  }

  async close(id: string): Promise<void> {
    const s = this.sessions.get(id)
    if (!s) return
    this.sessions.delete(id)
    s.closed = true
    await s.browser.close().catch(() => undefined)
  }

  async closeAll(): Promise<void> {
    await Promise.allSettled([...this.sessions.keys()].map((id) => this.close(id)))
  }

  count(): number {
    return this.sessions.size
  }
}
