import fs from 'fs'
import { z } from 'zod'
import { createHash } from 'crypto'
import type { IpcChannel, IpcPayload, IpcResultData } from '../../shared/ipc'
import type { AppInfo, CandidateProfile, NormalizedJob, ScoredJob } from '../../shared/types'
import type { Services } from '../app/services'
import { ResumeService } from '../services/resume/resumeService'
import { buildIntent } from '../services/jobs/search/intent'
import { allCountries } from '../services/jobs/geo/regions'
import { isPublicHttpUrl } from '../services/jobs/verification/urlSafety'
import { checkAvailability } from '../services/jobs/verification/availability'
import { providerById } from '../services/jobs/providers'
import { OCCUPATION_BY_ID } from '../services/jobs/search/taxonomy'
import { roleSkillHints } from '../services/resume/resumeAgent'
import type { ResumeDocument } from '../../shared/resume'
import { lastMigrationReport } from '../services/persistence/legacyImport'
import { normalizeDraft } from '../services/jobs/normalization/normalize'

/** Electron-specific operations the handlers need (injected so handlers are testable). */
export interface HostBridge {
  pickResumeFile(): Promise<string | null>
  saveJsonFile(defaultName: string, content: string): Promise<string | null>
  /** Save dialog for a PDF; resolves to the chosen absolute path or null when cancelled. */
  savePdfPath?(defaultName: string): Promise<string | null>
  openPath?(file: string): Promise<void>
  showInFolder?(file: string): Promise<void>
  /** Opens the Browse & Save window (Electron only). */
  openJobBrowser?(url: string): void
  confirm(message: string, detail: string, confirmLabel?: string): Promise<boolean>
  openExternal(url: string): Promise<void>
  appInfo(): Omit<AppInfo, 'migration' | 'demoMode' | 'dbPath' | 'userDataPath' | 'secureStorage'>
}

// ---------------------------------------------------------------------------
// Schemas (renderer input is untrusted)
// ---------------------------------------------------------------------------

const id = z.string().min(1).max(200)
const workMode = z.enum(['onsite', 'hybrid', 'remote'])
const employmentType = z.enum([
  'full_time',
  'part_time',
  'contract',
  'temporary',
  'internship',
  'seasonal',
  'per_diem',
  'volunteer'
])
const seniority = z.enum([
  'entry',
  'junior',
  'mid',
  'senior',
  'lead',
  'manager',
  'director',
  'executive'
])
const salaryPeriod = z.enum(['hour', 'day', 'week', 'month', 'year'])
const appState = z.enum([
  'DISCOVERED',
  'SAVED',
  'QUEUED',
  'OPENING',
  'AUTOFILLING',
  'NEEDS_USER_INPUT',
  'READY_FOR_REVIEW',
  'APPROVED',
  'SUBMITTING',
  'SUBMITTED',
  'SUBMISSION_UNVERIFIED',
  'FAILED',
  'CANCELLED',
  'MANUAL_COMPLETION_REQUIRED'
])
const verification = z.enum([
  'SOURCE_CONFIRMED',
  'EMPLOYER_CONFIRMED',
  'UNVERIFIED',
  'STALE',
  'EXPIRED',
  'REMOVED',
  'VERIFICATION_FAILED'
])

export const SearchCriteriaSchema = z.object({
  query: z.string().max(300),
  location: z.string().max(200).optional(),
  radius: z.number().positive().max(500).optional(),
  radiusUnit: z.enum(['mi', 'km']).optional(),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  workModes: z.array(workMode).max(3).optional(),
  employmentTypes: z.array(employmentType).max(8).optional(),
  seniority: z.array(seniority).max(8).optional(),
  minSalary: z.number().positive().max(10_000_000).optional(),
  salaryCurrency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  salaryPeriod: salaryPeriod.optional(),
  postedWithinDays: z.number().int().positive().max(365).optional(),
  providerIds: z.array(z.string().max(50)).max(50).optional(),
  includeUnknownLocations: z.boolean().optional(),
  excludedKeywords: z.array(z.string().max(60)).max(20).optional(),
  excludedCompanies: z.array(z.string().max(120)).max(50).optional(),
  targetOccupations: z.array(z.string().max(60)).max(20).optional(),
  excludedOccupations: z.array(z.string().max(60)).max(30).optional(),
  occupationMatch: z.enum(['exact', 'related']).optional(),
  locationMode: z.enum(['strict', 'preferred']).optional(),
  minimumMatchScore: z.number().int().min(0).max(100).optional(),
  requiredSkills: z.array(z.string().min(1).max(60)).max(20).optional(),
  preferredSkills: z.array(z.string().min(1).max(60)).max(30).optional()
})

