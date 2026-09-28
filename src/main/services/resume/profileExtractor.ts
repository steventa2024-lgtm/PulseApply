import { randomUUID } from 'crypto'
import type {
  CandidateProfile,
  EducationEntry,
  ExtractedField,
  WorkHistoryEntry
} from '../../../shared/types'
import { classifyJob } from '../jobs/search/classify'
import { CERT_BY_ID, findCertifications, findSkills, SKILL_BY_ID } from '../jobs/search/skills'
import type { Gazetteer } from '../jobs/geo/gazetteer'

/**
 * Confidence-aware resume extraction. Nothing is ever filled in from defaults:
 * a value that cannot be found is left empty with confidence 0, and anything
 * below 0.85 confidence is flagged for the user to confirm.
 */

export const CONFIRM_THRESHOLD = 0.85

const SECTION_PATTERNS: [RegExp, string][] = [
  [
    /^(professional |work |employment |relevant |career )?(experience|history|employment)( history)?$/i,
    'experience'
  ],
  [/^(education|academic background|education & training|education and training)$/i, 'education'],
  [
    /^(technical |core |key |professional )?(skills|competencies|skills & abilities|skills and abilities|skill set|expertise)$/i,
    'skills'
  ],
  [
    /^(certifications?|licenses?|licenses? (and|&) certifications?|certifications? (and|&) licenses?|certificates|credentials)$/i,
    'certifications'
  ],
  [
    /^(summary|professional summary|profile|objective|career objective|about me|about)$/i,
    'summary'
  ],
  [/^(projects|personal projects|selected projects)$/i, 'projects'],
  [
    /^(awards|honors|achievements|volunteer( experience)?|languages|interests|references)$/i,
    'other'
  ]
]

function sectionOf(line: string): string | undefined {
  const t = line
    .replace(/[:|•\-–—_*#]+$/g, '')
    .replace(/^[#*\s]+/, '')
    .trim()
  if (t.length > 40) return undefined
  for (const [re, name] of SECTION_PATTERNS) if (re.test(t)) return name
  return undefined
}

export function splitResumeSections(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = { header: [] }
  let current = 'header'
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim()
    if (!line) continue
    const sec = sectionOf(line)
    if (sec) {
      current = sec
      out[current] ??= []
      continue
    }
    ;(out[current] ??= []).push(line)
  }
  return out
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12
}
const MONTH_RE =
  '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?'
const DATE_RE = `(?:${MONTH_RE}\\s+\\d{4}|\\d{1,2}\\/\\d{4}|\\d{4})`
const RANGE_RE = new RegExp(
  `(${DATE_RE})\\s*(?:–|-|—|to|until)\\s*(${DATE_RE}|present|current|now|today)`,
  'i'
)

function parseDate(s: string, end = false): Date | undefined {
  const t = s.toLowerCase().replace(/\./g, '').trim()
  if (/present|current|now|today/.test(t)) return new Date()
  let m = /^([a-z]+)\s+(\d{4})$/.exec(t)
  if (m) {
    const month = MONTHS[m[1].slice(0, 4)] ?? MONTHS[m[1].slice(0, 3)]
    if (month) return new Date(Date.UTC(Number(m[2]), month - 1, 1))
  }
  m = /^(\d{1,2})\/(\d{4})$/.exec(t)
  if (m) return new Date(Date.UTC(Number(m[2]), Number(m[1]) - 1, 1))
  m = /^(\d{4})$/.exec(t)
  if (m) return new Date(Date.UTC(Number(m[1]), end ? 11 : 0, 1))
  return undefined
}

function monthsBetween(a: Date, b: Date): number {
  return Math.max(
    0,
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) + 1
  )
}

function isBullet(line: string): boolean {
  return (
    /^[•\-*·▪◦●]/.test(line) ||
    /^(\d+[.)]\s)/.test(line) ||
    (line.length > 70 && /[.;]$/.test(line))
  )
}

/** Splits "Title at Company", "Title | Company", "Company — Title" etc. */
function splitTitleCompany(text: string): { title?: string; company?: string } {
  const cleaned = text.replace(/[,|–—-]\s*$/, '').trim()
  const parts = cleaned
    .split(/\s+(?:at|@)\s+|\s*[|–—]\s*|\s+-\s+/i)
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length === 0) return {}
  if (parts.length === 1) return classifyJob(parts[0]) ? { title: parts[0] } : { company: parts[0] }
  const idx = parts.findIndex((p) => classifyJob(p))
  if (idx >= 0) {
    const title = parts[idx]
    const company = parts
      .filter((_, i) => i !== idx)
      .find((p) => !/^\d|, [A-Z]{2}$/.test(p) || p.length > 3)
    return { title, company }
  }
  return { title: parts[0], company: parts[1] }
}

