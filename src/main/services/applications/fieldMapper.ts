import type { CandidateProfile, FieldIssue } from '../../../shared/types'
import type { InspectedField } from './formInspector'

/**
 * Maps inspected form fields to approved candidate-profile values.
 *
 * Hard rules:
 *  - Sensitive questions (work authorization, sponsorship, criminal history,
 *    demographics, disability, veteran status, age, certifications, years of
 *    experience, legal declarations/consents, salary, start date) are NEVER
 *    answered from inference. They are filled only from an explicit,
 *    user-approved answer; otherwise they are escalated to the user.
 *  - Unknown required questions are escalated, never guessed.
 */

export type SensitiveCategory =
  | 'work_authorization'
  | 'sponsorship'
  | 'criminal_history'
  | 'demographic'
  | 'disability'
  | 'veteran'
  | 'age'
  | 'certification'
  | 'experience_years'
  | 'declaration'
  | 'salary'
  | 'availability'
  | 'background_check'

const SENSITIVE: [RegExp, SensitiveCategory][] = [
  [/sponsor|visa|immigration|h-?1b|work permit status/i, 'sponsorship'],
  [/(legally )?(authori[sz]ed|eligible|entitled|permitted|right) to work|work authori[sz]ation|employment eligibility|citizenship|citizen|permanent resident|green card/i, 'work_authorization'],
  [/convict|criminal|felony|misdemeanor|arrest|offen[cs]e/i, 'criminal_history'],
  [/\bgender\b|\bsex\b|\brace\b|racial|ethnic|hispanic|latin[oax]|sexual orientation|transgender|pronoun|lgbt|nationality|religio|marital/i, 'demographic'],
  [/disabilit|accommodation|impairment/i, 'disability'],
  [/veteran|military|armed forces|protected veteran/i, 'veteran'],
  [/date of birth|birth ?date|\bdob\b|your age|over (the age of )?(16|18|21)|at least (16|18|21)/i, 'age'],
  [/background check|drug (test|screen)|credit check/i, 'background_check'],
  [/salary|compensation|pay expectation|desired pay|expected pay|hourly rate expectation/i, 'salary'],
  [/start date|available to start|availability|notice period|when can you start|shifts? (are you )?available|hours available/i, 'availability'],
  [/years of (professional |relevant |work )?experience|how many years|how long have you/i, 'experience_years'],
  [/i (agree|acknowledge|certify|confirm|consent|understand|attest)|terms|privacy (policy|notice)|consent|declar|attest|truthful|accurate and complete|gdpr/i, 'declaration'],
  [/do you (have|hold|possess)|certificat|certified|licen[cs]e|forklift|cdl|food handler|servsafe|cpr|degree/i, 'certification']
]

export function sensitiveCategory(label: string): SensitiveCategory | undefined {
  for (const [re, cat] of SENSITIVE) if (re.test(label)) return cat
  return undefined
}

type ProfileKey =
  | 'firstName'
  | 'lastName'
  | 'fullName'
  | 'preferredName'
  | 'email'
  | 'phone'
  | 'location'
  | 'city'
  | 'linkedin'
  | 'github'
  | 'website'
  | 'currentCompany'
  | 'currentTitle'
  | 'resume'
  | 'coverLetter'
  | 'custom'

const STANDARD: [RegExp, ProfileKey][] = [
  [/^(legal )?first[ _-]?name|given name|^first$|forename|prénom/i, 'firstName'],
  [/^(legal )?last[ _-]?name|surname|family name|^last$/i, 'lastName'],
  [/preferred (first )?name|nickname/i, 'preferredName'],
  [/^(full |legal |your )?name\b(?!.*(company|employer|school|reference|manager))|^name\s*\*?$/i, 'fullName'],
  [/e-?mail/i, 'email'],
  [/phone|mobile|cell|telephone|contact number/i, 'phone'],
  [/linked ?in/i, 'linkedin'],
  [/github/i, 'github'],
  [/website|portfolio|personal (site|url)|other url|blog/i, 'website'],
  [/^(current )?(city|town)\b/i, 'city'],
  [/(current )?location|address|where are you (based|located)|city,? state/i, 'location'],
  [/current (company|employer)|most recent (company|employer)|^company$|^employer$|organization/i, 'currentCompany'],
  [/current (job )?title|most recent (job )?title|current (role|position)/i, 'currentTitle'],
  [/resume|résumé|\bcv\b|curriculum/i, 'resume'],
  [/cover letter|motivation letter/i, 'coverLetter']
]

export interface FillAction {
  field: InspectedField
  action: 'fill' | 'select' | 'check' | 'radio' | 'upload'
  value: string
  optionIndex?: number
  profileKey: string
}

export interface MappingResult {
  actions: FillAction[]
  issues: FieldIssue[]
}

