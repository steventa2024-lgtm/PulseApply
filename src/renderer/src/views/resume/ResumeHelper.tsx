import { useEffect, useState } from 'react'
import { Crown, FilePlus2, FileText, Sparkles, Trash2, Upload } from 'lucide-react'
import type { ResumeDocument, ResumeDocumentSummary } from '../../../../shared/resume'
import { TEMPLATES } from '../../../../shared/resume'
import type { ResumeRecord } from '../../../../shared/types'
import { Badge, Button, Card, Empty, PageHeader, Select } from '../../components/ui'
import { call } from '../../lib/api'
import { useApp } from '../../lib/appContext'
import { timeAgo } from '../../lib/format'
import { Questionnaire } from './Questionnaire'
import { ResumeEditor } from './Editor'

type Mode = { kind: 'list' } | { kind: 'create' } | { kind: 'edit'; doc: ResumeDocument }

export default function ResumeHelper(): React.JSX.Element {
  const { toast } = useApp()
  const [mode, setMode] = useState<Mode>({ kind: 'list' })
  const [docs, setDocs] = useState<ResumeDocumentSummary[] | null>(null)
  const [uploads, setUploads] = useState<ResumeRecord[]>([])
  const [source, setSource] = useState('')
  const [contact, setContact] = useState<ResumeDocument['contact']>({
    fullName: '',
    email: '',
    phone: '',
    location: '',
    linkedin: '',
    website: ''
  })
  const [busy, setBusy] = useState(false)

  const load = (): void => {
    call('resume:list')
      .then(setDocs)
      .catch(() => setDocs([]))
    call('profile:get')
      .then((p) => {
        setUploads(p.resumes)
        setSource((s) => s || (p.resumes.find((r) => r.isDefault)?.id ?? p.resumes[0]?.id ?? ''))
        setContact({
          fullName: p.profile.fullName.value,
          email: p.profile.email.value,
          phone: p.profile.phone.value,
          location: p.profile.location.value,
          linkedin: p.profile.linkedinUrl,
          website: p.profile.portfolioUrl
        })
      })
      .catch(() => undefined)
  }
  useEffect(load, [])

  const improve = async (): Promise<void> => {
    setBusy(true)
    try {
      const doc = await call('resume:import', { resumeId: source || undefined })
      setMode({ kind: 'edit', doc })
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  const upload = async (): Promise<void> => {
    setBusy(true)
    try {
      const res = await call('profile:pick-resume')
      if (!res) return
      const doc = await call('resume:import', { resumeId: res.resume.id })
      setMode({ kind: 'edit', doc })
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  const open = async (id: string): Promise<void> =>
    setMode({ kind: 'edit', doc: await call('resume:get', { id }) })
  const remove = async (d: ResumeDocumentSummary): Promise<void> => {
    if (d.isMaster) return toast('Choose another master resume before deleting this one', 'error')
    setDocs(await call('resume:delete', { id: d.id }))
  }

  if (mode.kind === 'edit')
    return (
      <ResumeEditor
        key={mode.doc.id}
        initial={mode.doc}
        onBack={() => {
          setMode({ kind: 'list' })
          load()
        }}
      />
    )
  if (mode.kind === 'create')
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader title="Resume Helper" subtitle="Create a new resume step by step" />
        <Questionnaire
          initialContact={contact}
          onCancel={() => setMode({ kind: 'list' })}
          onCreated={(doc) => setMode({ kind: 'edit', doc })}
        />
      </div>
    )

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Resume Helper"
        subtitle="Improve your resume or build one from scratch, preview it live, download a PDF, and use it for applications."
      />
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <Card
          title={
            <span className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-cyan-300" /> Improve existing resume
            </span>
          }
          subtitle="Start from a resume you uploaded. Nothing is changed until you accept a suggestion."
        >
          {uploads.length > 0 ? (
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Select
                  aria-label="Uploaded resume"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                >
                  {uploads.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                      {r.isDefault ? ' (current)' : ''}
                    </option>
                  ))}
                </Select>
              </div>
              <Button variant="primary" loading={busy} onClick={() => void improve()}>
                Improve this resume
              </Button>
            </div>
          ) : (
            <p className="mb-2 text-xs text-slate-400">No resume uploaded yet.</p>
          )}
          <Button
            className="mt-3"
            icon={<Upload className="h-3.5 w-3.5" />}
            loading={busy}
            onClick={() => void upload()}
          >
            Upload a resume (PDF or DOCX)
          </Button>
        </Card>
        <Card
          title={
            <span className="flex items-center gap-2">
              <FilePlus2 className="h-4 w-4 text-cyan-300" /> Create new resume
            </span>
          }
          subtitle="No resume? Answer a few guided questions — about your jobs, school and skills — in your own words."
        >
          <Button variant="primary" onClick={() => setMode({ kind: 'create' })}>
            Start the questions
          </Button>
          <p className="mt-2 text-[11px] text-slate-500">
            Templates: {TEMPLATES.map((t) => t.label).join(' · ')}. All are single-column and
            readable by applicant-tracking systems.
          </p>
        </Card>
      </div>

      <h2 className="mb-2 text-sm font-semibold text-slate-200">Your resumes</h2>
      {docs === null ? (
        <p className="text-xs text-slate-500">Loading…</p>
      ) : docs.length === 0 ? (
        <Empty icon={<FileText className="h-8 w-8" />} title="No resumes in the helper yet">
          Improve an uploaded resume or create a new one above.
        </Empty>
      ) : (
        <ul className="space-y-2">
          {docs.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3"
            >
              <button className="min-w-0 flex-1 text-left" onClick={() => void open(d.id)}>
                <p className="flex items-center gap-2 text-sm font-medium text-white">
                  {d.name}
                  {d.isMaster && (
                    <Badge tone="green">
                      <Crown className="h-3 w-3" /> Master
                    </Badge>
                  )}
                </p>
                <p className="text-[11px] text-slate-400">
                  {TEMPLATES.find((t) => t.id === d.template)?.label} · v{d.version} ·{' '}
                  {d.origin === 'imported' ? 'from an uploaded resume' : 'created here'} · edited{' '}
                  {timeAgo(d.updatedAt)}
                </p>
              </button>
              <Button size="sm" onClick={() => void open(d.id)}>
                Open
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Delete ${d.name}`}
                onClick={() => void remove(d)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
