import { useEffect, useState } from 'react'
import { FolderOpen, Inbox, Link2, PenLine, RefreshCw } from 'lucide-react'
import type { JobInboxStatus } from '../../../shared/ipc'
import { Button, Card, ErrorNote, Input, Label, Modal, Select, inputClass } from '../components/ui'
import { call } from '../lib/api'
import { useApp } from '../lib/appContext'
import { cx } from '../lib/cx'
import { timeAgo } from '../lib/format'

/**
 * Adds a job PulseApply's sources did not find: from a link (the page's
 * structured job data is read) or by entering the details. The link to the
 * original posting is always required.
 */
export function AddJobModal({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element | null {
  return open ? <AddJobForm onClose={onClose} /> : null
}

function AddJobForm({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { toast, refreshCounters } = useApp()
  const [tab, setTab] = useState<'link' | 'manual'>('link')
  const [url, setUrl] = useState('')
  const [m, setM] = useState({
    title: '',
    company: '',
    location: '',
    url: '',
    description: '',
    salary: '',
    employmentType: '',
    workMode: '' as '' | 'onsite' | 'hybrid' | 'remote'
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const done = (r: {
    added: number
    updated: number
    jobs: { eligibility?: { status: string; summary: string } }[]
  }): void => {
    refreshCounters()
    const e = r.jobs[0]?.eligibility
    toast(
      `${r.added ? 'Job added' : 'Job updated'}${e ? ` — ${e.status === 'eligible' ? 'meets your criteria' : e.summary}` : ''}`,
      e?.status === 'eligible' ? 'success' : 'info'
    )
    onClose()
  }
  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      if (tab === 'link') done(await call('jobs:import-url', { url: url.trim() }))
      else
        done(
          await call('jobs:import-manual', {
            title: m.title,
            company: m.company,
            location: m.location,
            url: m.url.trim(),
            description: m.description || undefined,
            salary: m.salary || undefined,
            employmentType: m.employmentType || undefined,
            workMode: m.workMode || undefined
          })
        )
    } catch (e) {
      const msg = (e as Error).message
      setError(msg)
      if (tab === 'link' && /Enter details|automated access/.test(msg)) {
        setM((x) => ({ ...x, url: url.trim() }))
        setTab('manual')
      }
    } finally {
      setBusy(false)
    }
  }
  const canSubmit =
    tab === 'link' ? url.trim().length > 8 : !!(m.title.trim() && m.company.trim() && m.url.trim())

  return (
    <Modal
      open
      title="Add a job"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            Add job
          </Button>
        </>
      }
    >
      <div className="mb-3 flex gap-2">
        {(
          [
            ['link', 'From a link', Link2],
            ['manual', 'Enter details', PenLine]
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cx(
              'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs',
              tab === id
                ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-100'
                : 'border-white/10 text-slate-400'
            )}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>
      {tab === 'link' ? (
        <div className="space-y-2">
          <Label htmlFor="add-url">Job posting link</Label>
          <Input
            id="add-url"
            value={url}
            placeholder="https://careers.example.com/jobs/12345"
            onChange={(e) => setUrl(e.target.value)}
          />
          <p className="text-[11px] text-slate-500">
            Works with employer career sites and applicant-tracking pages that publish job data
            (most do — it is what Google for Jobs reads). LinkedIn, Indeed, Glassdoor and
            ZipRecruiter do not allow automated reading; for those use “Enter details”.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="add-title">Job title</Label>
            <Input
              id="add-title"
              value={m.title}
              onChange={(e) => setM({ ...m, title: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="add-company">Employer</Label>
            <Input
              id="add-company"
              value={m.company}
              onChange={(e) => setM({ ...m, company: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="add-loc">Location</Label>
            <Input
              id="add-loc"
              value={m.location}
              placeholder="City, State or Remote"
              onChange={(e) => setM({ ...m, location: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="add-mode">Work mode</Label>
            <Select
              id="add-mode"
              value={m.workMode}
              onChange={(e) => setM({ ...m, workMode: e.target.value as typeof m.workMode })}
            >
              <option value="">Not stated</option>
              <option value="onsite">On-site</option>
              <option value="hybrid">Hybrid</option>
              <option value="remote">Remote</option>
            </Select>
          </div>
          <div className="col-span-2">
            <Label htmlFor="add-link">Link to the original posting</Label>
            <Input
              id="add-link"
              value={m.url}
              onChange={(e) => setM({ ...m, url: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="add-pay" hint="(as advertised)">
              Pay
            </Label>
            <Input
              id="add-pay"
              value={m.salary}
              placeholder="e.g. $19–$21 an hour"
              onChange={(e) => setM({ ...m, salary: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="add-type">Type</Label>
            <Input
              id="add-type"
              value={m.employmentType}
              placeholder="Full-time, part-time…"
              onChange={(e) => setM({ ...m, employmentType: e.target.value })}
            />
          </div>
          <div className="col-span-2">
            <Label htmlFor="add-desc" hint="(paste from the posting — improves matching)">
              Description
            </Label>
            <textarea
              id="add-desc"
              rows={4}
              className={inputClass}
              value={m.description}
              onChange={(e) => setM({ ...m, description: e.target.value })}
            />
          </div>
        </div>
      )}
      <ErrorNote error={error} />
    </Modal>
  )
}

/** Sources page card: the folder browser assistants drop jobs into. */
export function JobInboxCard(): React.JSX.Element {
  const { toast } = useApp()
  const [s, setS] = useState<JobInboxStatus | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    call('jobs:inbox-status')
      .then(setS)
      .catch(() => undefined)
  }, [])
  const scan = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await call('jobs:inbox-scan')
      setS(r)
      const l = r.lastResult
      toast(
        l?.files
          ? `${l.files} file(s): ${l.added} new job(s), ${l.updated} updated${l.errors.length ? `, ${l.errors.length} problem(s)` : ''}`
          : 'The inbox is empty',
        l?.errors.length ? 'info' : 'success'
      )
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card
      className="mb-6"
      title={
        <span className="flex items-center gap-2">
          <Inbox className="h-4 w-4 text-cyan-300" /> Job inbox (browser assistant)
        </span>
      }
      subtitle="Jobs saved as .json files in this folder are imported automatically — for example by the “find jobs near me” Claude skill browsing job pages in your own browser."
    >
      <p className="break-all font-mono text-[11px] text-slate-300" data-testid="inbox-path">
        {s?.path ?? '…'}
      </p>
      <p className="mt-1 text-[11px] text-slate-400">
        {s
          ? `${s.pending} waiting · ${s.imported} imported · ${s.failed} rejected${s.lastScanAt ? ` · checked ${timeAgo(s.lastScanAt)}` : ''}`
          : ''}
      </p>
      {s?.lastResult?.errors.length ? (
        <ul className="mt-1 list-disc pl-5 text-[11px] text-amber-200">
          {s.lastResult.errors.slice(0, 4).map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          icon={<FolderOpen className="h-3 w-3" />}
          onClick={() => void call('jobs:inbox-open')}
        >
          Open folder
        </Button>
        <Button
          size="sm"
          loading={busy}
          icon={<RefreshCw className="h-3 w-3" />}
          onClick={() => void scan()}
        >
          Import now
        </Button>
      </div>
      <p className="mt-2 text-[11px] text-slate-500">
        Each job needs a title, employer, location and a link to the original posting. Imported jobs
        are marked “Unverified” until you check them, and go through the same occupation and
        location filters as every other job.
      </p>
    </Card>
  )
}
