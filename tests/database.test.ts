import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { AppDb } from '../src/main/services/persistence/database'
import { makeServices, tmpDir } from './helpers'

/** Shape written by the pre-upgrade app (src/main/services/db.ts in git history). */
const LEGACY = {
  profile: {
    fileName: 'resume.pdf',
    rawText: 'Jordan Rivera\nWarehouse Associate\nInventory Management',
    contact: { fullName: 'Jordan Rivera', email: 'jordan@example.com', phone: '562-555-0147', location: 'Lakewood, CA' },
    extractedSkills: ['Inventory Management', 'Warehouse Operations'],
    detectedRoles: ['Warehouse / Office Manager'],
    wordCount: 6,
    updatedAt: '2026-09-20T00:00:00.000Z'
  },
  candidate: {
    fullName: 'Jordan Rivera',
    email: 'jordan@example.com',
    phone: '562-555-0147',
    location: 'Lakewood, CA',
    linkedinUrl: 'https://linkedin.com/in/jordan-test',
    githubUrl: '',
    portfolioUrl: '',
    workAuthorization: 'US Citizen',
    resumeFilePath: '/nonexistent/resume.pdf'
  },
  settings: { minScoreThreshold: 75, cronIntervalHours: 3, targetRoles: ['Warehouse / Office Manager'], targetLocation: 'Lakewood, CA', hitlApprovalRequired: true },
  jobs: [
    { id: 'job_lakewood_101', title: 'Warehouse & Operations Lead', company: 'Pacific Freight Logistics', location: 'Long Beach, CA', source: 'Indeed', url: 'https://indeed.com', description: 'x', requiredSkills: [], matchScore: 96, matchedSkills: [], missingSkills: [], discoveredAt: '2026-09-20T00:00:00.000Z', status: 'applied' },
    { id: 'job_lakewood_102', title: 'Lead Barista', company: 'Roast & Steam', location: 'Lakewood, CA', source: 'Indeed', url: 'https://indeed.com', description: 'x', requiredSkills: [], matchScore: 90, matchedSkills: [], missingSkills: [], discoveredAt: '2026-09-20T00:00:00.000Z', status: 'dismissed' },
    { id: 'job_lakewood_103', title: 'Office Coordinator', company: 'Apex', location: 'Cerritos, CA', source: 'LinkedIn', url: 'https://linkedin.com', description: 'x', requiredSkills: [], matchScore: 80, matchedSkills: [], missingSkills: [], discoveredAt: '2026-09-20T00:00:00.000Z', status: 'queued' }
  ]
}

describe('legacy JSON migration', () => {
  it('backs up, imports honestly, and is idempotent', async () => {
    const dir = tmpDir()
    const legacyPath = path.join(dir, 'pulseapply_db.json')
    fs.writeFileSync(legacyPath, '﻿' + JSON.stringify(LEGACY))
    const original = fs.readFileSync(legacyPath)

    const { svc } = await makeServices({ userDataDir: dir })
    const report = svc.store.settings.getRaw<{ performed: boolean; backupPath: string; imported: Record<string, unknown>; notes: string[] }>('legacy_import_report', null as never)
    expect(report.performed).toBe(true)
    expect(fs.readFileSync(report.backupPath).equals(original)).toBe(true)
    expect(fs.readFileSync(legacyPath).equals(original)).toBe(true) // never modified
    expect(report.imported).toMatchObject({ candidate: true, profile: true, jobs: 3, applications: 1, settings: true })

    const p = svc.store.candidate.get()
    expect(p.fullName).toMatchObject({ value: 'Jordan Rivera', confirmed: false })
    expect(p.linkedinUrl).toBe('https://linkedin.com/in/jordan-test')
    // The legacy default was not treated as an explicit answer.
    expect(p.sensitive.authorizedToWork).toEqual({})
    expect(report.notes.join()).toMatch(/not imported/)

    // Legacy sample jobs are preserved but hidden from results.
    expect(svc.store.jobs.list({ view: 'all' })).toHaveLength(0)
    const apps = svc.store.applications.list()
    expect(apps).toHaveLength(1)
    expect(apps[0]).toMatchObject({ state: 'SUBMISSION_UNVERIFIED', origin: 'legacy_import' })
    expect(apps[0].evidence[0].kind).toBe('user_report')
    expect(svc.store.candidate.resumes()[0].warnings.join()).toMatch(/re-upload/)
    await svc.shutdown()

    // Re-open: no duplicate import, data survives restart.
    const { svc: again } = await makeServices({ userDataDir: dir })
    expect(again.store.applications.list()).toHaveLength(1)
    expect(again.store.candidate.resumes()).toHaveLength(1)
    expect(fs.readdirSync(dir).filter((f) => f.startsWith('pulseapply_db.backup-'))).toHaveLength(1)
    await again.shutdown()
  })
})

