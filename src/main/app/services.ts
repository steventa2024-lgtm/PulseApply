import path from 'path'
import type { ApplicationRecord, DashboardStats, TelegramStatus } from '../../shared/types'
import { openStore, type Store } from '../services/persistence/store'
import type { SecretCipher } from '../services/persistence/secrets'
import { importLegacyDatabase } from '../services/persistence/legacyImport'
import { Gazetteer } from '../services/jobs/geo/gazetteer'
import { GeoService } from '../services/jobs/geo/geoService'
import { HttpClient } from '../services/jobs/adapters/http'
import { ALL_PROVIDERS } from '../services/jobs/providers'
import type { JobProvider } from '../services/jobs/providers/types'
import { SearchService } from '../services/jobs/orchestration/searchService'
import { EmployerService } from '../services/jobs/discovery/employers'
import { JobImportService } from '../services/jobs/import/jobImport'
import { EmbeddingService } from '../services/matching/embeddings'
import { MatchingService } from '../services/matching/matchingService'
import { CriteriaService } from '../services/eligibility/criteriaService'
import { ResumeService } from '../services/resume/resumeService'
import { ResumeHelperService, type PdfPrinter } from '../services/resume/resumeHelper'
import { BrowserManager, type BrowserOptions } from '../services/applications/browserManager'
import { ApplicationManager } from '../services/applications/applicationManager'
import { ACTIVE_STATES } from '../services/applications/stateMachine'
import { TelegramService } from '../services/telegram/telegramService'
import type { TelegramApi } from '../services/telegram/api'
import { Scheduler } from '../services/scheduler/scheduler'
import { log } from '../services/logger'
import { htmlToText, looksLikeHtml } from '../services/jobs/normalization/text'

export type EmitFn = (channel: string, payload: unknown) => void

export interface ServiceOptions {
  userDataDir: string
  resourcesDir: string
  cipher: SecretCipher
  emit: EmitFn
  appVersion: string
  fetchImpl?: typeof fetch
  providers?: JobProvider[]
  browserOptions?: () => BrowserOptions
  telegramApiFactory?: (token: string) => TelegramApi
  telegramPollTimeoutSec?: number
  telegramConflictBackoffMs?: number
  allowPrivateHosts?: boolean
  /** HTML-to-PDF renderer for the Resume Helper (Electron printToPDF in the app). */
  pdfPrinter?: () => PdfPrinter | undefined
  /** In-memory database (tests). */
  inMemory?: boolean
}

export interface Services {
  store: Store
  geo: GeoService
  http: HttpClient
  search: SearchService
  employers: EmployerService
  imports: JobImportService
  matching: MatchingService
  criteria: CriteriaService
  resumes: ResumeService
  resumeHelper: ResumeHelperService
  browser: BrowserManager
  applications: ApplicationManager
  telegram: TelegramService
  scheduler: Scheduler
  paths: { userData: string; db: string; resumes: string; resources: string }
  dashboard(): Promise<DashboardStats>
  shutdown(): Promise<void>
}

