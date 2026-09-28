import type { CandidateProfile, ResumeRecord, SensitiveProfile } from '../../../shared/types'
import type { AppDb } from './database'
import { json } from './database'
import type { SecretStore } from './secrets'

export const PRIMARY_CANDIDATE = 'primary'

export function emptyField(): CandidateProfile['fullName'] {
  return { value: '', confidence: 0, source: 'user', confirmed: false }
}

export function defaultSensitive(): SensitiveProfile {
  return {
    authorizedToWork: {},
    requiresSponsorship: 'unset',
    allowAutofill: { workAuthorization: false, sponsorship: false }
  }
}

export function emptyProfile(): CandidateProfile {
  return {
    fullName: emptyField(),
    email: emptyField(),
    phone: emptyField(),
    location: emptyField(),
    linkedinUrl: '',
    githubUrl: '',
    portfolioUrl: '',
    skills: [],
    certifications: [],
    workHistory: [],
    education: [],
    preferences: {
      targetRoles: [],
      targetOccupations: [],
      radiusUnit: 'mi',
      workModes: [],
      employmentTypes: [],
      excludedOccupations: []
    },
    customAnswers: [],
    sensitive: defaultSensitive(),
    updatedAt: new Date(0).toISOString()
  }
}

interface ResumeRow {
  id: string
  label: string
  file_name: string
  stored_path: string
  sha256: string
  format: string
  text_length: number
  needs_ocr: number
  is_default: number
  parsed_at: string
  warnings: string
}

/**
 * Candidate profile storage. Work-authorization and sponsorship answers are
 * stored encrypted with the OS-backed secret cipher.
 */
export class CandidateRepo {
  constructor(
    private readonly db: AppDb,
    private readonly secrets: SecretStore
  ) {}

  get(): CandidateProfile {
    const row = this.db.get<{ data: string; sensitive: string | null; sensitive_encrypted: number }>(
      'SELECT data, sensitive, sensitive_encrypted FROM candidates WHERE id = ?',
      [PRIMARY_CANDIDATE]
    )
    const base = emptyProfile()
    if (!row) return base
    const data = json<Partial<CandidateProfile>>(row.data, {})
    let sensitive = defaultSensitive()
    if (row.sensitive) {
      try {
        sensitive = { ...sensitive, ...JSON.parse(this.secrets.decryptBlob(row.sensitive, !!row.sensitive_encrypted)) }
      } catch {
        sensitive = defaultSensitive()
      }
    }
    return {
      ...base,
      ...data,
      preferences: { ...base.preferences, ...(data.preferences ?? {}) },
      sensitive
    }
  }

  exists(): boolean {
    return !!this.db.get('SELECT 1 AS x FROM candidates WHERE id = ?', [PRIMARY_CANDIDATE])
  }

