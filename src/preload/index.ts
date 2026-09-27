import { contextBridge, ipcRenderer, webUtils } from 'electron'

const api = {
  ping: () => ipcRenderer.invoke('system:ping'),
  getDatabase: () => ipcRenderer.invoke('db:get-all'),
  saveCandidate: (candidate: any) => ipcRenderer.invoke('db:save-candidate', candidate),
  selectAndParseResume: () => ipcRenderer.invoke('resume:select-and-parse'),
  parseResumePath: (filePath: string) => ipcRenderer.invoke('resume:parse-path', filePath),
  parseResumeBase64: (fileName: string, base64: string) =>
    ipcRenderer.invoke('resume:parse-base64', { fileName, base64 }),
  getPathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return (file as any).path || ''
    }
  },
  forceRunScraper: () => ipcRenderer.invoke('scraper:force-run'),
  toggleScheduler: (activate: boolean) => ipcRenderer.invoke('scheduler:toggle', activate),
  onPipelineUpdated: (callback: (jobs: any) => void) => {
    ipcRenderer.on('jobs:pipeline-updated', (_, data) => callback(data))
  },
  onDatabaseSync: (callback: (db: any) => void) => {
    ipcRenderer.on('db:sync', (_, data) => callback(data))
  },
  startAutofill: (jobId: string) => ipcRenderer.invoke('autofill:start', jobId),
  confirmSubmission: (jobId: string) => ipcRenderer.invoke('autofill:confirm-submission', jobId),
  cancelAutofill: () => ipcRenderer.invoke('autofill:cancel'),
  onAutofillStatus: (callback: (update: any) => void) => {
    ipcRenderer.on('autofill:status-update', (_, data) => callback(data))
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.api = api
}
