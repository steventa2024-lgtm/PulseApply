import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { makeServices } from './helpers'
import { extractResumeText } from '../src/main/services/resume/extractText'
import { extractProfile } from '../src/main/services/resume/profileExtractor'
import { Gazetteer } from '../src/main/services/jobs/geo/gazetteer'
import { htmlToText } from '../src/main/services/jobs/normalization/text'
import { assertPublicUrl, isPublicHttpUrl, canonicalizeUrl } from '../src/main/services/jobs/verification/urlSafety'
import { isAllowed, parseRobots } from '../src/main/services/jobs/discovery/robots'
import { extractJsonLd, jobPostingToDraft } from '../src/main/services/jobs/providers/careerPages'
import { detectAtsFromUrl, detectAtsInHtml } from '../src/main/services/jobs/discovery/atsDetect'
import { validatePayload } from '../src/main/ipc/handlers'
import { redact, registerSecret } from '../src/main/services/logger'
import { RESOURCES } from './helpers'

const FIX = path.join(__dirname, 'fixtures', 'resumes')
const gaz = new Gazetteer(RESOURCES)

describe('resume parsing', () => {
  it('parses a text PDF without inventing anything', async () => {
    const t = await extractResumeText('r.pdf', fs.readFileSync(path.join(FIX, 'warehouse_barista.pdf')))
    const { profile, needsConfirmation } = extractProfile(t.text, gaz)
    expect(profile.fullName!.value).toBe('Jordan Rivera')
    expect(profile.email!.value).toBe('jordan.rivera.test@example.com')
    expect(profile.location!.value).toBe('Lakewood, CA')
    expect(profile.workHistory!.map((w) => [w.title, w.company])).toEqual([
      ['Warehouse Associate', 'Harborline Distribution'],
      ['Barista', 'Bluebird Coffee Co.']
    ])
    expect(profile.education![0]).toMatchObject({ institution: 'Lakewood High School', graduationYear: '2018' })
    expect(profile.certifications!.map((c) => c.name).join()).toMatch(/Food Handler/)
    expect(needsConfirmation).toEqual([])
  })

  it('parses DOCX resumes', async () => {
    const t = await extractResumeText('r.docx', fs.readFileSync(path.join(FIX, 'frontend_dev.docx')))
    const { profile } = extractProfile(t.text, gaz)
    expect(profile.fullName!.value).toBe('Sam Lee')
    expect(profile.githubUrl).toBe('https://github.com/samlee-test')
    expect(profile.workHistory![0]).toMatchObject({ title: 'Junior Frontend Developer', company: 'Pixelworks Studio', current: true })
    expect(profile.skills!.map((s) => s.name)).toEqual(expect.arrayContaining(['React', 'TypeScript']))
  })

  it('detects scanned PDFs and returns empty, unconfirmed fields', async () => {
    const t = await extractResumeText('scan.pdf', fs.readFileSync(path.join(FIX, 'scanned.pdf')))
    expect(t.needsOcr).toBe(true)
    expect(t.warnings.join()).toMatch(/scanned/)
    const { profile, needsConfirmation } = extractProfile(t.text, gaz)
    expect(profile.fullName!.value).toBe('')
    expect(profile.email!.value).toBe('')
    expect(needsConfirmation).toContain('Full name (not found)')
  })

  it('stores resume versions, never overwrites confirmed fields, and deletes files', async () => {
    const { svc } = await makeServices()
    const p = svc.store.candidate.get()
    p.fullName = { value: 'Jordan R. Rivera', confidence: 1, source: 'user', confirmed: true }
    svc.store.candidate.save(p)
    const r1 = await svc.resumes.importFile(path.join(FIX, 'warehouse_barista.pdf'))
    const r2 = await svc.resumes.importFile(path.join(FIX, 'frontend_dev.docx'), { label: 'Tech resume' })
    expect(svc.store.candidate.get().fullName.value).toBe('Jordan R. Rivera')
    const list = svc.store.candidate.resumes()
    expect(list).toHaveLength(2)
    expect(list.find((r) => r.id === r1.resume.id)!.isDefault).toBe(true)
    expect(fs.existsSync(r2.resume.storedPath)).toBe(true)
    expect(path.dirname(r2.resume.storedPath)).toBe(svc.paths.resumes)
    const dup = await svc.resumes.importFile(path.join(FIX, 'warehouse_barista.pdf'))
    expect(dup.resume.id).toBe(r1.resume.id)
    expect(svc.store.candidate.resumes()).toHaveLength(2)
    svc.resumes.deleteAll()
    expect(fs.existsSync(r2.resume.storedPath)).toBe(false)
    expect(svc.store.candidate.resumes()).toHaveLength(0)
    await svc.shutdown()
  })

  it('rejects unsafe resume file names and types', async () => {
    const { svc } = await makeServices()
    await expect(svc.resumes.importBuffer('../../evil.exe', Buffer.from('MZ'))).rejects.toThrow(/Unsupported/)
    const ok = await svc.resumes.importBuffer('../../../escape.txt', Buffer.from('Jane Doe\njane@example.com'))
    expect(path.dirname(ok.resume.storedPath)).toBe(svc.paths.resumes)
    await svc.shutdown()
  })
})

