import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Plus, Trash2, Wand2 } from 'lucide-react'
import type { ResumeQuestionnairePayload } from '../../../../shared/ipc'
import { TEMPLATES, type ResumeDocument } from '../../../../shared/resume'
import {
  Button,
  Card,
  Chip,
  ErrorNote,
  Input,
  Label,
  Select,
  inputClass
} from '../../components/ui'
import { call } from '../../lib/api'
import { cx } from '../../lib/cx'

type Exp = ResumeQuestionnairePayload['experience'][number]
type Edu = ResumeQuestionnairePayload['education'][number]

const STEPS = ['Contact', 'Target role', 'Experience', 'Education', 'Skills', 'Template'] as const

const emptyExp = (): Exp => ({ title: '', company: '', current: false, duties: '' })

/**
 * Guided questions for people without a resume. Everything in the result comes
 * from these answers; PulseApply only tidies the wording and offers a skill
 * checklist for the chosen role (ticked only by the user).
 */
export function Questionnaire({
  initialContact,
  onCancel,
  onCreated
}: {
  initialContact: ResumeQuestionnairePayload['contact']
  onCancel: () => void
  onCreated: (doc: ResumeDocument) => void
}): React.JSX.Element {
  const [step, setStep] = useState(0)
  const [a, setA] = useState<ResumeQuestionnairePayload>({
    contact: initialContact,
    targetRole: '',
    experience: [emptyExp()],
    education: [],
    skills: [],
    certifications: [],
    template: 'classic',
    pageSize: 'letter'
  })
  const [hints, setHints] = useState<string[]>([])
  const [skillText, setSkillText] = useState('')
  const [certText, setCertText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!a.targetRole.trim()) return
    const t = setTimeout(
      () =>
        call('resume:role-skills', { role: a.targetRole })
          .then(setHints)
          .catch(() => setHints([])),
      300
    )
    return () => clearTimeout(t)
  }, [a.targetRole])

  const setExp = (i: number, patch: Partial<Exp>): void =>
    setA((x) => ({
      ...x,
      experience: x.experience.map((e, j) => (j === i ? { ...e, ...patch } : e))
    }))
  const setEdu = (i: number, patch: Partial<Edu>): void =>
    setA((x) => ({
      ...x,
      education: x.education.map((e, j) => (j === i ? { ...e, ...patch } : e))
    }))

  const canNext =
    step === 0
      ? !!a.contact.fullName.trim() && (!!a.contact.email.trim() || !!a.contact.phone.trim())
      : step === 1
        ? !!a.targetRole.trim()
        : true

  const finish = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const skills = [
        ...a.skills,
        ...skillText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      ]
      const certifications = certText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((name) => ({ name }))
      const doc = await call('resume:create', { ...a, skills, certifications })
      onCreated(doc)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card
      title="Create a new resume"
      subtitle="Answer in your own words. Nothing is added that you did not enter — you can edit everything afterwards."
    >
      <ol className="mb-5 flex flex-wrap gap-2 text-[11px]">
        {STEPS.map((s, i) => (
          <li
            key={s}
            className={cx(
              'rounded-full border px-2.5 py-0.5',
              i === step
                ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-200'
                : i < step
                  ? 'border-emerald-500/30 text-emerald-300'
                  : 'border-white/10 text-slate-500'
            )}
          >
            {i + 1}. {s}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              ['fullName', 'Full name'],
              ['email', 'Email'],
              ['phone', 'Phone'],
              ['location', 'City, State'],
              ['linkedin', 'LinkedIn URL (optional)'],
              ['website', 'Website (optional)']
            ] as const
          ).map(([k, label]) => (
            <div key={k}>
              <Label htmlFor={`q-${k}`}>{label}</Label>
              <Input
                id={`q-${k}`}
                value={a.contact[k]}
                onChange={(e) =>
                  setA((x) => ({ ...x, contact: { ...x.contact, [k]: e.target.value } }))
                }
              />
            </div>
          ))}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-3">
          <div>
            <Label htmlFor="q-role">What job do you want?</Label>
            <Input
              id="q-role"
              value={a.targetRole}
              placeholder="e.g. Warehouse Associate, Barista, Medical Assistant"
              onChange={(e) => setA((x) => ({ ...x, targetRole: e.target.value }))}
            />
          </div>
          <p className="text-[11px] text-slate-500">
            Used for the headline and to suggest skills commonly listed for this role. It is not
            added as experience.
          </p>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <p className="text-[11px] text-slate-400">
            List jobs, internships, volunteering or family business work. Describe what you did, one
            item per line — plain words are fine.
          </p>
          {a.experience.map((e, i) => (
            <div key={i} className="rounded-xl border border-white/[0.07] p-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor={`qe-t-${i}`}>Job title</Label>
                  <Input
                    id={`qe-t-${i}`}
                    value={e.title}
                    onChange={(ev) => setExp(i, { title: ev.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor={`qe-c-${i}`}>Employer</Label>
                  <Input
                    id={`qe-c-${i}`}
                    value={e.company}
                    onChange={(ev) => setExp(i, { company: ev.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor={`qe-s-${i}`}>Start (month)</Label>
                  <Input
                    id={`qe-s-${i}`}
                    type="month"
                    value={e.startDate ?? ''}
                    onChange={(ev) => setExp(i, { startDate: ev.target.value || undefined })}
                  />
                </div>
                <div>
                  <Label htmlFor={`qe-e-${i}`}>End (month)</Label>
                  <Input
                    id={`qe-e-${i}`}
                    type="month"
                    disabled={e.current}
                    value={e.endDate ?? ''}
                    onChange={(ev) => setExp(i, { endDate: ev.target.value || undefined })}
                  />
                  <label className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-400">
                    <input
                      type="checkbox"
                      checked={e.current}
                      onChange={(ev) => setExp(i, { current: ev.target.checked })}
                    />
                    I work here now
                  </label>
                </div>
              </div>
              <Label htmlFor={`qe-d-${i}`}>What did you do?</Label>
              <textarea
                id={`qe-d-${i}`}
                rows={4}
                className={inputClass}
                value={e.duties}
                placeholder={'Picked and packed orders\nLoaded trucks\nTrained new staff'}
                onChange={(ev) => setExp(i, { duties: ev.target.value })}
              />
              {a.experience.length > 1 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-2"
                  icon={<Trash2 className="h-3 w-3" />}
                  onClick={() =>
                    setA((x) => ({ ...x, experience: x.experience.filter((_, j) => j !== i) }))
                  }
                >
                  Remove
                </Button>
              )}
            </div>
          ))}
          <Button
            size="sm"
            icon={<Plus className="h-3 w-3" />}
            onClick={() => setA((x) => ({ ...x, experience: [...x.experience, emptyExp()] }))}
          >
            Add another job
          </Button>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3">
          {a.education.map((e, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_120px_auto] items-end gap-2">
              <div>
                <Label htmlFor={`qd-i-${i}`}>School</Label>
                <Input
                  id={`qd-i-${i}`}
                  value={e.institution}
                  onChange={(ev) => setEdu(i, { institution: ev.target.value })}
                />
              </div>
              <div>
                <Label htmlFor={`qd-d-${i}`}>Degree / diploma</Label>
                <Input
                  id={`qd-d-${i}`}
                  value={e.degree ?? ''}
                  onChange={(ev) => setEdu(i, { degree: ev.target.value || undefined })}
                />
              </div>
              <div>
                <Label htmlFor={`qd-f-${i}`}>Field</Label>
                <Input
                  id={`qd-f-${i}`}
                  value={e.field ?? ''}
                  onChange={(ev) => setEdu(i, { field: ev.target.value || undefined })}
                />
              </div>
              <div>
                <Label htmlFor={`qd-g-${i}`}>Finished</Label>
                <Input
                  id={`qd-g-${i}`}
                  type="month"
                  value={e.graduationDate ?? ''}
                  onChange={(ev) => setEdu(i, { graduationDate: ev.target.value || undefined })}
                />
              </div>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Remove school"
                onClick={() =>
                  setA((x) => ({ ...x, education: x.education.filter((_, j) => j !== i) }))
                }
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
          <Button
            size="sm"
            icon={<Plus className="h-3 w-3" />}
            onClick={() =>
              setA((x) => ({ ...x, education: [...x.education, { institution: '' }] }))
            }
          >
            Add school
          </Button>
          <div>
            <Label htmlFor="q-certs" hint="(one per line, only ones you hold)">
              Licenses & certifications
            </Label>
            <textarea
              id="q-certs"
              rows={3}
              className={inputClass}
              value={certText}
              placeholder={'Forklift Certification\nFood Handler Card'}
              onChange={(e) => setCertText(e.target.value)}
            />
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-3">
          {hints.length > 0 && (
            <div>
              <Label>Common skills for {a.targetRole} — tick only the ones you have</Label>
              <div className="flex flex-wrap gap-1.5">
                {hints.map((h) => (
                  <Chip
                    key={h}
                    active={a.skills.includes(h)}
                    onClick={() =>
                      setA((x) => ({
                        ...x,
                        skills: x.skills.includes(h)
                          ? x.skills.filter((s) => s !== h)
                          : [...x.skills, h]
                      }))
                    }
                  >
                    {h}
                  </Chip>
                ))}
              </div>
            </div>
          )}
          <div>
            <Label htmlFor="q-skills" hint="(comma-separated)">
              Other skills, tools, languages
            </Label>
            <Input
              id="q-skills"
              value={skillText}
              placeholder="e.g. Spanish, Microsoft Excel, cash handling"
              onChange={(e) => setSkillText(e.target.value)}
            />
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setA((x) => ({ ...x, template: t.id }))}
                className={cx(
                  'rounded-xl border p-3 text-left text-xs',
                  a.template === t.id
                    ? 'border-cyan-400/60 bg-cyan-500/10 text-cyan-100'
                    : 'border-white/10 text-slate-300 hover:border-white/20'
                )}
              >
                <p className="font-semibold">{t.label}</p>
                <p className="mt-1 text-[11px] text-slate-400">{t.description}</p>
              </button>
            ))}
          </div>
          <div className="w-48">
            <Label htmlFor="q-size">Paper size</Label>
            <Select
              id="q-size"
              value={a.pageSize}
              onChange={(e) => setA((x) => ({ ...x, pageSize: e.target.value as 'letter' | 'a4' }))}
            >
              <option value="letter">US Letter</option>
              <option value="a4">A4</option>
            </Select>
          </div>
        </div>
      )}

      <ErrorNote error={error} />
      <div className="mt-5 flex items-center justify-between">
        <Button
          variant="ghost"
          onClick={step === 0 ? onCancel : () => setStep((s) => s - 1)}
          icon={<ArrowLeft className="h-3.5 w-3.5" />}
        >
          {step === 0 ? 'Cancel' : 'Back'}
        </Button>
        {step < STEPS.length - 1 ? (
          <Button
            variant="primary"
            disabled={!canNext}
            onClick={() => setStep((s) => s + 1)}
            icon={<ArrowRight className="h-3.5 w-3.5" />}
          >
            Next
          </Button>
        ) : (
          <Button
            variant="primary"
            loading={busy}
            onClick={() => void finish()}
            icon={<Wand2 className="h-3.5 w-3.5" />}
          >
            Build my resume
          </Button>
        )}
      </div>
    </Card>
  )
}
