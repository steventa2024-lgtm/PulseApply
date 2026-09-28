import fs from 'fs'
import path from 'path'
import { createHash, randomUUID } from 'crypto'
import type { CandidateProfile, ResumeRecord } from '../../../shared/types'
import {
  paginateResume,
  renderResumeHtml,
  resumeFileName,
  resumePlainText,
  type ResumeDocument,
  type ResumePageSize,
  type ResumeSuggestion
} from '../../../shared/resume'
import type { Store } from '../persistence/store'
import type { HttpClient } from '../jobs/adapters/http'
import {
  analyzeResume,
  applySuggestion,
  documentFromAnswers,
  documentFromProfile,
  ollamaRewrites,
  type ResumeQuestionnaire
} from './resumeAgent'
import { log } from '../logger'

/** Renders HTML to PDF (Electron's printToPDF in the app; Playwright Chromium in tests). */
export interface PdfPrinter {
  print(html: string, pageSize: ResumePageSize): Promise<{ pdf: Buffer; pages: number }>
}

/** JavaScript run in the print window before printing (same pagination as the preview). */
export const PAGINATE_SCRIPT = `(${paginateResume.toString()})(document)`

export interface PdfCheck {
  pages: number
  text: string
  bytes: number
}

/** Re-opens a PDF and extracts its text; throws when the file is not a readable PDF. */
export async function inspectPdf(file: string): Promise<PdfCheck> {
  const data = fs.readFileSync(file)
  if (data.length < 800 || data.subarray(0, 5).toString('latin1') !== '%PDF-')
    throw new Error('The written file is not a valid PDF')
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: new Uint8Array(data) })
  try {
    const res = await parser.getText()
    return { pages: res.total, text: res.text, bytes: data.length }
  } finally {
    await parser.destroy()
  }
}

function monthsBetween(start?: string, end?: string): number | undefined {
  const p = (s?: string): number | undefined => {
    const m = /^(\d{4})-(\d{2})$/.exec(s ?? '')
    return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : undefined
  }
  const a = p(start)
  if (a === undefined) return undefined
  const now = new Date()
  const b = p(end) ?? now.getFullYear() * 12 + now.getMonth()
  return b >= a ? b - a + 1 : undefined
}

export class ResumeHelperService {
  /** Files written by exportPdf in this session — the only paths the UI may open. */
  private readonly exported = new Set<string>()

  constructor(
    private readonly deps: {
      store: Store
      http: HttpClient
      resumesDir: string
      printer: () => PdfPrinter | undefined
      onProfileChanged: () => Promise<unknown>
    }
  ) {}

  list(): ReturnType<Store['resumeDocs']['list']> {
    return this.deps.store.resumeDocs.list()
  }

  get(id: string): ResumeDocument {
    const d = this.deps.store.resumeDocs.get(id)
    if (!d) throw new Error('Resume not found')
    return d
  }

  save(doc: ResumeDocument, note?: string): ResumeDocument {
    return this.deps.store.resumeDocs.save(doc, note)
  }

  /** Builds an editable document from the uploaded resume (via the parsed profile). */
  importFromProfile(resumeId?: string): ResumeDocument {
    const { store } = this.deps
    const profile = store.candidate.get()
    const resume = resumeId ? store.candidate.resume(resumeId) : store.candidate.defaultResume()
    if (!resume && !profile.workHistory.length && !profile.fullName.value)
      throw new Error('Upload a resume on the Profile page first, or create a new resume.')
    const doc = documentFromProfile(profile, {
      resumeId: resume?.id,
      name: resume ? `${resume.label} (improved)` : 'Imported resume'
    })
    return store.resumeDocs.save(doc, `Imported from ${resume?.fileName ?? 'profile'}`)
  }

  createFromAnswers(a: ResumeQuestionnaire): ResumeDocument {
    return this.deps.store.resumeDocs.save(documentFromAnswers(a), 'Created from questionnaire')
  }

  async analyze(
    doc: ResumeDocument,
    opts: { targetRole?: string; jobId?: string; useAi?: boolean; signal?: AbortSignal }
  ): Promise<{ suggestions: ResumeSuggestion[]; aiDetail: string }> {
    const job = opts.jobId ? this.deps.store.jobs.get(opts.jobId) : undefined
    const suggestions = analyzeResume(doc, {
      targetRole: opts.targetRole ?? job?.title,
      jobText: job ? `${job.title}\n${job.description}` : undefined
    })
    let aiDetail = 'Rule-based suggestions (local AI not requested).'
    if (opts.useAi) {
      const s = this.deps.store.settings.get().ollama
      const ai = await ollamaRewrites(doc, this.deps.http, s, opts.signal)
      aiDetail = ai.detail
      const taken = new Set(suggestions.map((x) => x.path))
      for (const x of ai.suggestions) if (!taken.has(x.path)) suggestions.push(x)
    }
    return { suggestions, aiDetail }
  }

  apply(doc: ResumeDocument, s: ResumeSuggestion, edited?: string): ResumeDocument {
    return applySuggestion(doc, s, edited)
  }