export async function createServices(opts: ServiceOptions): Promise<Services> {
  const dbPath = path.join(opts.userDataDir, 'pulseapply.sqlite')
  const store = await openStore(opts.inMemory ? null : dbPath, opts.cipher)
  store.searches.abandonDanglingRuns()
  const migration = importLegacyDatabase(store, opts.userDataDir)
  if (migration?.performed)
    log.info('startup', `Legacy import: ${JSON.stringify(migration.imported)}`)

  bootstrapSecretsFromEnv(store, process.env)
  const repaired = store.jobs.repairDescriptions(htmlToText, looksLikeHtml)
  if (repaired)
    log.info('startup', `Converted ${repaired} stored job description(s) from HTML to text`)
  const http = new HttpClient({
    userAgent: `PulseApply/${opts.appVersion} (desktop job-search assistant)`,
    fetchImpl: opts.fetchImpl
  })
  http.setHostInterval('nominatim.openstreetmap.org', 1100)
  const gazetteer = new Gazetteer(opts.resourcesDir)
  const geo = new GeoService(gazetteer, store.db, http, () => store.settings.get().onlineGeocoding)
  const embeddings = new EmbeddingService(store.db, http, () => store.settings.get().ollama)
  const matching = new MatchingService(store, geo, embeddings)
  // The import service is created later; criteria changes refresh its search request.
  const late: { imports?: JobImportService } = {}
  const criteria = new CriteriaService({
    store,
    geo,
    matching,
    onChanged: () => {
      opts.emit('jobs:changed', null)
      void late.imports?.writeSearchRequest()
    }
  })
  const search = new SearchService({
    store,
    geo,
    http,
    providers: opts.providers ?? ALL_PROVIDERS,
    criteria
  })
  const employers = new EmployerService(store, http)
  const imports = new JobImportService({
    store,
    geo,
    http,
    criteria,
    inboxDir: path.join(opts.userDataDir, 'inbox'),
    skipDnsCheck: opts.allowPrivateHosts,
    onImported: () => opts.emit('jobs:changed', null)
  })
  late.imports = imports
  const resumesDir = path.join(opts.userDataDir, 'resumes')
  const resumes = new ResumeService(store, resumesDir, gazetteer)
  const resumeHelper = new ResumeHelperService({
    store,
    http,
    resumesDir,
    printer: opts.pdfPrinter ?? (() => undefined),
    onProfileChanged: () => criteria.profileChanged()
  })
  const browser = new BrowserManager(
    opts.browserOptions ??
      (() => {
        const b = store.settings.get().browser
        return {
          executablePath: b.executablePath || process.env.PULSEAPPLY_CHROMIUM_PATH,
          channel: b.channel
        }
      })
  )
  const applications = new ApplicationManager({
    store,
    browser,
    emit: (app: ApplicationRecord) => opts.emit('applications:updated', app),
    allowPrivateHosts: opts.allowPrivateHosts
  })
  const telegram = new TelegramService({
    store,
    lockDir: opts.userDataDir,
    queueApplication: (jobId) => applications.queue(jobId, 'telegram'),
    emit: (s: TelegramStatus) => opts.emit('telegram:status', s),
    apiFactory: opts.telegramApiFactory,
    pollTimeoutSec: opts.telegramPollTimeoutSec,
    conflictBackoffMs: opts.telegramConflictBackoffMs
  })
  const scheduler = new Scheduler({
    store,
    search,
    telegram,
    onUpdate: () => opts.emit('scheduler:updated', null)
  })

  let shuttingDown: Promise<void> | null = null

  return {
    store,
    geo,
    http,
    search,
    employers,
    imports,
    matching,
    criteria,
    resumes,
    resumeHelper,
    browser,
    applications,
    telegram,
    scheduler,
    paths: {
      userData: opts.userDataDir,
      db: dbPath,
      resumes: resumesDir,
      resources: opts.resourcesDir
    },
    async dashboard(): Promise<DashboardStats> {
      const settings = store.settings.get()
      const since = new Date(Date.now() - 24 * 3600_000).toISOString()
      const s = store.jobs.stats(since, settings.matching.strongThreshold)
      const counters = await criteria.counters()
      const counts = store.applications.counts()
      const infos = search.providerInfos()
      return {
        counters,
        totalJobs: s.total,
        newJobs: s.newJobs,
        verifiedJobs: s.verified,
        strongMatches: s.strong,
        savedJobs: s.saved,
        applicationsInProgress: ACTIVE_STATES.reduce((a, st) => a + (counts[st] ?? 0), 0),
        confirmedSubmitted: counts.SUBMITTED ?? 0,
        unverifiedSubmissions: counts.SUBMISSION_UNVERIFIED ?? 0,
        lastSuccessfulSearchAt: store.searches.lastSuccessfulRunAt(),
        providersConnected: infos.filter((i) => i.status === 'CONNECTED').length,
        providersNeedingCredentials: infos.filter((i) => i.status === 'REQUIRES_CREDENTIALS')
          .length,
        scheduledSearches: store.searches.list().filter((x) => x.enabled).length,
        telegram: telegram.status().state
      }
    },
    shutdown(): Promise<void> {
      if (shuttingDown) return shuttingDown
      shuttingDown = (async () => {
        scheduler.stop()
        imports.stop()
        search.cancelAll()
        await Promise.allSettled([telegram.shutdown(), applications.shutdown()])
        store.db.close()
      })()
      return shuttingDown
    }
  }
}

/**
 * Optional developer convenience: credentials present in the environment
 * (see .env.example) are copied into the encrypted secret store once, only
 * when the store has no value for that key. Values are never logged.
 */
export const ENV_SECRETS: Record<string, string> = {
  ADZUNA_APP_ID: 'adzuna.appId',
  ADZUNA_APP_KEY: 'adzuna.appKey',
  JOOBLE_API_KEY: 'jooble.apiKey',
  JOOBLE_REGIONAL_KEYS: 'jooble.regionalKeys',
  USAJOBS_API_KEY: 'usajobs.apiKey',
  USAJOBS_EMAIL: 'usajobs.email',
  CAREERONESTOP_USER_ID: 'careeronestop.userId',
  CAREERONESTOP_TOKEN: 'careeronestop.token',
  THEMUSE_API_KEY: 'themuse.apiKey',
  BRAVE_SEARCH_API_KEY: 'brave.apiKey',
  TELEGRAM_BOT_TOKEN: 'telegram.botToken'
}

export function bootstrapSecretsFromEnv(store: Store, env: NodeJS.ProcessEnv): string[] {
  const imported: string[] = []
  for (const [envKey, secretKey] of Object.entries(ENV_SECRETS)) {
    const v = env[envKey]?.trim()
    if (v && !store.secrets.has(secretKey)) {
      store.secrets.set(secretKey, v)
      imported.push(secretKey)
    }
  }
  if (imported.length)
    log.info('startup', `Imported ${imported.length} credential(s) from environment variables`)
  return imported
}
