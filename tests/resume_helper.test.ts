import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Browser } from 'playwright'
import type { Services } from '../src/main/app/services'
import {
  PAGINATE_SCRIPT,
  inspectPdf,
  type PdfPrinter
} from '../src/main/services/resume/resumeHelper'
import {
  analyzeResume,
  applySuggestion,
  documentFromAnswers,
  fabricationCheck,
  gerundToPast,
  ollamaRewrites,
  tidyBullet,
  type ResumeQuestionnaire
} from '../src/main/services/resume/resumeAgent'
import { HttpClient } from '../src/main/services/jobs/adapters/http'
import { renderResumeHtml, resumeFileName } from '../src/shared/resume'
import { CHROMIUM, fakeFetch, json, makeServices, tmpDir, warehouseBaristaProfile } from './helpers'

const SHOTS = process.env.PULSEAPPLY_SCREENSHOTS ?? path.join(os.tmpdir(), 'pulseapply-ui')
const RESUME = path.join(__dirname, 'fixtures', 'resumes', 'warehouse_barista.pdf')

/** Same Chromium print engine as Electron's printToPDF, driven through Playwright. */
class PlaywrightPrinter implements PdfPrinter {
  constructor(private readonly browser: Browser) {}
  async print(html: string): Promise<{ pdf: Buffer; pages: number }> {
    const page = await this.browser.newPage()
    try {
      await page.setContent(html)
      const pages = Number(await page.evaluate(PAGINATE_SCRIPT))
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
      return { pdf, pages }
    } finally {
      await page.close()
    }
  }
}

const ANSWERS: ResumeQuestionnaire = {
  contact: {
    fullName: 'Jordan Rivera',
    email: 'jordan.rivera.test@example.com',
    phone: '(562) 555-0147',
    location: 'Lakewood, CA',
    linkedin: '',
    website: ''
  },
  targetRole: 'Warehouse Associate',
  experience: [
    {
      title: 'Warehouse Associate',
      company: 'Harborline Distribution',
      location: 'Carson, CA',
      startDate: '2023-03',
      current: true,
      duties:
        'I pick and pack orders with an RF scanner\nLoad and unload trucks with a pallet jack\nCycle counts'
    },
    {
      title: 'Barista',
      company: 'Bluebird Coffee',
      startDate: '2019-06',
      endDate: '2022-12',
      current: false,
      duties:
        'Responsible for preparing espresso drinks; cash handling and POS; opening and closing'
    }
  ],
  education: [{ institution: 'Lakewood High School', degree: 'High School Diploma' }],
  skills: ['Order Picking', 'RF Scanner', 'Pallet Jack'],
  certifications: [{ name: 'Forklift Certification', issuer: 'Cal/OSHA trainer' }],
  template: 'classic',
  pageSize: 'letter'
}