  save(profile: CandidateProfile): CandidateProfile {
    const { sensitive, ...rest } = profile
    const blob = this.secrets.encryptBlob(JSON.stringify(sensitive ?? defaultSensitive()))
    const now = new Date().toISOString()
    const data = JSON.stringify({ ...rest, updatedAt: now })
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO candidates (id, data, sensitive, sensitive_encrypted, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data, sensitive = excluded.sensitive,
           sensitive_encrypted = excluded.sensitive_encrypted, updated_at = excluded.updated_at`,
        [PRIMARY_CANDIDATE, data, blob.value, blob.encrypted ? 1 : 0, now]
      )
      this.db.run('DELETE FROM candidate_skills WHERE candidate_id = ?', [PRIMARY_CANDIDATE])
      for (const s of profile.skills) {
        this.db.run(
          'INSERT OR IGNORE INTO candidate_skills (candidate_id, name, canonical_id, source, confirmed) VALUES (?, ?, ?, ?, ?)',
          [PRIMARY_CANDIDATE, s.name, s.canonicalId ?? null, s.source, s.confirmed ? 1 : 0]
        )
      }
    })
    return this.get()
  }

  // --- resumes -------------------------------------------------------------

  private hydrateResume(r: ResumeRow): ResumeRecord {
    return {
      id: r.id,
      label: r.label,
      fileName: r.file_name,
      storedPath: r.stored_path,
      sha256: r.sha256,
      format: r.format as ResumeRecord['format'],
      textLength: r.text_length,
      needsOcr: !!r.needs_ocr,
      isDefault: !!r.is_default,
      parsedAt: r.parsed_at,
      warnings: json<string[]>(r.warnings, [])
    }
  }

  resumes(): ResumeRecord[] {
    return this.db
      .all<ResumeRow>('SELECT * FROM resumes WHERE candidate_id = ? ORDER BY parsed_at DESC', [PRIMARY_CANDIDATE])
      .map((r) => this.hydrateResume(r))
  }

  resume(id: string): ResumeRecord | undefined {
    const r = this.db.get<ResumeRow>('SELECT * FROM resumes WHERE id = ?', [id])
    return r ? this.hydrateResume(r) : undefined
  }

  defaultResume(): ResumeRecord | undefined {
    const r =
      this.db.get<ResumeRow>('SELECT * FROM resumes WHERE candidate_id = ? AND is_default = 1', [PRIMARY_CANDIDATE]) ??
      this.db.get<ResumeRow>('SELECT * FROM resumes WHERE candidate_id = ? ORDER BY parsed_at DESC LIMIT 1', [PRIMARY_CANDIDATE])
    return r ? this.hydrateResume(r) : undefined
  }

  resumeText(id: string): string {
    return this.db.get<{ raw_text: string }>('SELECT raw_text FROM resumes WHERE id = ?', [id])?.raw_text ?? ''
  }

  findResumeBySha(sha: string): ResumeRecord | undefined {
    const r = this.db.get<ResumeRow>('SELECT * FROM resumes WHERE candidate_id = ? AND sha256 = ?', [PRIMARY_CANDIDATE, sha])
    return r ? this.hydrateResume(r) : undefined
  }

  addResume(rec: ResumeRecord, rawText: string): ResumeRecord {
    this.db.transaction(() => {
      if (!this.exists()) this.save(emptyProfile())
      if (rec.isDefault) this.db.run('UPDATE resumes SET is_default = 0 WHERE candidate_id = ?', [PRIMARY_CANDIDATE])
      this.db.run(
        `INSERT INTO resumes (id, candidate_id, label, file_name, stored_path, sha256, format, text_length, needs_ocr, is_default,
           parsed_at, warnings, raw_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          rec.id,
          PRIMARY_CANDIDATE,
          rec.label,
          rec.fileName,
          rec.storedPath,
          rec.sha256,
          rec.format,
          rec.textLength,
          rec.needsOcr ? 1 : 0,
          rec.isDefault ? 1 : 0,
          rec.parsedAt,
          JSON.stringify(rec.warnings),
          rawText
        ]
      )
    })
    return this.resume(rec.id)!
  }

  setDefaultResume(id: string): void {
    this.db.transaction(() => {
      this.db.run('UPDATE resumes SET is_default = 0 WHERE candidate_id = ?', [PRIMARY_CANDIDATE])
      this.db.run('UPDATE resumes SET is_default = 1 WHERE id = ?', [id])
    })
  }

  renameResume(id: string, label: string): void {
    this.db.run('UPDATE resumes SET label = ? WHERE id = ?', [label.slice(0, 80), id])
  }

  deleteResume(id: string): ResumeRecord | undefined {
    const r = this.resume(id)
    this.db.run('DELETE FROM resumes WHERE id = ?', [id])
    return r
  }

  /** Removes the candidate profile, resumes and skills (application history is kept). */
  deleteAll(): ResumeRecord[] {
    const all = this.resumes()
    this.db.transaction(() => {
      this.db.run('DELETE FROM candidates WHERE id = ?', [PRIMARY_CANDIDATE])
    })
    return all
  }
}
