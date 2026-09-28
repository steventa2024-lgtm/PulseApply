import type { ApplicationState } from '../../../shared/types'

/**
 * Allowed application state transitions.
 *
 * Invariants enforced here:
 * - SUBMITTED is only reachable from states where PulseApply can observe the
 *   destination page (SUBMITTING, or a page the user submitted themselves that
 *   PulseApply then inspects). Approval alone never implies submission.
 * - SUBMITTED is terminal. SUBMISSION_UNVERIFIED may only be upgraded to
 *   SUBMITTED by later observed evidence, never retried automatically.
 */
const TRANSITIONS: Record<ApplicationState, ApplicationState[]> = {
  DISCOVERED: ['SAVED', 'QUEUED', 'OPENING', 'CANCELLED'],
  SAVED: ['QUEUED', 'OPENING', 'CANCELLED'],
  QUEUED: ['OPENING', 'CANCELLED'],
  OPENING: ['AUTOFILLING', 'NEEDS_USER_INPUT', 'MANUAL_COMPLETION_REQUIRED', 'FAILED', 'CANCELLED'],
  AUTOFILLING: [
    'NEEDS_USER_INPUT',
    'READY_FOR_REVIEW',
    'MANUAL_COMPLETION_REQUIRED',
    'FAILED',
    'CANCELLED'
  ],
  NEEDS_USER_INPUT: [
    'AUTOFILLING',
    'READY_FOR_REVIEW',
    'MANUAL_COMPLETION_REQUIRED',
    'SUBMITTED',
    'SUBMISSION_UNVERIFIED',
    'FAILED',
    'CANCELLED'
  ],
  READY_FOR_REVIEW: [
    'APPROVED',
    'AUTOFILLING',
    'NEEDS_USER_INPUT',
    'SUBMITTED',
    'SUBMISSION_UNVERIFIED',
    'CANCELLED',
    'FAILED'
  ],
  APPROVED: ['SUBMITTING', 'CANCELLED'],
  SUBMITTING: ['SUBMITTED', 'SUBMISSION_UNVERIFIED', 'FAILED', 'NEEDS_USER_INPUT'],
  SUBMITTED: [],
  SUBMISSION_UNVERIFIED: ['SUBMITTED'],
  FAILED: ['OPENING', 'CANCELLED'],
  CANCELLED: [],
  MANUAL_COMPLETION_REQUIRED: [
    'AUTOFILLING',
    'SUBMITTED',
    'SUBMISSION_UNVERIFIED',
    'CANCELLED',
    'FAILED'
  ]
}

export const ACTIVE_STATES: ApplicationState[] = [
  'QUEUED',
  'OPENING',
  'AUTOFILLING',
  'NEEDS_USER_INPUT',
  'READY_FOR_REVIEW',
  'APPROVED',
  'SUBMITTING',
  'MANUAL_COMPLETION_REQUIRED'
]

/** States after which starting a new application for the same job is refused. */
export const BLOCKS_NEW_APPLICATION: ApplicationState[] = [
  ...ACTIVE_STATES,
  'SUBMITTED',
  'SUBMISSION_UNVERIFIED'
]

export function canTransition(from: ApplicationState, to: ApplicationState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false
}

export class InvalidTransitionError extends Error {
  constructor(from: ApplicationState, to: ApplicationState) {
    super(`Application cannot move from ${from} to ${to}`)
    this.name = 'InvalidTransitionError'
  }
}
