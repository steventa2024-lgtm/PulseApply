import { randomUUID } from 'crypto'
import type { CandidateProfile } from '../../../shared/types'
import {
  DEFAULT_SECTION_ORDER,
  emptyResumeDocument,
  type ResumeContact,
  type ResumeDocument,
  type ResumePageSize,
  type ResumeSuggestion,
  type ResumeTemplateId
} from '../../../shared/resume'
import { classifyQuery } from '../jobs/search/classify'
import { OCCUPATION_BY_ID } from '../jobs/search/taxonomy'
import { findSkills, skillLabel } from '../jobs/search/skills'
import type { HttpClient } from '../jobs/adapters/http'

/** Answers collected by the guided "Create new resume" questionnaire. */
export interface ResumeQuestionnaire {
  contact: ResumeContact
  targetRole: string
  experience: {
    title: string
    company: string
    location?: string
    startDate?: string
    endDate?: string
    current: boolean
    /** What the person did, one item per line, in their own words. */
    duties: string
  }[]
  education: { institution: string; degree?: string; field?: string; graduationDate?: string }[]
  skills: string[]
  certifications: { name: string; issuer?: string; date?: string }[]
  template: ResumeTemplateId
  pageSize: ResumePageSize
}

const IRREGULAR: Record<string, string> = {
  lead: 'led',
  run: 'ran',
  make: 'made',
  build: 'built',
  write: 'wrote',
  teach: 'taught',
  sell: 'sold',
  keep: 'kept',
  drive: 'drove',
  oversee: 'oversaw',
  give: 'gave',
  take: 'took',
  meet: 'met',
  send: 'sent',
  pay: 'paid',
  hold: 'held',
  buy: 'bought',
  bring: 'brought',
  get: 'got',
  set: 'set',
  put: 'put',
  cut: 'cut'
}
const GERUND_BASE: Record<string, string> = {
  leading: 'lead',
  running: 'run',
  making: 'make',
  building: 'build',
  writing: 'write',
  teaching: 'teach',
  selling: 'sell',
  keeping: 'keep',
  driving: 'drive',
  overseeing: 'oversee',
  giving: 'give',
  taking: 'take',
  meeting: 'meet',
  sending: 'send',
  paying: 'pay',
  holding: 'hold',
  buying: 'buy',
  bringing: 'bring',
  getting: 'get',
  setting: 'set',
  putting: 'put',
  cutting: 'cut'
}

/** "managing" -> "managed", "shipping" -> "shipped", "leading" -> "led". */
export function gerundToPast(word: string): string | undefined {
  const w = word.toLowerCase()
  if (!w.endsWith('ing') || w.length < 5) return undefined
  const base = GERUND_BASE[w]
  if (base) return IRREGULAR[base]
  const stem = w.slice(0, -3)
  if (/(.)\1$/.test(stem) && !/(ss|ll|ff|zz)$/.test(stem)) return stem + 'ed' // shipping -> shipped
  if (/[^aeiou]y$/.test(stem)) return stem.slice(0, -1) + 'ied'
  return stem + 'ed'
}

const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s)

/** Deterministic, meaning-preserving clean-up of one bullet written by the user. */
export function tidyBullet(text: string, current: boolean): string {
  let t = text
    .trim()
    .replace(/^[•\-*·▪◦●]\s*/, '')
    .replace(/\s+/g, ' ')
  t = t.replace(/^(i'm|i am|we are|we're)\s+/i, '')
  t = t.replace(/^(i|we)\s+(?=[a-z])/i, '')
  t = t.replace(/\.$/, '')
  if (!current) {
    const m =
      /^(?:responsible for|in charge of|duties included|tasked with)\s+([a-z]+ing)\b\s*/i.exec(t)
    if (m) {
      const past = gerundToPast(m[1])
      if (past) t = past + ' ' + t.slice(m[0].length)
    }
  }
  return cap(t)
}

function splitDuties(text: string): string[] {
  return text
    .split(/\n|;|•/)
    .map((x) => x.trim())
    .filter((x) => x.length > 1)
}