describe('security helpers', () => {
  it('sanitizes job HTML to text and drops scripts', () => {
    const t = htmlToText('<p>Hello</p><script>alert(1)</script><img src=x onerror=alert(2)><ul><li>One</li></ul>')
    expect(t).not.toMatch(/alert|<|onerror/)
    expect(t).toContain('• One')
  })

  it('rejects private, credentialed and non-http URLs', async () => {
    expect(isPublicHttpUrl('https://boards.greenhouse.io/x')).toBe(true)
    for (const u of ['javascript:alert(1)', 'file:///etc/passwd', 'http://127.0.0.1/', 'http://localhost:3000', 'http://192.168.0.1', 'http://[::1]/', 'https://user:pw@example.com', 'http://169.254.169.254/latest']) {
      expect(isPublicHttpUrl(u), u).toBe(false)
    }
    await expect(assertPublicUrl('http://10.0.0.5/careers')).rejects.toThrow()
    expect(canonicalizeUrl('https://Example.com/jobs/1?utm_source=x&gh_src=y&id=5#top')).toBe('https://example.com/jobs/1?id=5')
  })

  it('respects robots.txt', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /careers/search\nAllow: /careers/search/public\n\nUser-agent: badbot\nDisallow: /\nSitemap: https://e.com/sitemap.xml')
    expect(isAllowed(rules, '/careers/search?q=x')).toBe(false)
    expect(isAllowed(rules, '/careers/search/public')).toBe(true)
    expect(isAllowed(rules, '/careers/job/1')).toBe(true)
    expect(rules.sitemaps).toEqual(['https://e.com/sitemap.xml'])
  })

  it('extracts schema.org JobPosting data', () => {
    const html = `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"JobPosting","title":"Barista","datePosted":"2026-09-01","validThrough":"2099-01-01",
      "employmentType":["PART_TIME"],"hiringOrganization":{"@type":"Organization","name":"Bean Co","sameAs":"https://beanco.example"},
      "jobLocation":{"@type":"Place","address":{"addressLocality":"Long Beach","addressRegion":"CA","addressCountry":"US"},"geo":{"latitude":33.77,"longitude":-118.19}},
      "baseSalary":{"@type":"MonetaryAmount","currency":"USD","value":{"@type":"QuantitativeValue","minValue":18,"maxValue":21,"unitText":"HOUR"}},"identifier":{"value":"BC-77"}}]}</script>`
    const [jp] = extractJsonLd(html)
    const d = jobPostingToDraft(jp, 'https://beanco.example/careers/77', 'Bean Co')!
    expect(d).toMatchObject({ title: 'Barista', company: 'Bean Co', sourceJobId: 'BC-77', employmentTypes: ['part_time'], salary: { min: 18, max: 21, period: 'hour' } })
    expect(d.places![0]).toMatchObject({ city: 'Long Beach', country: 'US', coordinates: { lat: 33.77, lon: -118.19 } })
  })

  it('detects ATS boards from URLs and embedded career pages', () => {
    expect(detectAtsFromUrl('https://job-boards.greenhouse.io/acme/jobs/123')).toEqual({ provider: 'greenhouse', board: 'acme', postingId: '123' })
    expect(detectAtsFromUrl('https://jobs.lever.co/acme/1b2c3d4e-0000-4000-8000-000000000001/apply')).toMatchObject({ provider: 'lever', board: 'acme' })
    expect(detectAtsFromUrl('https://jobs.ashbyhq.com/Acme%20Inc')).toMatchObject({ provider: 'ashby', board: 'Acme Inc' })
    expect(detectAtsFromUrl('https://jobs.smartrecruiters.com/AcmeCorp/743999912345-barista')).toMatchObject({ provider: 'smartrecruiters', board: 'AcmeCorp', postingId: '743999912345' })
    expect(detectAtsInHtml('<script src="https://boards.greenhouse.io/embed/job_board/js?for=acmecoffee"></script>')).toEqual([{ provider: 'greenhouse', board: 'acmecoffee' }])
  })

  it('validates IPC payloads', () => {
    expect(() => validatePayload('jobs:open-external', { url: 5 })).toThrow(/Invalid request/)
    expect(() => validatePayload('search:run', { query: 'x', radius: -3 })).toThrow(/radius/)
    expect(() => validatePayload('telegram:authorize', { chatId: 'abc; drop' })).toThrow()
    expect(() => validatePayload('settings:update', { ollama: { baseUrl: 'http://evil.example.com:11434' } })).toThrow(/localhost/)
    expect(validatePayload('search:run', { query: 'barista', location: 'Lakewood, CA', radius: 15 })).toMatchObject({ query: 'barista' })
  })

  it('redacts secrets from logs', () => {
    registerSecret('my-adzuna-key-123')
    expect(redact('GET https://api.adzuna.com/v1?app_id=abc&app_key=my-adzuna-key-123')).not.toContain('my-adzuna-key-123')
    expect(redact('https://api.telegram.org/bot123456789:AAHfakeTokenForTestsOnly_abcdefghijklmn/getUpdates')).not.toContain('AAHfake')
  })
})