describe('resume agent (deterministic, no fabrication)', () => {
  it('builds a resume only from the questionnaire answers', () => {
    const doc = documentFromAnswers(ANSWERS)
    expect(doc.experience.map((e) => e.company)).toEqual([
      'Harborline Distribution',
      'Bluebird Coffee'
    ])
    // Wording is tidied, facts are not changed.
    expect(doc.experience[0].bullets[0]).toBe('Pick and pack orders with an RF scanner')
    expect(doc.experience[1].bullets[0]).toBe('Prepared espresso drinks')
    // Summary uses only stated facts; no numbers the user did not give.
    expect(doc.summary).toMatch(/^Warehouse Associate with \d\+ years of hands-on experience\./)
    expect(doc.summary).toContain('Order Picking')
    const all = JSON.stringify(doc)
    for (const invented of ['%', 'increased', 'award', 'University'])
      expect(all.includes(invented)).toBe(false)
  })

  it('suggests improvements and never adds claims without confirmation', () => {
    const doc = documentFromAnswers(ANSWERS)
    doc.summary = undefined
    doc.experience[1].bullets.push('Responsible for training new baristas')
    const s = analyzeResume(doc)
    const kinds = s.map((x) => x.kind)
    expect(kinds).toContain('missing_summary')
    expect(kinds).toContain('weak_verb')
    expect(kinds).toContain('add_quantity')
    const weak = s.find((x) => x.kind === 'weak_verb')!
    expect(weak.after).toBe('Trained new baristas')
    for (const x of s) {
      // No invented numbers: only the summary may state years, computed from the user's own dates.
      if (x.after && x.kind !== 'missing_summary') expect(x.after).not.toMatch(/\d/)
      if (x.kind === 'skill_in_text' || x.kind === 'target_keyword' || x.kind === 'missing_summary')
        expect(x.requiresConfirmation).toBe(true)
    }
    const summary = s.find((x) => x.kind === 'missing_summary')!
    expect(summary.after).toMatch(/^Warehouse Associate with \d\+ years/)
    const applied = applySuggestion(doc, weak)
    expect(applied.experience[1].bullets.at(-1)).toBe('Trained new baristas')
    // Edited acceptance uses the user's text.
    const edited = applySuggestion(doc, weak, 'Trained 3 new baristas')
    expect(edited.experience[1].bullets.at(-1)).toBe('Trained 3 new baristas')
  })

  it('conjugates common verbs', () => {
    expect(gerundToPast('managing')).toBe('managed')
    expect(gerundToPast('shipping')).toBe('shipped')
    expect(gerundToPast('leading')).toBe('led')
    expect(gerundToPast('supplying')).toBe('supplied')
    expect(tidyBullet('I am responsible for stocking shelves.', true)).toBe(
      'Responsible for stocking shelves'
    )
  })

  it('discards local-AI rewrites that add facts', async () => {
    expect(fabricationCheck('Loaded trucks', 'Loaded 40 trucks per shift')).toMatch(/number/)
    expect(fabricationCheck('Loaded trucks', 'Loaded trucks for Amazon')).toMatch(/name/)
    expect(
      fabricationCheck('Loaded and unloaded trucks', 'Loaded and unloaded delivery trucks')
    ).toBeNull()

    const replies = ['Loaded 40 trucks daily for FedEx', 'Loaded and unloaded delivery trucks']
    const http = new HttpClient({
      userAgent: 't',
      fetchImpl: fakeFetch([
        (u) =>
          u.pathname === '/api/generate' ? json({ response: replies.shift() ?? '' }) : undefined
      ])
    })
    const doc = documentFromAnswers(ANSWERS)
    doc.experience = [
      {
        ...doc.experience[0],
        bullets: ['Load and unload trucks every day', 'Loaded and unloaded trucks']
      }
    ]
    const res = await ollamaRewrites(doc, http, {
      enabled: true,
      baseUrl: 'http://127.0.0.1:11434',
      generateModel: 'llama3.2'
    })
    expect(res.rejected).toBe(1)
    expect(res.suggestions.map((s) => s.after)).toEqual(['Loaded and unloaded delivery trucks'])
    expect(res.suggestions[0].source).toBe('ollama')
  })
})

