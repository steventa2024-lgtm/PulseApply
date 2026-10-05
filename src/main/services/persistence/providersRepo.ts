import { createHash, randomUUID } from 'crypto'
import type { AtsProvider, EmployerRecord } from '../../../shared/types'
import type { AppDb } from './database'
import { json } from './database'

export interface ProviderHealth {
  lastSuccessAt?: string
  lastErrorAt?: string
  lastError?: string
  lastCount?: number
  rateLimitedUntil?: string
}

/** Provider enablement, health and response cache. */
export class ProvidersRepo {
  constructor(private readonly db: AppDb) {}

  isEnabled(providerId: string, defaultEnabled: boolean): boolean {
    const r = this.db.get<{ enabled: number }>(
      'SELECT enabled FROM job_sources WHERE provider_id = ?',
      [providerId]
    )
    return r ? !!r.enabled : defaultEnabled
  }

  setEnabled(providerId: string, enabled: boolean): void {
    this.db.run(
      `INSERT INTO job_sources (provider_id, enabled) VALUES (?, ?)
       ON CONFLICT(provider_id) DO UPDATE SET enabled = excluded.enabled`,
      [providerId, enabled ? 1 : 0]
    )
  }

  getConfig<T>(providerId: string, fallback: T): T {
    const r = this.db.get<{ config: string }>(
      'SELECT config FROM job_sources WHERE provider_id = ?',
      [providerId]
    )
    return r ? json<T>(r.config, fallback) : fallback
  }

  setConfig(providerId: string, config: unknown): void {
    this.db.run(
      `INSERT INTO job_sources (provider_id, enabled, config) VALUES (?, 1, ?)
       ON CONFLICT(provider_id) DO UPDATE SET config = excluded.config`,
      [providerId, JSON.stringify(config)]
    )
  }

  health(providerId: string): ProviderHealth {
    const r = this.db.get<{
      last_success_at: string | null
      last_error_at: string | null
      last_error: string | null
      last_count: number | null
      rate_limited_until: string | null
    }>('SELECT * FROM provider_health WHERE provider_id = ?', [providerId])
    if (!r) return {}
    return {
      lastSuccessAt: r.last_success_at ?? undefined,
      lastErrorAt: r.last_error_at ?? undefined,
      lastError: r.last_error ?? undefined,
      lastCount: r.last_count ?? undefined,
      rateLimitedUntil: r.rate_limited_until ?? undefined
    }
  }

  private ensure(providerId: string): void {
    this.db.run('INSERT OR IGNORE INTO provider_health (provider_id, updated_at) VALUES (?, ?)', [
      providerId,
      new Date().toISOString()
    ])
  }

  /** Counts one request against the provider's monthly usage (UTC month). */
  addUsage(providerId: string, month = new Date().toISOString().slice(0, 7)): void {
    this.db.run(
      `INSERT INTO provider_usage (provider_id, month, requests) VALUES (?, ?, 1)
       ON CONFLICT(provider_id, month) DO UPDATE SET requests = requests + 1`,
      [providerId, month]
    )
  }

  usage(providerId: string, month = new Date().toISOString().slice(0, 7)): number {
    return (
      this.db.get<{ n: number }>(
        'SELECT requests AS n FROM provider_usage WHERE provider_id = ? AND month = ?',
        [providerId, month]
      )?.n ?? 0
    )
  }

  recordSuccess(providerId: string, count: number): void {
    this.ensure(providerId)
    const now = new Date().toISOString()
    this.db.run(
      'UPDATE provider_health SET last_success_at = ?, last_count = ?, updated_at = ? WHERE provider_id = ?',
      [now, count, now, providerId]
    )
  }

  recordError(providerId: string, error: string, rateLimitedUntil?: string): void {
    this.ensure(providerId)
    const now = new Date().toISOString()
    this.db.run(
      `UPDATE provider_health SET last_error_at = ?, last_error = ?, updated_at = ?,
         rate_limited_until = COALESCE(?, rate_limited_until) WHERE provider_id = ?`,
      [now, error.slice(0, 500), now, rateLimitedUntil ?? null, providerId]
    )
  }

  // --- cache ---------------------------------------------------------------

  static cacheKey(providerId: string, query: unknown): string {
    return (
      providerId +
      ':' +
      createHash('sha256').update(JSON.stringify(query)).digest('hex').slice(0, 32)
    )
  }

