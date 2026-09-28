import type {
  AppInfo,
  AppSettings,
  ApplicationEvent,
  ApplicationRecord,
  ApplicationState,
  AtsProvider,
  CandidateProfile,
  DashboardStats,
  EmployerRecord,
  ExclusionReason,
  JobCounters,
  ProviderInfo,
  ResumeParseResult,
  ResumeRecord,
  SavedSearch,
  ScoredJob,
  SearchCriteria,
  SearchIntent,
  SearchRunResult,
  SearchStats,
  SemanticStatus,
  TelegramStatus,
  VerificationStatus
} from './types'

/** Every renderer -> main request: channel -> [payload, result]. */
export interface IpcContract {
  'app:info': [void, AppInfo]
  'dashboard:stats': [void, DashboardStats]
  'settings:get': [void, AppSettings]
  'settings:update': [Partial<AppSettings>, AppSettings]

  'profile:get': [
    void,
    { profile: CandidateProfile; resumes: ResumeRecord[]; needsConfirmation: string[] }
  ]
  'profile:save': [CandidateProfile, CandidateProfile]
  'profile:pick-resume': [void, ResumeParseResult | null]
  'profile:import-resume': [{ path: string }, ResumeParseResult]
  'profile:import-resume-data': [{ fileName: string; base64: string }, ResumeParseResult]
  'profile:set-default-resume': [{ id: string }, ResumeRecord[]]
  'profile:rename-resume': [{ id: string; label: string }, ResumeRecord[]]
  'profile:delete-resume': [{ id: string }, ResumeRecord[]]
  'profile:export': [void, string | null]
  'profile:delete-all': [void, boolean]

  'criteria:get': [void, { criteria: SearchCriteria; intent: SearchIntent; label: string }]
  'criteria:save': [SearchCriteria, { criteria: SearchCriteria; counters: JobCounters }]
  'jobs:counters': [void, JobCounters]
  'criteria:occupations': [void, { id: string; label: string; family: string }[]]

  'search:run': [SearchCriteria, SearchRunResult]
  'search:cancel': [{ runId: string }, boolean]
  'search:parse': [SearchCriteria, SearchIntent]
  'search:last': [
    void,
    {
      criteria: SearchCriteria
      intent: SearchIntent
      stats: SearchStats
      jobs: ScoredJob[]
      finishedAt: string
    } | null
  ]
  'search:manual-links': [SearchCriteria, { providerId: string; name: string; url: string }[]]
  'geo:suggest': [{ text: string }, { label: string; country: string }[]]
  'geo:countries': [void, { code: string; name: string }[]]

  'jobs:list': [
    {
      view?:
        | 'all'
        | 'eligible'
        | 'review'
        | 'excluded'
        | 'archive'
        | 'saved'
        | 'dismissed'
        | 'new'
        | 'applied'
      runId?: string
      reason?: ExclusionReason
      minScore?: number
      verification?: VerificationStatus[]
      limit?: number
      offset?: number
    },
    ScoredJob[]
  ]
  'jobs:get': [{ id: string }, ScoredJob | null]
  'jobs:save': [{ id: string; saved: boolean }, ScoredJob | null]
  'jobs:dismiss': [{ id: string; dismissed: boolean }, ScoredJob | null]
  'jobs:verify': [{ id: string }, ScoredJob | null]
  'jobs:open-external': [{ url: string }, boolean]

  'applications:list': [{ states?: ApplicationState[] }, ApplicationRecord[]]
  'applications:events': [{ id: string }, ApplicationEvent[]]
  'applications:start': [{ jobId: string; resumeId?: string }, ApplicationRecord]
  'applications:rescan': [{ id: string }, ApplicationRecord]
  'applications:advance': [{ id: string }, ApplicationRecord]
  'applications:approve': [{ id: string }, ApplicationRecord]
  'applications:check': [
    { id: string },
    { app: ApplicationRecord; confirmed: boolean; message: string }
  ]
  'applications:report-manual': [{ id: string; note?: string }, ApplicationRecord]
  'applications:reopen': [{ id: string }, ApplicationRecord]
  'applications:cancel': [{ id: string }, ApplicationRecord]

