import { log } from '../../logger'

export interface HttpRequest {
  url: string
  method?: 'GET' | 'POST' | 'HEAD'
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
  retries?: number
  signal?: AbortSignal
  /** Accept non-2xx statuses without throwing (caller inspects `status`). */
  acceptStatuses?: number[]
  maxBytes?: number
}

export interface HttpResponse {
  status: number
  url: string
  headers: Headers
  text: string
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
    readonly retryAfterMs?: number
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export class RateLimitedError extends HttpError {
  constructor(url: string, retryAfterMs: number) {
    super(
      `Rate limited by provider; retry after ${Math.ceil(retryAfterMs / 1000)}s`,
      429,
      url,
      retryAfterMs
    )
    this.name = 'RateLimitedError'
  }
}

export class CancelledError extends Error {
  constructor() {
    super('Cancelled')
    this.name = 'CancelledError'
  }
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504])
const MAX_RETRY_AFTER_MS = 20_000

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined
  const secs = Number(value)
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000)
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelledError())
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(t)
      reject(new CancelledError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Fetch wrapper used by every outbound integration: per-request timeout,
 * cancellation, bounded exponential backoff with jitter, Retry-After support,
 * per-host minimum spacing, and response size limits. URLs are redacted in logs.
 */
export class HttpClient {
  private readonly hostQueues = new Map<string, Promise<void>>()
  private readonly hostLast = new Map<string, number>()

  constructor(
    private readonly opts: {
      userAgent: string
      fetchImpl?: typeof fetch
      minIntervalMsByHost?: Record<string, number>
    }
  ) {}

  private get fetchImpl(): typeof fetch {
    return this.opts.fetchImpl ?? fetch
  }

  setHostInterval(host: string, ms: number): void {
    this.opts.minIntervalMsByHost = { ...(this.opts.minIntervalMsByHost ?? {}), [host]: ms }
  }

  private async throttle(url: string, signal?: AbortSignal): Promise<void> {
    const host = new URL(url).host
    const interval = this.opts.minIntervalMsByHost?.[host] ?? 0
    if (!interval) return
    const prev = this.hostQueues.get(host) ?? Promise.resolve()
    let release!: () => void
    const mine = new Promise<void>((r) => (release = r))
    this.hostQueues.set(
      host,
      prev.then(() => mine)
    )
    await prev
    try {
      const wait = (this.hostLast.get(host) ?? 0) + interval - Date.now()
      if (wait > 0) await sleep(wait, signal)
      this.hostLast.set(host, Date.now())
    } finally {
      release()
    }
  }

  async request(req: HttpRequest): Promise<HttpResponse> {
    const retries = req.retries ?? 2
    let attempt = 0
    for (;;) {
      if (req.signal?.aborted) throw new CancelledError()
      await this.throttle(req.url, req.signal)
      const timeout = AbortSignal.timeout(req.timeoutMs ?? 15_000)
      const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout
      let res: Response
      try {
        res = await this.fetchImpl(req.url, {
          method: req.method ?? 'GET',
          headers: {
            'User-Agent': this.opts.userAgent,
            Accept: 'application/json, text/html;q=0.9, */*;q=0.5',
            ...req.headers
          },
          body: req.body,
          signal,
          redirect: 'follow'
        })
      } catch (err) {
        if (req.signal?.aborted) throw new CancelledError()
        const timedOut = timeout.aborted
        if (attempt < retries) {
          attempt++
          await sleep(this.backoff(attempt), req.signal)
          continue
        }
        throw new HttpError(
          timedOut ? 'Request timed out' : `Network error: ${(err as Error).message}`,
          0,
          req.url
        )
      }

      if (res.ok || req.acceptStatuses?.includes(res.status)) {
        const text = await this.readBody(res, req.maxBytes ?? 8 * 1024 * 1024)
        return { status: res.status, url: res.url || req.url, headers: res.headers, text }
      }

      const retryAfter = parseRetryAfter(res.headers.get('retry-after'))
      // Drain body so the connection can be reused.
      await res.text().catch(() => '')
      if (res.status === 429 && retryAfter !== undefined && retryAfter > MAX_RETRY_AFTER_MS) {
        throw new RateLimitedError(req.url, retryAfter)
      }
      if (RETRYABLE.has(res.status) && attempt < retries) {
        attempt++
        await sleep(retryAfter ?? this.backoff(attempt), req.signal)
        continue
      }
      if (res.status === 429) throw new RateLimitedError(req.url, retryAfter ?? 60_000)
      log.debug('http', `HTTP ${res.status} for ${req.url}`)
      throw new HttpError(`HTTP ${res.status}`, res.status, req.url, retryAfter)
    }
  }

  async json<T = unknown>(req: HttpRequest): Promise<T> {
    const res = await this.request(req)
    try {
      return JSON.parse(res.text) as T
    } catch {
      throw new HttpError('Provider returned a non-JSON response', res.status, req.url)
    }
  }

  private backoff(attempt: number): number {
    return Math.min(8_000, 500 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250)
  }

  private async readBody(res: Response, maxBytes: number): Promise<string> {
    const len = Number(res.headers.get('content-length') ?? 0)
    if (len > maxBytes) throw new HttpError('Response too large', res.status, res.url)
    const buf = await res.arrayBuffer()
    if (buf.byteLength > maxBytes) throw new HttpError('Response too large', res.status, res.url)
    return new TextDecoder('utf-8').decode(buf)
  }
}
