import { useEffect, useId, useState, type DragEvent } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileCheck2,
  Plus,
  Save,
  Trash2,
  UploadCloud,
  X
} from 'lucide-react'
import type {
  CandidateProfile,
  EmploymentType,
  ExtractedField,
  ResumeRecord,
  WorkMode,
  YesNoUnset
} from '../../../shared/types'
import {
  Badge,
  Button,
  Card,
  Chip,
  ErrorNote,
  Input,
  Label,
  PageHeader,
  Select,
  Spinner,
  Toggle,
  inputClass
} from '../components/ui'
import { cx } from '../lib/cx'
import { call } from '../lib/api'
import { EMPLOYMENT_LABEL, timeAgo } from '../lib/format'
import { useApp } from '../lib/appContext'
import { LocationInput } from './Search'

const AUTH_COUNTRIES = ['US', 'CA', 'GB', 'DE', 'AU', 'IE', 'NL', 'FR', 'IN', 'MX']

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export default function Profile(): React.JSX.Element {
  const { toast } = useApp()
  const [profile, setProfile] = useState<CandidateProfile | null>(null)
  const [resumes, setResumes] = useState<ResumeRecord[]>([])
  const [needs, setNeeds] = useState<string[]>([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [lastParse, setLastParse] = useState<{
    warnings: string[]
    needsConfirmation: string[]
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const apply = (r: Awaited<ReturnType<typeof call<'profile:get'>>>): void => {
    setProfile(r.profile)
    setResumes(r.resumes)
    setNeeds(r.needsConfirmation)
    setDirty(false)
  }
  const load = async (): Promise<void> => apply(await call('profile:get'))
  useEffect(() => {
    call('profile:get')
      .then(apply)
      .catch((e) => setError((e as Error).message))
  }, [])

  const upd = (fn: (p: CandidateProfile) => CandidateProfile): void => {
    setProfile((p) => (p ? fn(structuredClone(p)) : p))
    setDirty(true)
  }

  const importResult = async (
    fn: () => Promise<Awaited<ReturnType<typeof call<'profile:import-resume'>>> | null>
  ): Promise<void> => {
    setUploading(true)
    setError(null)
    try {
      const r = await fn()
      if (!r) return
      setLastParse({ warnings: r.warnings, needsConfirmation: r.needsConfirmation })
      await load()
      toast(
        r.resume.needsOcr
          ? 'Resume stored, but it appears to be scanned — see warnings.'
          : 'Resume parsed. Review the highlighted fields.',
        r.resume.needsOcr ? 'info' : 'success'
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  const onDrop = async (e: DragEvent): Promise<void> => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    const path = window.pulse.pathForFile(file)
    if (path) return importResult(() => call('profile:import-resume', { path }))
    const buf = await file.arrayBuffer()
    let binary = ''
    const bytes = new Uint8Array(buf)
    for (let i = 0; i < bytes.length; i += 0x8000)
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return importResult(() =>
      call('profile:import-resume-data', { fileName: file.name, base64: btoa(binary) })
    )
  }

  const save = async (): Promise<void> => {
    if (!profile) return
    setSaving(true)
    setError(null)
    try {
      const saved = await call('profile:save', profile)
      setProfile(saved)
      setDirty(false)
      const r = await call('profile:get')
      setNeeds(r.needsConfirmation)
      toast('Profile saved', 'success')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (!profile) return <Spinner label="Loading profile…" />

  return (
    <div>
      <PageHeader
        title="Profile"
        subtitle="Extracted from your resume and editable. PulseApply never invents qualifications: anything not found stays empty until you add it."
        actions={
          <>
            <Button
              icon={<Download className="h-3.5 w-3.5" />}
              onClick={() =>
                void call('profile:export').then((p) => p && toast(`Exported to ${p}`, 'success'))
              }
            >
              Export
            </Button>
            <Button
              variant="danger"
              icon={<Trash2 className="h-3.5 w-3.5" />}
              onClick={() =>
                void call('profile:delete-all').then(async (ok) => {
                  if (ok) await load()
                })
              }
            >
              Delete profile
            </Button>
            <Button
              variant="primary"
              loading={saving}
              disabled={!dirty}
              icon={<Save className="h-3.5 w-3.5" />}
              onClick={save}
            >
              Save changes
            </Button>
          </>
        }
      />
      <ErrorNote error={error} />

      <div className="mt-2 grid gap-5 lg:grid-cols-[1fr_1fr]">
        <Card
          title="Resumes"
          subtitle="PDF (text-based), DOCX or TXT. Choose which version to attach per application."
        >
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => void onDrop(e)}
            className={cx(
              'flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition',
              dragging ? 'border-cyan-400 bg-cyan-500/10' : 'border-white/10'
            )}
          >
            {uploading ? (
              <Spinner label="Extracting resume…" />
            ) : (
              <UploadCloud className="h-7 w-7 text-cyan-400" />
            )}
            <p className="mt-2 text-xs text-slate-300">Drop a resume here</p>
            <Button
              size="sm"
              className="mt-3"
              disabled={uploading}
              onClick={() => void importResult(() => call('profile:pick-resume'))}
            >
              Choose file…
            </Button>
          </div>
          {lastParse &&
            (lastParse.warnings.length > 0 || lastParse.needsConfirmation.length > 0) && (
              <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] text-amber-100">
                {lastParse.warnings.map((w) => (
                  <p key={w}>• {w}</p>
                ))}
                {lastParse.needsConfirmation.length > 0 && (
                  <p>• Please confirm: {lastParse.needsConfirmation.join(', ')}</p>
                )}
              </div>
            )}
          <ul className="mt-3 space-y-2">
            {resumes.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.07] px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <FileCheck2 className="h-4 w-4 shrink-0 text-cyan-300" />
                  <div className="min-w-0">
                    <p className="truncate text-xs text-white">{r.label}</p>
                    <p className="text-[10px] text-slate-500">
                      {r.format.toUpperCase()} · {r.textLength} chars · {timeAgo(r.parsedAt)}
                      {r.needsOcr && <span className="text-amber-300"> · scanned (no text)</span>}
                      {!r.storedPath && <span className="text-amber-300"> · file missing</span>}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {r.isDefault ? (
                    <Badge tone="green">default</Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void call('profile:set-default-resume', { id: r.id }).then(setResumes)
                      }
                    >
                      Make default
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Delete resume"
                    icon={<Trash2 className="h-3 w-3" />}
                    onClick={() =>
                      void call('profile:delete-resume', { id: r.id }).then(setResumes)
                    }
                  />
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Contact details" subtitle="Used to fill application forms.">
          {needs.length > 0 && (
            <p className="mb-3 flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {needs.join(', ')}
            </p>
          )}
          <div className="space-y-3">
            <FieldEditor
              label="Full name"
              field={profile.fullName}
              onChange={(f) => upd((p) => ({ ...p, fullName: f }))}
            />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>First name</Label>
                <Input
                  value={profile.firstName ?? ''}
                  onChange={(e) => upd((p) => ({ ...p, firstName: e.target.value }))}
                />
              </div>
              <div>
                <Label>Last name</Label>
                <Input
                  value={profile.lastName ?? ''}
                  onChange={(e) => upd((p) => ({ ...p, lastName: e.target.value }))}
                />
              </div>
            </div>
            <FieldEditor
              label="Email"
              field={profile.email}
              onChange={(f) => upd((p) => ({ ...p, email: f }))}
            />
            <FieldEditor
              label="Phone"
              field={profile.phone}
              onChange={(f) => upd((p) => ({ ...p, phone: f }))}
            />
            <FieldEditor
              label="Location"
              field={profile.location}
              onChange={(f) => upd((p) => ({ ...p, location: f }))}
            />
            {(['linkedinUrl', 'githubUrl', 'portfolioUrl'] as const).map((k) => (
              <div key={k}>
                <Label>
                  {k === 'linkedinUrl'
                    ? 'LinkedIn URL'
                    : k === 'githubUrl'
                      ? 'GitHub URL'
                      : 'Website / portfolio'}
                </Label>
                <Input
                  value={profile[k]}
                  placeholder="https://…"
                  onChange={(e) => upd((p) => ({ ...p, [k]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card
        className="mt-5"
        title="Work history"
        subtitle="Used to judge occupational relevance and experience. Confirm entries once they are correct."
        actions={
          <Button
            size="sm"
            icon={<Plus className="h-3 w-3" />}
            onClick={() =>
              upd((p) => ({
                ...p,
                workHistory: [
                  ...p.workHistory,
                  {
                    id: uid(),
                    title: '',
                    company: '',
                    current: false,
                    confidence: 1,
                    confirmed: true
                  }
                ]
              }))
            }
          >
            Add
          </Button>
        }
      >
        {profile.workHistory.length === 0 && (
          <p className="text-xs text-slate-500">No work history yet.</p>
        )}
        <div className="space-y-3">
          {profile.workHistory.map((w, i) => (
            <div
              key={w.id}
              className={cx(
                'rounded-xl border p-3',
                w.confirmed ? 'border-white/[0.07]' : 'border-amber-500/30'
              )}
            >
              <div className="grid grid-cols-[1fr_1fr_110px_110px_auto] items-end gap-2">
                <div>
                  <Label>Title</Label>
                  <Input
                    value={w.title}
                    onChange={(e) => upd((p) => ((p.workHistory[i].title = e.target.value), p))}
                  />
                </div>
                <div>
                  <Label>Employer</Label>
                  <Input
                    value={w.company}
                    onChange={(e) => upd((p) => ((p.workHistory[i].company = e.target.value), p))}
                  />
                </div>
                <div>
                  <Label>Start (YYYY-MM)</Label>
                  <Input
                    value={w.startDate ?? ''}
                    placeholder="2021-03"
                    onChange={(e) =>
                      upd((p) => ((p.workHistory[i].startDate = e.target.value || undefined), p))
                    }
                  />
                </div>
                <div>
                  <Label>End</Label>
                  <Input
                    value={w.current ? 'present' : (w.endDate ?? '')}
                    disabled={w.current}
                    placeholder="2023-06"
                    onChange={(e) =>
                      upd((p) => ((p.workHistory[i].endDate = e.target.value || undefined), p))
                    }
                  />
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Remove"
                  icon={<X className="h-3 w-3" />}
                  onClick={() =>
                    upd((p) => ({ ...p, workHistory: p.workHistory.filter((x) => x.id !== w.id) }))
                  }
                />
              </div>
              <textarea
                className={cx(inputClass, 'mt-2 h-16 resize-y')}
                placeholder="What you did (optional)"
                value={w.summary ?? ''}
                onChange={(e) => upd((p) => ((p.workHistory[i].summary = e.target.value), p))}
              />
              <div className="mt-2 flex items-center gap-4">
                <Toggle
                  checked={w.current}
                  onChange={(v) => upd((p) => ((p.workHistory[i].current = v), p))}
                  label="Current job"
                />
                <Toggle
                  checked={w.confirmed}
                  onChange={(v) => upd((p) => ((p.workHistory[i].confirmed = v), p))}
                  label={
                    w.confirmed
                      ? 'Confirmed'
                      : `Unconfirmed (extraction confidence ${Math.round(w.confidence * 100)}%)`
                  }
                />
                {w.months !== undefined && (
                  <span className="text-[11px] text-slate-500">≈ {w.months} months</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card
          title="Skills"
          subtitle="Extracted or added by you. Only listed skills count toward matches."
        >
          <TagEditor
            items={profile.skills.map((s) => ({ name: s.name, confirmed: s.confirmed }))}
            onAdd={(name) =>
              upd((p) => ({
                ...p,
                skills: [...p.skills, { name, source: 'user', confirmed: true }]
              }))
            }
            onRemove={(name) =>
              upd((p) => ({ ...p, skills: p.skills.filter((s) => s.name !== name) }))
            }
            onConfirmAll={() =>
              upd((p) => ({ ...p, skills: p.skills.map((s) => ({ ...s, confirmed: true })) }))
            }
          />
        </Card>
        <Card title="Certifications & licenses" subtitle="Only add credentials you actually hold.">
          <TagEditor
            items={profile.certifications.map((s) => ({ name: s.name, confirmed: s.confirmed }))}
            onAdd={(name) =>
              upd((p) => ({
                ...p,
                certifications: [...p.certifications, { name, source: 'user', confirmed: true }]
              }))
            }
            onRemove={(name) =>
              upd((p) => ({
                ...p,
                certifications: p.certifications.filter((s) => s.name !== name)
              }))
            }
            onConfirmAll={() =>
              upd((p) => ({
                ...p,
                certifications: p.certifications.map((s) => ({ ...s, confirmed: true }))
              }))
            }
          />
        </Card>
      </div>

      <Card
        className="mt-5"
        title="Job preferences"
        subtitle="Used for “near me” searches and as match criteria."
      >
        <div className="grid gap-3 md:grid-cols-3">
          <div className="md:col-span-2">
            <Label>Target roles (comma separated)</Label>
            <Input
              value={profile.preferences.targetRoles.join(', ')}
              placeholder="Warehouse Associate, Barista"
              onChange={(e) =>
                upd(
                  (p) => (
                    (p.preferences.targetRoles = e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean)),
                    p
                  )
                )
              }
            />
          </div>
          <div>
            <Label>Preferred location</Label>
            <LocationInput
              value={profile.preferences.location ?? ''}
              onChange={(v) => upd((p) => ((p.preferences.location = v), p))}
            />
          </div>
          <div>
            <Label>Commute radius</Label>
            <div className="flex gap-2">
              <Input
                type="number"
                min={1}
                value={profile.preferences.radius ?? ''}
                onChange={(e) =>
                  upd(
                    (p) => (
                      (p.preferences.radius = e.target.value ? Number(e.target.value) : undefined),
                      p
                    )
                  )
                }
              />
              <Select
                value={profile.preferences.radiusUnit}
                onChange={(e) =>
                  upd((p) => ((p.preferences.radiusUnit = e.target.value as 'mi' | 'km'), p))
                }
              >
                <option value="mi">mi</option>
                <option value="km">km</option>
              </Select>
            </div>
          </div>
          <div>
            <Label>Minimum pay</Label>
            <div className="flex gap-2">
              <Input
                type="number"
                min={0}
                value={profile.preferences.minSalary ?? ''}
                onChange={(e) =>
                  upd(
                    (p) => (
                      (p.preferences.minSalary = e.target.value
                        ? Number(e.target.value)
                        : undefined),
                      p
                    )
                  )
                }
              />
              <Select
                value={profile.preferences.salaryPeriod ?? ''}
                onChange={(e) =>
                  upd(
                    (p) => (
                      (p.preferences.salaryPeriod = (e.target.value || undefined) as never),
                      p
                    )
                  )
                }
              >
                <option value="">auto</option>
                <option value="hour">/hour</option>
                <option value="year">/year</option>
              </Select>
            </div>
          </div>
          <div>
            <Label>Work modes</Label>
            <div className="flex flex-wrap gap-1.5">
              {(['onsite', 'hybrid', 'remote'] as WorkMode[]).map((m) => (
                <Chip
                  key={m}
                  active={profile.preferences.workModes.includes(m)}
                  onClick={() =>
                    upd(
                      (p) => (
                        (p.preferences.workModes = p.preferences.workModes.includes(m)
                          ? p.preferences.workModes.filter((x) => x !== m)
                          : [...p.preferences.workModes, m]),
                        p
                      )
                    )
                  }
                >
                  {m}
                </Chip>
              ))}
            </div>
          </div>
          <div className="md:col-span-3">
            <Label>Employment types</Label>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(EMPLOYMENT_LABEL) as EmploymentType[]).map((t) => (
                <Chip
                  key={t}
                  active={profile.preferences.employmentTypes.includes(t)}
                  onClick={() =>
                    upd(
                      (p) => (
                        (p.preferences.employmentTypes = p.preferences.employmentTypes.includes(t)
                          ? p.preferences.employmentTypes.filter((x) => x !== t)
                          : [...p.preferences.employmentTypes, t]),
                        p
                      )
                    )
                  }
                >
                  {EMPLOYMENT_LABEL[t]}
                </Chip>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card
          title="Work authorization (optional)"
          subtitle="Stored encrypted. Never inferred. Used for autofill only if you switch it on below."
        >
          <div className="grid grid-cols-2 gap-2">
            {AUTH_COUNTRIES.map((cc) => (
              <div key={cc} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="text-slate-300">Authorized to work in {cc}</span>
                <YesNo
                  value={profile.sensitive.authorizedToWork[cc] ?? 'unset'}
                  onChange={(v) => upd((p) => ((p.sensitive.authorizedToWork[cc] = v), p))}
                />
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between text-[11px]">
            <span className="text-slate-300">I require visa sponsorship</span>
            <YesNo
              value={profile.sensitive.requiresSponsorship}
              onChange={(v) => upd((p) => ((p.sensitive.requiresSponsorship = v), p))}
            />
          </div>
          <div className="mt-4 space-y-2 border-t border-white/[0.06] pt-3">
            <Toggle
              checked={profile.sensitive.allowAutofill.workAuthorization}
              onChange={(v) => upd((p) => ((p.sensitive.allowAutofill.workAuthorization = v), p))}
              label="Allow autofill of work-authorization questions with these answers"
            />
            <Toggle
              checked={profile.sensitive.allowAutofill.sponsorship}
              onChange={(v) => upd((p) => ((p.sensitive.allowAutofill.sponsorship = v), p))}
              label="Allow autofill of sponsorship questions with this answer"
            />
          </div>
        </Card>
        <Card
          title="Pre-approved answers"
          subtitle="Reusable answers for recurring questions (e.g. “How did you hear about us?”). Applied only when the form’s label contains your question text. Demographic, disability, veteran and criminal-history questions are answered only from answers you add here."
          actions={
            <Button
              size="sm"
              icon={<Plus className="h-3 w-3" />}
              onClick={() =>
                upd((p) => ({
                  ...p,
                  customAnswers: [
                    ...p.customAnswers,
                    { id: uid(), question: '', answer: '', approved: true }
                  ]
                }))
              }
            >
              Add
            </Button>
          }
        >
          {profile.customAnswers.length === 0 && (
            <p className="text-xs text-slate-500">None yet.</p>
          )}
          <div className="space-y-2">
            {profile.customAnswers.map((a, i) => (
              <div key={a.id} className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-2">
                <Input
                  placeholder="Question contains…"
                  value={a.question}
                  onChange={(e) => upd((p) => ((p.customAnswers[i].question = e.target.value), p))}
                />
                <Input
                  placeholder="Answer"
                  value={a.answer}
                  onChange={(e) => upd((p) => ((p.customAnswers[i].answer = e.target.value), p))}
                />
                <Toggle
                  checked={a.approved}
                  onChange={(v) => upd((p) => ((p.customAnswers[i].approved = v), p))}
                  label="use"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Remove"
                  icon={<X className="h-3 w-3" />}
                  onClick={() =>
                    upd((p) => ({
                      ...p,
                      customAnswers: p.customAnswers.filter((x) => x.id !== a.id)
                    }))
                  }
                />
              </div>
            ))}
          </div>
        </Card>
      </div>
      {dirty && (
        <div className="sticky bottom-0 mt-5 flex justify-end border-t border-white/[0.06] bg-[#090d16]/90 py-3 backdrop-blur">
          <Button
            variant="primary"
            loading={saving}
            icon={<Save className="h-3.5 w-3.5" />}
            onClick={save}
          >
            Save changes
          </Button>
        </div>
      )}
    </div>
  )
}

function FieldEditor({
  label,
  field,
  onChange
}: {
  label: string
  field: ExtractedField
  onChange: (f: ExtractedField) => void
}): React.JSX.Element {
  const id = useId()
  const uncertain = !field.confirmed && field.source === 'resume' && field.confidence < 0.85
  return (
    <div>
      <Label
        htmlFor={id}
        hint={
          field.value && field.source === 'resume'
            ? `(from resume, ${Math.round(field.confidence * 100)}% confidence)`
            : undefined
        }
      >
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          className={cx(uncertain && 'border-amber-500/50')}
          value={field.value}
          onChange={(e) =>
            onChange({ value: e.target.value, confidence: 1, source: 'user', confirmed: true })
          }
        />
        {field.value && !field.confirmed ? (
          <Button
            size="sm"
            onClick={() => onChange({ ...field, confirmed: true })}
            icon={<CheckCircle2 className="h-3 w-3" />}
          >
            Confirm
          </Button>
        ) : field.value ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-label="confirmed" />
        ) : null}
      </div>
    </div>
  )
}

function YesNo({
  value,
  onChange
}: {
  value: YesNoUnset
  onChange: (v: YesNoUnset) => void
}): React.JSX.Element {
  return (
    <div className="flex gap-1">
      {(['yes', 'no', 'unset'] as YesNoUnset[]).map((v) => (
        <Chip key={v} active={value === v} onClick={() => onChange(v)}>
          {v === 'unset' ? 'not set' : v}
        </Chip>
      ))}
    </div>
  )
}

function TagEditor({
  items,
  onAdd,
  onRemove,
  onConfirmAll
}: {
  items: { name: string; confirmed: boolean }[]
  onAdd: (n: string) => void
  onRemove: (n: string) => void
  onConfirmAll: () => void
}): React.JSX.Element {
  const [v, setV] = useState('')
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((s) => (
          <span
            key={s.name}
            className={cx(
              'inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px]',
              s.confirmed
                ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-200'
            )}
          >
            {s.name}
            <button onClick={() => onRemove(s.name)} aria-label={`Remove ${s.name}`}>
              <X className="h-3 w-3 opacity-70" />
            </button>
          </span>
        ))}
        {items.length === 0 && <span className="text-xs text-slate-500">None.</span>}
      </div>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (v.trim() && !items.some((i) => i.name.toLowerCase() === v.trim().toLowerCase()))
            onAdd(v.trim())
          setV('')
        }}
      >
        <Input value={v} placeholder="Add…" onChange={(e) => setV(e.target.value)} />
        <Button type="submit" size="sm">
          Add
        </Button>
        {items.some((i) => !i.confirmed) && (
          <Button size="sm" variant="ghost" onClick={onConfirmAll}>
            Confirm all
          </Button>
        )}
      </form>
    </div>
  )
}
