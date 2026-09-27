import { ParsedProfile } from './parser'

export function scoreJobMatch(
  profile: ParsedProfile,
  jobDescription: string,
  requiredSkills: string[]
): { score: number; matchedSkills: string[]; missingSkills: string[] } {
  const matchedSkills: string[] = []
  const missingSkills: string[] = []

  const userSkills = profile.extractedSkills.map((s) => s.toLowerCase())
  const rawText = profile.rawText.toLowerCase()

  for (const req of requiredSkills) {
    const reqClean = req.toLowerCase()

    const hasMatch =
      userSkills.some((u) => u.includes(reqClean) || reqClean.includes(u)) ||
      rawText.includes(reqClean)

    if (hasMatch) {
      matchedSkills.push(req)
    } else {
      missingSkills.push(req)
    }
  }

  const coverage = requiredSkills.length > 0 ? matchedSkills.length / requiredSkills.length : 0.8
  const score = Math.min(Math.max(Math.round(coverage * 96), 65), 98)

  return {
    score,
    matchedSkills,
    missingSkills
  }
}
