/**
 * Domain types shared by the main process, preload bridge and renderer.
 *
 * Conventions:
 * - Anything a provider did not state is `undefined`, never a guessed value.
 * - Values PulseApply derived itself (occupation, extracted skills, resolved
 *   coordinates, ...) are listed in `NormalizedJob.inferredFields` so the UI can
 *   distinguish them from source-confirmed data.
 */

// ---------------------------------------------------------------------------
// Geography
// ---------------------------------------------------------------------------

export interface GeoPoint {
  lat: number
  lon: number
}

export type DistanceUnit = 'mi' | 'km'

export type LocationResolution = 'source' | 'postal' | 'gazetteer' | 'geocoder' | 'unresolved'

export interface ResolvedPlace {
  label: string
  city?: string
  region?: string
  /** ISO 3166-1 alpha-2 */
  country?: string
  coordinates?: GeoPoint
  /** 'city' when the point is a city centroid, 'region'/'country' when only coarse. */
  precision: 'point' | 'postal' | 'city' | 'region' | 'country' | 'none'
  resolution: LocationResolution
  confidence: number
}

export type RemoteScopeKind = 'worldwide' | 'countries' | 'regions' | 'unspecified'

export interface RemoteEligibility {
  kind: RemoteScopeKind
  countries: string[]
  /** Named macro-regions, e.g. 'europe', 'americas', 'emea', 'apac', 'latam', 'north-america'. */
  regions: string[]
  raw?: string
}

export type WorkMode = 'onsite' | 'hybrid' | 'remote'

export type GeoEligibility =
  | 'within_radius'
  | 'outside_radius'
  | 'in_country'
  | 'outside_country'
  | 'remote_eligible'
  | 'remote_ineligible'
  | 'remote_unspecified'
  | 'unknown'

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export type EmploymentType =
  | 'full_time'
  | 'part_time'
  | 'contract'
  | 'temporary'
  | 'internship'
  | 'seasonal'
  | 'per_diem'
  | 'volunteer'

export type Seniority =
  'entry' | 'junior' | 'mid' | 'senior' | 'lead' | 'manager' | 'director' | 'executive'

export type SalaryPeriod = 'hour' | 'day' | 'week' | 'month' | 'year'

export interface Salary {
  min?: number
  max?: number
  currency?: string
  period?: SalaryPeriod
  raw?: string
}

export type VerificationStatus =
  | 'SOURCE_CONFIRMED'
  | 'EMPLOYER_CONFIRMED'
  | 'UNVERIFIED'
  | 'STALE'
  | 'EXPIRED'
  | 'REMOVED'
  | 'VERIFICATION_FAILED'

export type ApplicationSupport =
  'greenhouse' | 'lever' | 'ashby' | 'smartrecruiters' | 'generic' | 'manual'

export interface JobSourceRecord {
  providerId: string
  providerName: string
  sourceJobId: string
  sourceUrl: string
  applyUrl?: string
  fetchedAt: string
  /** true when the record came directly from the employer's own ATS board */
  employerDirect: boolean
}

export interface OccupationTag {
  id: string
  label: string
  confidence: number
  basis: 'title' | 'description' | 'none'
}

export interface NormalizedJob {
  /** Stable canonical id (deterministic from ATS identity or source identity). */
  id: string
  canonicalKey: string
  source: string
  sourceJobId: string
  sourceUrl: string
  canonicalJobUrl?: string
  applyUrl?: string

  title: string
  normalizedTitle: string
  company: string
  companyWebsite?: string

  /** Plain text only. Never HTML. Treated as untrusted data. */
  description: string
  responsibilities: string[]
  qualifications: string[]
  requiredSkills: string[]
  preferredSkills: string[]
  requiredCertifications: string[]
  minYearsExperience?: number

  employmentTypes: EmploymentType[]
  seniority?: Seniority
  workModes: WorkMode[]
  schedule: string[]

  locationText: string
  locations: ResolvedPlace[]
  remoteEligibility?: RemoteEligibility

