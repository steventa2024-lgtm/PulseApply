import type { JobTracking, TrackStatus } from '../../../shared/types'
import type { AppDb } from './database'
import { json } from './database'

interface Row {
  status: string
  notes: string
  applied_at: string | null
  follow_up_at: string | null
  contact: string | null
  history: string
  updated_at: string
}

export type TrackingPatch = Partial<
  Pick<JobTracking, 'status' | 'notes' | 'appliedAt' | 'followUpAt' | 'contact'>
>

/** Statuses that come after "applied" (an automatic "applied" never moves a job backwards). */
const AFTER_APPLIED = new Set<TrackStatus>([
  'interviewing',
  'offer',
  'accepted',
  'rejected',
  'withdrawn'
])

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 86400_000).toISOString().slice(0, 10)
}

export class TrackingRepo {
  constructor(private readonly db: AppDb) {}

  static fromRow(r: Row | undefined | null): JobTracking | undefined {
    if (!r) return undefined
    return {
      status: r.status as TrackStatus,
      notes: r.notes,
      appliedAt: r.applied_at ?? undefined,
      followUpAt: r.follow_up_at ?? undefined,
      contact: r.contact ?? undefined,
      updatedAt: r.updated_at,
      history: json(r.history, [])
    }
  }

  get(jobId: string): JobTracking | undefined {
    return TrackingRepo.fromRow(
      this.db.get<Row>('SELECT * FROM job_tracking WHERE job_id = ?', [jobId])
    )
  }

  /**
   * Updates a job's tracking. Moving to "applied" records today's date and,
   * unless one is set, a follow-up one week later.
   */
  set(jobId: string, patch: TrackingPatch, now = new Date().toISOString()): JobTracking {
    const prev = this.get(jobId)
    const status = patch.status ?? prev?.status ?? 'interested'
    const history = [...(prev?.history ?? [])]
    if (!prev || prev.status !== status) history.push({ at: now, status })
    let appliedAt = patch.appliedAt !== undefined ? patch.appliedAt || undefined : prev?.appliedAt
    let followUpAt =
      patch.followUpAt !== undefined ? patch.followUpAt || undefined : prev?.followUpAt
    if (status === 'applied' && !appliedAt) appliedAt = now
    if (status === 'applied' && !followUpAt && patch.followUpAt === undefined)
      followUpAt = addDays(appliedAt ?? now, 7)
    if (['accepted', 'rejected', 'withdrawn'].includes(status) && patch.followUpAt === undefined)
      followUpAt = undefined
    const t: JobTracking = {
      status,
      notes: patch.notes ?? prev?.notes ?? '',
      appliedAt,
      followUpAt,
      contact: patch.contact ?? prev?.contact,
      updatedAt: now,
      history: history.slice(-50)
    }
    this.db.run(
      `INSERT INTO job_tracking (job_id, status, notes, applied_at, follow_up_at, contact, history, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(job_id) DO UPDATE SET status = excluded.status, notes = excluded.notes,
         applied_at = excluded.applied_at, follow_up_at = excluded.follow_up_at, contact = excluded.contact,
         history = excluded.history, updated_at = excluded.updated_at`,
      [
        jobId,
        t.status,
        t.notes,
        t.appliedAt ?? null,
        t.followUpAt ?? null,
        t.contact ?? null,
        JSON.stringify(t.history),
        t.updatedAt
      ]
    )
    return t
  }

  /** Marks a job applied (e.g. after a confirmed submission) without moving it backwards. */
  markApplied(jobId: string): void {
    const prev = this.get(jobId)
    if (prev && (prev.status === 'applied' || AFTER_APPLIED.has(prev.status))) return
    this.set(jobId, { status: 'applied' })
  }

  remove(jobId: string): void {
    this.db.run('DELETE FROM job_tracking WHERE job_id = ?', [jobId])
  }

  /** Job ids that are tracked, plus saved jobs (shown as "Saved" on the tracker). */
  trackedJobIds(): string[] {
    return this.db
      .all<{ id: string }>(
        `SELECT j.id FROM jobs j LEFT JOIN job_tracking t ON t.job_id = j.id
         WHERE t.job_id IS NOT NULL OR j.saved = 1`
      )
      .map((r) => r.id)
  }

  /** Follow-ups due on or before `day` (YYYY-MM-DD) for jobs still in play. */
  dueFollowUps(day: string): { jobId: string; followUpAt: string; status: TrackStatus }[] {
    return this.db
      .all<{ job_id: string; follow_up_at: string; status: string }>(
        `SELECT job_id, follow_up_at, status FROM job_tracking
         WHERE follow_up_at IS NOT NULL AND follow_up_at <= ? AND status IN ('applied','interviewing','offer')
         ORDER BY follow_up_at`,
        [day]
      )
      .map((r) => ({
        jobId: r.job_id,
        followUpAt: r.follow_up_at,
        status: r.status as TrackStatus
      }))
  }

  counts(): Partial<Record<TrackStatus, number>> {
    const out: Partial<Record<TrackStatus, number>> = {}
    for (const r of this.db.all<{ status: string; n: number }>(
      'SELECT status, COUNT(*) AS n FROM job_tracking GROUP BY status'
    ))
      out[r.status as TrackStatus] = r.n
    return out
  }
}