const exclusionReason = z.enum([
  'irrelevant_occupation',
  'excluded_occupation',
  'outside_radius',
  'outside_country',
  'remote_not_requested',
  'remote_ineligible',
  'onsite_not_requested',
  'unknown_location',
  'salary_below_minimum',
  'employment_type',
  'seniority',
  'too_old',
  'excluded_keyword',
  'excluded_company',
  'malformed',
  'expired',
  'work_mode',
  'missing_required_skill',
  'below_minimum_score'
])

const field = z.object({
  value: z.string().max(300),
  confidence: z.number().min(0).max(1),
  source: z.enum(['resume', 'user']),
  confirmed: z.boolean()
})
const yesNo = z.enum(['yes', 'no', 'unset'])
const httpOrEmpty = z
  .string()
  .max(500)
  .refine((u) => u === '' || isPublicHttpUrl(u), 'Must be an http(s) URL')

export const ProfileSchema = z.object({
  fullName: field,
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  email: field,
  phone: field,
  location: field,
  linkedinUrl: httpOrEmpty,
  githubUrl: httpOrEmpty,
  portfolioUrl: httpOrEmpty,
  headline: z.string().max(200).optional(),
  summary: z.string().max(3000).optional(),
  skills: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        canonicalId: z.string().max(60).optional(),
        source: z.enum(['resume', 'user']),
        confirmed: z.boolean()
      })
    )
    .max(300),
  certifications: z
    .array(
      z.object({
        name: z.string().min(1).max(150),
        source: z.enum(['resume', 'user']),
        confirmed: z.boolean()
      })
    )
    .max(100),
  workHistory: z
    .array(
      z.object({
        id,
        title: z.string().max(150),
        company: z.string().max(150),
        location: z.string().max(150).optional(),
        startDate: z
          .string()
          .regex(/^\d{4}-\d{2}$/)
          .optional(),
        endDate: z
          .string()
          .regex(/^\d{4}-\d{2}$/)
          .optional(),
        current: z.boolean(),
        months: z.number().int().min(0).max(1000).optional(),
        summary: z.string().max(3000).optional(),
        confidence: z.number().min(0).max(1),
        confirmed: z.boolean()
      })
    )
    .max(50),
  education: z
    .array(
      z.object({
        id,
        institution: z.string().max(200),
        degree: z.string().max(200).optional(),
        field: z.string().max(200).optional(),
        graduationYear: z.string().max(10).optional(),
        confidence: z.number().min(0).max(1),
        confirmed: z.boolean()
      })
    )
    .max(20),
  totalExperienceMonths: z.number().int().min(0).max(1200).optional(),
  preferences: z.object({
    targetRoles: z.array(z.string().max(100)).max(20),
    targetOccupations: z.array(z.string().max(60)).max(20),
    location: z.string().max(200).optional(),
    radius: z.number().positive().max(500).optional(),
    radiusUnit: z.enum(['mi', 'km']),
    workModes: z.array(workMode).max(3),
    employmentTypes: z.array(employmentType).max(8),
    minSalary: z.number().positive().max(10_000_000).optional(),
    salaryCurrency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    salaryPeriod: salaryPeriod.optional(),
    excludedOccupations: z.array(z.string().max(60)).max(30)
  }),
  customAnswers: z
    .array(
      z.object({
        id,
        question: z.string().max(200),
        answer: z.string().max(2000),
        approved: z.boolean()
      })
    )
    .max(100),
  sensitive: z.object({
    authorizedToWork: z.record(z.string().regex(/^[A-Z]{2}$/), yesNo),
    requiresSponsorship: yesNo,
    allowAutofill: z.object({ workAuthorization: z.boolean(), sponsorship: z.boolean() })
  }),
  updatedAt: z.string().max(40)
})

const ym = z
  .string()
  .regex(/^\d{4}-\d{2}$/)
  .optional()
