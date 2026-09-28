import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { EVENT_CHANNELS, INVOKE_CHANNELS, type IpcEnvelope } from '../shared/ipc'

/**
 * Minimal, allow-listed bridge. The renderer can only invoke known channels
 * (each validated again in the main process) and subscribe to known events.
 * Subscriptions return an unsubscribe function so React effects can clean up
 * (the previous bridge leaked a listener on every re-render/HMR).
 */
const invokeAllowed = new Set<string>(INVOKE_CHANNELS)
const eventsAllowed = new Set<string>(EVENT_CHANNELS)

const bridge = {
  invoke(channel: string, payload?: unknown): Promise<IpcEnvelope<unknown>> {
    if (!invokeAllowed.has(channel)) return Promise.resolve({ ok: false, error: `Channel not allowed: ${channel}` })
    return ipcRenderer.invoke(channel, payload)
  },
  on(channel: string, callback: (payload: unknown) => void): () => void {
    if (!eventsAllowed.has(channel)) return () => undefined
    const listener = (_: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  /** Absolute path for a dropped file (Electron >= 32 replacement for File.path). */
  pathForFile(file: File): string {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  }
}

export type PulseBridge = typeof bridge

contextBridge.exposeInMainWorld('pulse', bridge)