  'searches:list': [void, SavedSearch[]]
  'searches:save': [
    {
      id?: string
      name: string
      criteria: SearchCriteria
      enabled: boolean
      intervalMinutes: number
      notify: boolean
      minScoreToNotify: number
    },
    SavedSearch
  ]
  'searches:delete': [{ id: string }, boolean]
  'searches:set-enabled': [{ id: string; enabled: boolean }, SavedSearch | null]
  'searches:run-now': [
    { id: string },
    { resultCount: number; newCount: number; notified: number } | null
  ]
  'searches:cancel': [{ id: string }, boolean]
  'searches:runs': [
    void,
    {
      id: string
      searchId?: string
      trigger: string
      startedAt: string
      finishedAt?: string
      status: string
      stats?: SearchStats
      error?: string
    }[]
  ]

  'sources:list': [void, ProviderInfo[]]
  'sources:set-enabled': [{ id: string; enabled: boolean }, ProviderInfo[]]
  'sources:set-credentials': [
    { providerId: string; values: Record<string, string> },
    ProviderInfo[]
  ]
  'sources:clear-credentials': [{ providerId: string }, ProviderInfo[]]

  'employers:list': [void, EmployerRecord[]]
  'employers:add-url': [{ url: string; name?: string; country?: string }, EmployerRecord[]]
  'employers:add-board': [
    { provider: Exclude<AtsProvider, 'jsonld'>; boardId: string; name?: string; country?: string },
    EmployerRecord
  ]
  'employers:remove': [{ id: string }, EmployerRecord[]]
  'employers:discover': [
    SearchCriteria,
    {
      provider: Exclude<AtsProvider, 'jsonld'>
      boardId: string
      name?: string
      jobCount?: number
      exampleUrl?: string
      alreadyRegistered: boolean
    }[]
  ]

  'telegram:status': [void, TelegramStatus]
  'telegram:set-token': [{ token: string }, TelegramStatus]
  'telegram:start': [void, TelegramStatus]
  'telegram:stop': [void, TelegramStatus]
  'telegram:authorize': [{ chatId: string }, TelegramStatus]
  'telegram:revoke': [{ chatId: string }, TelegramStatus]
  'telegram:test': [void, boolean]
  'telegram:clear-webhook': [void, TelegramStatus]

  'matching:status': [void, SemanticStatus]
  'demo:seed': [void, ScoredJob[]]
}

export type IpcChannel = keyof IpcContract
export type IpcPayload<C extends IpcChannel> = IpcContract[C][0]
export type IpcResultData<C extends IpcChannel> = IpcContract[C][1]

export type IpcEnvelope<T> = { ok: true; data: T } | { ok: false; error: string }

/** main -> renderer push events. */
export interface IpcEvents {
  'search:progress': import('./types').SearchProgress
  'applications:updated': ApplicationRecord
  'telegram:status': TelegramStatus
  'scheduler:updated': null
  'jobs:changed': null
}
export type IpcEvent = keyof IpcEvents

export const EVENT_CHANNELS: IpcEvent[] = [
  'search:progress',
  'applications:updated',
  'telegram:status',
  'scheduler:updated',
  'jobs:changed'
]

export const INVOKE_CHANNELS: IpcChannel[] = [
  'app:info',
  'dashboard:stats',
  'settings:get',
  'settings:update',
  'profile:get',
  'profile:save',
  'profile:pick-resume',
  'profile:import-resume',
  'profile:import-resume-data',
  'profile:set-default-resume',
  'profile:rename-resume',
  'profile:delete-resume',
  'profile:export',
  'profile:delete-all',
  'criteria:get',
  'criteria:save',
  'jobs:counters',
  'criteria:occupations',
  'search:run',
  'search:cancel',
  'search:parse',
  'search:last',
  'search:manual-links',
  'geo:suggest',
  'geo:countries',
  'jobs:list',
  'jobs:get',
  'jobs:save',
  'jobs:dismiss',
  'jobs:verify',
  'jobs:open-external',
  'applications:list',
  'applications:events',
  'applications:start',
  'applications:rescan',
  'applications:advance',
  'applications:approve',
  'applications:check',
  'applications:report-manual',
  'applications:reopen',
  'applications:cancel',
  'searches:list',
  'searches:save',
  'searches:delete',
  'searches:set-enabled',
  'searches:run-now',
  'searches:cancel',
  'searches:runs',
  'sources:list',
  'sources:set-enabled',
  'sources:set-credentials',
  'sources:clear-credentials',
  'employers:list',
  'employers:add-url',
  'employers:add-board',
  'employers:remove',
  'employers:discover',
  'telegram:status',
  'telegram:set-token',
  'telegram:start',
  'telegram:stop',
  'telegram:authorize',
  'telegram:revoke',
  'telegram:test',
  'telegram:clear-webhook',
  'matching:status',
  'demo:seed'
]