const line = z.string().max(600)
const short = z.string().max(200)
const ResumeDocSchema = z.object({
  id,
  name: z.string().min(1).max(120),
  template: z.enum(['classic', 'modern', 'technical']),
  pageSize: z.enum(['letter', 'a4']),
  contact: z.object({
    fullName: short,
    email: short,
    phone: z.string().max(60),
    location: short,
    linkedin: z.string().max(300),
    website: z.string().max(300)
  }),
  headline: short.optional(),
  summary: z.string().max(2000).optional(),
  experience: z
    .array(
      z.object({
        id,
        title: short,
        company: short,
        location: short.optional(),
        startDate: ym,
        endDate: ym,
        current: z.boolean(),
        bullets: z.array(line).max(20)
      })
    )
    .max(30),
  education: z
    .array(
      z.object({
        id,
        institution: short,
        degree: short.optional(),
        field: short.optional(),
        location: short.optional(),
        graduationDate: z.string().max(20).optional(),
        details: z.string().max(600).optional()
      })
    )
    .max(15),
  skills: z.array(z.string().max(80)).max(120),
  certifications: z
    .array(
      z.object({
        id,
        name: short,
        issuer: short.optional(),
        date: z.string().max(20).optional()
      })
    )
    .max(40),
  projects: z
    .array(
      z.object({
        id,
        name: short,
        link: z.string().max(300).optional(),
        bullets: z.array(line).max(10)
      })
    )
    .max(20),
  sectionOrder: z
    .array(z.enum(['summary', 'experience', 'skills', 'education', 'certifications', 'projects']))
    .max(6),
  targetRole: short.optional(),
  origin: z.enum(['imported', 'created']),
  sourceResumeId: id.optional(),
  version: z.number().int().min(0),
  isMaster: z.boolean(),
  createdAt: z.string().max(40),
  updatedAt: z.string().max(40)
})
const SuggestionSchema = z.object({
  id: z.string().max(200),
  kind: z.enum([
    'missing_contact',
    'missing_summary',
    'weak_verb',
    'first_person',
    'long_bullet',
    'no_bullets',
    'add_quantity',
    'skill_in_text',
    'target_keyword',
    'duplicate_skill',
    'date_missing',
    'too_long',
    'rewrite'
  ]),
  path: z.string().max(100),
  section: z.enum([
    'summary',
    'experience',
    'skills',
    'education',
    'certifications',
    'projects',
    'contact'
  ]),
  message: z.string().max(1000),
  before: z.string().max(2000).optional(),
  after: z.string().max(2000).optional(),
  requiresConfirmation: z.boolean(),
  source: z.enum(['rules', 'ollama'])
})
const QuestionnaireSchema = z.object({
  contact: ResumeDocSchema.shape.contact,
  targetRole: short,
  experience: z
    .array(
      z.object({
        title: short,
        company: short,
        location: short.optional(),
        startDate: ym,
        endDate: ym,
        current: z.boolean(),
        duties: z.string().max(4000)
      })
    )
    .max(20),
  education: z
    .array(
      z.object({
        institution: short,
        degree: short.optional(),
        field: short.optional(),
        graduationDate: z.string().max(20).optional()
      })
    )
    .max(10),
  skills: z.array(z.string().max(80)).max(120),
  certifications: z
    .array(z.object({ name: short, issuer: short.optional(), date: z.string().max(20).optional() }))
    .max(30),
  template: z.enum(['classic', 'modern', 'technical']),
  pageSize: z.enum(['letter', 'a4'])
})

const SettingsPatch = z
  .object({
    demoMode: z.boolean(),
    onlineGeocoding: z.boolean(),
    ollama: z
      .object({
        enabled: z.boolean(),
        baseUrl: z
          .string()
          .url()
          .max(200)
          .refine(
            (u) => /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\/?$/.test(u),
            'Ollama must run on this computer (localhost)'
          ),
        model: z.string().min(1).max(100),
        generateModel: z.string().max(100).optional()
      })
      .partial(),
    browser: z.object({
      executablePath: z.string().max(500).optional(),
      channel: z.enum(['chromium', 'chrome', 'msedge']).optional()
    }),
    matching: z
      .object({
        weights: z.record(z.string(), z.number().min(0).max(100)),
        strongThreshold: z.number().min(40).max(100)
      })
      .partial(),
    staleAfterDays: z.number().int().min(1).max(365),
    contactEmailForApis: z.string().email().max(200).optional()
  })
  .partial()