  salary?: Salary
  /** e.g. Adzuna's `salary_is_predicted` — an estimate that must never be shown as advertised pay. */
  salaryEstimateDiscarded?: boolean

  postedAt?: string
  expiresAt?: string
  discoveredAt: string
  lastSeenAt: string
  lastVerifiedAt?: string

  verificationStatus: VerificationStatus
  verificationNotes: string[]
  scamSignals: string[]

  ats?: { provider: ApplicationSupport; board?: string; requisitionId?: string; postingId?: string }
  occupation?: OccupationTag
  inferredFields: string[]
  sources: JobSourceRecord[]
  applicationSupport: ApplicationSupport
  isDemo?: boolean
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * How the search location is applied.
 * - `strict` (default): jobs outside the radius/country are removed before scoring.
 * - `preferred`: jobs anywhere are kept, but nearby jobs rank higher; the job card
 *   says clearly when a job is outside the preferred area.
 */
export type LocationMode = 'strict' | 'preferred'

/**
 * The single authoritative description of what the user is looking for. The
 * same object drives manual searches, the Results page, saved/scheduled
 * searches, Telegram notifications, the application queue and dashboard
 * counters.
 */
export interface SearchCriteria {
  query: string
  /** Taxonomy occupation ids chosen explicitly (in addition to those read from `query`). */
  targetOccupations?: string[]
  /** Taxonomy occupation ids that must never appear. */
  excludedOccupations?: string[]
  /** 'related' (default) also accepts closely related occupations of the same family. */
  occupationMatch?: 'exact' | 'related'
  location?: string
  locationMode?: LocationMode
  radius?: number
  radiusUnit?: DistanceUnit
  country?: string
  workModes?: WorkMode[]
  employmentTypes?: EmploymentType[]
  seniority?: Seniority[]
  minSalary?: number
  salaryCurrency?: string
  salaryPeriod?: SalaryPeriod
  postedWithinDays?: number
  providerIds?: string[]
  /** @deprecated Jobs whose location cannot be verified always go to a separate review group. */
  includeUnknownLocations?: boolean
  excludedKeywords?: string[]
  excludedCompanies?: string[]
  /** Jobs scoring below this are listed as "below your minimum match score". */
  minimumMatchScore?: number
  /** Every term must appear in the job title or description. */
  requiredSkills?: string[]
  /** Terms that raise the match score when present. */
  preferredSkills?: string[]
}

export interface SearchIntent {
  rawQuery: string
  keywords: string[]
  normalizedOccupations: string[]
  occupationSynonyms: string[]
  excludedOccupations: string[]
  location?: ResolvedPlace
  locationText?: string
  radius?: number
  radiusUnit: DistanceUnit
  workModes: WorkMode[]
  employmentTypes: EmploymentType[]
  seniority: Seniority[]
  minimumSalary?: number
  currency?: string
  salaryPeriod?: SalaryPeriod
  schedule: string[]
  postedWithinDays?: number
  requiredQualifications: string[]
  nearMe: boolean
  excludedKeywords: string[]
  excludedCompanies: string[]
  includeUnknownLocations: boolean
  notes: string[]
}

export type ExclusionReason =
  | 'irrelevant_occupation'
  | 'excluded_occupation'
  | 'outside_radius'
  | 'outside_country'
  | 'remote_not_requested'
  | 'remote_ineligible'
  | 'onsite_not_requested'
  | 'unknown_location'
  | 'salary_below_minimum'
  | 'employment_type'
  | 'seniority'
  | 'too_old'
  | 'excluded_keyword'
  | 'excluded_company'
  | 'malformed'
  | 'expired'
  | 'work_mode'
  | 'missing_required_skill'
  | 'below_minimum_score'

export interface ProviderRunReport {
  providerId: string
  providerName: string
  status: 'ok' | 'cached' | 'skipped' | 'error' | 'cancelled'
  reason?: string
  fetched: number
  normalized: number
  rejected: number
  durationMs: number
}

export interface SearchStats {
  providers: ProviderRunReport[]
  fetched: number
  normalized: number
  rejectedMalformed: number
  excluded: Partial<Record<ExclusionReason, number>>
  duplicatesMerged: number
  returned: number
  newJobs: number
  /** Jobs whose location could not be verified (not counted in `returned`). */
  review?: number
  belowMinimumScore?: number
}

export type EligibilityStatus = 'eligible' | 'review' | 'excluded'

/** Result of the hard filters, evaluated before any scoring. */
export interface JobEligibility {
  status: EligibilityStatus
  eligible: boolean
  exclusionReasons: ExclusionReason[]
  /** Human-readable reason for the first exclusion / review. */
  summary: string
  locationStatus: 'match' | 'outside' | 'unverified' | 'not_applied' | 'outside_preferred'
  occupationStatus: 'match' | 'related' | 'unrelated' | 'excluded' | 'unknown'
  workModeStatus: 'match' | 'mismatch' | 'unknown'
  /** Facts the posting did not state (location, occupation, employment type, salary…). */
  missingData: string[]
  /** Hash of the criteria this was evaluated against. */
  criteriaKey: string
}

export interface ScoredJob extends NormalizedJob {
  eligibility?: JobEligibility
  match?: MatchResult
  geo: { eligibility: GeoEligibility; distance?: number; unit?: DistanceUnit; note?: string }
  relevance: { score: number; basis: string }
  state: JobUserState
  isNew?: boolean
}

export interface JobUserState {
  saved: boolean
  dismissed: boolean
  applicationId?: string
  applicationState?: ApplicationState
}

export interface SearchRunResult {
  runId: string
  intent: SearchIntent
  stats: SearchStats
  /** Eligible jobs only (after hard filters and the minimum score). */
  jobs: ScoredJob[]
  /** Jobs kept aside because their location could not be verified. */
  review: ScoredJob[]
  cancelled: boolean
  startedAt: string
  finishedAt: string
}

export type SearchPhase =
  | 'interpreting'
  | 'resolving_location'
  | 'searching_providers'
  | 'checking_employer_boards'
  | 'normalizing'
  | 'deduplicating'
  | 'matching'
  | 'verifying'
  | 'saving'
  | 'done'
  | 'cancelled'
  | 'error'

export interface SearchProgress {
  runId: string
  phase: SearchPhase
  message: string
  provider?: {
    id: string
    name: string
    status: 'running' | 'ok' | 'cached' | 'error' | 'skipped'
    count?: number
    error?: string
  }
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

export interface MatchCriterion {
  key: string
  label: string
  weight: number
  /** 0..1, or null when not evaluable (excluded from the weighted total). */
  score: number | null
  evidence: string
}

export interface MatchResult {
  score: number
  band: 'strong' | 'good' | 'partial' | 'weak'
  occupationRelevance: 'strong' | 'related' | 'weak' | 'none'
  criteria: MatchCriterion[]
  matchedSkills: string[]
  transferableSkills: string[]
  missingSkills: string[]
  missingQualifications: string[]
  caps: string[]
  semanticActive: boolean
  semanticModel?: string
  explanation: string[]
  disclaimer: string
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export type ProviderStatus =
  | 'CONNECTED'
  | 'AVAILABLE'
  | 'REQUIRES_CREDENTIALS'
  | 'LIMITED'
  | 'UNAVAILABLE'
  | 'MANUAL'
  | 'ERROR'
  | 'DISABLED'

export interface CredentialField {
  key: string
  label: string
  secret: boolean
  required: boolean
  help?: string
}

export interface ProviderInfo {
  id: string
  name: string
  kind:
    | 'remote_board'
    | 'aggregator'
    | 'government'
    | 'ats'
    | 'employer_site'
    | 'restricted'
    | 'discovery'
  description: string
  markets: string
  status: ProviderStatus
  statusDetail: string
  enabled: boolean
  credentials: CredentialField[]
  credentialsConfigured: Record<string, boolean>
  docsUrl?: string
  signupUrl?: string
  termsNote?: string
  rateLimitNote: string
  lastSuccessAt?: string
  lastErrorAt?: string
  lastError?: string
  lastCount?: number
  rateLimitedUntil?: string
  manualSearchUrlTemplate?: string
}

export type AtsProvider = 'greenhouse' | 'lever' | 'ashby' | 'smartrecruiters' | 'jsonld'

export interface EmployerRecord {
  id: string
  name: string
  atsProvider: AtsProvider
  boardId: string
  careersUrl?: string
  country?: string
  locations: string[]
  industry?: string
  status: 'pending' | 'active' | 'invalid' | 'error' | 'disabled'
  statusDetail?: string
  lastSyncAt?: string
  jobCount?: number
  addedBy: 'user' | 'discovery'
  createdAt: string
}

// ---------------------------------------------------------------------------
// Candidate
// ---------------------------------------------------------------------------

export interface ExtractedField<T = string> {
  value: T
  confidence: number
  source: 'resume' | 'user'
  confirmed: boolean
}

export interface WorkHistoryEntry {
  id: string
  title: string
  company: string
  location?: string
  startDate?: string
  endDate?: string
  current: boolean
  months?: number
  summary?: string
  confidence: number
  confirmed: boolean
}

export interface EducationEntry {
  id: string
  institution: string
  degree?: string
  field?: string
  graduationYear?: string
  confidence: number
  confirmed: boolean
}

export interface CustomAnswer {
  id: string
  /** Label pattern the answer applies to (case-insensitive substring). */
  question: string
  answer: string
  approved: boolean
}

export type YesNoUnset = 'yes' | 'no' | 'unset'

export interface SensitiveProfile {
  /** Only filled when the user explicitly provides them. Never inferred. */
  authorizedToWork: Record<string, YesNoUnset>
  requiresSponsorship: YesNoUnset
  /** User must opt in per category before autofill may use any of these. */
  allowAutofill: {
    workAuthorization: boolean
    sponsorship: boolean
  }
}

export interface CandidatePreferences {
  targetRoles: string[]
  targetOccupations: string[]
  location?: string
  radius?: number
  radiusUnit: DistanceUnit
  workModes: WorkMode[]
  employmentTypes: EmploymentType[]
  minSalary?: number
  salaryCurrency?: string
  salaryPeriod?: SalaryPeriod
  excludedOccupations: string[]
}

export interface CandidateProfile {
  fullName: ExtractedField
  firstName?: string
  lastName?: string
  email: ExtractedField
  phone: ExtractedField
  location: ExtractedField
  linkedinUrl: string
  githubUrl: string
  portfolioUrl: string
  headline?: string
  summary?: string
  skills: { name: string; canonicalId?: string; source: 'resume' | 'user'; confirmed: boolean }[]
  certifications: { name: string; source: 'resume' | 'user'; confirmed: boolean }[]
  workHistory: WorkHistoryEntry[]
  education: EducationEntry[]
  totalExperienceMonths?: number
  preferences: CandidatePreferences
  customAnswers: CustomAnswer[]
  sensitive: SensitiveProfile
  updatedAt: string
}

export interface ResumeRecord {
  id: string
  label: string
  fileName: string
  storedPath: string
  sha256: string
  format: 'pdf' | 'docx' | 'txt'
  textLength: number
  needsOcr: boolean
  isDefault: boolean
  parsedAt: string
  warnings: string[]
}

export interface ResumeParseResult {
  resume: ResumeRecord
  extracted: Partial<CandidateProfile>
  needsConfirmation: string[]
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

export type ApplicationState =
  | 'DISCOVERED'
  | 'SAVED'
  | 'QUEUED'
  | 'OPENING'
  | 'AUTOFILLING'
  | 'NEEDS_USER_INPUT'
  | 'READY_FOR_REVIEW'
  | 'APPROVED'
  | 'SUBMITTING'
  | 'SUBMITTED'
  | 'SUBMISSION_UNVERIFIED'
  | 'FAILED'
  | 'CANCELLED'
  | 'MANUAL_COMPLETION_REQUIRED'

export interface FieldIssue {
  label: string
  reason:
    | 'unknown_question'
    | 'sensitive_requires_user'
    | 'required_empty'
    | 'unsupported_input'
    | 'no_profile_value'
  required: boolean
  type: string
}

export interface SubmissionEvidence {
  kind:
    'confirmation_url' | 'confirmation_text' | 'reference_number' | 'ats_response' | 'user_report'
  detail: string
  url?: string
  observedAt: string
}

export interface ApplicationRecord {
  id: string
  jobId: string
  jobTitle: string
  company: string
  state: ApplicationState
  adapter: ApplicationSupport | 'demo'
  sourceUrl: string
  applyUrl?: string
  currentUrl?: string
  resumeId?: string
  resumeLabel?: string
  filledFields: { label: string; profileKey: string }[]
  issues: FieldIssue[]
  blockers: string[]
  evidence: SubmissionEvidence[]
  error?: string
  createdAt: string
  updatedAt: string
  approvedAt?: string
  submittedAt?: string
  origin: 'desktop' | 'telegram' | 'legacy_import'
  isDemo: boolean
}

export interface ApplicationEvent {
  id: number
  applicationId: string
  at: string
  fromState?: ApplicationState
  toState: ApplicationState
  message: string
}

// ---------------------------------------------------------------------------
// Automation
// ---------------------------------------------------------------------------

export interface SavedSearch {
  id: string
  name: string
  criteria: SearchCriteria
  enabled: boolean
  intervalMinutes: number
  notify: boolean
  minScoreToNotify: number
  lastRunAt?: string
  lastSuccessAt?: string
  lastResultCount?: number
  lastNewCount?: number
  lastError?: string
  consecutiveFailures: number
  nextRunAt?: string
  running: boolean
  createdAt: string
}

export type TelegramState = 'STOPPED' | 'STARTING' | 'RUNNING' | 'STOPPING' | 'ERROR'

export interface TelegramStatus {
  state: TelegramState
  detail: string
  tokenConfigured: boolean
  botUsername?: string
  authorizedChats: { chatId: string; label: string; addedAt: string }[]
  pendingChats: { chatId: string; label: string; seenAt: string }[]
  lastPollAt?: string
  conflictCount: number
  notificationsEnabled: boolean
}

// ---------------------------------------------------------------------------
// Settings & dashboard
// ---------------------------------------------------------------------------

export interface AppSettings {
  demoMode: boolean
  onlineGeocoding: boolean
  ollama: { enabled: boolean; baseUrl: string; model: string }
  browser: { executablePath?: string; channel?: 'chromium' | 'chrome' | 'msedge' }
  matching: { weights: Record<string, number>; strongThreshold: number }
  staleAfterDays: number
  contactEmailForApis?: string
}

export interface SemanticStatus {
  enabled: boolean
  active: boolean
  model: string
  detail: string
}

export interface DashboardStats {
  counters: JobCounters
  totalJobs: number
  newJobs: number
  verifiedJobs: number
  strongMatches: number
  savedJobs: number
  applicationsInProgress: number
  confirmedSubmitted: number
  unverifiedSubmissions: number
  lastSuccessfulSearchAt?: string
  providersConnected: number
  providersNeedingCredentials: number
  scheduledSearches: number
  telegram: TelegramState
}

/** Result-set counters, always computed from the database against the active criteria. */
export interface JobCounters {
  criteriaKey: string
  criteriaLabel: string
  lastRun?: {
    runId: string
    finishedAt?: string
    fetched: number
    newJobs: number
    status: string
  }
  historical: number
  eligible: number
  eligibleNew: number
  review: number
  excluded: number
  excludedBy: {
    location: number
    occupation: number
    workMode: number
    belowScore: number
    expired: number
    other: number
  }
  unverified: number
  saved: number
  dismissed: number
}

export interface MigrationReport {
  performed: boolean
  backupPath?: string
  imported: {
    candidate: boolean
    profile: boolean
    jobs: number
    applications: number
    settings: boolean
  }
  notes: string[]
  at: string
}

export interface AppInfo {
  version: string
  userDataPath: string
  dbPath: string
  migration?: MigrationReport
  secureStorage: 'os' | 'basic' | 'unavailable'
  demoMode: boolean
  isPackaged: boolean
}