export interface MapperInput {
  profile: CandidateProfile
  resumePath?: string
  /** ISO country of the job, for work-authorization answers. */
  jobCountry?: string
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function pickYesNo(field: InspectedField, yes: boolean): number | undefined {
  const re = yes ? /^(yes|y|true|i am|i do)\b/i : /^(no|n|false|i am not|i do not)\b/i
  return field.options.find((o) => re.test(o.label.trim()))?.index
}

function customAnswer(profile: CandidateProfile, label: string): string | undefined {
  const l = norm(label)
  const hits = profile.customAnswers.filter((a) => a.approved && a.question.trim() && l.includes(norm(a.question)))
  // Prefer the most specific (longest) matching question pattern.
  return hits.sort((a, b) => b.question.length - a.question.length)[0]?.answer
}

function optionFor(field: InspectedField, answer: string): number | undefined {
  const a = norm(answer)
  return (
    field.options.find((o) => norm(o.label) === a)?.index ??
    field.options.find((o) => norm(o.label).startsWith(a) || a.startsWith(norm(o.label)))?.index ??
    (/^(yes|no)$/.test(a) ? pickYesNo(field, a === 'yes') : undefined)
  )
}

function actionForValue(field: InspectedField, value: string, profileKey: string): FillAction | FieldIssue {
  if (field.kind === 'select' || field.kind === 'radio') {
    const idx = optionFor(field, value)
    if (idx === undefined) return { label: field.label, reason: 'unknown_question', required: field.required, type: field.kind }
    return { field, action: field.kind === 'select' ? 'select' : 'radio', value, optionIndex: idx, profileKey }
  }
  if (field.kind === 'checkbox') {
    if (/^(yes|true|checked|agree)$/i.test(value.trim())) return { field, action: 'check', value: 'checked', profileKey }
    return { label: field.label, reason: 'unknown_question', required: field.required, type: field.kind }
  }
  if (field.kind === 'checkbox-group' || field.kind === 'file') {
    return { label: field.label, reason: 'unsupported_input', required: field.required, type: field.kind }
  }
  return { field, action: 'fill', value, profileKey }
}

const isIssue = (x: FillAction | FieldIssue): x is FieldIssue => 'reason' in x

export function mapFields(fields: InspectedField[], input: MapperInput): MappingResult {
  const { profile } = input
  const actions: FillAction[] = []
  const issues: FieldIssue[] = []
  const current = profile.workHistory.find((w) => w.current) ?? profile.workHistory[0]
  const fullName = profile.fullName.value.trim()
  const [first, ...restName] = fullName.split(/\s+/)
  const values: Partial<Record<ProfileKey, string>> = {
    firstName: profile.firstName || first || '',
    lastName: profile.lastName || restName.join(' '),
    fullName,
    email: profile.email.value,
    phone: profile.phone.value,
    location: profile.location.value,
    city: profile.location.value.split(',')[0]?.trim(),
    linkedin: profile.linkedinUrl,
    github: profile.githubUrl,
    website: profile.portfolioUrl,
    currentCompany: current?.company,
    currentTitle: current?.title
  }

  for (const field of fields) {
    if (field.filled && field.kind !== 'file') continue
    const label = field.label || field.name
    const custom = customAnswer(profile, label)

    // ---- resume / cover letter uploads ----
    if (field.kind === 'file') {
      const isCover = /cover|motivation/i.test(label)
      if (!isCover && (/resume|résumé|\bcv\b|curriculum|attach/i.test(label) || fields.filter((f) => f.kind === 'file').length === 1)) {
        if (input.resumePath && !field.filled) actions.push({ field, action: 'upload', value: input.resumePath, profileKey: 'resume' })
        else if (!input.resumePath) issues.push({ label, reason: 'no_profile_value', required: field.required, type: 'file' })
      } else if (field.required && !field.filled) {
        issues.push({ label, reason: 'unknown_question', required: true, type: 'file' })
      }
      continue
    }

    // ---- sensitive questions: only explicit approved answers ----
    const category = sensitiveCategory(label)
    if (category) {
      let answer = custom
      if (!answer && category === 'work_authorization' && profile.sensitive.allowAutofill.workAuthorization) {
        const v = profile.sensitive.authorizedToWork[input.jobCountry ?? 'US']
        if (v === 'yes' || v === 'no') answer = v
      }
      if (!answer && category === 'sponsorship' && profile.sensitive.allowAutofill.sponsorship) {
        const v = profile.sensitive.requiresSponsorship
        if (v === 'yes' || v === 'no') answer = v
      }
      if (answer) {
        const a = actionForValue(field, answer, `approved:${category}`)
        if (isIssue(a)) issues.push({ ...a, reason: 'sensitive_requires_user' })
        else actions.push(a)
      } else if (field.required || field.kind !== 'checkbox') {
        issues.push({ label, reason: 'sensitive_requires_user', required: field.required, type: field.kind })
      }
      continue
    }

    // ---- standard contact fields ----
    let key: ProfileKey | undefined
    for (const [re, k] of STANDARD) {
      if (re.test(label) || (field.name && re.test(field.name.replace(/[_[\]-]+/g, ' ')))) {
        key = k
        break
      }
    }
    if (field.kind === 'email') key = 'email'
    if (field.kind === 'tel') key = 'phone'
    if (key === 'coverLetter' || key === 'resume') {
      if (field.required) issues.push({ label, reason: 'unknown_question', required: true, type: field.kind })
      continue
    }
    const value = key && key !== 'custom' ? values[key] : undefined
    if (value) {
      const a = actionForValue(field, value, key!)
      if (isIssue(a)) issues.push(a)
      else actions.push(a)
      continue
    }
    if (custom) {
      const a = actionForValue(field, custom, 'custom_answer')
      if (isIssue(a)) issues.push(a)
      else actions.push(a)
      continue
    }
    if (key) {
      if (field.required) issues.push({ label, reason: 'no_profile_value', required: true, type: field.kind })
      continue
    }
    if (field.required) issues.push({ label, reason: 'unknown_question', required: true, type: field.kind })
  }
  return { actions, issues }
}
