import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileSearch,
  Play,
  RefreshCw,
  Send,
  SkipForward,
  XCircle
} from 'lucide-react'
import type { ApplicationEvent, ApplicationRecord, ApplicationState } from '../../../shared/types'
import { Badge, Button, Card, Chip, Empty, Input, Modal, PageHeader } from '../components/ui'
import { useLoader } from '../lib/useLoader'
import { call, useEvent } from '../lib/api'
import { APP_STATE_LABEL, APP_STATE_TONE, dateTime, timeAgo } from '../lib/format'
import { useApp } from '../lib/appContext'

const GROUPS: { label: string; states: ApplicationState[] }[] = [
  {
    label: 'Needs you',
    states: ['NEEDS_USER_INPUT', 'READY_FOR_REVIEW', 'MANUAL_COMPLETION_REQUIRED', 'QUEUED']
  },
  { label: 'In progress', states: ['OPENING', 'AUTOFILLING', 'APPROVED', 'SUBMITTING'] },
  { label: 'Submitted', states: ['SUBMITTED'] },
  { label: 'Unverified', states: ['SUBMISSION_UNVERIFIED'] },
  { label: 'Failed / cancelled', states: ['FAILED', 'CANCELLED'] }
]

const REASON: Record<string, string> = {
  sensitive_requires_user: 'Sensitive question — answer it yourself',
  unknown_question: 'Question PulseApply cannot answer',
  required_empty: 'Required field still empty',
  unsupported_input: 'Could not fill this input',
  no_profile_value: 'Missing from your profile'
}