function monthsBetween(start?: string, end?: string): number {
  const p = (s?: string): number | undefined => {
    const m = /^(\d{4})-(\d{2})$/.exec(s ?? '')
    return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : undefined
  }
  const a = p(start)
  const now = new Date()
  const b = p(end) ?? now.getFullYear() * 12 + now.getMonth()
  return a !== undefined && b >= a ? b - a + 1 : 0
}

function yearsLabel(months: number): string | undefined {
  if (months < 12) return undefined
  const y = Math.floor(months / 12)
  return `${y}+ year${y === 1 ? '' : 's'}`
}

/**
 * Factual summary built only from what the document already states (role,
 * total dated experience, listed skills). Returns undefined when there is not
 * enough information — PulseApply never invents a profile.
 */
export function factualSummary(doc: ResumeDocument): string | undefined {
  const role = doc.targetRole?.trim() || doc.experience[0]?.title
  if (!role) return undefined
  const months = doc.experience.reduce(
    (a, e) => a + monthsBetween(e.startDate, e.current ? undefined : e.endDate),
    0
  )
  const years = yearsLabel(months)
  const skills = doc.skills.slice(0, 4)
  const exp = years ? ` with ${years} of hands-on experience` : ''
  const sk = skills.length
    ? ` Skilled in ${skills.join(', ').replace(/, ([^,]*)$/, ' and $1')}.`
    : ''
  return `${cap(role)}${exp}.${sk}`.replace(/\.\./g, '.')
}

/** Structured resume document from the stored profile and parsed resume (import path). */
export function documentFromProfile(
  profile: CandidateProfile,
  opts: { id?: string; resumeId?: string; name?: string } = {}
): ResumeDocument {
  const doc = emptyResumeDocument(opts.id ?? randomUUID())
  doc.origin = 'imported'
  doc.sourceResumeId = opts.resumeId
  doc.name = opts.name ?? 'Imported resume'
  doc.contact = {
    fullName: profile.fullName.value,
    email: profile.email.value,
    phone: profile.phone.value,
    location: profile.location.value,
    linkedin: profile.linkedinUrl,
    website: profile.portfolioUrl || profile.githubUrl
  }
  doc.headline = profile.headline
  doc.summary = profile.summary
  doc.experience = profile.workHistory.map((w) => ({
    id: w.id,
    title: w.title,
    company: w.company,
    location: w.location,
    startDate: w.startDate,
    endDate: w.endDate,
    current: w.current,
    bullets: w.summary ? splitDuties(w.summary) : []
  }))
  doc.education = profile.education.map((e) => ({
    id: e.id,
    institution: e.institution,
    degree: e.degree,
    field: e.field,
    graduationDate: e.graduationYear
  }))
  doc.skills = profile.skills.map((s) => s.name)
  doc.certifications = profile.certifications.map((c) => ({ id: randomUUID(), name: c.name }))
  doc.targetRole = profile.preferences.targetRoles[0]
  return doc
}

/** Builds a resume from questionnaire answers — only the facts the user entered. */
export function documentFromAnswers(a: ResumeQuestionnaire, id = randomUUID()): ResumeDocument {
  const doc = emptyResumeDocument(id)
  doc.origin = 'created'
  doc.name = a.targetRole ? `${a.targetRole} resume` : 'My resume'
  doc.template = a.template
  doc.pageSize = a.pageSize
  doc.contact = { ...a.contact }
  doc.targetRole = a.targetRole || undefined
  doc.headline = a.targetRole || undefined
  doc.experience = a.experience
    .filter((e) => e.title.trim() || e.company.trim())
    .map((e) => ({
      id: randomUUID(),
      title: e.title.trim(),
      company: e.company.trim(),
      location: e.location?.trim() || undefined,
      startDate: e.startDate || undefined,
      endDate: e.current ? undefined : e.endDate || undefined,
      current: e.current,
      bullets: splitDuties(e.duties).map((d) => tidyBullet(d, e.current))
    }))
  doc.education = a.education
    .filter((e) => e.institution.trim())
    .map((e) => ({ id: randomUUID(), ...e, institution: e.institution.trim() }))
  doc.skills = [...new Set(a.skills.map((s) => s.trim()).filter(Boolean))]
  doc.certifications = a.certifications
    .filter((c) => c.name.trim())
    .map((c) => ({ id: randomUUID(), ...c, name: c.name.trim() }))
  doc.sectionOrder = [...DEFAULT_SECTION_ORDER]
  doc.summary = factualSummary(doc)
  return doc
}

