import { useEffect, useMemo, useState } from 'react'
import { BellRing, ExternalLink, KanbanSquare, Trash2, X } from 'lucide-react'
import type { ScoredJob, TrackStatus } from '../../../shared/types'
import {
  Badge,
  Button,
  Empty,
  Input,
  Label,
  PageHeader,
  Select,
  inputClass
} from '../components/ui'
import { call, useEvent } from '../lib/api'
import { useApp } from '../lib/appContext'
import { cx } from '../lib/cx'
import { TRACK_LABEL, timeAgo } from '../lib/format'

type Column = { id: string; label: string; match: (j: ScoredJob) => boolean; hint: string }

const COLUMNS: Column[] = [
  {
    id: 'saved',
    label: 'Saved',
    match: (j) => !j.state.tracking,
    hint: 'Jobs you saved but have not started'
  },
  {
    id: 'interested',
    label: 'Interested',
    match: (j) => j.state.tracking?.status === 'interested',
    hint: 'Planning to apply'
  },
  {
    id: 'applied',
    label: 'Applied',
    match: (j) => j.state.tracking?.status === 'applied',
    hint: 'Waiting to hear back'
  },
  {
    id: 'interviewing',
    label: 'Interviewing',
    match: (j) => j.state.tracking?.status === 'interviewing',
    hint: 'In conversation with the employer'
  },
  {
    id: 'offer',
    label: 'Offer',
    match: (j) => j.state.tracking?.status === 'offer' || j.state.tracking?.status === 'accepted',
    hint: 'Offers and accepted jobs'
  },
  {
    id: 'closed',
    label: 'Closed',
    match: (j) =>
      j.state.tracking?.status === 'rejected' || j.state.tracking?.status === 'withdrawn',
    hint: 'Rejected or withdrawn'
  }
]

const today = (): string => new Date().toISOString().slice(0, 10)

function FollowUp({ date }: { date?: string }): React.JSX.Element | null {
  if (!date) return null
  const t = today()
  const tone = date < t ? 'red' : date === t ? 'amber' : 'slate'
  return (
    <Badge tone={tone} title="Follow-up date">
      <BellRing className="h-3 w-3" />
      {date < t
        ? `Follow up (overdue ${date})`
        : date === t
          ? 'Follow up today'
          : `Follow up ${date}`}
    </Badge>
  )
}

