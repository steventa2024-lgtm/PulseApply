import type { SubmissionEvidence } from '../../../shared/types'
import type { FormInspection } from './formInspector'

/**
 * Decides whether an application was actually submitted, based only on what
 * the destination shows. Approval by the user is never evidence.
 */
export type Verdict =
  | { outcome: 'submitted'; evidence: SubmissionEvidence[] }
  | { outcome: 'failed'; reason: string }
  | { outcome: 'blocked'; reason: string }
  | { outcome: 'unverified'; reason: string }

const CONFIRM_TEXT = [
  /thank(s| you) for (applying|your application|your interest in|submitting)/i,
  /(your )?application (has been |was )?(successfully )?(submitted|received|sent|completed)/i,
  /we('ve| have) (successfully )?received your application/i,
  /application (submitted|received|complete)[.!]/i,
  /you('ve| have) (successfully )?applied/i,
  /successfully (applied|submitted)/i,
  /vielen dank für ihre bewerbung/i,
  /merci pour votre candidature/i
]
const CONFIRM_URL =
  /(thank[-_]?you|thanks|confirmation|confirmed|submitted|success|application[-_]received|applied)(\b|[/?#_-])/i
const REFERENCE_RE =
  /\b(?:application|reference|confirmation|submission|candidate)\s*(?:id|number|no\.?|#|code)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{4,})\b/i

export interface AtsResponseSignal {
  url: string
  status: number
  body: string
}

export function evaluateSubmission(
  before: { url: string; hadForm: boolean },
  after: FormInspection,
  responses: AtsResponseSignal[] = []
): Verdict {
  const now = new Date().toISOString()
  const evidence: SubmissionEvidence[] = []
  const text = after.pageText

  for (const re of CONFIRM_TEXT) {
    const m = re.exec(text)
    if (m) {
      evidence.push({
        kind: 'confirmation_text',
        detail: `Page says: “${m[0]}”`,
        url: after.url,
        observedAt: now
      })
      break
    }
  }
  const ref = REFERENCE_RE.exec(text)
  if (ref)
    evidence.push({
      kind: 'reference_number',
      detail: `Reference: ${ref[1]}`,
      url: after.url,
      observedAt: now
    })
  if (
    after.url !== before.url &&
    CONFIRM_URL.test(new URL(after.url).pathname + new URL(after.url).search)
  ) {
    evidence.push({
      kind: 'confirmation_url',
      detail: `Redirected to ${new URL(after.url).pathname}`,
      url: after.url,
      observedAt: now
    })
  }
  for (const r of responses) {
    if (
      r.status >= 200 &&
      r.status < 300 &&
      /"(success|submitted)"\s*:\s*true|"status"\s*:\s*"(submitted|success|received)"|"application_?id"\s*:/i.test(
        r.body
      )
    ) {
      evidence.push({
        kind: 'ats_response',
        detail: `ATS responded ${r.status} with a success payload`,
        url: r.url,
        observedAt: now
      })
      break
    }
  }

  const stillHasForm = after.fields.some((f) => f.kind !== 'checkbox') && !!after.submitButton
  const invalid = after.fields.filter((f) => f.invalid).map((f) => f.label)
  const strong = evidence.some(
    (e) =>
      e.kind === 'confirmation_text' || e.kind === 'reference_number' || e.kind === 'ats_response'
  )

  if (strong && !(stillHasForm && invalid.length)) return { outcome: 'submitted', evidence }
  if (after.hasCaptcha && stillHasForm)
    return {
      outcome: 'blocked',
      reason:
        'A CAPTCHA or verification challenge appeared. Complete it in the browser window, then submit and use “Check confirmation”.'
    }
  if (stillHasForm && (invalid.length || after.validationErrors.length)) {
    return {
      outcome: 'failed',
      reason: `The form reported errors: ${[...invalid, ...after.validationErrors].slice(0, 5).join('; ')}`
    }
  }
  if (evidence.length)
    return {
      outcome: 'unverified',
      reason: `Only weak confirmation signals were seen (${evidence.map((e) => e.detail).join('; ')}).`
    }
  if (stillHasForm && before.hadForm && after.url === before.url) {
    return {
      outcome: 'unverified',
      reason: 'The form is still displayed and no confirmation appeared. Check the browser window.'
    }
  }
  return {
    outcome: 'unverified',
    reason: 'No confirmation message, reference number or confirmation page was detected.'
  }
}
