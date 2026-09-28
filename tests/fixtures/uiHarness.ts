import fs from 'fs'
import http from 'http'
import path from 'path'
import type { AddressInfo } from 'net'
import type { Services } from '../../src/main/app/services'
import { createHandlers, validatePayload } from '../../src/main/ipc/handlers'
import type { IpcChannel } from '../../src/shared/ipc'

/**
 * Serves the production renderer build (out/renderer) to a normal browser and
 * replaces Electron's preload bridge with an HTTP one that calls the real,
 * validated IPC handlers. Lets the UI be exercised end-to-end where the
 * Electron binary is unavailable.
 */
const BRIDGE = `
window.pulse = {
  invoke: (channel, payload) => fetch('/ipc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channel, payload }) }).then(r => r.json()),
  on: (channel, cb) => {
    const es = new EventSource('/events?channel=' + encodeURIComponent(channel));
    es.onmessage = (e) => cb(JSON.parse(e.data));
    return () => es.close();
  },
  pathForFile: () => ''
};`

export async function startUiHarness(
  svc: Services,
  opts: { pickResume?: string } = {}
): Promise<{ url: string; close: () => Promise<void> }> {
  const root = path.join(__dirname, '..', '..', 'out', 'renderer')
  const listeners = new Set<{ channel: string; res: http.ServerResponse }>()
  const emit = (channel: string, payload: unknown): void => {
    for (const l of listeners)
      if (l.channel === channel) l.res.write(`data: ${JSON.stringify(payload)}\n\n`)
  }
  const handlers = createHandlers(
    svc,
    {
      pickResumeFile: async () => opts.pickResume ?? null,
      saveJsonFile: async () => null,
      confirm: async () => true,
      openExternal: async () => undefined,
      appInfo: () => ({ version: 'ui-test', isPackaged: false })
    },
    emit
  )
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname === '/ipc' && req.method === 'POST') {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', async () => {
        const { channel, payload } = JSON.parse(body)
        let out: unknown
        try {
          const input = validatePayload(channel as IpcChannel, payload ?? undefined)
          out = {
            ok: true,
            data: await (handlers[channel as IpcChannel] as (p: unknown) => Promise<unknown>)(input)
          }
        } catch (err) {
          out = { ok: false, error: (err as Error).message }
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(out ?? null))
      })
      return
    }
    if (url.pathname === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      const l = { channel: url.searchParams.get('channel') ?? '', res }
      listeners.add(l)
      req.on('close', () => listeners.delete(l))
      return
    }
    if (url.pathname === '/bridge.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' })
      res.end(BRIDGE)
      return
    }
    const file = path.join(root, url.pathname === '/' ? 'index.html' : url.pathname)
    if (!file.startsWith(root) || !fs.existsSync(file)) {
      res.writeHead(404)
      res.end()
      return
    }
    let content: Buffer | string = fs.readFileSync(file)
    if (file.endsWith('index.html')) {
      content = content.toString().replace('<script', '<script src="/bridge.js"></script><script')
    }
    const type = file.endsWith('.js')
      ? 'text/javascript'
      : file.endsWith('.css')
        ? 'text/css'
        : 'text/html'
    res.writeHead(200, { 'content-type': type })
    res.end(content)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise<void>((r) => {
        for (const l of listeners) l.res.end()
        server.close(() => r())
      })
  }
}