export default function Tracker(): React.JSX.Element {
  const { toast } = useApp()
  const [jobs, setJobs] = useState<ScoredJob[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const load = (): void => {
    call('tracker:list')
      .then(setJobs)
      .catch((e) => toast((e as Error).message, 'error'))
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [])
  useEvent('jobs:changed', load)

  const update = async (
    jobId: string,
    patch: {
      status?: TrackStatus
      notes?: string
      appliedAt?: string
      followUpAt?: string
      contact?: string
    }
  ): Promise<void> => {
    try {
      const j = await call('tracker:update', { jobId, ...patch })
      if (j) setJobs((l) => (l ?? []).map((x) => (x.id === j.id ? j : x)))
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  const remove = async (j: ScoredJob): Promise<void> => {
    await call('tracker:remove', { jobId: j.id })
    if (j.state.saved) await call('jobs:save', { id: j.id, saved: false })
    setJobs((l) => (l ?? []).filter((x) => x.id !== j.id))
    setOpenId(null)
  }

  const due = useMemo(
    () =>
      (jobs ?? []).filter(
        (j) =>
          j.state.tracking?.followUpAt &&
          j.state.tracking.followUpAt <= today() &&
          ['applied', 'interviewing', 'offer'].includes(j.state.tracking.status)
      ).length,
    [jobs]
  )
  const open = (jobs ?? []).find((j) => j.id === openId) ?? null

  return (
    <div>
      <PageHeader
        title="Tracker"
        subtitle="Keep track of the jobs you apply to yourself — status, dates, follow-ups and notes. Jobs you save or mark “I applied” appear here."
      />
      {due > 0 && (
        <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-100">
          {due} follow-up{due === 1 ? '' : 's'} due — a short, polite check-in a week after applying
          often gets a reply.
        </p>
      )}
      {jobs === null ? (
        <p className="text-xs text-slate-500">Loading…</p>
      ) : jobs.length === 0 ? (
        <Empty icon={<KanbanSquare className="h-8 w-8" />} title="Nothing tracked yet">
          On Results, click <b>Save</b> or <b>I applied</b> on a job and it appears here.
        </Empty>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6" data-testid="tracker">
          {COLUMNS.map((c) => {
            const list = jobs.filter(c.match)
            return (
              <section
                key={c.id}
                className="min-w-0 rounded-2xl border border-white/[0.06] bg-white/[0.015] p-2"
              >
                <h2 className="mb-0.5 px-1 text-xs font-semibold text-slate-200" title={c.hint}>
                  {c.label} <span className="text-slate-500">({list.length})</span>
                </h2>
                <div className="space-y-2">
                  {list.map((j) => (
                    <button
                      key={j.id}
                      onClick={() => setOpenId(j.id)}
                      className="block w-full rounded-xl border border-white/[0.07] bg-slate-900/60 p-2.5 text-left hover:border-cyan-500/40"
                    >
                      <p className="line-clamp-2 text-xs font-semibold text-white">{j.title}</p>
                      <p className="truncate text-[11px] text-slate-400">{j.company}</p>
                      <p className="truncate text-[10px] text-slate-500">{j.locationText}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {j.state.tracking?.appliedAt && (
                          <Badge tone="cyan">applied {timeAgo(j.state.tracking.appliedAt)}</Badge>
                        )}
                        {j.state.tracking?.status === 'accepted' && (
                          <Badge tone="green">Accepted</Badge>
                        )}
                        {j.state.tracking?.status === 'withdrawn' && <Badge>Withdrawn</Badge>}
                        <FollowUp
                          date={
                            ['applied', 'interviewing', 'offer'].includes(
                              j.state.tracking?.status ?? ''
                            )
                              ? j.state.tracking?.followUpAt
                              : undefined
                          }
                        />
                      </div>
                      {j.state.tracking?.notes && (
                        <p className="mt-1 line-clamp-2 text-[10px] text-slate-400">
                          {j.state.tracking.notes}
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}
      {open && (
        <TrackDrawer
          key={open.id}
          job={open}
          onClose={() => setOpenId(null)}
          onSave={(patch) => update(open.id, patch)}
          onRemove={() => void remove(open)}
        />
      )}
    </div>
  )
}

function TrackDrawer({
  job,
  onClose,
  onSave,
  onRemove
}: {
  job: ScoredJob
  onClose: () => void
  onSave: (p: {
    status?: TrackStatus
    notes?: string
    appliedAt?: string
    followUpAt?: string
    contact?: string
  }) => Promise<void>
  onRemove: () => void
}): React.JSX.Element {
  const t = job.state.tracking
  const [status, setStatus] = useState<TrackStatus>(t?.status ?? 'interested')
  const [notes, setNotes] = useState(t?.notes ?? '')
  const [applied, setApplied] = useState(t?.appliedAt?.slice(0, 10) ?? '')
  const [follow, setFollow] = useState(t?.followUpAt ?? '')
  const [contact, setContact] = useState(t?.contact ?? '')
  const [busy, setBusy] = useState(false)
  const save = async (): Promise<void> => {
    setBusy(true)
    await onSave({
      status,
      notes,
      // Keep the exact time unless the user picked a different day.
      appliedAt:
        applied === (t?.appliedAt?.slice(0, 10) ?? '')
          ? undefined
          : applied
            ? new Date(`${applied}T12:00:00`).toISOString()
            : '',
      followUpAt: follow,
      contact
    })
    setBusy(false)
    onClose()
  }
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onClick={onClose}>
      <aside
        className="h-full w-full max-w-md overflow-y-auto border-l border-white/10 bg-slate-950 p-5"
        onClick={(e) => e.stopPropagation()}
        aria-label="Tracked job"
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-white">{job.title}</h2>
            <p className="text-xs text-slate-400">
              {job.company} · {job.locationText}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-slate-400 hover:bg-white/10"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mb-4 flex flex-wrap gap-2">
          <Button
            size="sm"
            icon={<ExternalLink className="h-3 w-3" />}
            onClick={() => void call('jobs:open-external', { url: job.applyUrl ?? job.sourceUrl })}
          >
            Open application page
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<ExternalLink className="h-3 w-3" />}
            onClick={() =>
              void call('jobs:open-external', { url: job.canonicalJobUrl ?? job.sourceUrl })
            }
          >
            Original listing
          </Button>
        </div>
        <div className="space-y-3">
          <div>
            <Label htmlFor="tr-status">Status</Label>
            <Select
              id="tr-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as TrackStatus)}
            >
              {(Object.keys(TRACK_LABEL) as TrackStatus[]).map((s) => (
                <option key={s} value={s}>
                  {TRACK_LABEL[s]}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="tr-applied">Applied on</Label>
              <Input
                id="tr-applied"
                type="date"
                value={applied}
                onChange={(e) => setApplied(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="tr-follow">Follow up on</Label>
              <Input
                id="tr-follow"
                type="date"
                value={follow}
                onChange={(e) => setFollow(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="tr-contact" hint="(recruiter, hiring manager, email…)">
              Contact
            </Label>
            <Input id="tr-contact" value={contact} onChange={(e) => setContact(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="tr-notes">Notes</Label>
            <textarea
              id="tr-notes"
              rows={6}
              className={inputClass}
              value={notes}
              placeholder="Interview times, questions asked, pay discussed…"
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          {t?.history.length ? (
            <div>
              <p className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">History</p>
              <ul className="space-y-0.5 text-[11px] text-slate-400">
                {t.history
                  .slice()
                  .reverse()
                  .map((h) => (
                    <li key={h.at + h.status}>
                      {new Date(h.at).toLocaleDateString()} — {TRACK_LABEL[h.status]}
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
        </div>
        <div className={cx('mt-5 flex items-center justify-between')}>
          <Button
            size="sm"
            variant="ghost"
            icon={<Trash2 className="h-3 w-3" />}
            onClick={onRemove}
          >
            Remove from tracker
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            Save
          </Button>
        </div>
      </aside>
    </div>
  )
}