export default function Applications(): React.JSX.Element {
  const { toast } = useApp()
  const { data, reload, setData } = useLoader(() => call('applications:list', {}))
  const [filter, setFilter] = useState<number | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEvent('applications:updated', (app) => {
    setData(
      [app, ...(data ?? []).filter((a) => a.id !== app.id)].sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt)
      )
    )
  })

  const list = useMemo(
    () => (data ?? []).filter((a) => filter === null || GROUPS[filter].states.includes(a.state)),
    [data, filter]
  )
  const selected = (data ?? []).find((a) => a.id === selectedId) ?? list[0] ?? null

  return (
    <div>
      <PageHeader
        title="Applications"
        subtitle="Every application opens the real employer or ATS page. PulseApply fills what it can, you review, and nothing is marked submitted without confirmation from the site."
        actions={
          <Button icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void reload()}>
            Refresh
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Chip active={filter === null} onClick={() => setFilter(null)}>
          All ({data?.length ?? 0})
        </Chip>
        {GROUPS.map((g, i) => (
          <Chip key={g.label} active={filter === i} onClick={() => setFilter(i)}>
            {g.label} ({(data ?? []).filter((a) => g.states.includes(a.state)).length})
          </Chip>
        ))}
      </div>

      {list.length === 0 ? (
        <Empty icon={<FileSearch className="h-8 w-8" />} title="No applications here">
          Start one from a job’s details panel on the Results page, or queue one from a Telegram
          notification.
        </Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
          <ul className="space-y-2">
            {list.map((a) => (
              <li key={a.id}>
                <button
                  onClick={() => setSelectedId(a.id)}
                  className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${selected?.id === a.id ? 'border-cyan-500/40 bg-cyan-500/[0.07]' : 'border-white/[0.07] bg-white/[0.02] hover:border-white/20'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-xs font-semibold text-white">{a.jobTitle}</p>
                    {a.isDemo && <Badge tone="amber">DEMO</Badge>}
                  </div>
                  <p className="truncate text-[11px] text-slate-400">{a.company}</p>
                  <div className="mt-1.5 flex items-center justify-between">
                    <Badge tone={APP_STATE_TONE[a.state]}>{APP_STATE_LABEL[a.state]}</Badge>
                    <span className="text-[10px] text-slate-500">{timeAgo(a.updatedAt)}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          {selected && (
            <Detail
              app={selected}
              onError={(m) => toast(m, 'error')}
              onInfo={(m, t) => toast(m, t)}
            />
          )}
        </div>
      )}
    </div>
  )
}

function Detail({
  app,
  onError,
  onInfo
}: {
  app: ApplicationRecord
  onError: (m: string) => void
  onInfo: (m: string, t?: 'success' | 'info') => void
}): React.JSX.Element {
  const [events, setEvents] = useState<ApplicationEvent[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmSubmit, setConfirmSubmit] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    call('applications:events', { id: app.id })
      .then(setEvents)
      .catch(() => setEvents([]))
  }, [app.id, app.updatedAt])

  const act = async (label: string, fn: () => Promise<unknown>): Promise<void> => {
    setBusy(label)
    try {
      await fn()
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }
  const browserClosed = app.blockers.some((b) => /window closed/i.test(b))
  const s = app.state
  const multiStep = app.blockers.some((b) => /Multi-step/.test(b))
  const requiredIssues = app.issues.filter((i) => i.required)

  return (
    <div className="space-y-4">
      <Card
        title={app.jobTitle}
        subtitle={`${app.company} · ${app.adapter === 'demo' ? 'DEMO practice form' : `${app.adapter} adapter`} · started ${dateTime(app.createdAt)}`}
        actions={<Badge tone={APP_STATE_TONE[s]}>{APP_STATE_LABEL[s]}</Badge>}
      >
        {app.isDemo && (
          <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
            Demo mode: this is a local practice form. Nothing is sent to any employer.
          </p>
        )}
        <StateHelp app={app} />
        <div className="mt-4 flex flex-wrap gap-2">
          {s === 'QUEUED' && (
            <Button
              variant="primary"
              loading={busy === 'open'}
              icon={<Play className="h-3.5 w-3.5" />}
              onClick={() => act('open', () => call('applications:reopen', { id: app.id }))}
            >
              Open & autofill now
            </Button>
          )}
          {s === 'READY_FOR_REVIEW' && !browserClosed && (
            <Button
              variant="success"
              icon={<Send className="h-3.5 w-3.5" />}
              onClick={() => setConfirmSubmit(true)}
            >
              Approve & submit…
            </Button>
          )}
          {['NEEDS_USER_INPUT', 'READY_FOR_REVIEW', 'MANUAL_COMPLETION_REQUIRED'].includes(s) &&
            !browserClosed && (
              <Button
                loading={busy === 'rescan'}
                icon={<RefreshCw className="h-3.5 w-3.5" />}
                onClick={() => act('rescan', () => call('applications:rescan', { id: app.id }))}
              >
                Re-scan form
              </Button>
            )}
          {multiStep && ['NEEDS_USER_INPUT', 'READY_FOR_REVIEW'].includes(s) && !browserClosed && (
            <Button
              loading={busy === 'advance'}
              icon={<SkipForward className="h-3.5 w-3.5" />}
              onClick={() => act('advance', () => call('applications:advance', { id: app.id }))}
            >
              Continue to next step
            </Button>
          )}
          {[
            'NEEDS_USER_INPUT',
            'READY_FOR_REVIEW',
            'MANUAL_COMPLETION_REQUIRED',
            'SUBMISSION_UNVERIFIED'
          ].includes(s) &&
            !browserClosed && (
              <Button
                loading={busy === 'check'}
                icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                onClick={() =>
                  act('check', async () => {
                    const r = await call('applications:check', { id: app.id })
                    onInfo(r.message, r.confirmed ? 'success' : 'info')
                  })
                }
              >
                Check for confirmation
              </Button>
            )}
          {['NEEDS_USER_INPUT', 'READY_FOR_REVIEW', 'MANUAL_COMPLETION_REQUIRED'].includes(s) && (
            <Button variant="ghost" onClick={() => setManualOpen(true)}>
              I submitted it myself
            </Button>
          )}
          {(browserClosed || s === 'FAILED') && (
            <Button
              loading={busy === 'reopen'}
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={() => act('reopen', () => call('applications:reopen', { id: app.id }))}
            >
              {s === 'FAILED' ? 'Retry' : 'Reopen browser'}
            </Button>
          )}
          <Button
            variant="ghost"
            icon={<ExternalLink className="h-3.5 w-3.5" />}
            onClick={() =>
              void call('jobs:open-external', { url: app.applyUrl ?? app.sourceUrl }).catch((e) =>
                onError(e.message)
              )
            }
          >
            Open in my browser
          </Button>
          {!['SUBMITTED', 'SUBMISSION_UNVERIFIED', 'CANCELLED', 'SUBMITTING'].includes(s) && (
            <Button
              variant="danger"
              loading={busy === 'cancel'}
              icon={<XCircle className="h-3.5 w-3.5" />}
              onClick={() => act('cancel', () => call('applications:cancel', { id: app.id }))}
            >
              Cancel
            </Button>
          )}
        </div>
      </Card>

      {(requiredIssues.length > 0 || app.blockers.length > 0 || app.error) && (
        <Card title="What needs your attention">
          {app.error && <p className="mb-2 text-xs text-rose-300">{app.error}</p>}
          {app.blockers.map((b) => (
            <p key={b} className="mb-1.5 flex items-start gap-1.5 text-xs text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {b}
            </p>
          ))}
          {app.issues.length > 0 && (
            <ul className="mt-2 space-y-1 text-[11px]">
              {app.issues.map((i) => (
                <li
                  key={i.label}
                  className="flex justify-between gap-3 border-t border-white/[0.05] pt-1"
                >
                  <span className="text-slate-200">
                    {i.label}
                    {i.required && <span className="text-rose-300"> *</span>}
                  </span>
                  <span className="text-right text-slate-500">{REASON[i.reason] ?? i.reason}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[11px] text-slate-500">
            Answer these directly in the browser window PulseApply opened, then click “Re-scan
            form”. You can pre-approve reusable answers on the Profile page.
          </p>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Filled from your profile">
          {app.filledFields.length === 0 ? (
            <p className="text-xs text-slate-500">Nothing filled yet.</p>
          ) : (
            <ul className="space-y-1 text-[11px]">
              {app.filledFields.map((f) => (
                <li key={f.label} className="flex justify-between gap-2">
                  <span className="truncate text-slate-300">{f.label}</span>
                  <span className="text-slate-500">
                    {f.profileKey.replace('approved:', 'approved ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[11px] text-slate-500">
            Resume: {app.resumeLabel ?? 'default / none'}
          </p>
        </Card>
        <Card title="Submission evidence">
          {app.evidence.length === 0 ? (
            <p className="text-xs text-slate-500">No confirmation observed.</p>
          ) : (
            <ul className="space-y-1.5 text-[11px]">
              {app.evidence.map((e, i) => (
                <li key={i}>
                  <Badge tone={e.kind === 'user_report' ? 'amber' : 'green'}>
                    {e.kind.replace(/_/g, ' ')}
                  </Badge>{' '}
                  <span className="text-slate-300">{e.detail}</span>
                  <span className="block text-slate-500">{dateTime(e.observedAt)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 break-all text-[11px] text-slate-500">Listing: {app.sourceUrl}</p>
          {app.currentUrl && (
            <p className="mt-1 break-all text-[11px] text-slate-500">
              Browser at: {app.currentUrl}
            </p>
          )}
        </Card>
      </div>

      <Card title="Timeline">
        <ol className="space-y-1.5 text-[11px]">
          {events.map((e) => (
            <li key={e.id} className="flex gap-3">
              <span className="w-36 shrink-0 text-slate-500">{dateTime(e.at)}</span>
              <Badge tone={APP_STATE_TONE[e.toState]}>{APP_STATE_LABEL[e.toState]}</Badge>
              <span className="text-slate-300">{e.message}</span>
            </li>
          ))}
        </ol>
      </Card>

      <Modal
        open={confirmSubmit}
        title="Approve and submit this application?"
        onClose={() => setConfirmSubmit(false)}
        footer={
          <>
            <Button onClick={() => setConfirmSubmit(false)}>Not yet</Button>
            <Button
              variant="success"
              loading={busy === 'approve'}
              onClick={() =>
                act('approve', async () => {
                  setConfirmSubmit(false)
                  const res = await call('applications:approve', { id: app.id })
                  onInfo(
                    res.state === 'SUBMITTED'
                      ? 'Submission confirmed by the site.'
                      : `Result: ${APP_STATE_LABEL[res.state]}`,
                    res.state === 'SUBMITTED' ? 'success' : 'info'
                  )
                })
              }
            >
              Yes — submit now
            </Button>
          </>
        }
      >
        <p>
          PulseApply will click the site’s submit button for <b>{app.jobTitle}</b> at{' '}
          <b>{app.company}</b>.
        </p>
        <p className="mt-2">
          Only continue if you have reviewed every field in the browser window. The application will
          be marked submitted only if the site shows a confirmation; otherwise it is recorded as
          unverified and never retried automatically.
        </p>
      </Modal>
      <Modal
        open={manualOpen}
        title="Record a manual submission"
        onClose={() => setManualOpen(false)}
        footer={
          <>
            <Button onClick={() => setManualOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() =>
                act('manual', async () => {
                  await call('applications:report-manual', { id: app.id, note: note || undefined })
                  setManualOpen(false)
                })
              }
            >
              Record as unverified submission
            </Button>
          </>
        }
      >
        <p>
          Because PulseApply did not observe a confirmation, this is recorded as “Submission
          unverified”. Use “Check for confirmation” while the confirmation page is open to upgrade
          it.
        </p>
        <Input
          className="mt-3"
          placeholder="Optional note (e.g. confirmation email received)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Modal>
    </div>
  )
}

function StateHelp({ app }: { app: ApplicationRecord }): React.JSX.Element {
  const text: Partial<Record<ApplicationState, string>> = {
    QUEUED: 'Queued (for example from Telegram). Open it when you are at your computer.',
    OPENING: 'Opening the application page in a browser window…',
    AUTOFILLING: 'Detecting and filling form fields…',
    NEEDS_USER_INPUT:
      'Some questions need your answer, or the site needs sign-in / verification. Complete them in the browser window, then re-scan.',
    READY_FOR_REVIEW:
      'All required fields PulseApply knows about are filled. Review the whole form in the browser window before approving.',
    SUBMITTING: 'Submitting and watching for a confirmation…',
    SUBMITTED: 'The application site confirmed the submission.',
    SUBMISSION_UNVERIFIED:
      'The outcome could not be confirmed. Check your email or the employer portal before applying again.',
    FAILED: 'The attempt failed. Nothing is retried automatically.',
    MANUAL_COMPLETION_REQUIRED:
      'This site cannot be automated reliably. Complete the application in the browser window.',
    CANCELLED: 'Cancelled.'
  }
  return <p className="text-xs text-slate-300">{text[app.state] ?? ''}</p>
}