  cacheGet<T>(key: string): T | undefined {
    const r = this.db.get<{ payload: string; expires_at: string }>(
      'SELECT payload, expires_at FROM provider_cache WHERE cache_key = ?',
      [key]
    )
    if (!r || r.expires_at < new Date().toISOString()) return undefined
    return json<T | undefined>(r.payload, undefined)
  }

  cacheSet(key: string, providerId: string, payload: unknown, ttlMs: number): void {
    const now = Date.now()
    this.db.run(
      `INSERT INTO provider_cache (cache_key, provider_id, payload, fetched_at, expires_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`,
      [
        key,
        providerId,
        JSON.stringify(payload),
        new Date(now).toISOString(),
        new Date(now + ttlMs).toISOString()
      ]
    )
  }

  pruneCache(): void {
    this.db.run('DELETE FROM provider_cache WHERE expires_at < ?', [new Date().toISOString()])
  }
}

interface EmployerRow {
  id: string
  name: string
  ats_provider: string
  board_id: string
  careers_url: string | null
  country: string | null
  locations: string
  industry: string | null
  status: string
  status_detail: string | null
  last_sync_at: string | null
  job_count: number | null
  added_by: string
  created_at: string
}

/** Registry of employer job boards (company-specific ATS feeds and career pages). */
export class EmployersRepo {
  constructor(private readonly db: AppDb) {}

  private hydrate(r: EmployerRow): EmployerRecord {
    return {
      id: r.id,
      name: r.name,
      atsProvider: r.ats_provider as AtsProvider,
      boardId: r.board_id,
      careersUrl: r.careers_url ?? undefined,
      country: r.country ?? undefined,
      locations: json<string[]>(r.locations, []),
      industry: r.industry ?? undefined,
      status: r.status as EmployerRecord['status'],
      statusDetail: r.status_detail ?? undefined,
      lastSyncAt: r.last_sync_at ?? undefined,
      jobCount: r.job_count ?? undefined,
      addedBy: r.added_by as EmployerRecord['addedBy'],
      createdAt: r.created_at
    }
  }

  list(provider?: AtsProvider): EmployerRecord[] {
    const rows = provider
      ? this.db.all<EmployerRow>('SELECT * FROM employers WHERE ats_provider = ? ORDER BY name', [
          provider
        ])
      : this.db.all<EmployerRow>('SELECT * FROM employers ORDER BY name')
    return rows.map((r) => this.hydrate(r))
  }

  get(id: string): EmployerRecord | undefined {
    const r = this.db.get<EmployerRow>('SELECT * FROM employers WHERE id = ?', [id])
    return r ? this.hydrate(r) : undefined
  }

  find(provider: AtsProvider, boardId: string): EmployerRecord | undefined {
    const r = this.db.get<EmployerRow>(
      'SELECT * FROM employers WHERE ats_provider = ? AND board_id = ?',
      [provider, boardId]
    )
    return r ? this.hydrate(r) : undefined
  }

  upsert(input: Omit<EmployerRecord, 'id' | 'createdAt'> & { id?: string }): EmployerRecord {
    const existing = this.find(input.atsProvider, input.boardId)
    const id = existing?.id ?? input.id ?? randomUUID()
    this.db.run(
      `INSERT INTO employers (id, name, ats_provider, board_id, careers_url, country, locations, industry, status, status_detail,
         last_sync_at, job_count, added_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(ats_provider, board_id) DO UPDATE SET name = excluded.name, careers_url = excluded.careers_url,
         country = excluded.country, locations = excluded.locations, industry = excluded.industry, status = excluded.status,
         status_detail = excluded.status_detail`,
      [
        id,
        input.name,
        input.atsProvider,
        input.boardId,
        input.careersUrl ?? null,
        input.country ?? null,
        JSON.stringify(input.locations ?? []),
        input.industry ?? null,
        input.status,
        input.statusDetail ?? null,
        input.lastSyncAt ?? null,
        input.jobCount ?? null,
        input.addedBy,
        existing?.createdAt ?? new Date().toISOString()
      ]
    )
    return this.find(input.atsProvider, input.boardId)!
  }

  recordSync(
    id: string,
    status: EmployerRecord['status'],
    detail: string | null,
    jobCount?: number
  ): void {
    this.db.run(
      'UPDATE employers SET status = ?, status_detail = ?, last_sync_at = ?, job_count = COALESCE(?, job_count) WHERE id = ?',
      [status, detail, new Date().toISOString(), jobCount ?? null, id]
    )
  }

  delete(id: string): void {
    this.db.run('DELETE FROM employers WHERE id = ?', [id])
  }
}
