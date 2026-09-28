import { baseDomain, parseHttpUrl } from './urlSafety'

/**
 * Basic job-scam warning signals. These are warnings for the user, not
 * verdicts: recruiters and staffing agencies are legitimate and are never
 * flagged just for being third parties.
 */
const PAYMENT_RE =
  /\b(pay (a|the|an)? ?(fee|deposit)|registration fee|training fee|starter kit|purchase (your own )?(equipment|kit)|send (us )?money|wire transfer|western union|moneygram|gift cards?|bitcoin|crypto(currency)? payment|cashier'?s check|deposit (a|the) check|reshipping|re-shipping|package forwarding)\b/i
const CONTACT_RE =
  /\b(telegram|whatsapp|signal app|text (me|us) at|contact (me|us) on (telegram|whatsapp)|google hangouts|wickr)\b/i
const TOO_GOOD_RE =
  /\b(earn \$?\d{3,}[,\d]* (a|per) (day|week) from home|no experience.{0,40}\$\d{4,}\s*(\/|per)\s*week|guaranteed income|unlimited earning potential with no)\b/i
const PERSONAL_DATA_RE =
  /\b(social security number|ssn|bank account (number|details)|routing number|credit card)\b.{0,60}\b(before|to apply|in your application|upfront)\b/i
const FREE_EMAIL_RE =
  /\b[a-z0-9._%+-]+@(gmail|yahoo|hotmail|outlook|aol|proton|protonmail|mail|gmx|icloud)\.(com|net|me)\b/i
const SHORTENER_HOSTS = new Set([
  'bit.ly',
  'tinyurl.com',
  't.co',
  'goo.gl',
  'ow.ly',
  'is.gd',
  'buff.ly',
  'rebrand.ly',
  'cutt.ly',
  'shorturl.at',
  'rb.gy'
])

export interface ScamInput {
  title: string
  company: string
  description: string
  sourceUrl: string
  applyUrl?: string
  companyWebsite?: string
  salaryMaxAnnual?: number
  occupationId?: string
}

export function scamSignals(job: ScamInput): string[] {
  const out: string[] = []
  const text = `${job.title}\n${job.description}`
  if (PAYMENT_RE.test(text))
    out.push(
      'Mentions paying fees, buying equipment, or handling money transfers — legitimate employers do not ask applicants to pay.'
    )
  if (CONTACT_RE.test(text))
    out.push('Asks you to move the conversation to a messaging app (Telegram/WhatsApp/etc.).')
  if (PERSONAL_DATA_RE.test(text)) out.push('Requests banking or Social Security details up front.')
  if (TOO_GOOD_RE.test(text)) out.push('Promises unusually high or guaranteed earnings.')
  if (
    FREE_EMAIL_RE.test(job.description) &&
    !/\b(staffing|recruit|agency)\b/i.test(job.description)
  ) {
    out.push('Lists a free personal email address (e.g. Gmail) as the contact.')
  }
  const apply = parseHttpUrl(job.applyUrl)
  if (apply && SHORTENER_HOSTS.has(apply.hostname.toLowerCase()))
    out.push('Application link uses a URL shortener that hides the destination.')
  const companyDomain = baseDomain(job.companyWebsite)
  const applyDomain = baseDomain(job.applyUrl)
  if (
    companyDomain &&
    applyDomain &&
    companyDomain !== applyDomain &&
    !isKnownJobPlatform(applyDomain)
  ) {
    out.push(
      `Application link (${applyDomain}) does not match the employer's website (${companyDomain}).`
    )
  }
  if (
    !job.company ||
    /^(confidential|private|undisclosed|n\/a|unknown)$/i.test(job.company.trim())
  ) {
    out.push('Employer name is not disclosed.')
  }
  return out
}

const JOB_PLATFORMS = [
  'greenhouse.io',
  'lever.co',
  'ashbyhq.com',
  'smartrecruiters.com',
  'myworkdayjobs.com',
  'workday.com',
  'icims.com',
  'taleo.net',
  'oraclecloud.com',
  'successfactors.com',
  'jobvite.com',
  'bamboohr.com',
  'breezy.hr',
  'recruitee.com',
  'workable.com',
  'jazzhr.com',
  'applytojob.com',
  'paylocity.com',
  'adp.com',
  'ultipro.com',
  'ukg.com',
  'paycomonline.net',
  'indeed.com',
  'linkedin.com',
  'ziprecruiter.com',
  'glassdoor.com',
  'usajobs.gov',
  'adzuna.com',
  'adzuna.co.uk',
  'jooble.org',
  'remoteok.com',
  'remotive.com',
  'arbeitnow.com',
  'jobicy.com',
  'himalayas.app',
  'teamtailor.com',
  'personio.de',
  'personio.com',
  'rippling.com',
  'dover.com',
  'wellfound.com',
  'careers-page.com',
  'hirebridge.com',
  'harri.com',
  'snagajob.com',
  'fountain.com',
  'paradox.ai',
  'olivia.paradox.ai'
]

export function isKnownJobPlatform(domain: string | undefined): boolean {
  return !!domain && JOB_PLATFORMS.some((d) => domain === d || domain.endsWith('.' + d))
}
