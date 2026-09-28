import { randomUUID } from 'crypto'
import type {
  ApplicationEvent,
  ApplicationRecord,
  ApplicationState,
  ApplicationSupport,
  FieldIssue,
  SubmissionEvidence
} from '../../../shared/types'
import type { AppDb } from './database'
import { json } from './database'
import {
  BLOCKS_NEW_APPLICATION,
  canTransition,
  InvalidTransitionError
} from '../applications/stateMachine'

interface AppRow {
  id: string
  job_id: string
  state: string
  adapter: string
  source_url: string
  apply_url: string | null
  current_url: string | null
  resume_id: string | null
  data: string
  error: string | null
  origin: string
  is_demo: number
  created_at: string
  updated_at: string
  approved_at: string | null
  submitted_at: string | null
  title: string | null
  company: string | null
  resume_label: string | null
}

interface AppData {
  filledFields: { label: string; profileKey: string }[]
  issues: FieldIssue[]
  blockers: string[]
  evidence: SubmissionEvidence[]
}

const SELECT = `
  SELECT a.*, j.title AS title, j.company AS company, r.label AS resume_label
  FROM applications a
  LEFT JOIN jobs j ON j.id = a.job_id
  LEFT JOIN resumes r ON r.id = a.resume_id`

export class DuplicateApplicationError extends Error {
  constructor(
    readonly existingId: string,
    readonly existingState: ApplicationState
  ) {
    super(
      existingState === 'SUBMITTED'
        ? 'An application for this job was already submitted.'
        : existingState === 'SUBMISSION_UNVERIFIED'
          ? 'A previous submission for this job may have gone through. Check your email or the employer portal before applying again.'
          : `An application for this job is already in progress (${existingState}).`
    )
    this.name = 'DuplicateApplicationError'
  }
}

export class ApplicationsRepo {
  constructor(private readonly db: AppDb) {}

  private hydrate(r: AppRow): ApplicationRecord {
    const d = json<AppData>(r.data, { filledFields: [], issues: [], blockers: [], evidence: [] })
    return {
      id: r.id,
      jobId: r.job_id,
      jobTitle: r.title ?? '(job removed)',
      company: r.company ?? '',
      state: r.state as ApplicationState,
      adapter: r.adapter as ApplicationRecord['adapter'],
      sourceUrl: r.source_url,
      applyUrl: r.apply_url ?? undefined,
      currentUrl: r.current_url ?? undefined,
      resumeId: r.resume_id ?? undefined,
      resumeLabel: r.resume_label ?? undefined,
      filledFields: d.filledFields ?? [],
      issues: d.issues ?? [],
      blockers: d.blockers ?? [],
      evidence: d.evidence ?? [],
      error: r.error ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      approvedAt: r.approved_at ?? undefined,
      submittedAt: r.submitted_at ?? undefined,
      origin: r.origin as ApplicationRecord['origin'],
      isDemo: !!r.is_demo
    }
  }

  get(id: string): ApplicationRecord | undefined {
    const row = this.db.get<AppRow>(`${SELECT} WHERE a.id = ?`, [id])
    return row ? this.hydrate(row) : undefined
  }

  list(states?: ApplicationState[]): ApplicationRecord[] {
    const where = states?.length ? `WHERE a.state IN (${states.map(() => '?').join(',')})` : ''
    return this.db
      .all<AppRow>(`${SELECT} ${where} ORDER BY a.updated_at DESC`, states ?? [])
      .map((r) => this.hydrate(r))
  }

  latestForJob(jobId: string): ApplicationRecord | undefined {
    const row = this.db.get<AppRow>(
      `${SELECT} WHERE a.job_id = ? ORDER BY a.created_at DESC LIMIT 1`,
      [jobId]
    )
    return row ? this.hydrate(row) : undefined
  }