describe('SQLite persistence', () => {
  it('rolls back failed transactions', async () => {
    const db = await AppDb.open(null)
    db.run("INSERT INTO settings (key, value) VALUES ('a', '1')")
    expect(() =>
      db.transaction(() => {
        db.run("INSERT INTO settings (key, value) VALUES ('b', '2')")
        db.transaction(() => {
          db.run("INSERT INTO settings (key, value) VALUES ('c', '3')")
        })
        throw new Error('fail')
      })
    ).toThrow('fail')
    expect(db.all('SELECT key FROM settings ORDER BY key')).toEqual([{ key: 'a' }])
  })

  it('enforces foreign keys', async () => {
    const db = await AppDb.open(null)
    expect(() =>
      db.run("INSERT INTO applications (id, job_id, state, adapter, source_url, origin, created_at, updated_at) VALUES ('x', 'missing', 'QUEUED', 'generic', 'https://e.com', 'desktop', 'n', 'n')")
    ).toThrow(/FOREIGN KEY/)
  })

  it('writes atomically and survives restart', async () => {
    const dir = tmpDir()
    const file = path.join(dir, 'x.sqlite')
    const db = await AppDb.open(file)
    db.run("INSERT INTO settings (key, value) VALUES ('k', '\"v\"')")
    db.flush()
    db.run("UPDATE settings SET value = '\"v2\"' WHERE key = 'k'")
    db.close()
    expect(fs.existsSync(file + '.prev')).toBe(true)
    const reopened = await AppDb.open(file)
    expect(reopened.get<{ value: string }>("SELECT value FROM settings WHERE key = 'k'")!.value).toBe('"v2"')
    expect(reopened.schemaVersion).toBe(1)
    // Recovery from a missing primary file.
    reopened.close()
    fs.rmSync(file)
    const recovered = await AppDb.open(file)
    expect(recovered.get("SELECT value FROM settings WHERE key = 'k'")).toBeDefined()
  })

  it('encrypts credentials and sensitive answers at rest', async () => {
    const dir = tmpDir()
    const { svc } = await makeServices({ userDataDir: dir })
    svc.store.secrets.set('adzuna.appKey', 'super-secret-key-1')
    const p = svc.store.candidate.get()
    p.sensitive.requiresSponsorship = 'no'
    svc.store.candidate.save(p)
    await svc.shutdown()
    const raw = fs.readFileSync(path.join(dir, 'pulseapply.sqlite')).toString('latin1')
    expect(raw).not.toContain('super-secret-key-1')
    expect(raw).not.toContain('requiresSponsorship')
    const { svc: again } = await makeServices({ userDataDir: dir })
    expect(again.store.secrets.get('adzuna.appKey')).toBe('super-secret-key-1')
    expect(again.store.candidate.get().sensitive.requiresSponsorship).toBe('no')
    await again.shutdown()
  })

  it('application history survives restart', async () => {
    const dir = tmpDir()
    const { svc } = await makeServices({ userDataDir: dir })
    svc.store.db.run(
      "INSERT INTO jobs (id, canonical_key, data, title, company, source, discovered_at, last_seen_at, verification_status) VALUES ('j1', 'k', '{}', 'T', 'C', 's', 'n', 'n', 'SOURCE_CONFIRMED')"
    )
    const app = svc.store.applications.create({ jobId: 'j1', state: 'OPENING', adapter: 'generic', sourceUrl: 'https://e.com', origin: 'desktop', message: 'open' })
    svc.store.applications.transition(app.id, 'MANUAL_COMPLETION_REQUIRED', 'manual')
    await svc.shutdown()
    const { svc: again } = await makeServices({ userDataDir: dir })
    expect(again.store.applications.get(app.id)!.state).toBe('MANUAL_COMPLETION_REQUIRED')
    expect(again.store.applications.events(app.id).map((e) => e.toState)).toEqual(['OPENING', 'MANUAL_COMPLETION_REQUIRED'])
    expect(() => again.store.applications.transition(app.id, 'APPROVED', 'x')).toThrow(/cannot move/)
    await again.shutdown()
  })
})
