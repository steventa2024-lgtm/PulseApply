import { BrowserWindow, session } from 'electron'
import type { ResumePageSize } from '../shared/resume'
import { PAGINATE_SCRIPT, type PdfPrinter } from './services/resume/resumeHelper'

/**
 * Renders resume HTML to PDF with Chromium's print engine (text stays
 * selectable). Uses an invisible, sandboxed window that loads only the
 * generated HTML: no network, no Node, no navigation.
 */
const PARTITION = 'pulseapply-pdf'
let sessionReady = false

/** Isolated in-memory session for the print window: every network request is blocked. */
function printSession(): Electron.Session {
  const ses = session.fromPartition(PARTITION)
  if (!sessionReady) {
    ses.webRequest.onBeforeRequest((details, cb) =>
      cb({ cancel: !/^(data|about|devtools):/.test(details.url) })
    )
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
    sessionReady = true
  }
  return ses
}

export class ElectronPdfPrinter implements PdfPrinter {
  async print(html: string, pageSize: ResumePageSize): Promise<{ pdf: Buffer; pages: number }> {
    const win = new BrowserWindow({
      show: false,
      width: 900,
      height: 1200,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        javascript: true,
        session: printSession()
      }
    })
    try {
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      win.webContents.on('will-navigate', (e) => e.preventDefault())
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
      const pages = Number(await win.webContents.executeJavaScript(PAGINATE_SCRIPT, true)) || 1
      const pdf = await win.webContents.printToPDF({
        pageSize: pageSize === 'a4' ? 'A4' : 'Letter',
        printBackground: true,
        preferCSSPageSize: true,
        margins: { marginType: 'none' }
      })
      return { pdf, pages }
    } finally {
      win.destroy()
    }
  }
}
