import { createHash } from 'crypto'
import type { SemanticStatus } from '../../../shared/types'
import type { AppDb } from '../persistence/database'
import type { HttpClient } from '../jobs/adapters/http'
import { log } from '../logger'

/**
 * Optional local semantic similarity via Ollama (e.g. `nomic-embed-text`).
 * Embeddings are cached by content hash + model name. When Ollama is not
 * running, matching silently uses only the deterministic criteria and the UI
 * shows semantic matching as inactive.
 */
export class EmbeddingService {
  private status: SemanticStatus
  private lastCheck = 0

  constructor(
    private readonly db: AppDb,
    private readonly http: HttpClient,
    private readonly config: () => { enabled: boolean; baseUrl: string; model: string }
  ) {
    const c = config()
    this.status = { enabled: c.enabled, active: false, model: c.model, detail: 'Not checked yet' }
  }

  private base(): string {
    return this.config().baseUrl.replace(/\/$/, '')
  }

  async checkStatus(force = false): Promise<SemanticStatus> {
    const c = this.config()
    if (!c.enabled) {
      this.status = {
        enabled: false,
        active: false,
        model: c.model,
        detail: 'Disabled in settings'
      }
      return this.status
    }
    if (!force && Date.now() - this.lastCheck < 60_000) return this.status
    this.lastCheck = Date.now()
    try {
      const tags = await this.http.json<{ models?: { name: string }[] }>({
        url: `${this.base()}/api/tags`,
        timeoutMs: 2500,
        retries: 0
      })
      const names = (tags.models ?? []).map((m) => m.name)
      const present = names.some((n) => n === c.model || n.startsWith(`${c.model}:`))
      this.status = present
        ? {
            enabled: true,
            active: true,
            model: c.model,
            detail: `Ollama running; using ${c.model}`
          }
        : {
            enabled: true,
            active: false,
            model: c.model,
            detail: `Ollama is running but "${c.model}" is not installed. Run: ollama pull ${c.model}`
          }
    } catch {
      this.status = {
        enabled: true,
        active: false,
        model: c.model,
        detail: `Ollama not reachable at ${this.base()} — using deterministic matching only`
      }
    }
    return this.status
  }

  current(): SemanticStatus {
    return this.status
  }

  static hash(text: string): string {
    return createHash('sha256').update(text).digest('hex').slice(0, 40)
  }

  private cached(hash: string, model: string): number[] | undefined {
    const row = this.db.get<{ vector: string }>(
      'SELECT vector FROM job_embeddings WHERE content_hash = ? AND model = ?',
      [hash, model]
    )
    if (!row) return undefined
    try {
      return JSON.parse(row.vector)
    } catch {
      return undefined
    }
  }

  /** Returns embeddings for texts (null when unavailable). Batched, cached. */
  async embed(texts: string[], signal?: AbortSignal): Promise<(number[] | null)[]> {
    const status = await this.checkStatus()
    if (!status.active) return texts.map(() => null)
    const model = status.model
    const out: (number[] | null)[] = texts.map(() => null)
    const missing: { idx: number; text: string; hash: string }[] = []
    texts.forEach((t, idx) => {
      const hash = EmbeddingService.hash(`${model}\n${t}`)
      const hit = this.cached(hash, model)
      if (hit) out[idx] = hit
      else missing.push({ idx, text: t, hash })
    })
    for (let i = 0; i < missing.length; i += 32) {
      if (signal?.aborted) break
      const batch = missing.slice(i, i + 32)
      try {
        const res = await this.http.json<{ embeddings?: number[][] }>({
          url: `${this.base()}/api/embed`,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, input: batch.map((b) => b.text) }),
          timeoutMs: 60_000,
          retries: 0,
          signal
        })
        const vecs = res.embeddings ?? []
        this.db.transaction(() => {
          batch.forEach((b, k) => {
            const v = vecs[k]
            if (!Array.isArray(v) || v.length === 0) return
            out[b.idx] = v
            this.db.run(
              'INSERT OR REPLACE INTO job_embeddings (content_hash, model, vector, created_at) VALUES (?, ?, ?, ?)',
              [
                b.hash,
                model,
                JSON.stringify(v.map((x) => Math.round(x * 1e5) / 1e5)),
                new Date().toISOString()
              ]
            )
          })
        })
      } catch (err) {
        log.warn('embeddings', `Ollama embedding failed: ${(err as Error).message}`)
        this.status = {
          ...this.status,
          active: false,
          detail: `Embedding request failed: ${(err as Error).message}`
        }
        break
      }
    }
    return out
  }
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

/**
 * Maps raw cosine similarity to 0..1. General-purpose text embeddings give
 * unrelated texts ~0.3-0.45 and closely related ones ~0.75+, so the useful
 * range is rescaled. This is a similarity signal, not a probability.
 */
export function similarityScore(cos: number): number {
  return Math.max(0, Math.min(1, (cos - 0.4) / 0.4))
}