describe.skipIf(!CHROMIUM)('resume PDF export and master resume integration', () => {
  let browser: Browser
  let svc: Services
  beforeAll(async () => {
    const { chromium } = await import('playwright')
    browser = await chromium.launch({ executablePath: CHROMIUM })
    svc = (await makeServices({ pdfPrinter: () => new PlaywrightPrinter(browser) })).svc
    fs.mkdirSync(SHOTS, { recursive: true })
  }, 60_000)
  afterAll(async () => {
    await svc?.shutdown()
    await browser?.close()
  })

  it('TEST 5 — improves an uploaded resume', async () => {
    await svc.resumes.importFile(RESUME)
    const doc = svc.resumeHelper.importFromProfile()
    expect(doc.origin).toBe('imported')
    expect(doc.contact.fullName).toBe('Jordan Rivera')
    expect(doc.experience.length).toBeGreaterThan(0)
    const { suggestions } = await svc.resumeHelper.analyze(doc, {})
    expect(suggestions.length).toBeGreaterThan(0)
    expect(svc.store.resumeDocs.versions(doc.id)).toHaveLength(1)
  })

  it('TEST 7 — downloads a real, readable PDF (Letter and A4)', async () => {
    const doc = svc.resumeHelper.createFromAnswers(ANSWERS)
    expect(resumeFileName(doc)).toBe('Jordan_Rivera_Resume.pdf')
    const dir = tmpDir()
    for (const size of ['letter', 'a4'] as const) {
      const file = path.join(dir, `${size}-${resumeFileName(doc)}`)
      const res = await svc.resumeHelper.exportPdf({ ...doc, pageSize: size }, file)
      expect(fs.existsSync(file)).toBe(true)
      expect(res.pages).toBe(1)
      // Re-open independently and check the text is real, selectable text.
      const check = await inspectPdf(file)
      const text = check.text.replace(/\s+/g, ' ')
      for (const s of [
        'Jordan Rivera',
        'Harborline Distribution',
        'Pick and pack orders with an RF scanner',
        'Forklift Certification'
      ])
        expect(text).toContain(s)
      // Render every page to an image.
      const { PDFParse } = await import('pdf-parse')
      const parser = new PDFParse({ data: new Uint8Array(fs.readFileSync(file)) })
      const shots = await parser.getScreenshot({ scale: 1 })
      await parser.destroy()
      expect(shots.pages).toHaveLength(1)
      const pg = shots.pages[0]
      expect(pg.data.length).toBeGreaterThan(5000)
      const ratio = pg.width / pg.height
      expect(ratio).toBeCloseTo(size === 'letter' ? 8.5 / 11 : 210 / 297, 2)
      fs.writeFileSync(path.join(SHOTS, `11-resume-pdf-${size}.png`), Buffer.from(pg.data))
      expect(svc.resumeHelper.wasExported(file)).toBe(true)
    }
  }, 60_000)

  it('paginates long resumes identically in preview and PDF without cutting lines', async () => {
    const doc = documentFromAnswers({
      ...ANSWERS,
      experience: Array.from({ length: 9 }, (_, i) => ({
        title: `Warehouse Associate ${i + 1}`,
        company: `Employer Number ${i + 1}`,
        startDate: '2015-01',
        endDate: '2016-01',
        current: false,
        duties: Array.from(
          { length: 6 },
          (_, j) =>
            `Handled duty ${String.fromCharCode(65 + j)} for role ${i + 1} safely and accurately`
        ).join('\n')
      }))
    })
    const file = path.join(tmpDir(), 'long.pdf')
    const res = await svc.resumeHelper.exportPdf({ ...doc, template: 'modern' }, file)
    expect(res.pages).toBeGreaterThanOrEqual(2)
    // The preview paginator (run in a browser page) produces the same page count.
    const page = await browser.newPage()
    await page.setContent(renderResumeHtml({ ...doc, template: 'modern' }, { mode: 'preview' }))
    expect(await page.evaluate(PAGINATE_SCRIPT)).toBe(res.pages)
    await page.close()
    const text = (await inspectPdf(file)).text.replace(/\s+/g, ' ')
    for (let i = 1; i <= 9; i++) expect(text).toContain(`Handled duty F for role ${i} safely`)
  }, 60_000)

  it('TEST 8 — set as master updates the profile, the default resume and job scores', async () => {
    const doc = svc.resumeHelper.createFromAnswers({ ...ANSWERS, template: 'technical' })
    const before = svc.store.candidate.resumes().length
    const res = await svc.resumeHelper.setMaster(doc.id)
    expect(res.doc.isMaster).toBe(true)
    expect(res.resume.isDefault).toBe(true)
    expect(svc.store.candidate.resumes()).toHaveLength(before + 1)
    expect(fs.existsSync(res.resume.storedPath)).toBe(true)
    const p = svc.store.candidate.get()
    expect(p.workHistory.map((w) => w.company)).toEqual([
      'Harborline Distribution',
      'Bluebird Coffee'
    ])
    expect(p.skills.every((s) => s.confirmed && s.source === 'user')).toBe(true)
    expect(svc.store.candidate.defaultResume()!.id).toBe(res.resume.id)
    // Only one master at a time.
    const other = svc.resumeHelper.createFromAnswers(ANSWERS)
    await svc.resumeHelper.setMaster(other.id)
    expect(svc.store.resumeDocs.list().filter((d) => d.isMaster)).toHaveLength(1)
  }, 60_000)
})

describe('master resume changes the match score of stored jobs', () => {
  it('re-scores after the profile changes', async () => {
    const { svc } = await makeServices()
    svc.store.db.run(
      "INSERT INTO jobs (id, canonical_key, data, title, company, source, discovered_at, last_seen_at, verification_status) VALUES ('j1', 'k', ?, 'Warehouse Associate', 'C', 's', 'n', 'n', 'SOURCE_CONFIRMED')",
      [
        JSON.stringify({
          id: 'j1',
          title: 'Warehouse Associate',
          company: 'C',
          description: 'Order picking and RF scanner.',
          requiredSkills: ['order_picking'],
          preferredSkills: [],
          requiredCertifications: [],
          employmentTypes: [],
          workModes: ['onsite'],
          inferredFields: [],
          locations: [],
          sources: [],
          occupation: {
            id: 'warehouse_associate',
            label: 'Warehouse Associate',
            confidence: 1,
            basis: 'title'
          },
          verificationNotes: [],
          scamSignals: []
        })
      ]
    )
    await svc.criteria.setActive({ query: 'Warehouse Associate' })
    expect(svc.store.jobs.get('j1')!.match).toBeUndefined() // no profile yet
    svc.store.candidate.save(warehouseBaristaProfile())
    await svc.criteria.profileChanged()
    expect(svc.store.jobs.get('j1')!.match!.score).toBeGreaterThan(50)
    await svc.shutdown()
  })
})
