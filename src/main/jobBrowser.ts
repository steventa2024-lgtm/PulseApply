import { BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import type { Services } from './app/services'
import type { ClippedJob } from '../shared/clip'
import { isPublicHttpUrl } from './services/jobs/verification/urlSafety'
import { log } from './services/logger'

/**
 * Browse & Save: a normal browser window the user drives (sign-ins persist in
 * its own session). Its preload adds a "Save job" button; PulseApply reads the
 * current page only when the user clicks it. No automated navigation, no bulk
 * collection, no CAPTCHA or login handling.
 */
const PARTITION = 'persist:pulseapply-browse'
let win: BrowserWindow | null = null
let registered = false

export function openJobBrowser(svc: Services, url: string, onSaved: () => void): void {
  if (!isPublicHttpUrl(url)) throw new Error('Only public http(s) pages can be opened')
  if (!registered) {
    registered = true
    ipcMain.handle('clipper:save', async (event, payload) => {
      if (!win || event.sender !== win.webContents) return { ok: false, error: 'Not allowed' }
      try {
        const { job, overrides } = (payload ?? {}) as {
          job: ClippedJob
          overrides?: { title?: string; company?: string; location?: string }
        }
        if (!job || typeof job.url !== 'string' || !Array.isArray(job.jsonLd))
          return { ok: false, error: 'Nothing to save on this page' }
        const clean = (v: unknown, max: number): string | undefined =>
          typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined
        const res = await svc.imports.importClip(
          {
            url: job.url.slice(0, 2048),
            site: clean(job.site, 100) ?? '',
            title: clean(job.title, 300),
            company: clean(job.company, 200),
            location: clean(job.location, 300),
            description: clean(job.description, 20000),
            salary: clean(job.salary, 200),
            employmentType: clean(job.employmentType, 60),
            remote: !!job.remote,
            jsonLd: job.jsonLd.slice(0, 3),
            method: job.method
          },
          {
            title: clean(overrides?.title, 300),
            company: clean(overrides?.company, 200),
            location: clean(overrides?.location, 300)
          }
        )
        if (!res.saved) return { ok: true, ...res }
        onSaved()
        const saved = res.jobs[0]
        const e = saved?.eligibility
        return {
          ok: true,
          saved: true,
          summary: `${res.added ? 'Saved' : 'Already saved — updated'}: ${saved?.title ?? 'job'}${
            e
              ? e.status === 'eligible'
                ? ` — meets your criteria${saved.match ? ` (match ${saved.match.score})` : ''}`
                : ` — ${e.summary}`
              : ''
          }`
        }
      } catch (err) {
        log.warn('browse', `Save failed: ${(err as Error).message}`)
        return { ok: false, error: (err as Error).message }
      }
    })
  }

  if (win && !win.isDestroyed()) {
    void win.loadURL(url)
    win.focus()
    return
  }
  win = new BrowserWindow({
    width: 1280,
    height: 900,
    title: 'PulseApply — Browse & Save',
    autoHideMenuBar: true,
    webPreferences: {
      partition: PARTITION,
      preload: join(__dirname, '../preload/clipper.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  const wc = win.webContents
  // Links that open new tabs stay in this window; non-web links go to the OS.
  wc.setWindowOpenHandler(({ url: target }) => {
    if (isPublicHttpUrl(target)) void wc.loadURL(target)
    return { action: 'deny' }
  })
  wc.on('will-navigate', (e, target) => {
    if (!/^https?:/i.test(target)) {
      e.preventDefault()
      if (/^mailto:/i.test(target)) void shell.openExternal(target)
    }
  })
  wc.session.setPermissionRequestHandler((_w, perm, cb) => cb(perm === 'clipboard-sanitized-write'))
  win.on('closed', () => (win = null))
  void win.loadURL(url)
}