const schemas: { [C in IpcChannel]: z.ZodType<IpcPayload<C>> } = {
  'app:info': z.undefined(),
  'dashboard:stats': z.undefined(),
  'settings:get': z.undefined(),
  'settings:update': SettingsPatch as never,
  'profile:get': z.undefined(),
  'profile:save': ProfileSchema as never,
  'profile:pick-resume': z.undefined(),
  'profile:import-resume': z.object({ path: z.string().min(1).max(1000) }),
  'profile:import-resume-data': z.object({
    fileName: z.string().min(1).max(200),
    base64: z.string().min(1).max(22_000_000)
  }),
  'profile:set-default-resume': z.object({ id }),
  'profile:rename-resume': z.object({ id, label: z.string().min(1).max(80) }),
  'profile:delete-resume': z.object({ id }),
  'profile:export': z.undefined(),
  'profile:delete-all': z.undefined(),
  'criteria:get': z.undefined(),
  'criteria:save': SearchCriteriaSchema as never,
  'jobs:counters': z.undefined(),
  'criteria:occupations': z.undefined(),
  'criteria:from-resume': z.undefined(),
  'search:run': SearchCriteriaSchema as never,
  'search:cancel': z.object({ runId: id }),
  'search:parse': SearchCriteriaSchema as never,
  'search:last': z.undefined(),
  'search:manual-links': SearchCriteriaSchema as never,
  'geo:suggest': z.object({ text: z.string().max(100) }),
  'geo:countries': z.undefined(),
  'jobs:list': z.object({
    view: z
      .enum([
        'all',
        'eligible',
        'review',
        'excluded',
        'archive',
        'saved',
        'dismissed',
        'new',
        'applied'
      ])
      .optional(),
    runId: id.optional(),
    reason: exclusionReason.optional(),
    minScore: z.number().min(0).max(100).optional(),
    verification: z.array(verification).optional(),
    limit: z.number().int().min(1).max(2000).optional(),
    offset: z.number().int().min(0).optional()
  }),
  'jobs:get': z.object({ id }),
  'jobs:save': z.object({ id, saved: z.boolean() }),
  'jobs:dismiss': z.object({ id, dismissed: z.boolean() }),
  'jobs:verify': z.object({ id }),
  'jobs:open-external': z.object({ url: z.string().max(2048) }),
  'jobs:import-url': z.object({ url: z.string().min(4).max(2048) }),
  'jobs:import-manual': z.object({
    title: z.string().trim().min(2).max(300),
    company: z.string().trim().min(1).max(200),
    location: z.string().max(300),
    url: z.string().min(4).max(2048),
    description: z.string().max(50_000).optional(),
    salary: z.string().max(200).optional(),
    employmentType: z.string().max(60).optional(),
    workMode: z.enum(['onsite', 'hybrid', 'remote']).optional()
  }),
  'jobs:inbox-status': z.undefined(),
  'jobs:inbox-scan': z.undefined(),
  'jobs:inbox-open': z.undefined(),
  'jobs:browse': z.object({
    providerId: z.string().max(50).optional(),
    url: z.string().max(2048).optional()
  }),
  'applications:list': z.object({ states: z.array(appState).optional() }),
  'applications:events': z.object({ id }),
  'applications:start': z.object({ jobId: id, resumeId: id.optional() }),
  'applications:rescan': z.object({ id }),
  'applications:advance': z.object({ id }),
  'applications:approve': z.object({ id }),
  'applications:check': z.object({ id }),
  'applications:report-manual': z.object({ id, note: z.string().max(300).optional() }),
  'applications:reopen': z.object({ id }),
  'applications:cancel': z.object({ id }),
  'searches:list': z.undefined(),
  'searches:save': z.object({
    id: id.optional(),
    name: z.string().min(1).max(100),
    criteria: SearchCriteriaSchema,
    enabled: z.boolean(),
    intervalMinutes: z.number().int().min(15).max(10080),
    notify: z.boolean(),
    minScoreToNotify: z.number().int().min(0).max(100)
  }) as never,
  'searches:delete': z.object({ id }),
  'searches:set-enabled': z.object({ id, enabled: z.boolean() }),
  'searches:run-now': z.object({ id }),
  'searches:cancel': z.object({ id }),
  'searches:runs': z.undefined(),
  'sources:list': z.undefined(),
  'sources:set-enabled': z.object({ id: z.string().max(50), enabled: z.boolean() }),
  'sources:set-credentials': z.object({
    providerId: z.string().max(50),
    values: z.record(z.string().max(80), z.string().max(2000))
  }),
  'sources:clear-credentials': z.object({ providerId: z.string().max(50) }),
  'sources:test': z.object({ providerId: z.string().max(50) }),
  'employers:list': z.undefined(),
  'employers:add-url': z.object({
    url: z.string().min(4).max(2048),
    name: z.string().max(120).optional(),
    country: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional()
  }),
  'employers:add-board': z.object({
    provider: z.enum(['greenhouse', 'lever', 'ashby', 'smartrecruiters']),
    boardId: z.string().min(1).max(100),
    name: z.string().max(120).optional(),
    country: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional()
  }),
  'employers:remove': z.object({ id }),
  'employers:discover': SearchCriteriaSchema as never,
  'telegram:status': z.undefined(),
  'telegram:set-token': z.object({ token: z.string().max(200) }),
  'telegram:start': z.undefined(),
  'telegram:stop': z.undefined(),
  'telegram:authorize': z.object({ chatId: z.string().regex(/^-?\d{1,20}$/) }),
  'telegram:revoke': z.object({ chatId: z.string().regex(/^-?\d{1,20}$/) }),
  'telegram:test': z.undefined(),
  'telegram:clear-webhook': z.undefined(),
  'resume:list': z.undefined(),
  'resume:get': z.object({ id }),
  'resume:save': z.object({ doc: ResumeDocSchema, note: z.string().max(200).optional() }) as never,
  'resume:delete': z.object({ id }),
  'resume:versions': z.object({ id }),
  'resume:version': z.object({ id, version: z.number().int().min(1) }),
  'resume:import': z.object({ resumeId: id.optional() }),
  'resume:create': QuestionnaireSchema as never,
  'resume:role-skills': z.object({ role: z.string().max(120) }),
  'resume:analyze': z.object({
    doc: ResumeDocSchema,
    targetRole: z.string().max(120).optional(),
    jobId: id.optional(),
    useAi: z.boolean().optional()
  }) as never,
  'resume:apply': z.object({
    doc: ResumeDocSchema,
    suggestion: SuggestionSchema,
    edited: z.string().max(2000).optional()
  }) as never,
  'resume:export-pdf': z.object({ doc: ResumeDocSchema }) as never,
  'resume:open-pdf': z.object({
    path: z.string().min(1).max(1000),
    reveal: z.boolean().optional()
  }),
  'resume:set-master': z.object({ id }),
  'matching:status': z.undefined(),
  'demo:seed': z.undefined()
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

type Handlers = { [C in IpcChannel]: (payload: IpcPayload<C>) => Promise<IpcResultData<C>> }

function stripScore(job: ScoredJob): NormalizedJob {
  const { match: _m, relevance: _r, geo: _g, state: _s, isNew: _n, eligibility: _e, ...base } = job
  void _e
  void _m
  void _r
  void _g
  void _s
  void _n
  return base
}

export function createHandlers(
  svc: Services,
  host: HostBridge,
  emit: (channel: string, payload: unknown) => void
): Handlers {
  const { store } = svc
  const jobsChanged = (): void => emit('jobs:changed', null)

  return {
    'app:info': async () => ({
      ...host.appInfo(),
      userDataPath: svc.paths.userData,
      dbPath: svc.paths.db,
      migration: lastMigrationReport(store),
      secureStorage: store.secrets.level,
      demoMode: store.settings.get().demoMode
    }),
    'dashboard:stats': () => svc.dashboard(),
    'settings:get': async () => store.settings.get(),
    'settings:update': async (patch) => {
      const next = store.settings.update(patch)
      if (patch.ollama) await svc.matching.embeddings.checkStatus(true)
      return next
    },

    'profile:get': async () => {
      const profile = store.candidate.get()
      return {
        profile,
        resumes: store.candidate.resumes(),
        needsConfirmation: ResumeService.needsConfirmation(profile)
      }
    },
    'profile:save': async (p) => {
      const saved = store.candidate.save(p as CandidateProfile)
      void svc.criteria.profileChanged()
      return saved
    },
    'profile:pick-resume': async () => {
      const file = await host.pickResumeFile()
      if (!file) return null
      const res = await svc.resumes.importFile(file)
      void svc.criteria.profileChanged()
      return res
    },
    'profile:import-resume': async ({ path }) => {
      const res = await svc.resumes.importFile(path)
      void svc.criteria.profileChanged()
      return res
    },
    'profile:import-resume-data': async ({ fileName, base64 }) => {
      const res = await svc.resumes.importBuffer(fileName, Buffer.from(base64, 'base64'))
      void svc.criteria.profileChanged()
      return res
    },
    'profile:set-default-resume': async ({ id }) => {
      store.candidate.setDefaultResume(id)
      void svc.criteria.profileChanged()
      return store.candidate.resumes()
    },
    'profile:rename-resume': async ({ id, label }) => {
      store.candidate.renameResume(id, label)
      return store.candidate.resumes()
    },
    'profile:delete-resume': async ({ id }) => {
      svc.resumes.deleteResume(id)
      return store.candidate.resumes()
    },
    'profile:export': async () =>
      host.saveJsonFile(
        'pulseapply-profile.json',
        JSON.stringify(svc.resumes.exportProfile(), null, 2)
      ),
    'profile:delete-all': async () => {
      const ok = await host.confirm(
        'Delete your profile and all stored resumes?',
        'Application history, saved searches and jobs are kept. This cannot be undone.'
      )
      if (ok) svc.resumes.deleteAll()
      return ok
    },

    'criteria:get': async () => {
      const ctx = await svc.criteria.context()
      return { criteria: svc.criteria.getActive(), intent: ctx.intent, label: ctx.label }
    },
    'criteria:save': async (criteria) => {
      const res = await svc.criteria.setActive(criteria)
      jobsChanged()
      return res
    },
    'jobs:counters': () => svc.criteria.counters(),
    'criteria:from-resume': async () => svc.criteria.fromResume(),
    'criteria:occupations': async () =>
      [...OCCUPATION_BY_ID.values()]
        .map((o) => ({ id: o.id, label: o.label, family: o.family }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    // A manual search always runs the saved, authoritative criteria.
    'search:run': async (criteria) => {
      const { criteria: active } = await svc.criteria.setActive(criteria)
      const res = await svc.search.run(
        { ...active, providerIds: criteria.providerIds },
        {
          trigger: 'manual',
          onProgress: (p) => emit('search:progress', p)
        }
      )
      jobsChanged()
      return res
    },
    'search:cancel': async ({ runId }) => svc.search.cancel(runId),
    'search:parse': async (criteria) => {
      const p = store.candidate.get()
      return buildIntent(criteria, {
        location: p.preferences.location || p.location.value || undefined,
        radius: p.preferences.radius,
        radiusUnit: p.preferences.radiusUnit
      })
    },
    'search:last': async () => {
      const last = svc.search.lastSearch()
      if (!last) return null
      // Only jobs that still meet the (possibly edited) active criteria.
      const jobs = store.jobs.list({ ids: last.jobIds, view: 'eligible', limit: 2000 })
      const order = new Map(last.jobIds.map((jid, i) => [jid, i]))
      jobs.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
      return {
        criteria: last.criteria,
        intent: last.intent,
        stats: last.stats,
        jobs,
        finishedAt: last.finishedAt
      }
    },
    'search:manual-links': async (criteria) => svc.search.manualLinks(criteria),
    'geo:suggest': async ({ text }) => svc.geo.suggest(text),
    'geo:countries': async () => allCountries(),

    'jobs:list': async (f) => {
      // Stored evaluations must match the active criteria before anything is listed.
      if (store.jobs.staleEvaluationCount(svc.criteria.activeKey()) > 0)
        await svc.criteria.recalculate()
      return store.jobs.list({
        ...f,
        limit: f.limit ?? 500,
        includeDemo: store.settings.get().demoMode
      })
    },
    'jobs:get': async ({ id }) => store.jobs.get(id) ?? null,
    'jobs:save': async ({ id, saved }) => {
      store.jobs.setSaved(id, saved)
      jobsChanged()
      return store.jobs.get(id) ?? null
    },
    'jobs:dismiss': async ({ id, dismissed }) => {
      store.jobs.setDismissed(id, dismissed)
      jobsChanged()
      return store.jobs.get(id) ?? null
    },
    'jobs:verify': async ({ id }) => {
      const job = store.jobs.get(id)
      if (!job) return null
      const res = await checkAvailability(svc.http, stripScore(job))
      store.jobs.setVerification(
        id,
        res.status,
        res.redirectWarning ? `${res.note} ${res.redirectWarning}` : res.note
      )
      jobsChanged()
      return store.jobs.get(id) ?? null
    },
    'jobs:open-external': async ({ url }) => {
      if (!isPublicHttpUrl(url)) throw new Error('Only public http(s) links can be opened')
      await host.openExternal(url)
      return true
    },

    'jobs:import-url': async ({ url }) => {
      const res = await svc.imports.importUrl(url)
      jobsChanged()
      return res
    },
    'jobs:import-manual': async (input) => {
      const res = await svc.imports.importManual({ ...input, location: input.location ?? '' })
      jobsChanged()
      return res
    },
    'jobs:browse': async ({ providerId, url }) => {
      if (!host.openJobBrowser)
        throw new Error('Browse & Save is only available in the desktop app')
      let target = url
      if (providerId) {
        const c = svc.criteria.getActive()
        const occ = (c.targetOccupations ?? [])
          .map((o) => OCCUPATION_BY_ID.get(o)?.label)
          .filter(Boolean)[0]
        const ctx = await svc.criteria.context()
        const location =
          c.location || ctx.intent.location?.label || ctx.intent.locationText || undefined
        target = svc.search
          .manualLinks({ ...c, query: c.query || occ || '', location })
          .find((l) => l.providerId === providerId)?.url
      }
      if (!target || !isPublicHttpUrl(target)) throw new Error('Nothing to open')
      host.openJobBrowser(target)
      return true
    },
    'jobs:inbox-status': async () => svc.imports.status(),
    'jobs:inbox-scan': async () => {
      await svc.imports.scanInbox()
      jobsChanged()
      return svc.imports.status()
    },
    'jobs:inbox-open': async () => {
      const dir = svc.imports.status().path
      fs.mkdirSync(dir, { recursive: true })
      await host.openPath?.(dir)
      return true
    },

    'applications:list': async ({ states }) => store.applications.list(states),
    'applications:events': async ({ id }) => store.applications.events(id),
    'applications:start': ({ jobId, resumeId }) =>
      svc.applications.start(jobId, { resumeId, origin: 'desktop' }),
    'applications:rescan': ({ id }) => svc.applications.rescan(id),
    'applications:advance': ({ id }) => svc.applications.advance(id),
    'applications:approve': ({ id }) => svc.applications.approveAndSubmit(id),
    'applications:check': ({ id }) => svc.applications.checkConfirmation(id),
    'applications:report-manual': ({ id, note }) =>
      svc.applications.reportManualSubmission(id, note),
    'applications:reopen': ({ id }) => svc.applications.reopen(id),
    'applications:cancel': ({ id }) => svc.applications.cancel(id),

    'searches:list': async () =>
      store.searches
        .list()
        .map((s) => ({ ...s, running: s.running || svc.scheduler.isRunning(s.id) })),
    'searches:save': async (input) => store.searches.save(input),
    'searches:delete': async ({ id }) => {
      svc.scheduler.cancel(id)
      store.searches.delete(id)
      return true
    },
    'searches:set-enabled': async ({ id, enabled }) => {
      store.searches.setEnabled(id, enabled)
      return store.searches.get(id) ?? null
    },
    'searches:run-now': async ({ id }) => (await svc.scheduler.runNow(id)) ?? null,
    'searches:cancel': async ({ id }) => svc.scheduler.cancel(id),
    'searches:runs': async () => store.searches.recentRuns(),

    'sources:list': async () => svc.search.providerInfos(),
    'sources:set-enabled': async ({ id, enabled }) => {
      if (!providerById(id)) throw new Error('Unknown provider')
      store.providers.setEnabled(id, enabled)
      return svc.search.providerInfos()
    },
    'sources:set-credentials': async ({ providerId, values }) => {
      const p = providerById(providerId)
      if (!p) throw new Error('Unknown provider')
      for (const [key, value] of Object.entries(values)) {
        if (!p.credentials.some((c) => c.key === key)) throw new Error(`Unknown credential ${key}`)
        if (value.trim()) store.secrets.set(key, value)
      }
      return svc.search.providerInfos()
    },
    'sources:clear-credentials': async ({ providerId }) => {
      const p = providerById(providerId)
      if (!p) throw new Error('Unknown provider')
      for (const c of p.credentials) store.secrets.delete(c.key)
      return svc.search.providerInfos()
    },

    'sources:test': ({ providerId }) => svc.search.testProvider(providerId),

    'employers:list': async () => svc.employers.list(),
    'employers:add-url': async ({ url, name, country }) => {
      await svc.employers.addFromUrl(url, { name, country })
      return svc.employers.list()
    },
    'employers:add-board': (input) => svc.employers.addBoard(input),
    'employers:remove': async ({ id }) => {
      svc.employers.remove(id)
      return svc.employers.list()
    },
    'employers:discover': async (criteria) => {
      const p = store.candidate.get()
      const intent = buildIntent(criteria, {
        location: p.preferences.location || p.location.value || undefined
      })
      if (intent.locationText)
        intent.location = await svc.geo.resolveSearchLocation(intent.locationText)
      return svc.employers.discover(intent)
    },

    'telegram:status': async () => svc.telegram.status(),
    'telegram:set-token': ({ token }) => svc.telegram.setToken(token),
    'telegram:start': () => svc.telegram.start(),
    'telegram:stop': () => svc.telegram.stop(),
    'telegram:authorize': async ({ chatId }) => {
      store.telegram.authorize(chatId)
      return svc.telegram.status()
    },
    'telegram:revoke': async ({ chatId }) => {
      store.telegram.revoke(chatId)
      return svc.telegram.status()
    },
    'telegram:test': async () => {
      await svc.telegram.sendTest()
      return true
    },
    'telegram:clear-webhook': () => svc.telegram.clearWebhook(),

    'resume:list': async () => svc.resumeHelper.list(),
    'resume:get': async ({ id }) => svc.resumeHelper.get(id),
    'resume:save': async ({ doc, note }) => svc.resumeHelper.save(doc as ResumeDocument, note),
    'resume:delete': async ({ id }) => {
      store.resumeDocs.delete(id)
      return svc.resumeHelper.list()
    },
    'resume:versions': async ({ id }) => store.resumeDocs.versions(id),
    'resume:version': async ({ id, version }) => {
      const d = store.resumeDocs.version(id, version)
      if (!d) throw new Error('Version not found')
      return d
    },
    'resume:import': async ({ resumeId }) => svc.resumeHelper.importFromProfile(resumeId),
    'resume:create': async (a) => svc.resumeHelper.createFromAnswers(a),
    'resume:role-skills': async ({ role }) => roleSkillHints(role),
    'resume:analyze': ({ doc, targetRole, jobId, useAi }) =>
      svc.resumeHelper.analyze(doc as ResumeDocument, { targetRole, jobId, useAi }),
    'resume:apply': async ({ doc, suggestion, edited }) =>
      svc.resumeHelper.apply(doc as ResumeDocument, suggestion, edited),
    'resume:export-pdf': async ({ doc }) => {
      if (!host.savePdfPath) throw new Error('Saving files is not available here')
      const file = await host.savePdfPath(svc.resumeHelper.defaultFileName(doc as ResumeDocument))
      if (!file) return null
      const res = await svc.resumeHelper.exportPdf(doc as ResumeDocument, file)
      return { path: res.path, pages: res.pages, bytes: res.bytes }
    },
    'resume:open-pdf': async ({ path: file, reveal }) => {
      // Only files this session exported can be opened (no arbitrary paths from the renderer).
      if (!svc.resumeHelper.wasExported(file)) throw new Error('Unknown file')
      if (reveal) await host.showInFolder?.(file)
      else await host.openPath?.(file)
      return true
    },
    'resume:set-master': async ({ id }) => {
      const doc = svc.resumeHelper.get(id)
      const ok = await host.confirm(
        `Use “${doc.name}” as your master resume?`,
        'It becomes the resume attached to applications, and your profile’s experience, education, skills and contact details are replaced with its content. Stored jobs are re-scored. Earlier resumes stay available.',
        'Set as master'
      )
      if (!ok) return null
      const res = await svc.resumeHelper.setMaster(id)
      jobsChanged()
      return res
    },

    'matching:status': () => svc.matching.embeddings.checkStatus(true),
    'demo:seed': async () => {
      if (!store.settings.get().demoMode) throw new Error('Enable demo mode in Settings first')
      const now = new Date()
      const draft = {
        sourceJobId: 'demo-1',
        sourceUrl: 'https://example.com/pulseapply-demo-job',
        title: 'Warehouse Associate (DEMO)',
        company: 'Demo Employer — not real',
        descriptionText:
          'DEMO LISTING for practising the application workflow. This job does not exist.\nRequirements:\n• Order picking and packing\n• RF scanner experience',
        locationText: 'Los Angeles, CA',
        employerDirect: false
      }
      const res = normalizeDraft(draft, {
        providerId: 'demo',
        providerName: 'Demo mode',
        geo: svc.geo,
        now
      })
      if (!res.job) throw new Error(res.error)
      const job: ScoredJob = {
        ...res.job,
        id: 'demo-' + createHash('sha256').update('demo-1').digest('hex').slice(0, 12),
        isDemo: true,
        verificationStatus: 'UNVERIFIED',
        verificationNotes: ['DEMO job created locally for practice. It is not a real vacancy.'],
        geo: { eligibility: 'unknown', note: 'Demo' },
        relevance: { score: 1, basis: 'Demo' },
        state: { saved: false, dismissed: false }
      }
      store.jobs.upsertMany([job])
      jobsChanged()
      return store.jobs.list({ ids: [job.id], includeDemo: true })
    }
  }
}

export function validatePayload<C extends IpcChannel>(channel: C, payload: unknown): IpcPayload<C> {
  const schema = schemas[channel]
  if (!schema) throw new Error(`Unknown channel ${channel}`)
  const res = schema.safeParse(payload)
  if (!res.success)
    throw new Error(
      `Invalid request: ${res.error.issues.map((i) => `${i.path.join('.') || 'payload'} ${i.message}`).join('; ')}`
    )
  return res.data
}
