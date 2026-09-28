import fs from 'fs'
import path from 'path'
import { createHash, randomUUID } from 'crypto'
import type { CandidateProfile, ExtractedField, ResumeParseResult, ResumeRecord } from '../../../shared/types'
import type { Store } from '../persistence/store'
import type { Gazetteer } from '../jobs/geo/gazetteer'
import { extractResumeText, MAX_RESUME_BYTES } from './extractText'
import { CONFIRM_THRESHOLD, extractProfile } from './profileExtractor'

const ALLOWED_EXT = new Set(['.pdf', '.docx', '.txt'])

function mergeField(current: ExtractedField, extracted: ExtractedField | undefined): ExtractedField {
  if (!extracted || !extracted.value) return current
  // Never overwrite something the user confirmed or typed.
  if (current.value && (current.confirmed || current.source === 'user')) return current
  return { ...extracted, confirmed: extracted.confidence >= 0.95 }
}

/**
 * Resume import: validates the file, copies it into the app's private
 * resumes folder, extracts text, and merges extracted data into the
 * profile without overwriting anything the user entered or confirmed.
 */
export class ResumeService {
  constructor(
    private readonly store: Store,
    private readonly resumesDir: string,
    private readonly gazetteer: Gazetteer
  ) {}

  static validatePath(filePath: string): void {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('Invalid file path')
    const ext = path.extname(filePath).toLowerCase()
    if (!ALLOWED_EXT.has(ext)) throw new Error('Unsupported file type. Upload a PDF, DOCX or TXT resume.')
    const st = fs.statSync(filePath)
    if (!st.isFile()) throw new Error('Not a file')
    if (st.size > MAX_RESUME_BYTES) throw new Error('Resume file is larger than 15 MB')
  }

  async importFile(filePath: string, opts: { label?: string; makeDefault?: boolean } = {}): Promise<ResumeParseResult> {
    ResumeService.validatePath(filePath)
    return this.importBuffer(path.basename(filePath), fs.readFileSync(filePath), opts)
  }

  async importBuffer(fileName: string, data: Buffer, opts: { label?: string; makeDefault?: boolean } = {}): Promise<ResumeParseResult> {
    const safeName = path.basename(fileName).replace(/[^\w.() -]+/g, '_').slice(0, 120) || 'resume'
    const ext = path.extname(safeName).toLowerCase()
    if (!ALLOWED_EXT.has(ext)) throw new Error('Unsupported file type. Upload a PDF, DOCX or TXT resume.')
    const extracted = await extractResumeText(safeName, data)
    const sha = createHash('sha256').update(data).digest('hex')
    const existing = this.store.candidate.findResumeBySha(sha)
    const { profile: found, needsConfirmation, warnings } = extractProfile(extracted.text, this.gazetteer)
    const allWarnings = [...extracted.warnings, ...warnings]

    let resume: ResumeRecord
    if (existing) {
      resume = existing
      allWarnings.unshift('This exact file was already uploaded; its stored copy was reused.')
    } else {
      fs.mkdirSync(this.resumesDir, { recursive: true })
      const id = randomUUID()
      const storedPath = path.join(this.resumesDir, `${id}${ext}`)
      fs.writeFileSync(storedPath, data, { mode: 0o600 })
      const isFirst = this.store.candidate.resumes().length === 0
      resume = this.store.candidate.addResume(
        {
          id,
          label: opts.label?.trim() || safeName.replace(/\.[^.]+$/, ''),
          fileName: safeName,
          storedPath,
          sha256: sha,
          format: extracted.format,
          textLength: extracted.text.length,
          needsOcr: extracted.needsOcr,
          isDefault: opts.makeDefault ?? isFirst,
          parsedAt: new Date().toISOString(),
          warnings: allWarnings
        },
        extracted.text
      )
    }

    if (!extracted.needsOcr) this.applyExtraction(found)
    return { resume, extracted: found, needsConfirmation, warnings: allWarnings }
  }

  /** Merges extracted values into the stored profile (non-destructive). */
  applyExtraction(found: Partial<CandidateProfile>): CandidateProfile {
    const p = this.store.candidate.get()
    p.fullName = mergeField(p.fullName, found.fullName)
    p.email = mergeField(p.email, found.email)
    p.phone = mergeField(p.phone, found.phone)
    p.location = mergeField(p.location, found.location)
    if (!p.firstName && found.firstName && p.fullName.value === found.fullName?.value) p.firstName = found.firstName
    if (!p.lastName && found.lastName && p.fullName.value === found.fullName?.value) p.lastName = found.lastName
    p.linkedinUrl ||= found.linkedinUrl ?? ''
    p.githubUrl ||= found.githubUrl ?? ''
    p.portfolioUrl ||= found.portfolioUrl ?? ''
    p.summary ||= found.summary

    const keepHistory = p.workHistory.filter((w) => w.confirmed)
    const newHistory = (found.workHistory ?? []).filter(
      (w) => !keepHistory.some((k) => k.title.toLowerCase() === w.title.toLowerCase() && k.company.toLowerCase() === w.company.toLowerCase())
    )
    p.workHistory = [...keepHistory, ...newHistory]
    const keepEdu = p.education.filter((e) => e.confirmed)
    p.education = [...keepEdu, ...(found.education ?? []).filter((e) => !keepEdu.some((k) => k.institution === e.institution))]

    const skillNames = new Set(p.skills.map((s) => s.name.toLowerCase()))
    for (const s of found.skills ?? []) if (!skillNames.has(s.name.toLowerCase())) p.skills.push(s)
    const certNames = new Set(p.certifications.map((c) => c.name.toLowerCase()))
    for (const c of found.certifications ?? []) if (!certNames.has(c.name.toLowerCase())) p.certifications.push(c)
    if (found.totalExperienceMonths) p.totalExperienceMonths = found.totalExperienceMonths
    return this.store.candidate.save(p)
  }

  deleteResume(id: string): void {
    const r = this.store.candidate.deleteResume(id)
    if (r?.storedPath && r.storedPath.startsWith(this.resumesDir) && fs.existsSync(r.storedPath)) fs.rmSync(r.storedPath)
  }

  /** Deletes the profile and every stored resume file. Application history is kept. */
  deleteAll(): void {
    const all = this.store.candidate.deleteAll()
    for (const r of all) {
      if (r.storedPath && r.storedPath.startsWith(this.resumesDir) && fs.existsSync(r.storedPath)) fs.rmSync(r.storedPath)
    }
  }

  /** Profile export (no credentials, no resume binaries). */
  exportProfile(): Record<string, unknown> {
    return {
      exportedAt: new Date().toISOString(),
      format: 'pulseapply-profile-v1',
      profile: this.store.candidate.get(),
      resumes: this.store.candidate.resumes().map(({ storedPath: _p, ...r }) => r)
    }
  }

  static needsConfirmation(p: CandidateProfile): string[] {
    const out: string[] = []
    const chk = (label: string, f: ExtractedField) => {
      if (!f.value) out.push(`${label} missing`)
      else if (!f.confirmed && f.confidence < CONFIRM_THRESHOLD) out.push(`${label} needs confirmation`)
    }
    chk('Full name', p.fullName)
    chk('Email', p.email)
    chk('Phone', p.phone)
    chk('Location', p.location)
    return out
  }
}