  private async render(doc: ResumeDocument): Promise<{ pdf: Buffer; pages: number }> {
    const printer = this.deps.printer()
    if (!printer) throw new Error('PDF rendering is not available in this environment')
    return printer.print(renderResumeHtml(doc, { mode: 'print' }), doc.pageSize)
  }

  /**
   * Writes the PDF atomically, then re-opens it to prove it is a readable PDF
   * containing the resume text before reporting success.
   */
  async exportPdf(doc: ResumeDocument, filePath: string): Promise<PdfCheck & { path: string }> {
    if (!path.isAbsolute(filePath) || path.extname(filePath).toLowerCase() !== '.pdf')
      throw new Error('Choose a .pdf file name')
    const { pdf } = await this.render(doc)
    const tmp = `${filePath}.${process.pid}.tmp`
    fs.writeFileSync(tmp, pdf)
    fs.renameSync(tmp, filePath)
    if (!fs.existsSync(filePath)) throw new Error('The PDF was not written')
    const check = await inspectPdf(filePath)
    const name = doc.contact.fullName.trim()
    if (name && !check.text.replace(/\s+/g, ' ').includes(name))
      throw new Error('The PDF was written but its text could not be verified')
    this.exported.add(path.resolve(filePath))
    log.info('resume', `Exported resume PDF (${check.pages} page(s), ${check.bytes} bytes)`)
    return { ...check, path: filePath }
  }

  defaultFileName(doc: ResumeDocument): string {
    return resumeFileName(doc)
  }

  wasExported(file: string): boolean {
    return this.exported.has(path.resolve(file))
  }

  /**
   * Makes a document the master resume: renders it to PDF in the private
   * resumes folder, registers it as the default resume (used for autofill),
   * replaces the profile's experience/education/skills with the document's
   * content (the user wrote and confirmed it), and re-scores stored jobs.
   */
  async setMaster(id: string): Promise<{ doc: ResumeDocument; resume: ResumeRecord }> {
    const { store } = this.deps
    const doc = this.get(id)
    const { pdf } = await this.render(doc)
    fs.mkdirSync(this.deps.resumesDir, { recursive: true })
    const resumeId = randomUUID()
    const storedPath = path.join(this.deps.resumesDir, `${resumeId}.pdf`)
    fs.writeFileSync(storedPath, pdf, { mode: 0o600 })
    const check = await inspectPdf(storedPath)
    const sha = createHash('sha256').update(pdf).digest('hex')
    const text = resumePlainText(doc)
    const existing = store.candidate.findResumeBySha(sha)
    let resume: ResumeRecord
    if (existing) {
      fs.rmSync(storedPath)
      resume = existing
    } else {
      resume = store.candidate.addResume(
        {
          id: resumeId,
          label: `${doc.name} v${doc.version}`,
          fileName: resumeFileName(doc),
          storedPath,
          sha256: sha,
          format: 'pdf',
          textLength: check.text.length,
          needsOcr: false,
          isDefault: true,
          parsedAt: new Date().toISOString(),
          warnings: []
        },
        text
      )
    }
    store.candidate.setDefaultResume(resume.id)
    store.candidate.save(this.profileFromDocument(store.candidate.get(), doc))
    store.resumeDocs.setMaster(doc.id, resume.id)
    await this.deps.onProfileChanged()
    return { doc: this.get(id), resume: store.candidate.resume(resume.id) ?? resume }
  }

  private profileFromDocument(p: CandidateProfile, doc: ResumeDocument): CandidateProfile {
    const field = (value: string): CandidateProfile['fullName'] => ({
      value,
      confidence: 1,
      source: 'user',
      confirmed: true
    })
    const c = doc.contact
    const parts = c.fullName.trim().split(/\s+/)
    return {
      ...p,
      fullName: c.fullName ? field(c.fullName) : p.fullName,
      firstName: parts.length > 1 ? parts[0] : p.firstName,
      lastName: parts.length > 1 ? parts[parts.length - 1] : p.lastName,
      email: c.email ? field(c.email) : p.email,
      phone: c.phone ? field(c.phone) : p.phone,
      location: c.location ? field(c.location) : p.location,
      linkedinUrl: c.linkedin || p.linkedinUrl,
      portfolioUrl: c.website || p.portfolioUrl,
      headline: doc.headline || p.headline,
      summary: doc.summary || p.summary,
      workHistory: doc.experience.map((e) => ({
        id: e.id,
        title: e.title,
        company: e.company,
        location: e.location,
        startDate: e.startDate,
        endDate: e.current ? undefined : e.endDate,
        current: e.current,
        months: monthsBetween(e.startDate, e.current ? undefined : e.endDate),
        summary: e.bullets.join('\n'),
        confidence: 1,
        confirmed: true
      })),
      education: doc.education.map((e) => ({
        id: e.id,
        institution: e.institution,
        degree: e.degree,
        field: e.field,
        graduationYear: e.graduationDate?.slice(0, 4),
        confidence: 1,
        confirmed: true
      })),
      skills: doc.skills.map((name) => ({ name, source: 'user' as const, confirmed: true })),
      certifications: doc.certifications.map((k) => ({
        name: k.name,
        source: 'user' as const,
        confirmed: true
      })),
      totalExperienceMonths: undefined
    }
  }
}
