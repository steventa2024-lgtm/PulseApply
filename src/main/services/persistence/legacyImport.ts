import fs from 'fs'
import path from 'path'
import { createHash, randomUUID } from 'crypto'
import type {
  CandidateProfile,
  MigrationReport,
  NormalizedJob,
  ResumeRecord
} from '../../../shared/types'
import type { Store } from './store'
import { emptyProfile } from './candidateRepo'
import { log } from '../logger'

/** Shape of the pre-upgrade `pulseapply_db.json` (see git history of src/main/services/db.ts). */
interface LegacyDb {
  profile?: {
    fileName?: string
    rawText?: string
    extractedSkills?: string[]
    detectedRoles?: string[]
    updatedAt?: string
  } | null
  candidate?: {
    fullName?: string
    email?: string
    phone?: string
    location?: string
    linkedinUrl?: string
    githubUrl?: string
    portfolioUrl?: string
    workAuthorization?: string
    resumeFilePath?: string
  }
  settings?: {
    minScoreThreshold?: number
    cronIntervalHours?: number
    targetRoles?: string[]
    targetLocation?: string
  }
  jobs?: {
    id: string
    title: string
    company: string
    location: string
    source: string
    url: string
    salary?: string
    description?: string
    requiredSkills?: string[]
    discoveredAt?: string
    status?: string
  }[]
}

const IMPORT_KEY = 'legacy_import_report'

function sha256(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex')
}

/**
 * One-time, idempotent import of the legacy JSON database.
 *
 * Safety procedure:
 *  1. The legacy file is copied to `pulseapply_db.backup-<timestamp>.json` and the
 *     copy is verified byte-for-byte (SHA-256) before anything is imported.
 *  2. The legacy file itself is never modified or deleted.
 *  3. The import runs in one transaction; on any error nothing is written and the
 *     import is retried on next launch.
 *  4. Rows are keyed by their legacy ids so re-running cannot duplicate them.
 *
 * Data honesty rules applied during import:
 *  - Contact fields are imported unconfirmed: the old parser silently substituted
 *    hardcoded defaults when extraction failed, so they must be re-confirmed.
 *  - The legacy `workAuthorization` value was a form default, not an explicit
 *    answer, so it is NOT imported.
 *  - Legacy job records came from a hardcoded sample list with placeholder URLs;
 *    they are kept for history but hidden from results and marked UNVERIFIED.
 *  - Jobs marked "applied" become SUBMISSION_UNVERIFIED applications, because the
 *    old flow recorded approval, not an observed submission.
 */
