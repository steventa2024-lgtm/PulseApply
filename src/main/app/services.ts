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
import { EmbeddingService } from '../services/matching/embeddings'
import { MatchingService } from '../services/matching/matchingService'
import { ResumeService } from '../services/resume/resumeService'
import { BrowserManager, type BrowserOptions } from '../services/applications/browserManager'
import { ApplicationManager } from '../services/applications/applicationManager'
import { ACTIVE_STATES } from '../services/applications/stateMachine'
import { TelegramService } from '../services/telegram/telegramService'
import type { TelegramApi } from '../services/telegram/api'
import { Scheduler } from '../services/scheduler/scheduler'
import { log } from '../services/logger'

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
  /** In-memory database (tests). */
  inMemory?: boolean
}

export interface Services {
  store: Store
  geo: GeoService
  http: HttpClient
  search: SearchService
  employers: EmployerService
  matching: MatchingService
  resumes: ResumeService
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
  if (migration?.performed) log.info('startup', `Legacy import: ${JSON.stringify(migration.imported)}`)

  const http = new HttpClient({ userAgent: `PulseApply/${opts.appVersion} (desktop job-search assistant)`, fetchImpl: opts.fetchImpl })
  http.setHostInterval('nominatim.openstreetmap.org', 1100)
  const gazetteer = new Gazetteer(opts.resourcesDir)
  const geo = new GeoService(gazetteer, store.db, http, () => store.settings.get().onlineGeocoding)
  const embeddings = new EmbeddingService(store.db, http, () => store.settings.get().ollama)
  const matching = new MatchingService(store, geo, embeddings)
  const search = new SearchService({ store, geo, http, providers: opts.providers ?? ALL_PROVIDERS, matching })
  const employers = new EmployerService(store, http)
  const resumesDir = path.join(opts.userDataDir, 'resumes')
  const resumes = new ResumeService(store, resumesDir, gazetteer)
  const browser = new BrowserManager(
    opts.browserOptions ??
      (() => {
        const b = store.settings.get().browser
        return { executablePath: b.executablePath || process.env.PULSEAPPLY_CHROMIUM_PATH, channel: b.channel }
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
  const scheduler = new Scheduler({ store, search, telegram, onUpdate: () => opts.emit('scheduler:updated', null) })

  let shuttingDown: Promise<void> | null = null

  return {
    store,
    geo,
    http,
    search,
    employers,
    matching,
    resumes,
    browser,
    applications,
    telegram,
    scheduler,
    paths: { userData: opts.userDataDir, db: dbPath, resumes: resumesDir, resources: opts.resourcesDir },
    async dashboard(): Promise<DashboardStats> {
      const settings = store.settings.get()
      const since = new Date(Date.now() - 24 * 3600_000).toISOString()
      const s = store.jobs.stats(since, settings.matching.strongThreshold)
      const counts = store.applications.counts()
      const infos = search.providerInfos()
      return {
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
        providersNeedingCredentials: infos.filter((i) => i.status === 'REQUIRES_CREDENTIALS').length,
        scheduledSearches: store.searches.list().filter((x) => x.enabled).length,
        telegram: telegram.status().state
      }
    },
    shutdown(): Promise<void> {
      if (shuttingDown) return shuttingDown
      shuttingDown = (async () => {
        scheduler.stop()
        search.cancelAll()
        await Promise.allSettled([telegram.shutdown(), applications.shutdown()])
        store.db.close()
      })()
      return shuttingDown
    }
  }
}
