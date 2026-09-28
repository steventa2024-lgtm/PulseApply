import type {
  CredentialField,
  EmployerRecord,
  EmploymentType,
  ProviderInfo,
  ResolvedPlace,
  Salary,
  SearchIntent,
  WorkMode,
  ApplicationSupport
} from '../../../../shared/types'
import type { HttpClient } from '../adapters/http'

/** What the orchestrator asks a provider for. */
export interface ProviderQuery {
  intent: SearchIntent
  /** Primary keyword phrase. */
  keywords: string
  /** Up to a few extra occupational synonyms for providers that support keyword search. */
  alternateKeywords: string[]
  location?: ResolvedPlace
  radiusKm?: number
  /** ISO alpha-2 market to query. */
  country?: string
  wantsRemote: boolean
  wantsOnsite: boolean
  postedWithinDays?: number
  maxResults: number
}

export interface ProviderContext {
  http: HttpClient
  secret(key: string): string | undefined
  config: Record<string, unknown>
  employers: EmployerRecord[]
  signal: AbortSignal
  contactEmail?: string
  onEmployerSynced?(
    employerId: string,
    status: EmployerRecord['status'],
    detail: string | null,
    count?: number
  ): void
}

export interface RawRecord {
  sourceJobId: string
  payload: unknown
  /** Market / employer context needed for normalization. */
  context?: Record<string, unknown>
}

/**
 * Provider-stated job fields. Everything here must come from the provider
 * payload. Derived values (occupation, skills, coordinates from the gazetteer,
 * work modes inferred from text) are added by the shared normalizer and
 * recorded in `inferredFields`.
 */
export interface DraftJob {
  sourceJobId: string
  sourceUrl: string
  applyUrl?: string
  title: string
  company: string
  companyWebsite?: string
  descriptionHtml?: string
  descriptionText?: string
  locationText: string
  /** Extra location strings (multi-location postings). */
  extraLocations?: string[]
  /** Provider-supplied structured location(s), e.g. with coordinates. */
  places?: Partial<ResolvedPlace>[]
  workModes?: WorkMode[]
  remoteEligibilityText?: string
  employmentTypes?: EmploymentType[]
  employmentTypeText?: string
  seniorityText?: string
  salary?: Salary
  salaryText?: string
  /** Provider marked the salary as its own estimate — it will be discarded. */
  salaryIsEstimate?: boolean
  postedAt?: string
  expiresAt?: string
  tags?: string[]
  employerDirect: boolean
  ats?: { provider: ApplicationSupport; board?: string; requisitionId?: string; postingId?: string }
  countryHint?: string
  extraNotes?: string[]
}

export interface ProviderSupport {
  ok: boolean
  reason?: string
}

export interface JobProvider {
  id: string
  name: string
  kind: ProviderInfo['kind']
  description: string
  markets: string
  docsUrl?: string
  signupUrl?: string
  termsNote?: string
  credentials: CredentialField[]
  defaultEnabled: boolean
  rateLimit: { minIntervalMs: number; note: string }
  cacheTtlMs: number
  timeoutMs: number
  /** Hosts this provider calls (used to register per-host throttling). */
  hosts: string[]
  /** Link template for user-assisted search on providers without an API ({q}, {l}). */
  manualSearchUrlTemplate?: string
  /** True for providers PulseApply never fetches from automatically. */
  manualOnly?: boolean
  supports(query: ProviderQuery): ProviderSupport
  isConfigured(secret: (key: string) => string | undefined): boolean
  fetch(query: ProviderQuery, ctx: ProviderContext): Promise<RawRecord[]>
  normalize(record: RawRecord): DraftJob | null
}

export function missingCredentials(
  p: JobProvider,
  secret: (k: string) => string | undefined
): string[] {
  return p.credentials.filter((c) => c.required && !secret(c.key)).map((c) => c.label)
}

export function isoFromUnix(value: unknown): string | undefined {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return undefined
  const ms = n > 1e12 ? n : n * 1000
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

export function isoFromString(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

export function str(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

export function num(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value.replace(/[, ]/g, '')) : Number(value)
  return typeof value !== 'boolean' && value !== null && value !== '' && Number.isFinite(n) && n > 0
    ? n
    : undefined
}

/** Client-side keyword filter for boards without server-side search. */
export function matchesKeywords(text: string, phrases: string[]): boolean {
  const lower = ` ${text.toLowerCase().replace(/[^a-z0-9+#]+/g, ' ')} `
  return phrases.some((p) => {
    const words = p
      .toLowerCase()
      .replace(/[^a-z0-9+#]+/g, ' ')
      .trim()
      .split(' ')
      .filter((w) => w.length > 1)
    return (
      words.length > 0 && words.every((w) => lower.includes(` ${w} `) || lower.includes(` ${w}s `))
    )
  })
}
