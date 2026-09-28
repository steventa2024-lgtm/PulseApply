import type { CandidateProfile, ResolvedPlace, Seniority } from '../../../shared/types'
import { classifyJob, classifyQuery } from '../jobs/search/classify'
import { canonicalizeSkill, findCertifications, findSkills, isTransferable } from '../jobs/search/skills'

export interface CandidateOccupation {
  id: string
  months: number
  /** 1 = demonstrated experience, 0.6 = stated target without experience */
  strength: number
  source: 'history' | 'target'
}

/** Normalized view of the candidate used by the matcher. Built only from what the user or resume actually states. */
export interface CandidateModel {
  empty: boolean
  occupations: CandidateOccupation[]
  specificSkills: Set<string>
  transferableSkills: Set<string>
  certifications: Set<string>
  totalMonths: number
  seniority?: Seniority
  location?: ResolvedPlace
  preferences: CandidateProfile['preferences']
  embeddingText: string
}

export function buildCandidateModel(profile: CandidateProfile, resumeText: string, location?: ResolvedPlace): CandidateModel {
  const occ = new Map<string, CandidateOccupation>()
  let totalMonths = 0
  for (const w of profile.workHistory) {
    const months = w.months ?? 0
    totalMonths += months
    const tag = classifyJob(w.title, w.summary ?? '')
    if (!tag) continue
    const prev = occ.get(tag.id)
    occ.set(tag.id, { id: tag.id, months: (prev?.months ?? 0) + months, strength: 1, source: 'history' })
  }
  for (const role of [...profile.preferences.targetRoles, ...profile.preferences.targetOccupations]) {
    for (const id of classifyQuery(role).slice(0, 2)) {
      if (!occ.has(id)) occ.set(id, { id, months: 0, strength: 0.6, source: 'target' })
    }
  }
  const skills = new Set<string>()
  for (const s of profile.skills) {
    if (s.canonicalId) skills.add(s.canonicalId)
    for (const id of canonicalizeSkill(s.name)) skills.add(id)
  }
  if (resumeText) for (const id of findSkills(resumeText)) skills.add(id)
  for (const w of profile.workHistory) if (w.summary) for (const id of findSkills(w.summary)) skills.add(id)

  const certs = new Set<string>()
  for (const c of profile.certifications) for (const id of findCertifications(c.name, { strict: false })) certs.add(id)
  if (resumeText) for (const id of findCertifications(resumeText)) certs.add(id)

  const specific = new Set([...skills].filter((s) => !isTransferable(s)))
  const transferable = new Set([...skills].filter((s) => isTransferable(s)))
  if (profile.totalExperienceMonths && profile.totalExperienceMonths > totalMonths) totalMonths = profile.totalExperienceMonths

  const seniority: Seniority | undefined =
    profile.workHistory.length === 0 && totalMonths === 0
      ? undefined
      : totalMonths < 12
        ? 'entry'
        : totalMonths < 36
          ? 'junior'
          : totalMonths < 72
            ? 'mid'
            : 'senior'

  const embeddingText = [
    profile.headline,
    profile.summary,
    ...profile.workHistory.map((w) => `${w.title} at ${w.company}. ${w.summary ?? ''}`),
    profile.skills.map((s) => s.name).join(', '),
    profile.certifications.map((c) => c.name).join(', ')
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 4000)

  return {
    empty: occ.size === 0 && skills.size === 0 && certs.size === 0 && !resumeText,
    occupations: [...occ.values()],
    specificSkills: specific,
    transferableSkills: transferable,
    certifications: certs,
    totalMonths,
    seniority,
    location,
    preferences: profile.preferences,
    embeddingText: embeddingText || resumeText.slice(0, 4000)
  }
}