/** Skill suggestions for a target role (for the questionnaire's checklist). */
export function roleSkillHints(role: string): string[] {
  const ids = classifyQuery(role).slice(0, 2)
  const out = new Set<string>()
  for (const id of ids)
    for (const s of OCCUPATION_BY_ID.get(id)?.skills ?? []) out.add(skillLabel(s))
  return [...out].slice(0, 16)
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

/**
 * Deterministic resume review. Rules only rephrase or reorganize what the
 * user wrote; anything that would add a claim (a skill, a keyword) is marked
 * `requiresConfirmation` and is advice until the user accepts it.
 */
export function analyzeResume(
  doc: ResumeDocument,
  opts: { targetRole?: string; jobText?: string } = {}
): ResumeSuggestion[] {
  const out: ResumeSuggestion[] = []
  const push = (s: Omit<ResumeSuggestion, 'id' | 'source'>): void => {
    out.push({ ...s, id: `${s.kind}:${s.path}`, source: 'rules' })
  }
  const c = doc.contact
  for (const [key, label] of [
    ['fullName', 'your name'],
    ['email', 'an email address'],
    ['phone', 'a phone number'],
    ['location', 'your city and state/country']
  ] as const) {
    if (!c[key]?.trim())
      push({
        kind: 'missing_contact',
        path: `contact.${key}`,
        section: 'contact',
        message: `Add ${label} so employers can reach you.`,
        requiresConfirmation: false
      })
  }

  if (!doc.summary?.trim()) {
    const draft = factualSummary(doc)
    push({
      kind: 'missing_summary',
      path: 'summary',
      section: 'summary',
      message: draft
        ? 'Add a short summary. This draft uses only facts already in your resume — edit it before accepting.'
        : 'Add a two-line summary of the work you do and want to do.',
      after: draft,
      requiresConfirmation: true
    })
  }

  let quantityAdviceGiven = 0
  doc.experience.forEach((e, i) => {
    if (!e.startDate)
      push({
        kind: 'date_missing',
        path: `experience.${i}.startDate`,
        section: 'experience',
        message: `Add a start date for “${e.title || e.company}”. Employers and ATS systems expect dates.`,
        requiresConfirmation: false
      })
    if (e.bullets.filter((b) => b.trim()).length === 0) {
      push({
        kind: 'no_bullets',
        path: `experience.${i}.bullets`,
        section: 'experience',
        message: `Add 2–4 lines describing what you did as ${e.title || 'this role'} (tasks, tools, responsibilities).`,
        requiresConfirmation: false
      })
      return
    }
    e.bullets.forEach((b, j) => {
      const path = `experience.${i}.bullets.${j}`
      const tidy = tidyBullet(b, e.current)
      if (/^(i|we|i'm|i am)\b/i.test(b.trim()) && tidy !== b.trim()) {
        push({
          kind: 'first_person',
          path,
          section: 'experience',
          message: 'Resume lines usually omit “I”.',
          before: b,
          after: tidy,
          requiresConfirmation: false
        })
      } else if (/^(responsible for|in charge of|duties included|tasked with)\b/i.test(b.trim())) {
        push({
          kind: 'weak_verb',
          path,
          section: 'experience',
          message:
            tidy !== b.trim()
              ? 'Start with an action verb instead of “Responsible for”.'
              : 'Start with an action verb (e.g. “Managed…”, “Handled…”) instead of “Responsible for”.',
          before: b,
          after: tidy !== b.trim() ? tidy : undefined,
          requiresConfirmation: false
        })
      }
      if (b.length > 220)
        push({
          kind: 'long_bullet',
          path,
          section: 'experience',
          message: 'This line is long; consider splitting it into two shorter lines.',
          before: b,
          requiresConfirmation: false
        })
    })
    if (quantityAdviceGiven < 2 && !e.bullets.some((b) => /\d/.test(b))) {
      quantityAdviceGiven++
      push({
        kind: 'add_quantity',
        path: `experience.${i}.bullets`,
        section: 'experience',
        message: `If you know real numbers for “${e.title}” (orders per shift, customers per day, team size), adding one helps. Only use numbers you can back up — PulseApply never estimates them.`,
        requiresConfirmation: false
      })
    }
  })

  // Skills demonstrated in the user's own lines but not listed.
  const listed = new Set(doc.skills.map((s) => s.toLowerCase()))
  const text = [doc.summary ?? '', ...doc.experience.flatMap((e) => e.bullets)].join('\n')
  const found = findSkills(text)
    .map(skillLabel)
    .filter((l) => !listed.has(l.toLowerCase()))
  if (found.length)
    push({
      kind: 'skill_in_text',
      path: 'skills',
      section: 'skills',
      message: `Your experience mentions ${found.join(', ')} — add ${found.length === 1 ? 'it' : 'them'} to Skills so applicant-tracking systems find ${found.length === 1 ? 'it' : 'them'}.`,
      after: found.join(', '),
      requiresConfirmation: true
    })

  const dupes = doc.skills.filter(
    (s, i) => doc.skills.findIndex((x) => x.toLowerCase() === s.toLowerCase()) !== i
  )
  if (dupes.length)
    push({
      kind: 'duplicate_skill',
      path: 'skills',
      section: 'skills',
      message: `Remove duplicate skills: ${[...new Set(dupes)].join(', ')}.`,
      requiresConfirmation: false
    })

  // Keywords commonly requested for the target role / job that are not in the resume.
  const target = opts.targetRole ?? doc.targetRole
  const wanted = new Set<string>()
  if (opts.jobText) for (const s of findSkills(opts.jobText)) wanted.add(skillLabel(s))
  if (target) for (const s of roleSkillHints(target).slice(0, 8)) wanted.add(s)
  const docText = `${text}\n${doc.skills.join('\n')}`.toLowerCase()
  const missing = [...wanted].filter((w) => !docText.includes(w.toLowerCase())).slice(0, 8)
  if (missing.length)
    push({
      kind: 'target_keyword',
      path: 'skills',
      section: 'skills',
      message: `${opts.jobText ? 'This job' : `${target} postings`} often ask for: ${missing.join(', ')}. Add only the ones you genuinely have.`,
      after: missing.join(', '),
      requiresConfirmation: true
    })

  const words = text.split(/\s+/).length + doc.skills.length
  if (words > 900)
    push({
      kind: 'too_long',
      path: 'experience',
      section: 'experience',
      message:
        'This resume is long. Most employers prefer one to two pages; trim older or less relevant lines.',
      requiresConfirmation: false
    })
  return out
}

/** Applies an accepted suggestion (optionally with the user's edited text). */
export function applySuggestion(
  doc: ResumeDocument,
  s: ResumeSuggestion,
  edited?: string
): ResumeDocument {
  const value = edited ?? s.after
  if (value === undefined) return doc
  const next: ResumeDocument = JSON.parse(JSON.stringify(doc))
  const parts = s.path.split('.')
  if (s.path === 'summary') next.summary = value
  else if (s.path === 'skills') {
    const add = value
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
    const have = new Set(next.skills.map((x) => x.toLowerCase()))
    next.skills = [...next.skills, ...add.filter((a) => !have.has(a.toLowerCase()))]
  } else if (parts[0] === 'experience' && parts[2] === 'bullets' && parts[3] !== undefined) {
    const e = next.experience[Number(parts[1])]
    if (e && e.bullets[Number(parts[3])] !== undefined) e.bullets[Number(parts[3])] = value
  }
  return next
}

// ---------------------------------------------------------------------------
// Optional local LLM (Ollama) rewrites with fabrication guards
// ---------------------------------------------------------------------------

function tokensOf(s: string): { numbers: Set<string>; proper: Set<string>; words: Set<string> } {
  const numbers = new Set(s.match(/\d+(?:[.,]\d+)?%?/g) ?? [])
  const words = new Set((s.toLowerCase().match(/[a-z][a-z'-]+/g) ?? []).map((w) => w))
  const proper = new Set(
    (s.match(/\b[A-Z][a-zA-Z]+\b/g) ?? []).slice(1).map((w) => w.toLowerCase())
  )
  return { numbers, proper, words }
}

/**
 * Rejects a model rewrite that adds facts: new numbers, new names/proper
 * nouns, or a much longer text. Returns the reason, or null when acceptable.
 */
export function fabricationCheck(original: string, rewrite: string): string | null {
  const a = tokensOf(original)
  const b = tokensOf(rewrite)
  for (const n of b.numbers) if (!a.numbers.has(n)) return `adds the number ${n}`
  for (const p of b.proper) if (!a.words.has(p) && !a.proper.has(p)) return `adds the name “${p}”`
  if (rewrite.length > original.length * 1.5 + 30) return 'adds too much new content'
  if (/\n/.test(rewrite.trim())) return 'is not a single line'
  return null
}

export interface OllamaGenerateSettings {
  enabled: boolean
  baseUrl: string
  generateModel?: string
}

/**
 * Asks a local Ollama model to tighten the wording of each bullet. Output that
 * fails {@link fabricationCheck} is discarded. Never sends data off the machine
 * (the base URL is validated to be localhost in Settings).
 */
export async function ollamaRewrites(
  doc: ResumeDocument,
  http: HttpClient,
  settings: OllamaGenerateSettings,
  signal?: AbortSignal
): Promise<{ suggestions: ResumeSuggestion[]; rejected: number; detail: string }> {
  if (!settings.enabled || !settings.generateModel)
    return {
      suggestions: [],
      rejected: 0,
      detail: 'Local AI rewriting is off (Settings → Ollama).'
    }
  const suggestions: ResumeSuggestion[] = []
  let rejected = 0
  const url = settings.baseUrl.replace(/\/$/, '') + '/api/generate'
  const jobs = doc.experience.flatMap((e, i) =>
    e.bullets.map((b, j) => ({ path: `experience.${i}.bullets.${j}`, text: b, current: e.current }))
  )
  for (const item of jobs.slice(0, 30)) {
    if (item.text.trim().length < 12) continue
    const prompt = `Rewrite this resume bullet to be concise and start with an action verb${item.current ? ' in present tense' : ' in past tense'}. Do NOT add any numbers, employers, tools, skills or facts that are not in the original. Return only the rewritten bullet.\n\nOriginal: ${item.text}`
    let out: string
    try {
      const res = await http.json<{ response?: string }>({
        url,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: settings.generateModel,
          prompt,
          stream: false,
          options: { temperature: 0.2 }
        }),
        timeoutMs: 60_000,
        retries: 0,
        signal
      })
      out = (res.response ?? '').trim().replace(/^["'•\-\s]+|["'\s]+$/g, '')
    } catch (err) {
      return {
        suggestions,
        rejected,
        detail: `Ollama unavailable (${(err as Error).message}); rule-based suggestions only.`
      }
    }
    if (!out || out.toLowerCase() === item.text.toLowerCase()) continue
    if (fabricationCheck(item.text, out)) {
      rejected++
      continue
    }
    suggestions.push({
      id: `rewrite:${item.path}`,
      kind: 'rewrite',
      path: item.path,
      section: 'experience',
      message: 'Suggested wording from your local AI model (no new facts were allowed).',
      before: item.text,
      after: out,
      requiresConfirmation: false,
      source: 'ollama'
    })
  }
  return {
    suggestions,
    rejected,
    detail: `${suggestions.length} rewrite(s) from ${settings.generateModel}; ${rejected} discarded for adding facts.`
  }
}
