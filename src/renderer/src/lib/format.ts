import type {
  TrackStatus,
  ApplicationState,
  EmploymentType,
  GeoEligibility,
  ProviderStatus,
  VerificationStatus
} from '../../../shared/types'

export { formatSalary } from '../../../shared/format'

export function timeAgo(iso?: string): string {
  if (!iso) return '—'
  const s = (Date.now() - Date.parse(iso)) / 1000
  if (!Number.isFinite(s)) return '—'
  if (s < 0) return until(iso)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`
  return new Date(iso).toLocaleDateString()
}

export function dateTime(iso?: string): string {
  return iso ? new Date(iso).toLocaleString() : '—'
}

export function until(iso?: string): string {
  if (!iso) return '—'
  const s = (Date.parse(iso) - Date.now()) / 1000
  if (s <= 0) return 'due now'
  if (s < 3600) return `in ${Math.ceil(s / 60)} min`
  if (s < 86400) return `in ${Math.round(s / 3600)} h`
  return new Date(iso).toLocaleString()
}

export const APP_STATE_LABEL: Record<ApplicationState, string> = {
  DISCOVERED: 'Discovered',
  SAVED: 'Saved',
  QUEUED: 'Queued',
  OPENING: 'Preparing',
  AUTOFILLING: 'Autofilling',
  NEEDS_USER_INPUT: 'Needs review',
  READY_FOR_REVIEW: 'Ready to submit',
  APPROVED: 'Approved — submitting',
  SUBMITTING: 'Submitting',
  SUBMITTED: 'Submitted (confirmed)',
  SUBMISSION_UNVERIFIED: 'Submission unverified',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
  MANUAL_COMPLETION_REQUIRED: 'Manual completion required'
}

export type Tone = 'cyan' | 'green' | 'amber' | 'red' | 'slate' | 'violet'

export const APP_STATE_TONE: Record<ApplicationState, Tone> = {
  DISCOVERED: 'slate',
  SAVED: 'slate',
  QUEUED: 'violet',
  OPENING: 'cyan',
  AUTOFILLING: 'cyan',
  NEEDS_USER_INPUT: 'amber',
  READY_FOR_REVIEW: 'cyan',
  APPROVED: 'cyan',
  SUBMITTING: 'cyan',
  SUBMITTED: 'green',
  SUBMISSION_UNVERIFIED: 'amber',
  FAILED: 'red',
  CANCELLED: 'slate',
  MANUAL_COMPLETION_REQUIRED: 'amber'
}

export const VERIFICATION_LABEL: Record<
  VerificationStatus,
  { label: string; tone: Tone; help: string }
> = {
  EMPLOYER_CONFIRMED: {
    label: 'Employer-confirmed',
    tone: 'green',
    help: 'Currently published on the employer’s own job board or official site.'
  },
  SOURCE_CONFIRMED: {
    label: 'Listed by source',
    tone: 'cyan',
    help: 'Currently listed by the provider; not independently confirmed with the employer.'
  },
  UNVERIFIED: { label: 'Unverified', tone: 'slate', help: 'Origin could not be confirmed.' },
  STALE: {
    label: 'Stale',
    tone: 'amber',
    help: 'Not seen recently or posted long ago; it may be filled.'
  },
  EXPIRED: {
    label: 'Expired',
    tone: 'red',
    help: 'The posting’s closing date has passed or it says it is closed.'
  },
  REMOVED: { label: 'Removed', tone: 'red', help: 'The listing no longer exists at its source.' },
  VERIFICATION_FAILED: {
    label: 'Check failed',
    tone: 'amber',
    help: 'The availability check could not complete. This does not mean the job is closed.'
  }
}

export const GEO_LABEL: Record<GeoEligibility, Tone> = {
  within_radius: 'green',
  in_country: 'green',
  remote_eligible: 'green',
  remote_unspecified: 'amber',
  unknown: 'amber',
  outside_radius: 'red',
  outside_country: 'red',
  remote_ineligible: 'red'
}

export const PROVIDER_STATUS: Record<ProviderStatus, { label: string; tone: Tone }> = {
  CONNECTED: { label: 'Connected', tone: 'green' },
  AVAILABLE: { label: 'Available', tone: 'cyan' },
  REQUIRES_CREDENTIALS: { label: 'Requires credentials', tone: 'amber' },
  LIMITED: { label: 'Rate-limited', tone: 'amber' },
  UNAVAILABLE: { label: 'Unavailable', tone: 'red' },
  MANUAL: { label: 'Manual browsing only', tone: 'violet' },
  ERROR: { label: 'Error', tone: 'red' },
  DISABLED: { label: 'Disabled', tone: 'slate' }
}

export const EMPLOYMENT_LABEL: Record<EmploymentType, string> = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  contract: 'Contract',
  temporary: 'Temporary',
  internship: 'Internship',
  seasonal: 'Seasonal',
  per_diem: 'Per diem',
  volunteer: 'Volunteer'
}

export const EXCLUSION_LABEL: Record<string, string> = {
  irrelevant_occupation: 'different occupation',
  excluded_occupation: 'excluded occupation',
  outside_radius: 'outside your radius',
  outside_country: 'in another country',
  remote_not_requested: 'remote-only (remote not selected)',
  remote_ineligible: 'remote but not open to your location',
  onsite_not_requested: 'on-site (only remote selected)',
  unknown_location: 'location unknown',
  salary_below_minimum: 'pay below your minimum',
  employment_type: 'different employment type',
  seniority: 'too senior',
  too_old: 'posted too long ago',
  excluded_keyword: 'matched an excluded keyword',
  excluded_company: 'excluded company',
  malformed: 'malformed',
  expired: 'expired',
  work_mode: 'work mode not selected',
  missing_required_skill: 'missing a required skill',
  below_minimum_score: 'below your minimum match score'
}

export const TRACK_LABEL: Record<TrackStatus, string> = {
  interested: 'Interested',
  applied: 'Applied',
  interviewing: 'Interviewing',
  offer: 'Offer',
  accepted: 'Accepted',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn'
}