function stripLocation(s: string): string {
  // "Harborline Distribution, Carson, CA" -> "Harborline Distribution"
  return s
    .replace(/,\s*[A-Za-z .'-]+,\s*[A-Z]{2}(\s+\d{5})?$/, '')
    .replace(/,\s*[A-Z]{2}$/, '')
    .trim()
}

export function extractWorkHistory(lines: string[]): WorkHistoryEntry[] {
  const entries: WorkHistoryEntry[] = []
  let consumedUntil = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const m = RANGE_RE.exec(line)
    if (!m) continue
    const start = parseDate(m[1])
    const end = parseDate(m[2], true)
    const current = /present|current|now|today/i.test(m[2])
    const sameLine = line
      .replace(m[0], '')
      .replace(/[(),|–—-]+\s*$/, '')
      .replace(/^\s*[(),|–—-]+/, '')
      .trim()
    let title: string | undefined
    let company: string | undefined
    if (sameLine.length > 2) {
      ;({ title, company } = splitTitleCompany(sameLine))
    }
    // Look back at up to two header lines that belong to this entry.
    const header: string[] = []
    for (let k = i - 1; k > consumedUntil && header.length < 2; k--) {
      if (isBullet(lines[k]) || RANGE_RE.test(lines[k])) break
      header.unshift(lines[k])
    }
    for (const h of header) {
      const split = splitTitleCompany(h)
      if (!title && split.title && classifyJob(split.title)) title = split.title
      else if (!company) company = split.company ?? split.title
      else if (!title) title = split.title ?? split.company
    }
    // Summary bullets until the next entry.
    const summary: string[] = []
    let j = i + 1
    for (; j < lines.length; j++) {
      if (RANGE_RE.test(lines[j])) break
      const next = lines[j + 1]
      if (!isBullet(lines[j]) && next && RANGE_RE.test(next)) break
      if (
        !isBullet(lines[j]) &&
        lines[j + 2] &&
        RANGE_RE.test(lines[j + 2]) &&
        !isBullet(lines[j + 1] ?? '')
      )
        break
      summary.push(lines[j].replace(/^[•\-*·▪◦●]\s*/, ''))
    }
    consumedUntil = j - 1
    const occ = title ? classifyJob(title) : undefined
    const months = start && end ? monthsBetween(start, end) : undefined
    entries.push({
      id: randomUUID(),
      title: title ?? '',
      company: company ? stripLocation(company) : '',
      location:
        company && company !== stripLocation(company)
          ? company.slice(stripLocation(company).length).replace(/^,\s*/, '')
          : undefined,
      startDate: start?.toISOString().slice(0, 7),
      endDate: current ? undefined : end?.toISOString().slice(0, 7),
      current,
      months,
      summary: summary.join('\n').slice(0, 1500) || undefined,
      confidence: title && company && occ ? 0.85 : title && company ? 0.7 : 0.45,
      confirmed: false
    })
  }
  return entries
}

const DEGREE_RE =
  /\b(high school diploma|diploma|ged|associate'?s?|a\.a\.?|a\.s\.?|bachelor'?s?|b\.?a\.?|b\.?s\.?c?\.?|bsc|master'?s?|m\.?a\.?|m\.?s\.?c?\.?|msc|mba|ph\.?d\.?|doctorate|certificate)\b/i
const INSTITUTION_RE =
  /\b(university|college|school|institute|academy|polytechnic|universidad|universit[äa]t|hochschule)\b/i

export function extractEducation(lines: string[]): EducationEntry[] {
  const out: EducationEntry[] = []
  for (const line of lines) {
    const hasDegree = DEGREE_RE.test(line)
    const hasInst = INSTITUTION_RE.test(line)
    if (!hasDegree && !hasInst) continue
    const year = /\b(19|20)\d{2}\b/.exec(line)?.[0]
    const parts = line
      .split(/\s*[,|–—]\s*|\s+-\s+/)
      .map((p) => p.trim())
      .filter(Boolean)
    const institution = parts.find((p) => INSTITUTION_RE.test(p)) ?? ''
    const degreePart = parts.find((p) => DEGREE_RE.test(p) && p !== institution)
    out.push({
      id: randomUUID(),
      institution,
      degree: degreePart,
      field:
        degreePart && / in | of /i.test(degreePart) ? degreePart.split(/ in | of /i)[1] : undefined,
      graduationYear: year,
      confidence: institution && degreePart ? 0.85 : 0.6,
      confirmed: false
    })
  }
  return out
}

const NAME_TOKEN = /^(?:[A-Z][a-zA-Z'’-]+|[A-Z]{2,}|[A-Z]\.)$/

function field(value: string, confidence: number): ExtractedField {
  return { value, confidence: value ? confidence : 0, source: 'resume', confirmed: false }
}

export interface ExtractionResult {
  profile: Partial<CandidateProfile>
  needsConfirmation: string[]
  warnings: string[]
}

export function extractProfile(text: string, gazetteer?: Gazetteer): ExtractionResult {
  const warnings: string[] = []
  const sections = splitResumeSections(text)
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const top = lines.slice(0, 12)

  const email = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/.exec(text)?.[1] ?? ''
  const phoneRaw =
    /(\+?\d{1,3}[\s.-]?)?(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}|\d{2,4}[\s.-]\d{3,4}[\s.-]\d{3,4})/.exec(
      top.join('\n')
    )?.[0] ?? ''
  const phone = phoneRaw.replace(/\D/g, '').length >= 10 ? phoneRaw.trim() : ''

  // Name: first short line of 2–4 capitalized tokens without contact data.
  let name = ''
  let nameConf = 0
  for (let i = 0; i < Math.min(top.length, 6); i++) {
    const l = top[i]
    if (/@|\d{3}|https?:|www\.|resume|curriculum|vitae/i.test(l) || sectionOf(l)) continue
    const tokens = l.split(/\s+/)
    if (tokens.length < 2 || tokens.length > 4 || l.length > 40) continue
    if (!tokens.every((t) => NAME_TOKEN.test(t))) continue
    if (gazetteer && gazetteer.resolve(l).precision === 'city') continue
    if (classifyJob(l)) continue
    name = tokens
      .map((t) => (t === t.toUpperCase() && t.length > 2 ? t[0] + t.slice(1).toLowerCase() : t))
      .join(' ')
    nameConf = i === 0 ? 0.85 : 0.7
    const local = email.split('@')[0]?.toLowerCase() ?? ''
    if (tokens.some((t) => t.length > 2 && local.includes(t.toLowerCase().replace(/[^a-z]/g, ''))))
      nameConf = Math.min(0.97, nameConf + 0.1)
    break
  }

  // Location: "City, ST" / "City, Country" near the top, validated against the gazetteer.
  let location = ''
  let locConf = 0
  for (const l of top) {
    for (const seg of l.split(/\s*[|·•]\s*/)) {
      const cand = seg.replace(/\b\d{5}(-\d{4})?\b/, '').trim()
      if (!/,/.test(cand) || /@|\d{3}/.test(cand) || cand.length > 60) continue
      if (!gazetteer) {
        location = cand
        locConf = 0.6
        break
      }
      const r = gazetteer.resolve(cand)
      if (r.precision === 'city') {
        location = r.label
        locConf = r.confidence >= 0.85 ? 0.9 : 0.7
        break
      }
    }
    if (location) break
  }

  const linkedin =
    /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9_%-]+\/?/i.exec(text)?.[0] ?? ''
  const github = /(?:https?:\/\/)?github\.com\/[A-Za-z0-9_-]+\/?/i.exec(text)?.[0] ?? ''
  const portfolio =
    [...text.matchAll(/https?:\/\/[^\s|,;]+/gi)]
      .map((m) => m[0])
      .find((u) => !/linkedin\.com|github\.com/i.test(u)) ?? ''
  const withScheme = (u: string): string => (u && !/^https?:\/\//i.test(u) ? `https://${u}` : u)

  const workHistory = extractWorkHistory(sections.experience ?? [])
  if (!sections.experience?.length) {
    // Some resumes have no headed experience section; scan everything.
    workHistory.push(...extractWorkHistory(lines))
  }
  const education = extractEducation(sections.education ?? [])

  // Skills: explicit skills-section items plus dictionary matches in the text.
  const skillNames = new Map<string, string>()
  for (const l of sections.skills ?? []) {
    for (const item of l.split(/\s*[,•|;·]\s*|\s{2,}/)) {
      const s = item.replace(/^[-*]\s*/, '').trim()
      if (s.length >= 2 && s.length <= 50 && !/^(and|or)$/i.test(s))
        skillNames.set(s.toLowerCase(), s)
    }
  }
  for (const id of findSkills(text)) {
    const label = SKILL_BY_ID.get(id)?.label ?? id
    if (![...skillNames.values()].some((n) => findSkills(n, { strict: false }).includes(id)))
      skillNames.set(label.toLowerCase(), label)
  }

  const certNames = new Map<string, string>()
  for (const l of sections.certifications ?? []) {
    const s = l.replace(/^[•\-*·]\s*/, '').trim()
    if (s.length >= 3 && s.length <= 120) certNames.set(s.toLowerCase(), s)
  }
  for (const id of findCertifications(text)) {
    const label = CERT_BY_ID.get(id)!.label
    if (![...certNames.values()].some((n) => findCertifications(n, { strict: false }).includes(id)))
      certNames.set(label.toLowerCase(), label)
  }

  let totalMonths = 0
  const ranges = workHistory
    .filter((w) => w.startDate)
    .map(
      (w) =>
        [
          Date.parse(w.startDate + '-01'),
          w.current ? Date.now() : Date.parse((w.endDate ?? w.startDate) + '-01')
        ] as [number, number]
    )
    .sort((a, b) => a[0] - b[0])
  let cur: [number, number] | null = null
  for (const r of ranges) {
    if (!cur || r[0] > cur[1]) {
      if (cur) totalMonths += Math.round((cur[1] - cur[0]) / (30.44 * 86400_000)) + 1
      cur = [...r]
    } else cur[1] = Math.max(cur[1], r[1])
  }
  if (cur) totalMonths += Math.round((cur[1] - cur[0]) / (30.44 * 86400_000)) + 1

  const [firstName, ...rest] = name.split(' ')
  const profile: Partial<CandidateProfile> = {
    fullName: field(name, nameConf),
    firstName: firstName || undefined,
    lastName: rest.length ? rest.join(' ') : undefined,
    email: field(email, 0.95),
    phone: field(phone, 0.9),
    location: field(location, locConf),
    linkedinUrl: withScheme(linkedin),
    githubUrl: withScheme(github),
    portfolioUrl: portfolio,
    summary: (sections.summary ?? []).join(' ').slice(0, 800) || undefined,
    skills: [...skillNames.values()].map((n) => ({
      name: n,
      source: 'resume' as const,
      confirmed: false
    })),
    certifications: [...certNames.values()].map((n) => ({
      name: n,
      source: 'resume' as const,
      confirmed: false
    })),
    workHistory,
    education,
    totalExperienceMonths: totalMonths || undefined
  }

  const needsConfirmation: string[] = []
  const check = (label: string, f?: ExtractedField): void => {
    if (!f || !f.value) needsConfirmation.push(`${label} (not found)`)
    else if (f.confidence < CONFIRM_THRESHOLD) needsConfirmation.push(`${label} (low confidence)`)
  }
  check('Full name', profile.fullName)
  check('Email', profile.email)
  check('Phone', profile.phone)
  check('Location', profile.location)
  if (workHistory.some((w) => w.confidence < CONFIRM_THRESHOLD))
    needsConfirmation.push('Some work history entries')
  if (!workHistory.length)
    warnings.push(
      'No dated work history was recognised; add your experience manually on the Profile page.'
    )
  if (!skillNames.size) warnings.push('No skills were recognised; add them manually.')
  return { profile, needsConfirmation, warnings }
}
