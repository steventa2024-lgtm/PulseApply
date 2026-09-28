import type { AppSettings } from '../../../shared/types'
import type { AppDb } from './database'
import { json } from './database'
import { DEFAULT_WEIGHTS } from '../matching/weights'

export const DEFAULT_SETTINGS: AppSettings = {
  demoMode: false,
  onlineGeocoding: true,
  ollama: { enabled: true, baseUrl: 'http://127.0.0.1:11434', model: 'nomic-embed-text' },
  browser: {},
  matching: { weights: { ...DEFAULT_WEIGHTS }, strongThreshold: 75 },
  staleAfterDays: 21
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return base
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const b = out[k]
    out[k] =
      b &&
      typeof b === 'object' &&
      !Array.isArray(b) &&
      v &&
      typeof v === 'object' &&
      !Array.isArray(v)
        ? deepMerge(b, v)
        : v
  }
  return out as T
}

/** Key/value settings. Nested defaults are merged so new settings appear after upgrades. */
export class SettingsRepo {
  constructor(private readonly db: AppDb) {}

  getRaw<T>(key: string, fallback: T): T {
    const row = this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key])
    return row ? json<T>(row.value, fallback) : fallback
  }

  setRaw(key: string, value: unknown): void {
    this.db.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, JSON.stringify(value)]
    )
  }

  get(): AppSettings {
    return deepMerge(structuredClone(DEFAULT_SETTINGS), this.getRaw('app', {}))
  }

  update(patch: Partial<AppSettings>): AppSettings {
    const next = deepMerge(this.get(), patch)
    this.setRaw('app', next)
    return next
  }
}
