import { app, shell, BrowserWindow, ipcMain, dialog, safeStorage, session } from 'electron'
import fs from 'fs'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { createServices, type Services } from './app/services'
import { createHandlers, validatePayload } from './ipc/handlers'
import { INVOKE_CHANNELS, type IpcChannel, type IpcEnvelope } from '../shared/ipc'
import type { SecretCipher } from './services/persistence/secrets'
import { isPublicHttpUrl } from './services/jobs/verification/urlSafety'
import { log, redact } from './services/logger'
import { ElectronPdfPrinter } from './resumePrinter'

const pdfPrinter = new ElectronPdfPrinter()

/**
 * Main-process entry.
 *
 * Lifecycle guarantees:
 *  - Only one PulseApply instance runs (duplicate instances were a cause of
 *    Telegram 409 conflicts and database write races).
 *  - All services are created exactly once, after `ready`.
 *  - Quit is intercepted until the scheduler, searches, Telegram poller and
 *    automation browsers have stopped and the database has been flushed.
 */

let mainWindow: BrowserWindow | null = null
let services: Services | null = null
let quitting = false

class SafeStorageCipher implements SecretCipher {
  readonly level: SecretCipher['level']
  constructor() {
    if (!safeStorage.isEncryptionAvailable()) this.level = 'unavailable'
    else if (
      process.platform === 'linux' &&
      safeStorage.getSelectedStorageBackend?.() === 'basic_text'
    )
      this.level = 'basic'
    else this.level = 'os'
  }
  encrypt(plain: string): string {
    return safeStorage.encryptString(plain).toString('base64')
  }
  decrypt(stored: string): string {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  }
}

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

function resourcesDir(): string {
  // out/main/index.js -> <app>/resources (inside app.asar, unpacked via asarUnpack when packaged)
  const candidates = [
    join(__dirname, '../../resources'),
    join(process.resourcesPath ?? '', 'app.asar.unpacked', 'resources')
  ]
  return candidates.find((c) => fs.existsSync(join(c, 'geo', 'cities.json.gz'))) ?? candidates[0]
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1000,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#090d16',
    title: 'PulseApply',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#090d16', symbolColor: '#94a3b8', height: 38 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => (mainWindow = null))

  // Only public http(s) links may leave the app, and only to the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isPublicHttpUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed =
      (is.dev &&
        process.env['ELECTRON_RENDERER_URL'] &&
        url.startsWith(process.env['ELECTRON_RENDERER_URL'])) ||
      url.startsWith('file://')
    if (!allowed) event.preventDefault()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(svc: Services): void {
  const handlers = createHandlers(
    svc,
    {
      async pickResumeFile() {
        const res = await dialog.showOpenDialog({
          title: 'Select resume',
          filters: [{ name: 'Resumes', extensions: ['pdf', 'docx', 'txt'] }],
          properties: ['openFile']
        })
        return res.canceled || !res.filePaths[0] ? null : res.filePaths[0]
      },
      async saveJsonFile(defaultName, content) {
        const res = await dialog.showSaveDialog({
          title: 'Export profile',
          defaultPath: defaultName,
          filters: [{ name: 'JSON', extensions: ['json'] }]
        })
        if (res.canceled || !res.filePath) return null
        fs.writeFileSync(res.filePath, content, { mode: 0o600 })
        return res.filePath
      },
      async savePdfPath(defaultName) {
        const res = await dialog.showSaveDialog({
          title: 'Save resume as PDF',
          defaultPath: join(app.getPath('documents'), defaultName),
          filters: [{ name: 'PDF', extensions: ['pdf'] }]
        })
        if (res.canceled || !res.filePath) return null
        return res.filePath.toLowerCase().endsWith('.pdf') ? res.filePath : `${res.filePath}.pdf`
      },
      async openPath(file) {
        const err = await shell.openPath(file)
        if (err) throw new Error(err)
      },
      async showInFolder(file) {
        shell.showItemInFolder(file)
      },
      async confirm(message, detail, confirmLabel = 'Delete') {
        const opts = {
          type: 'warning' as const,
          buttons: ['Cancel', confirmLabel],
          defaultId: 0,
          cancelId: 0,
          message,
          detail
        }
        const res = mainWindow
          ? await dialog.showMessageBox(mainWindow, opts)
          : await dialog.showMessageBox(opts)
        return res.response === 1
      },
      async openExternal(url) {
        await shell.openExternal(url)
      },
      appInfo: () => ({ version: app.getVersion(), isPackaged: app.isPackaged })
    },
    send
  )

  for (const channel of INVOKE_CHANNELS) {
    ipcMain.handle(channel, async (event, payload): Promise<IpcEnvelope<unknown>> => {
      // Only our own renderer may call privileged handlers.
      const origin = event.senderFrame?.url ?? ''
      const trusted =
        origin.startsWith('file://') ||
        (is.dev &&
          !!process.env['ELECTRON_RENDERER_URL'] &&
          origin.startsWith(process.env['ELECTRON_RENDERER_URL']))
      if (!trusted || event.sender !== mainWindow?.webContents)
        return { ok: false, error: 'Untrusted sender' }
      try {
        const input = validatePayload(channel as IpcChannel, payload)
        const handler = handlers[channel as IpcChannel] as (p: unknown) => Promise<unknown>
        return { ok: true, data: await handler(input) }
      } catch (err) {
        const message = redact((err as Error).message ?? String(err))
        log.warn('ipc', `${channel} failed: ${message}`)
        return { ok: false, error: message }
      }
    })
  }
}

async function bootstrap(): Promise<void> {
  electronApp.setAppUserModelId('com.pulseapply.app')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))

  services = await createServices({
    userDataDir: app.getPath('userData'),
    resourcesDir: resourcesDir(),
    cipher: new SafeStorageCipher(),
    emit: send,
    appVersion: app.getVersion(),
    pdfPrinter: () => pdfPrinter
  })
  registerIpc(services)
  createWindow()

  void services.telegram.resumeIfEnabled()
  services.scheduler.start()
  services.imports.startWatching()
  const housekeeping = (): void => {
    if (!services) return
    services.store.jobs.markExpired()
    services.store.jobs.markStale(services.store.settings.get().staleAfterDays)
    services.store.providers.pruneCache()
    services.store.telegram.pruneExpired()
  }
  housekeeping()
  setInterval(housekeeping, 60 * 60_000).unref()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app
    .whenReady()
    .then(bootstrap)
    .catch((err) => {
      log.error('startup', err)
      dialog.showErrorBox('PulseApply failed to start', redact((err as Error).message))
      app.quit()
    })

  app.on('before-quit', (event) => {
    if (quitting || !services) return
    event.preventDefault()
    quitting = true
    const done = (): void => app.quit()
    Promise.race([services.shutdown(), new Promise((r) => setTimeout(r, 8000))])
      .catch((err) => log.error('shutdown', err))
      .finally(done)
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
