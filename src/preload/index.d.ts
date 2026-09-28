import type { IpcEnvelope } from '../shared/ipc'

export interface PulseBridge {
  invoke(channel: string, payload?: unknown): Promise<IpcEnvelope<unknown>>
  on(channel: string, callback: (payload: unknown) => void): () => void
  pathForFile(file: File): string
}

declare global {
  interface Window {
    pulse: PulseBridge
  }
}