export function importLegacyDatabase(
  store: Store,
  userDataDir: string
): MigrationReport | undefined {
  const existing = store.settings.getRaw<MigrationReport | null>(IMPORT_KEY, null)
  if (existing?.performed) return existing

  const legacyPath = path.join(userDataDir, 'pulseapply_db.json')
  if (!fs.existsSync(legacyPath)) return undefined

  const report: MigrationReport = {
    performed: false,
    imported: { candidate: false, profile: false, jobs: 0, applications: 0, settings: false },
    notes: [],
    at: new Date().toISOString()
  }

  const raw = fs.readFileSync(legacyPath)
  const backupPath = path.join(
    userDataDir,
    `pulseapply_db.backup-${report.at.replace(/[:.]/g, '-')}.json`
  )
  fs.copyFileSync(legacyPath, backupPath)
  if (sha256(fs.readFileSync(backupPath)) !== sha256(raw)) {
    throw new Error('Legacy database backup verification failed; import aborted')
  }
  report.backupPath = backupPath

  let legacy: LegacyDb
  try {
    legacy = JSON.parse(raw.toString('utf-8').replace(/^\uFEFF/, ''))
  } catch (err) {
    report.notes.push(
      `Legacy database could not be parsed (${(err as Error).message}); nothing imported. Backup kept.`
    )
    report.performed = true
    store.settings.setRaw(IMPORT_KEY, report)
    return report
  }

  store.db.transaction(() => {
    // ---- candidate -------------------------------------------------------
    const c = legacy.candidate
    if (c && (c.fullName || c.email || c.phone)) {
      const profile: CandidateProfile = store.candidate.exists()
        ? store.candidate.get()
        : emptyProfile()
      const field = (
        v?: string
      ): { value: string; confidence: number; source: 'user'; confirmed: boolean } => ({
        value: v ?? '',
        confidence: v ? 0.5 : 0,
        source: 'user' as const,
        confirmed: false
      })
      if (!profile.fullName.value) profile.fullName = field(c.fullName)
      if (!profile.email.value) profile.email = field(c.email)
      if (!profile.phone.value) profile.phone = field(c.phone)
      if (!profile.location.value) profile.location = field(c.location)
      profile.linkedinUrl ||= c.linkedinUrl ?? ''
      profile.githubUrl ||= c.githubUrl ?? ''
      profile.portfolioUrl ||= c.portfolioUrl ?? ''
      if (legacy.settings?.targetRoles?.length && profile.preferences.targetRoles.length === 0) {
        profile.preferences.targetRoles = legacy.settings.targetRoles
      }
      if (legacy.settings?.targetLocation && !profile.preferences.location) {
        profile.preferences.location = legacy.settings.targetLocation
      }
      if (legacy.profile?.extractedSkills?.length && profile.skills.length === 0) {
        profile.skills = legacy.profile.extractedSkills.map((name) => ({
          name,
          source: 'resume' as const,
          confirmed: false
        }))
      }
      store.candidate.save(profile)
      report.imported.candidate = true
      report.notes.push(
        'Contact details imported as UNCONFIRMED — please review them on the Profile page.'
      )
      if (c.workAuthorization) {
        report.notes.push(
          `Legacy work authorization value "${c.workAuthorization}" was a form default and was not imported. Set it explicitly if you want autofill to use it.`
        )
      }
    }

    // ---- resume text -----------------------------------------------------
    const p = legacy.profile
    if (p?.rawText) {
      const sha = sha256(p.rawText)
      if (!store.candidate.findResumeBySha(sha)) {
        const filePath =
          c?.resumeFilePath && fs.existsSync(c.resumeFilePath) ? c.resumeFilePath : ''
        const rec: ResumeRecord = {
          id: randomUUID(),
          label: `${p.fileName ?? 'Resume'} (imported)`,
          fileName: p.fileName ?? 'resume.pdf',
          storedPath: filePath,
          sha256: sha,
          format: 'pdf',
          textLength: p.rawText.length,
          needsOcr: false,
          isDefault: true,
          parsedAt: p.updatedAt ?? report.at,
          warnings: filePath
            ? []
            : ['Original resume file not found; re-upload it to attach it to applications.']
        }
        store.candidate.addResume(rec, p.rawText)
      }
      report.imported.profile = true
    }

    // ---- settings --------------------------------------------------------
    if (legacy.settings) {
      store.settings.setRaw('legacy_settings', legacy.settings)
      report.imported.settings = true
    }

    // ---- jobs & application history --------------------------------------
    for (const j of legacy.jobs ?? []) {
      if (!j?.id || !j.title) continue
      const id = `legacy:${j.id}`
      const now = j.discoveredAt ?? report.at
      const data: NormalizedJob = {
        id,
        canonicalKey: id,
        source: 'legacy',
        sourceJobId: j.id,
        sourceUrl: j.url,
        title: j.title,
        normalizedTitle: j.title.toLowerCase(),
        company: j.company,
        description: j.description ?? '',
        responsibilities: [],
        qualifications: [],
        requiredSkills: j.requiredSkills ?? [],
        preferredSkills: [],
        requiredCertifications: [],
        employmentTypes: [],
        workModes: [],
        schedule: [],
        locationText: j.location,
        locations: [],
        discoveredAt: now,
        lastSeenAt: now,
        verificationStatus: 'UNVERIFIED',
        verificationNotes: [
          'Imported from the pre-upgrade database. The previous version used placeholder sample listings; this record could not be traced to a real posting.'
        ],
        scamSignals: [],
        inferredFields: [],
        sources: [],
        applicationSupport: 'manual'
      }
      const inserted = store.db.run(
        `INSERT OR IGNORE INTO jobs (id, canonical_key, data, title, company, source, discovered_at, last_seen_at,
           verification_status, dismissed, legacy) VALUES (?, ?, ?, ?, ?, 'legacy', ?, ?, 'UNVERIFIED', ?, 1)`,
        [
          id,
          id,
          JSON.stringify(data),
          j.title,
          j.company ?? '',
          now,
          now,
          j.status === 'dismissed' ? 1 : 0
        ]
      )
      if (inserted) report.imported.jobs++
      if (j.status === 'applied' || j.status === 'in_progress' || j.status === 'awaiting_review') {
        if (store.db.get('SELECT 1 AS x FROM applications WHERE job_id = ?', [id])) continue
        const appId = randomUUID()
        const state = j.status === 'applied' ? 'SUBMISSION_UNVERIFIED' : 'CANCELLED'
        const evidence =
          j.status === 'applied'
            ? [
                {
                  kind: 'user_report',
                  detail:
                    'Marked "applied" in the previous version, which recorded approval only — no submission confirmation was observed.',
                  observedAt: now
                }
              ]
            : []
        store.db.run(
          `INSERT INTO applications (id, job_id, state, adapter, source_url, data, origin, created_at, updated_at, submitted_at)
           VALUES (?, ?, ?, 'manual', ?, ?, 'legacy_import', ?, ?, ?)`,
          [
            appId,
            id,
            state,
            j.url ?? '',
            JSON.stringify({ filledFields: [], issues: [], blockers: [], evidence }),
            now,
            now,
            j.status === 'applied' ? now : null
          ]
        )
        store.db.run(
          'INSERT INTO application_events (application_id, at, from_state, to_state, message) VALUES (?, ?, NULL, ?, ?)',
          [appId, report.at, state, `Imported from legacy status "${j.status}"`]
        )
        report.imported.applications++
      }
    }
    if (report.imported.jobs) {
      report.notes.push(
        `${report.imported.jobs} legacy job record(s) kept for history but hidden from results: they were sample listings without real source URLs.`
      )
    }

    report.performed = true
    store.settings.setRaw(IMPORT_KEY, report)
  })

  store.db.flush()
  log.info('migration', `Legacy JSON import complete; backup at ${backupPath}`)
  return report
}

export function lastMigrationReport(store: Store): MigrationReport | undefined {
  return store.settings.getRaw<MigrationReport | null>(IMPORT_KEY, null) ?? undefined
}
