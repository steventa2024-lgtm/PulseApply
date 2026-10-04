import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  Crown,
  Download,
  FileText,
  FolderOpen,
  History,
  Lightbulb,
  Plus,
  Redo2,
  Save,
  Trash2,
  Undo2,
  X
} from 'lucide-react'
import {
  SECTION_LABEL,
  TEMPLATES,
  type ResumeDocument,
  type ResumeSectionId,
  type ResumeSuggestion,
  type ResumeVersionInfo
} from '../../../../shared/resume'
import type { ScoredJob } from '../../../../shared/types'
import { Badge, Button, Input, Label, Modal, Select, Toggle, inputClass } from '../../components/ui'
import { call } from '../../lib/api'
import { useApp } from '../../lib/appContext'
import { cx } from '../../lib/cx'
import { ResumePreview } from './Preview'

const uid = (): string => Math.random().toString(36).slice(2) + Date.now().toString(36)
const MAX_HISTORY = 60

export function ResumeEditor({
  initial,
  onBack
}: {
  initial: ResumeDocument
  onBack: () => void
}): React.JSX.Element {
  const { toast, refreshCounters } = useApp()
  const [doc, setDoc] = useState(initial)
  const [past, setPast] = useState<ResumeDocument[]>([])
  const [future, setFuture] = useState<ResumeDocument[]>([])
  const [savedVersion, setSavedVersion] = useState(JSON.stringify(initial))
  const [saving, setSaving] = useState(false)
  const [suggestions, setSuggestions] = useState<ResumeSuggestion[] | null>(null)
  const [aiDetail, setAiDetail] = useState('')
  const [useAi, setUseAi] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [editing, setEditing] = useState<Record<string, string>>({})
  const [jobs, setJobs] = useState<ScoredJob[]>([])
  const [jobId, setJobId] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exported, setExported] = useState<{ path: string; pages: number; bytes: number } | null>(
    null
  )
  const [versions, setVersions] = useState<ResumeVersionInfo[] | null>(null)
  const dirty = JSON.stringify(doc) !== savedVersion

  useEffect(() => {
    call('jobs:list', { view: 'saved', limit: 50 })
      .then((saved) =>
        call('jobs:list', { view: 'eligible', limit: 30 }).then((el) =>
          setJobs([...saved, ...el.filter((j) => !saved.some((s) => s.id === j.id))])
        )
      )
      .catch(() => setJobs([]))
  }, [])

  const docRef = useRef(doc)
  useEffect(() => {
    docRef.current = doc
  }, [doc])

  /** Every edit goes through here so it can be undone. */
  const update = useCallback((fn: (d: ResumeDocument) => ResumeDocument) => {
    const prev = docRef.current
    const next = fn(prev)
    if (next === prev) return
    docRef.current = next
    setPast((p) => [...p.slice(-MAX_HISTORY), prev])
    setFuture([])
    setDoc(next)
  }, [])
  const undo = (): void => {
    const prev = past[past.length - 1]
    if (!prev) return
    setFuture((f) => [doc, ...f])
    setPast((p) => p.slice(0, -1))
    setDoc(prev)
  }
  const redo = (): void => {
    const next = future[0]
    if (!next) return
    setPast((p) => [...p, doc])
    setFuture((f) => f.slice(1))
    setDoc(next)
  }

  const save = async (note?: string): Promise<ResumeDocument | null> => {
    setSaving(true)
    try {
      const saved = await call('resume:save', { doc, note })
      setDoc(saved)
      setSavedVersion(JSON.stringify(saved))
      toast(`Saved version ${saved.version}`, 'success')
      return saved
    } catch (e) {
      toast((e as Error).message, 'error')
      return null
    } finally {
      setSaving(false)
    }
  }

  const analyze = async (): Promise<void> => {
    setAnalyzing(true)
    try {
      const res = await call('resume:analyze', {
        doc,
        jobId: jobId || undefined,
        useAi
      })
      setSuggestions(res.suggestions)
      setAiDetail(res.aiDetail)
      setEditing({})
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setAnalyzing(false)
    }
  }

  const accept = async (s: ResumeSuggestion): Promise<void> => {
    const edited = editing[s.id]
    const next = await call('resume:apply', { doc, suggestion: s, edited })
    update(() => next)
    setSuggestions((l) => (l ?? []).filter((x) => x.id !== s.id))
  }
  const reject = (s: ResumeSuggestion): void =>
    setSuggestions((l) => (l ?? []).filter((x) => x.id !== s.id))

  const download = async (): Promise<void> => {
    setExporting(true)
    try {
      const res = await call('resume:export-pdf', { doc })
      if (res) {
        setExported(res)
        toast(`PDF saved (${res.pages} page${res.pages === 1 ? '' : 's'})`, 'success')
      }
    } catch (e) {
      toast(`PDF export failed: ${(e as Error).message}`, 'error')
    } finally {
      setExporting(false)
    }
  }

  const setMaster = async (): Promise<void> => {
    const saved = dirty || doc.version === 0 ? await save('Saved before setting as master') : doc
    if (!saved) return
    try {
      const res = await call('resume:set-master', { id: saved.id })
      if (!res) return
      setDoc(res.doc)
      setSavedVersion(JSON.stringify(res.doc))
      refreshCounters()
      toast(
        `“${res.doc.name}” is now your master resume. Profile updated and jobs re-scored.`,
        'success'
      )
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const showVersions = async (): Promise<void> =>
    setVersions(await call('resume:versions', { id: doc.id }).catch(() => []))
  const restore = async (v: number): Promise<void> => {
    const old = await call('resume:version', { id: doc.id, version: v })
    update(() => ({ ...old, version: doc.version, isMaster: doc.isMaster }))
    setVersions(null)
    toast(`Loaded version ${v} — save to keep it`, 'info')
  }

  const setContact = (k: keyof ResumeDocument['contact'], v: string): void =>
    update((d) => ({ ...d, contact: { ...d.contact, [k]: v } }))
  const moveSection = (s: ResumeSectionId, dir: -1 | 1): void =>
    update((d) => {
      const order = [...d.sectionOrder]
      const i = order.indexOf(s)
      const j = i + dir
      if (i < 0 || j < 0 || j >= order.length) return d
      ;[order[i], order[j]] = [order[j], order[i]]
      return { ...d, sectionOrder: order }
    })

  return (
    <div className="flex h-[calc(100vh-7rem)] min-h-[560px] flex-col">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button variant="ghost" icon={<ArrowLeft className="h-3.5 w-3.5" />} onClick={onBack}>
          All resumes
        </Button>
        <div className="w-60">
          <Input
            aria-label="Resume name"
            value={doc.name}
            onChange={(e) => update((d) => ({ ...d, name: e.target.value }))}
          />
        </div>
        {doc.isMaster && (
          <Badge tone="green">
            <Crown className="h-3 w-3" /> Master resume
          </Badge>
        )}
        <Badge tone={dirty ? 'amber' : 'slate'}>
          {dirty ? 'Unsaved changes' : doc.version ? `Saved · v${doc.version}` : 'Not saved'}
        </Badge>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            aria-label="Undo"
            disabled={!past.length}
            onClick={undo}
          >
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Redo"
            disabled={!future.length}
            onClick={redo}
          >
            <Redo2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            icon={<History className="h-3 w-3" />}
            onClick={() => void showVersions()}
          >
            Versions
          </Button>
          <Button
            size="sm"
            loading={saving}
            disabled={!dirty && doc.version > 0}
            icon={<Save className="h-3 w-3" />}
            onClick={() => void save()}
          >
            Save
          </Button>
          <Button
            size="sm"
            variant="primary"
            loading={exporting}
            icon={<Download className="h-3 w-3" />}
            onClick={() => void download()}
          >
            Download PDF
          </Button>
          <Button size="sm" icon={<Crown className="h-3 w-3" />} onClick={() => void setMaster()}>
            Set as master resume
          </Button>
        </div>
      </div>

      {exported && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
          <Check className="h-3.5 w-3.5" />
          <span className="min-w-0 flex-1 truncate" title={exported.path}>
            Saved and verified: {exported.path} · {exported.pages} page
            {exported.pages === 1 ? '' : 's'} · {Math.round(exported.bytes / 1024)} KB
          </span>
          <Button
            size="sm"
            icon={<FileText className="h-3 w-3" />}
            onClick={() =>
              void call('resume:open-pdf', { path: exported.path }).catch((e) =>
                toast((e as Error).message, 'error')
              )
            }
          >
            Open PDF
          </Button>
          <Button
            size="sm"
            icon={<FolderOpen className="h-3 w-3" />}
            onClick={() =>
              void call('resume:open-pdf', { path: exported.path, reveal: true }).catch((e) =>
                toast((e as Error).message, 'error')
              )
            }
          >
            Show in folder
          </Button>
          <button aria-label="Close" onClick={() => setExported(null)}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[45fr_55fr] gap-4">
        {/* ---------------- editor ---------------- */}
        <div className="min-h-0 space-y-4 overflow-y-auto pr-1" data-testid="resume-editor">
          <Section title="Design">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="r-template">Template</Label>
                <Select
                  id="r-template"
                  value={doc.template}
                  onChange={(e) =>
                    update((d) => ({
                      ...d,
                      template: e.target.value as ResumeDocument['template']
                    }))
                  }
                >
                  {TEMPLATES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="r-size">Paper</Label>
                <Select
                  id="r-size"
                  value={doc.pageSize}
                  onChange={(e) =>
                    update((d) => ({
                      ...d,
                      pageSize: e.target.value as ResumeDocument['pageSize']
                    }))
                  }
                >
                  <option value="letter">US Letter</option>
                  <option value="a4">A4</option>
                </Select>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">Section order</p>
            <ul className="mt-1 space-y-1">
              {doc.sectionOrder.map((s, i) => (
                <li
                  key={s}
                  className="flex items-center justify-between rounded-lg bg-white/[0.03] px-2 py-1 text-[11px]"
                >
                  {SECTION_LABEL[s]}
                  <span className="flex gap-1">
                    <button
                      aria-label={`Move ${SECTION_LABEL[s]} up`}
                      disabled={i === 0}
                      onClick={() => moveSection(s, -1)}
                      className="disabled:opacity-30"
                    >
                      <ArrowUp className="h-3 w-3" />
                    </button>
                    <button
                      aria-label={`Move ${SECTION_LABEL[s]} down`}
                      disabled={i === doc.sectionOrder.length - 1}
                      onClick={() => moveSection(s, 1)}
                      className="disabled:opacity-30"
                    >
                      <ArrowDown className="h-3 w-3" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Contact">
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ['fullName', 'Full name'],
                  ['email', 'Email'],
                  ['phone', 'Phone'],
                  ['location', 'City, State'],
                  ['linkedin', 'LinkedIn'],
                  ['website', 'Website']
                ] as const
              ).map(([k, label]) => (
                <div key={k}>
                  <Label htmlFor={`r-${k}`}>{label}</Label>
                  <Input
                    id={`r-${k}`}
                    value={doc.contact[k]}
                    onChange={(e) => setContact(k, e.target.value)}
                  />
                </div>
              ))}
            </div>
            <Label htmlFor="r-headline">Headline</Label>
            <Input
              id="r-headline"
              value={doc.headline ?? ''}
              onChange={(e) => update((d) => ({ ...d, headline: e.target.value || undefined }))}
            />
          </Section>

          <Section title="Summary">
            <textarea
              aria-label="Summary"
              rows={3}
              className={inputClass}
              value={doc.summary ?? ''}
              onChange={(e) => update((d) => ({ ...d, summary: e.target.value || undefined }))}
            />
          </Section>

          <Section
            title="Experience"
            action={
              <Button
                size="sm"
                icon={<Plus className="h-3 w-3" />}
                onClick={() =>
                  update((d) => ({
                    ...d,
                    experience: [
                      ...d.experience,
                      { id: uid(), title: '', company: '', current: false, bullets: [] }
                    ]
                  }))
                }
              >
                Add
              </Button>
            }
          >
            {doc.experience.map((e, i) => {
              const set = (patch: Partial<typeof e>): void =>
                update((d) => ({
                  ...d,
                  experience: d.experience.map((x, j) => (j === i ? { ...x, ...patch } : x))
                }))
              return (
                <div key={e.id} className="mb-3 rounded-lg border border-white/[0.06] p-2.5">
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      aria-label="Job title"
                      placeholder="Job title"
                      value={e.title}
                      onChange={(ev) => set({ title: ev.target.value })}
                    />
                    <Input
                      aria-label="Employer"
                      placeholder="Employer"
                      value={e.company}
                      onChange={(ev) => set({ company: ev.target.value })}
                    />
                    <Input
                      aria-label="Start"
                      type="month"
                      title="Start month"
                      value={e.startDate ?? ''}
                      onChange={(ev) => set({ startDate: ev.target.value || undefined })}
                    />
                    <Input
                      aria-label="End"
                      type="month"
                      title="End month"
                      disabled={e.current}
                      value={e.endDate ?? ''}
                      onChange={(ev) => set({ endDate: ev.target.value || undefined })}
                    />
                    <div className="col-span-2">
                      <Input
                        aria-label="Location"
                        placeholder="Location (optional)"
                        value={e.location ?? ''}
                        onChange={(ev) => set({ location: ev.target.value || undefined })}
                      />
                    </div>
                  </div>
                  <label className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-400">
                    <input
                      type="checkbox"
                      checked={e.current}
                      onChange={(ev) => set({ current: ev.target.checked })}
                    />
                    Current job
                  </label>
                  <textarea
                    aria-label={`Bullets for ${e.title || 'job'}`}
                    rows={Math.max(3, e.bullets.length + 1)}
                    className={cx(inputClass, 'mt-1')}
                    value={e.bullets.join('\n')}
                    placeholder="One line per accomplishment or duty"
                    onChange={(ev) => set({ bullets: ev.target.value.split('\n') })}
                  />
                  <div className="mt-1 flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Move up"
                      disabled={i === 0}
                      onClick={() =>
                        update((d) => {
                          const x = [...d.experience]
                          ;[x[i - 1], x[i]] = [x[i], x[i - 1]]
                          return { ...d, experience: x }
                        })
                      }
                    >
                      <ArrowUp className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Remove job"
                      onClick={() =>
                        update((d) => ({
                          ...d,
                          experience: d.experience.filter((_, j) => j !== i)
                        }))
                      }
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              )
            })}
          </Section>

          <Section title="Skills">
            <textarea
              aria-label="Skills"
              rows={2}
              className={inputClass}
              value={doc.skills.join(', ')}
              onChange={(e) =>
                update((d) => ({
                  ...d,
                  skills: e.target.value.split(',').map((s) => s.trimStart())
                }))
              }
              onBlur={() =>
                update((d) => ({ ...d, skills: d.skills.map((s) => s.trim()).filter(Boolean) }))
              }
            />
          </Section>

          <Section
            title="Education"
            action={
              <Button
                size="sm"
                icon={<Plus className="h-3 w-3" />}
                onClick={() =>
                  update((d) => ({
                    ...d,
                    education: [...d.education, { id: uid(), institution: '' }]
                  }))
                }
              >
                Add
              </Button>
            }
          >
            {doc.education.map((e, i) => {
              const set = (patch: Partial<typeof e>): void =>
                update((d) => ({
                  ...d,
                  education: d.education.map((x, j) => (j === i ? { ...x, ...patch } : x))
                }))
              return (
                <div key={e.id} className="mb-2 grid grid-cols-[1fr_1fr_110px_auto] gap-1.5">
                  <Input
                    aria-label="School"
                    placeholder="School"
                    value={e.institution}
                    onChange={(ev) => set({ institution: ev.target.value })}
                  />
                  <Input
                    aria-label="Degree"
                    placeholder="Degree / field"
                    value={e.degree ?? ''}
                    onChange={(ev) => set({ degree: ev.target.value || undefined })}
                  />
                  <Input
                    aria-label="Graduated"
                    placeholder="Year, e.g. 2018"
                    maxLength={20}
                    value={e.graduationDate ?? ''}
                    onChange={(ev) => set({ graduationDate: ev.target.value || undefined })}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Remove school"
                    onClick={() =>
                      update((d) => ({ ...d, education: d.education.filter((_, j) => j !== i) }))
                    }
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              )
            })}
          </Section>

          <Section
            title="Certifications"
            action={
              <Button
                size="sm"
                icon={<Plus className="h-3 w-3" />}
                onClick={() =>
                  update((d) => ({
                    ...d,
                    certifications: [...d.certifications, { id: uid(), name: '' }]
                  }))
                }
              >
                Add
              </Button>
            }
          >
            {doc.certifications.map((c, i) => {
              const set = (patch: Partial<typeof c>): void =>
                update((d) => ({
                  ...d,
                  certifications: d.certifications.map((x, j) => (j === i ? { ...x, ...patch } : x))
                }))
              return (
                <div key={c.id} className="mb-2 grid grid-cols-[1fr_1fr_auto] gap-1.5">
                  <Input
                    aria-label="Certification"
                    placeholder="Name"
                    value={c.name}
                    onChange={(ev) => set({ name: ev.target.value })}
                  />
                  <Input
                    aria-label="Issuer"
                    placeholder="Issuer (optional)"
                    value={c.issuer ?? ''}
                    onChange={(ev) => set({ issuer: ev.target.value || undefined })}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Remove certification"
                    onClick={() =>
                      update((d) => ({
                        ...d,
                        certifications: d.certifications.filter((_, j) => j !== i)
                      }))
                    }
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              )
            })}
          </Section>

          <Section
            title="Suggestions"
            icon={<Lightbulb className="h-3.5 w-3.5 text-amber-300" />}
            action={
              <Button
                size="sm"
                variant="primary"
                loading={analyzing}
                onClick={() => void analyze()}
              >
                {suggestions ? 'Re-check' : 'Review my resume'}
              </Button>
            }
          >
            <div className="mb-2 grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="r-job" hint="(optional)">
                  Tailor for a job
                </Label>
                <Select id="r-job" value={jobId} onChange={(e) => setJobId(e.target.value)}>
                  <option value="">Target role only</option>
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.title} — {j.company}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="pt-5">
                <Toggle
                  checked={useAi}
                  onChange={setUseAi}
                  label="Also ask local AI (Ollama) for wording"
                />
              </div>
            </div>
            <p className="mb-2 text-[11px] text-slate-500">
              Suggestions only rephrase what you wrote or point out gaps. Skills and keywords are
              added only if you accept them — add only what is true.
            </p>
            {aiDetail && <p className="mb-2 text-[11px] text-slate-400">{aiDetail}</p>}
            {suggestions?.length === 0 && (
              <p className="text-xs text-emerald-300">No suggestions left.</p>
            )}
            <ul className="space-y-2" data-testid="suggestions">
              {(suggestions ?? []).map((s) => (
                <li
                  key={s.id}
                  className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-2.5 text-xs"
                >
                  <div className="mb-1 flex items-center gap-1.5">
                    <Badge tone={s.requiresConfirmation ? 'amber' : 'cyan'}>
                      {s.requiresConfirmation
                        ? 'Confirm it’s true'
                        : s.source === 'ollama'
                          ? 'Local AI'
                          : 'Wording'}
                    </Badge>
                    <span className="text-slate-400">{s.section}</span>
                  </div>
                  <p className="text-slate-200">{s.message}</p>
                  {s.before && <p className="mt-1 text-slate-500 line-through">{s.before}</p>}
                  {s.after !== undefined && (
                    <textarea
                      aria-label="Suggested text"
                      rows={2}
                      className={cx(inputClass, 'mt-1')}
                      value={editing[s.id] ?? s.after}
                      onChange={(e) => setEditing((m) => ({ ...m, [s.id]: e.target.value }))}
                    />
                  )}
                  <div className="mt-1.5 flex justify-end gap-1.5">
                    <Button size="sm" variant="ghost" onClick={() => reject(s)}>
                      {s.after !== undefined ? 'Reject' : 'Dismiss'}
                    </Button>
                    {s.after !== undefined && (
                      <Button size="sm" variant="primary" onClick={() => void accept(s)}>
                        Accept{editing[s.id] !== undefined ? ' edited' : ''}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        </div>

        {/* ---------------- preview ---------------- */}
        <div className="min-h-0">
          <ResumePreview doc={doc} />
        </div>
      </div>

      <Modal open={!!versions} title="Version history" onClose={() => setVersions(null)}>
        {versions?.length ? (
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {versions.map((v) => (
              <li
                key={v.version}
                className="flex items-center justify-between rounded-lg bg-white/[0.03] px-2.5 py-1.5 text-xs"
              >
                <span>
                  v{v.version} · {new Date(v.createdAt).toLocaleString()}
                  {v.note && <span className="text-slate-500"> — {v.note}</span>}
                </span>
                <Button size="sm" onClick={() => void restore(v.version)}>
                  Load
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-400">No saved versions yet.</p>
        )}
      </Modal>
    </div>
  )
}

function Section({
  title,
  icon,
  action,
  children
}: {
  title: string
  icon?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3.5">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-300">
          {icon}
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  )
}