  /**
   * Creates an application unless one for the same job is active or already
   * (possibly) submitted. The check and insert run in one transaction so two
   * rapid requests (e.g. a double-tapped Telegram button) cannot both succeed.
   */
  create(input: {
    jobId: string
    state: ApplicationState
    adapter: ApplicationSupport | 'demo'
    sourceUrl: string
    applyUrl?: string
    resumeId?: string
    origin: ApplicationRecord['origin']
    isDemo?: boolean
    message: string
  }): ApplicationRecord {
    const id = randomUUID()
    this.db.transaction(() => {
      const existing = this.db.get<{ id: string; state: ApplicationState }>(
        `SELECT id, state FROM applications WHERE job_id = ? AND state IN (${BLOCKS_NEW_APPLICATION.map(() => '?').join(',')})
         ORDER BY created_at DESC LIMIT 1`,
        [input.jobId, ...BLOCKS_NEW_APPLICATION]
      )
      if (existing) throw new DuplicateApplicationError(existing.id, existing.state)
      const now = new Date().toISOString()
      this.db.run(
        `INSERT INTO applications (id, job_id, state, adapter, source_url, apply_url, resume_id, data, origin, is_demo, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.jobId,
          input.state,
          input.adapter,
          input.sourceUrl,
          input.applyUrl ?? null,
          input.resumeId ?? null,
          JSON.stringify({ filledFields: [], issues: [], blockers: [], evidence: [] }),
          input.origin,
          input.isDemo ? 1 : 0,
          now,
          now
        ]
      )
      this.db.run(
        'INSERT INTO application_events (application_id, at, from_state, to_state, message) VALUES (?, ?, ?, ?, ?)',
        [id, now, null, input.state, input.message]
      )
    })
    return this.get(id)!
  }

  /** Validated state transition with an audit event. */
  transition(
    id: string,
    to: ApplicationState,
    message: string,
    patch: Partial<
      Pick<
        ApplicationRecord,
        'filledFields' | 'issues' | 'blockers' | 'currentUrl' | 'error' | 'adapter'
      >
    > & {
      addEvidence?: SubmissionEvidence[]
    } = {}
  ): ApplicationRecord {
    this.db.transaction(() => {
      const row = this.db.get<AppRow>(`${SELECT} WHERE a.id = ?`, [id])
      if (!row) throw new Error('Application not found')
      const current = this.hydrate(row)
      if (current.state !== to && !canTransition(current.state, to)) {
        throw new InvalidTransitionError(current.state, to)
      }
      const now = new Date().toISOString()
      const data: AppData = {
        filledFields: patch.filledFields ?? current.filledFields,
        issues: patch.issues ?? current.issues,
        blockers: patch.blockers ?? current.blockers,
        evidence: [...current.evidence, ...(patch.addEvidence ?? [])]
      }
      this.db.run(
        `UPDATE applications SET state = ?, data = ?, current_url = COALESCE(?, current_url), error = ?, adapter = COALESCE(?, adapter),
           updated_at = ?, approved_at = CASE WHEN ? = 'APPROVED' THEN ? ELSE approved_at END,
           submitted_at = CASE WHEN ? IN ('SUBMITTED', 'SUBMISSION_UNVERIFIED') AND submitted_at IS NULL THEN ? ELSE submitted_at END
         WHERE id = ?`,
        [
          to,
          JSON.stringify(data),
          patch.currentUrl ?? null,
          'error' in patch
            ? (patch.error ?? null)
            : to === 'FAILED'
              ? (current.error ?? null)
              : null,
          patch.adapter ?? null,
          now,
          to,
          now,
          to,
          now,
          id
        ]
      )
      if (current.state !== to || message) {
        this.db.run(
          'INSERT INTO application_events (application_id, at, from_state, to_state, message) VALUES (?, ?, ?, ?, ?)',
          [id, now, current.state, to, message]
        )
      }
    })
    return this.get(id)!
  }

  events(id: string): ApplicationEvent[] {
    return this.db
      .all<{
        id: number
        application_id: string
        at: string
        from_state: string | null
        to_state: string
        message: string
      }>('SELECT * FROM application_events WHERE application_id = ? ORDER BY id ASC', [id])
      .map((e) => ({
        id: e.id,
        applicationId: e.application_id,
        at: e.at,
        fromState: (e.from_state as ApplicationState) ?? undefined,
        toState: e.to_state as ApplicationState,
        message: e.message
      }))
  }

  counts(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const r of this.db.all<{ state: string; n: number }>(
      'SELECT state, COUNT(*) AS n FROM applications WHERE is_demo = 0 GROUP BY state'
    )) {
      out[r.state] = r.n
    }
    return out
  }
}
