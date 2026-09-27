import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import fs from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { parseResumeFile } from './services/parser'
import { loadDatabase, saveDatabase, CandidateInfo } from './services/db'
import { runSourcingPipeline, startScheduler, stopScheduler } from './services/scheduler'
import { runAutofillPipeline, closeActiveSession } from './services/autofill'

let mainWindow: BrowserWindow | null = null

async function processAndSyncResume(profile: any, filePath: string) {
  const db = loadDatabase()
  db.profile = profile

  if (profile.contact) {
    db.candidate = {
      ...db.candidate,
      fullName: profile.contact.fullName || db.candidate.fullName || 'Steven Alvarez',
      email: profile.contact.email || db.candidate.email,
      phone: profile.contact.phone || db.candidate.phone,
      location: profile.contact.location || db.candidate.location,
      resumeFilePath: filePath
    }
  }

  if (profile.detectedRoles && profile.detectedRoles.length > 0) {
    db.settings.targetRoles = profile.detectedRoles
  }
  if (profile.contact?.location) {
    db.settings.targetLocation = profile.contact.location
  }

  saveDatabase(db)

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('db:sync', db)
    await runSourcingPipeline(mainWindow)
  }

  return { success: true, profile, candidate: db.candidate, path: filePath }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1300,
    height: 860,
    minWidth: 950,
    minHeight: 650,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#090d16',
      symbolColor: '#94a3b8',
      height: 38
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.pulseapply.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle('system:ping', async () => ({ status: 'online', timestamp: Date.now() }))
  ipcMain.handle('db:get-all', async () => loadDatabase())

  ipcMain.handle('db:save-candidate', async (_, candidate: CandidateInfo) => {
    const db = loadDatabase()
    db.candidate = candidate
    saveDatabase(db)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('db:sync', db)
    }
    return true
  })

  ipcMain.handle('resume:select-and-parse', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Select Master Resume',
      filters: [{ name: 'PDF Documents', extensions: ['pdf'] }],
      properties: ['openFile']
    })

    if (canceled || filePaths.length === 0) return { success: false }

    try {
      const profile = await parseResumeFile(filePaths[0])
      return await processAndSyncResume(profile, filePaths[0])
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('resume:parse-path', async (_, filePath: string) => {
    try {
      const profile = await parseResumeFile(filePath)
      return await processAndSyncResume(profile, filePath)
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('resume:parse-base64', async (_, { fileName, base64 }: { fileName: string; base64: string }) => {
    try {
      const nodeBuffer = Buffer.from(base64, 'base64')
      const savePath = join(app.getPath('userData'), fileName || 'master_resume.pdf')
      fs.writeFileSync(savePath, nodeBuffer)

      const profile = await parseResumeFile(savePath)
      return await processAndSyncResume(profile, savePath)
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('scraper:force-run', async () => {
    if (mainWindow) return runSourcingPipeline(mainWindow)
    return []
  })

  ipcMain.handle('scheduler:toggle', async (_, activate: boolean) => {
    if (activate && mainWindow) {
      startScheduler(mainWindow)
    } else {
      stopScheduler()
    }
    return activate
  })

  ipcMain.handle('autofill:start', async (_, jobId: string) => {
    const db = loadDatabase()
    const job = db.jobs.find((j) => j.id === jobId)
    if (!job) return { success: false, message: 'Job not found in queue.' }

    job.status = 'in_progress'
    saveDatabase(db)

    return await runAutofillPipeline(job, db.candidate, (status) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('autofill:status-update', { jobId, ...status })
      }
    })
  })

  ipcMain.handle('autofill:confirm-submission', async (_, jobId: string) => {
    const db = loadDatabase()
    const job = db.jobs.find((j) => j.id === jobId)
    if (job) {
      job.status = 'applied'
      saveDatabase(db)
    }
    await closeActiveSession()
    return true
  })

  ipcMain.handle('autofill:cancel', async () => {
    await closeActiveSession()
    return true
  })

  createWindow()

  if (mainWindow) {
    startScheduler(mainWindow)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
