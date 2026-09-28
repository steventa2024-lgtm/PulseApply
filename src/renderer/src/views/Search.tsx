import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2,
  CircleSlash,
  Loader2,
  Save,
  Search as SearchIcon,
  Sparkles,
  XCircle
} from 'lucide-react'
import type {
  EmploymentType,
  ProviderInfo,
  SalaryPeriod,
  SearchCriteria,
  SearchIntent,
  SearchProgress,
  Seniority,
  WorkMode
} from '../../../shared/types'
import {
  Button,
  Card,
  Chip,
  ErrorNote,
  Input,
  Label,
  Modal,
  PageHeader,
  Select,
  Toggle
} from '../components/ui'
import { cx } from '../lib/cx'
import { call, useEvent } from '../lib/api'
import { EMPLOYMENT_LABEL } from '../lib/format'
import { useApp } from '../lib/appContext'
import { EMPTY_CRITERIA, clean, splitList } from '../lib/criteria'

const EMPLOYMENT: EmploymentType[] = [
  'full_time',
  'part_time',
  'contract',
  'temporary',
  'internship',
  'seasonal'
]
const SENIORITY: Seniority[] = ['entry', 'junior', 'mid', 'senior', 'lead', 'manager']
const MODES: { id: WorkMode; label: string }[] = [
  { id: 'onsite', label: 'On-site' },
  { id: 'hybrid', label: 'Hybrid' },
  { id: 'remote', label: 'Remote' }
]

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v]
}

export function LocationInput({
  value,
  onChange,
  id
}: {
  value: string
  onChange: (v: string) => void
  id?: string
}): React.JSX.Element {
  const [suggestions, setSuggestions] = useState<{ label: string; country: string }[]>([])
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (value.trim().length < 2) return
    const t = setTimeout(() => {
      call('geo:suggest', { text: value })
        .then(setSuggestions)
        .catch(() => setSuggestions([]))
    }, 150)
    return () => clearTimeout(t)
  }, [value])
  return (
    <div className="relative">
      <Input
        id={id}
        value={value}
        placeholder="City, state, country or ZIP — e.g. Los Angeles, CA"
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        autoComplete="off"
      />
      {open && value.trim().length >= 2 && suggestions.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-white/10 bg-slate-900 py-1 shadow-xl">
          {suggestions.map((s) => (
            <li key={s.label}>
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left text-xs text-slate-200 hover:bg-cyan-500/15"
                onMouseDown={() => onChange(s.label)}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function SaveSearchModal(props: {
  open: boolean
  criteria: SearchCriteria
  onClose: () => void
}): React.JSX.Element | null {
  // Mounted only while open, so each opening starts from fresh defaults.
  return props.open ? <SaveSearchForm {...props} /> : null
}

function SaveSearchForm({
  open,
  criteria,
  onClose
}: {
  open: boolean
  criteria: SearchCriteria
  onClose: () => void
}): React.JSX.Element {
  const { toast, go } = useApp()
  const [name, setName] = useState(
    () => [criteria.query, criteria.location].filter(Boolean).join(' — ') || 'My search'
  )
  const [interval, setIntervalMin] = useState(60)
  const [notify, setNotify] = useState(true)
  const [minScore, setMinScore] = useState(60)
  const [busy, setBusy] = useState(false)
  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      await call('searches:save', {
        name,
        criteria,
        enabled: true,
        intervalMinutes: interval,
        notify,
        minScoreToNotify: minScore
      })
      toast('Scheduled search saved', 'success')
      onClose()
      go('automation')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open={open}
      title="Save as scheduled search"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={save} disabled={!name.trim()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <Label htmlFor="ss-name">Name</Label>
          <Input id="ss-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="ss-int">Run every</Label>
            <Select
              id="ss-int"
              value={interval}
              onChange={(e) => setIntervalMin(Number(e.target.value))}
            >
              {[15, 30, 60, 120, 240, 480, 1440].map((m) => (
                <option key={m} value={m}>
                  {m < 60
                    ? `${m} minutes`
                    : m === 1440
                      ? 'day'
                      : `${m / 60} hour${m > 60 ? 's' : ''}`}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="ss-min" hint="(Telegram)">
              Notify at match ≥
            </Label>
            <Input
              id="ss-min"
              type="number"
              min={0}
              max={100}
              value={minScore}
              onChange={(e) => setMinScore(Number(e.target.value))}
            />
          </div>
        </div>
        <Toggle checked={notify} onChange={setNotify} label="Send new matching jobs to Telegram" />
        <p className="text-[11px] text-slate-500">
          Only jobs not previously sent for this search are notified. Unchanged results never
          trigger a repeat message.
        </p>
      </div>
    </Modal>
  )
}

export default function Search(): React.JSX.Element {
  const { go, setLastSearch, toast, refreshCounters } = useApp()
  const [c, setC] = useState<SearchCriteria>(EMPTY_CRITERIA)
  const [savedLabel, setSavedLabel] = useState<string | null>(null)
  const [savedKey, setSavedKey] = useState<string>('')
  const [occupations, setOccupations] = useState<{ id: string; label: string; family: string }[]>(
    []
  )
  const [savingCriteria, setSavingCriteria] = useState(false)
  const [countries, setCountries] = useState<{ code: string; name: string }[]>([])
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [preview, setPreview] = useState<SearchIntent | null>(null)
  const [running, setRunning] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<SearchProgress[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const runIdRef = useRef<string | null>(null)
  const touched = useRef(false)

  useEffect(() => {
    call('criteria:get')
      .then((r) => {
        // Never overwrite what the user already started typing.
        if (!touched.current) setC({ ...EMPTY_CRITERIA, ...r.criteria })
        setSavedLabel(r.label)
        setSavedKey(JSON.stringify(clean({ ...EMPTY_CRITERIA, ...r.criteria })))
      })
      .catch(() => undefined)
    call('criteria:occupations')
      .then(setOccupations)
      .catch(() => undefined)
    call('geo:countries')
      .then(setCountries)
      .catch(() => undefined)
    call('sources:list')
      .then(setProviders)
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!c.query.trim()) return
    const t = setTimeout(() => {
      call('search:parse', clean(c))
        .then(setPreview)
        .catch(() => setPreview(null))
    }, 250)
    return () => clearTimeout(t)
  }, [c])

  useEvent('search:progress', (p) => {
    if (!busy) return
    if (!runIdRef.current) {
      runIdRef.current = p.runId
      setRunning(p.runId)
    }
    if (p.runId !== runIdRef.current) return
    setProgress((prev) => [...prev, p])
  })

  const set = <K extends keyof SearchCriteria>(k: K, v: SearchCriteria[K]): void => {
    touched.current = true
    setC((x) => ({ ...x, [k]: v }))
  }
  const searchable = providers.filter((p) => !['restricted', 'discovery'].includes(p.kind))

  const run = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setProgress([])
    runIdRef.current = null
    try {
      const res = await call('search:run', clean(c))
      if (res.cancelled) {
        toast('Search cancelled')
        return
      }
      setLastSearch({
        criteria: clean(c),
        intent: res.intent,
        stats: res.stats,
        jobs: res.jobs,
        review: res.review,
        runId: res.runId,
        finishedAt: res.finishedAt
      })
      refreshCounters()
      go('results')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
      setRunning(null)
    }
  }

  const dirty = JSON.stringify(clean(c)) !== savedKey
  const saveCriteria = async (): Promise<void> => {
    setSavingCriteria(true)
    try {
      const res = await call('criteria:save', clean(c))
      setSavedKey(JSON.stringify(clean({ ...EMPTY_CRITERIA, ...res.criteria })))
      setSavedLabel(res.counters.criteriaLabel)
      refreshCounters()
      toast(
        `Criteria saved — ${res.counters.eligible} stored job${res.counters.eligible === 1 ? '' : 's'} now match (${res.counters.excluded} excluded)`,
        'success'
      )
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setSavingCriteria(false)
    }
  }
  const occLabel = (id: string): string => occupations.find((o) => o.id === id)?.label ?? id

  const providerRows = useMemo(() => {
    const map = new Map<string, SearchProgress['provider']>()
    for (const p of progress) if (p.provider) map.set(p.provider.id, p.provider)
    return [...map.values()]
  }, [progress])
  const phase = progress[progress.length - 1]

  return (
    <div>
      <PageHeader
        title="Search"
        subtitle="These are your saved match criteria. The same criteria drive Results, the dashboard, scheduled searches and Telegram."
      />
      {savedLabel && (
        <p className="-mt-3 mb-4 text-[11px] text-slate-400" data-testid="active-criteria">
          Active criteria: <span className="text-slate-200">{savedLabel}</span>
          {dirty && <span className="ml-2 text-amber-300">· unsaved changes</span>}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <Card>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (!busy && c.query.trim()) void run()
            }}
          >
            <div>
              <Label htmlFor="q">What job are you looking for?</Label>
              <Input
                id="q"
                autoFocus
                value={c.query}
                placeholder='e.g. "Part-time barista within 15 miles" or "Warehouse Associate"'
                onChange={(e) => set('query', e.target.value)}
              />
            </div>
            <div className="grid grid-cols-[1fr_140px_90px] gap-3">
              <div>
                <Label htmlFor="loc">Location</Label>
                <LocationInput
                  id="loc"
                  value={c.location ?? ''}
                  onChange={(v) => set('location', v)}
                />
              </div>
              <div>
                <Label htmlFor="rad">Radius</Label>
                <Select
                  id="rad"
                  value={c.radius ?? 25}
                  onChange={(e) => set('radius', Number(e.target.value))}
                >
                  {[5, 10, 15, 20, 25, 30, 50, 75, 100].map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="unit">Unit</Label>
                <Select
                  id="unit"
                  value={c.radiusUnit ?? 'mi'}
                  onChange={(e) => set('radiusUnit', e.target.value as 'mi' | 'km')}
                >
                  <option value="mi">miles</option>
                  <option value="km">km</option>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="country" hint="(for remote searches or when no city is given)">
                  Country
                </Label>
                <Select
                  id="country"
                  value={c.country ?? ''}
                  onChange={(e) => set('country', e.target.value || undefined)}
                >
                  <option value="">Any / from location</option>
                  {countries.map((x) => (
                    <option key={x.code} value={x.code}>
                      {x.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="posted">Posted within</Label>
                <Select
                  id="posted"
                  value={c.postedWithinDays ?? ''}
                  onChange={(e) =>
                    set('postedWithinDays', e.target.value ? Number(e.target.value) : undefined)
                  }
                >
                  <option value="">Any time</option>
                  <option value="1">24 hours</option>
                  <option value="3">3 days</option>
                  <option value="7">7 days</option>
                  <option value="14">14 days</option>
                  <option value="30">30 days</option>
                </Select>
              </div>
            </div>
            <div>
              <Label>Work mode</Label>
              <div className="flex flex-wrap gap-2">
                {MODES.map((m) => (
                  <Chip
                    key={m.id}
                    active={(c.workModes ?? []).includes(m.id)}
                    onClick={() => set('workModes', toggle(c.workModes ?? [], m.id))}
                  >
                    {m.label}
                  </Chip>
                ))}
                <span className="self-center text-[11px] text-slate-500">
                  None selected: on-site + hybrid near a location, everything otherwise.
                </span>
              </div>
            </div>
            <div>
              <Label>Employment type</Label>
              <div className="flex flex-wrap gap-2">
                {EMPLOYMENT.map((t) => (
                  <Chip
                    key={t}
                    active={(c.employmentTypes ?? []).includes(t)}
                    onClick={() => set('employmentTypes', toggle(c.employmentTypes ?? [], t))}
                  >
                    {EMPLOYMENT_LABEL[t]}
                  </Chip>
                ))}
              </div>
            </div>
            <div>
              <Label>Seniority</Label>
              <div className="flex flex-wrap gap-2">
                {SENIORITY.map((s) => (
                  <Chip
                    key={s}
                    active={(c.seniority ?? []).includes(s)}
                    onClick={() => set('seniority', toggle(c.seniority ?? [], s))}
                  >
                    {s}
                  </Chip>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="minsal">Minimum pay</Label>
                <Input
                  id="minsal"
                  type="number"
                  min={0}
                  value={c.minSalary ?? ''}
                  placeholder="e.g. 22"
                  onChange={(e) =>
                    set('minSalary', e.target.value ? Number(e.target.value) : undefined)
                  }
                />
              </div>
              <div>
                <Label htmlFor="per">Per</Label>
                <Select
                  id="per"
                  value={c.salaryPeriod ?? ''}
                  onChange={(e) =>
                    set('salaryPeriod', (e.target.value || undefined) as SalaryPeriod | undefined)
                  }
                >
                  <option value="">auto</option>
                  <option value="hour">hour</option>
                  <option value="year">year</option>
                  <option value="month">month</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="cur">Currency</Label>
                <Select
                  id="cur"
                  value={c.salaryCurrency ?? ''}
                  onChange={(e) => set('salaryCurrency', e.target.value || undefined)}
                >
                  <option value="">any</option>
                  {['USD', 'CAD', 'GBP', 'EUR', 'AUD', 'INR', 'NZD', 'CHF'].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </Select>
              </div>
            </div>
            <p className="text-[11px] text-slate-500">
              Jobs that do not publish pay are kept (shown as “Not disclosed”) — only confirmed pay
              below your minimum is filtered out.
            </p>
            <fieldset className="rounded-lg border border-white/[0.06] p-3">
              <legend className="px-1 text-[11px] uppercase tracking-wide text-slate-400">
                Location filter
              </legend>
              <div className="space-y-2 text-xs">
                <label className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="locmode"
                    className="mt-0.5"
                    checked={(c.locationMode ?? 'strict') === 'strict'}
                    onChange={() => set('locationMode', 'strict')}
                  />
                  <span>
                    <span className="font-medium text-slate-100">Strict (recommended)</span>
                    <span className="block text-slate-400">
                      Only jobs inside the radius (or remote jobs open to your country, if Remote is
                      selected). Everything else is excluded before scoring.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="locmode"
                    className="mt-0.5"
                    checked={c.locationMode === 'preferred'}
                    onChange={() => set('locationMode', 'preferred')}
                  />
                  <span>
                    <span className="font-medium text-slate-100">Preferred only</span>
                    <span className="block text-slate-400">
                      Show jobs in any location; jobs inside the radius rank higher and jobs outside
                      it are labelled “Outside your preferred area”.
                    </span>
                  </span>
                </label>
                <p className="text-[11px] text-slate-500">
                  Jobs whose location cannot be verified are never mixed in — they are listed
                  separately under “Location could not be verified”.
                </p>
              </div>
            </fieldset>

            <fieldset className="space-y-3 rounded-lg border border-white/[0.06] p-3">
              <legend className="px-1 text-[11px] uppercase tracking-wide text-slate-400">
                Occupation & match
              </legend>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="occ-add" hint="(besides what you typed)">
                    Target occupations
                  </Label>
                  <Select
                    id="occ-add"
                    value=""
                    onChange={(e) =>
                      e.target.value &&
                      set('targetOccupations', [
                        ...new Set([...(c.targetOccupations ?? []), e.target.value])
                      ])
                    }
                  >
                    <option value="">Add an occupation…</option>
                    {occupations.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {(c.targetOccupations ?? []).map((o) => (
                      <Chip
                        key={o}
                        active
                        onClick={() =>
                          set(
                            'targetOccupations',
                            (c.targetOccupations ?? []).filter((x) => x !== o)
                          )
                        }
                      >
                        {occLabel(o)} ×
                      </Chip>
                    ))}
                  </div>
                </div>
                <div>
                  <Label htmlFor="occ-ex">Never show these occupations</Label>
                  <Select
                    id="occ-ex"
                    value=""
                    onChange={(e) =>
                      e.target.value &&
                      set('excludedOccupations', [
                        ...new Set([...(c.excludedOccupations ?? []), e.target.value])
                      ])
                    }
                  >
                    <option value="">Exclude an occupation…</option>
                    {occupations.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {(c.excludedOccupations ?? []).map((o) => (
                      <Chip
                        key={o}
                        active={false}
                        onClick={() =>
                          set(
                            'excludedOccupations',
                            (c.excludedOccupations ?? []).filter((x) => x !== o)
                          )
                        }
                      >
                        {occLabel(o)} ×
                      </Chip>
                    ))}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="occ-match">Occupation match</Label>
                  <Select
                    id="occ-match"
                    value={c.occupationMatch ?? 'related'}
                    onChange={(e) => set('occupationMatch', e.target.value as 'exact' | 'related')}
                  >
                    <option value="related">Same or closely related occupations</option>
                    <option value="exact">Same occupation only</option>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="min-score" hint="(0 = show all eligible)">
                    Minimum match score
                  </Label>
                  <Input
                    id="min-score"
                    type="number"
                    min={0}
                    max={100}
                    value={c.minimumMatchScore ?? 0}
                    onChange={(e) => set('minimumMatchScore', Number(e.target.value) || undefined)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="req-skills" hint="(comma-separated; job must mention each)">
                    Required skills
                  </Label>
                  <Input
                    id="req-skills"
                    defaultValue={(c.requiredSkills ?? []).join(', ')}
                    key={`req-${savedKey}`}
                    placeholder="e.g. forklift"
                    onBlur={(e) => set('requiredSkills', splitList(e.target.value))}
                  />
                </div>
                <div>
                  <Label htmlFor="pref-skills" hint="(raise the score)">
                    Preferred skills
                  </Label>
                  <Input
                    id="pref-skills"
                    defaultValue={(c.preferredSkills ?? []).join(', ')}
                    key={`pref-${savedKey}`}
                    placeholder="e.g. RF scanner, pallet jack"
                    onBlur={(e) => set('preferredSkills', splitList(e.target.value))}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="ex-kw" hint="(comma-separated, matched in the job title)">
                  Excluded title keywords
                </Label>
                <Input
                  id="ex-kw"
                  defaultValue={(c.excludedKeywords ?? []).join(', ')}
                  key={`exkw-${savedKey}`}
                  placeholder="e.g. driver, sales"
                  onBlur={(e) => set('excludedKeywords', splitList(e.target.value))}
                />
              </div>
            </fieldset>
            <details className="rounded-lg border border-white/[0.06] p-3">
              <summary className="cursor-pointer text-xs text-slate-300">
                Sources (
                {(c.providerIds?.length ?? 0) === 0
                  ? 'all eligible'
                  : `${c.providerIds!.length} selected`}
                )
              </summary>
              <div className="mt-3 flex flex-wrap gap-2">
                {searchable.map((p) => (
                  <Chip
                    key={p.id}
                    active={(c.providerIds ?? []).includes(p.id)}
                    onClick={() => set('providerIds', toggle(c.providerIds ?? [], p.id))}
                  >
                    {p.name}
                    {p.status === 'REQUIRES_CREDENTIALS' ? ' (needs key)' : ''}
                  </Chip>
                ))}
              </div>
            </details>

            <ErrorNote error={error} />
            <div className="flex items-center gap-2 pt-1">
              <Button
                type="submit"
                variant="primary"
                loading={busy}
                disabled={!c.query.trim()}
                icon={<SearchIcon className="h-3.5 w-3.5" />}
              >
                {busy ? 'Searching…' : 'Search'}
              </Button>
              {busy && running && (
                <Button
                  variant="danger"
                  onClick={() => void call('search:cancel', { runId: running })}
                  icon={<XCircle className="h-3.5 w-3.5" />}
                >
                  Cancel
                </Button>
              )}
              <Button
                loading={savingCriteria}
                disabled={!dirty}
                onClick={() => void saveCriteria()}
                icon={<Save className="h-3.5 w-3.5" />}
                title="Save without searching; stored results are re-checked immediately"
              >
                Save criteria
              </Button>
              <Button disabled={!c.query.trim()} onClick={() => setSaveOpen(true)}>
                Save as scheduled search
              </Button>
              <Button variant="ghost" onClick={() => setC(EMPTY_CRITERIA)}>
                Reset
              </Button>
            </div>
          </form>
        </Card>

        <div className="space-y-4">
          <Card
            title={
              <span className="flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-cyan-300" /> How PulseApply reads this
              </span>
            }
          >
            {!c.query.trim() || !preview ? (
              <p className="text-xs text-slate-500">Type a query to see how it is interpreted.</p>
            ) : (
              <dl className="space-y-1.5 text-[11px]">
                <Row k="Keywords" v={preview.keywords.join(', ') || '—'} />
                <Row
                  k="Occupation"
                  v={
                    preview.normalizedOccupations.join(', ').replace(/_/g, ' ') ||
                    'not recognised — title keywords used'
                  }
                />
                <Row
                  k="Also searches"
                  v={preview.occupationSynonyms.slice(0, 5).join(', ') || '—'}
                />
                <Row
                  k="Location"
                  v={
                    preview.locationText
                      ? `${preview.locationText}${preview.radius ? ` (${preview.radius} ${preview.radiusUnit})` : ''}`
                      : 'anywhere'
                  }
                />
                <Row k="Work mode" v={preview.workModes.join(', ')} />
                {preview.employmentTypes.length > 0 && (
                  <Row
                    k="Type"
                    v={preview.employmentTypes.map((t) => EMPLOYMENT_LABEL[t]).join(', ')}
                  />
                )}
                {preview.seniority.length > 0 && (
                  <Row k="Seniority" v={preview.seniority.join(', ')} />
                )}
                {preview.minimumSalary && (
                  <Row
                    k="Min pay"
                    v={`${preview.currency ?? ''} ${preview.minimumSalary}/${preview.salaryPeriod ?? ''}`}
                  />
                )}
                {preview.schedule.length > 0 && (
                  <Row k="Schedule" v={preview.schedule.join(', ')} />
                )}
                {preview.excludedKeywords.length > 0 && (
                  <Row k="Excluding" v={preview.excludedKeywords.join(', ')} />
                )}
                {preview.notes.map((n) => (
                  <p key={n} className="pt-1 text-amber-300/90">
                    {n}
                  </p>
                ))}
              </dl>
            )}
          </Card>

          {(busy || progress.length > 0) && (
            <Card title="Progress" subtitle={phase?.message}>
              <ul className="space-y-1.5">
                {providerRows.map((p) =>
                  p ? (
                    <li key={p.id} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="flex items-center gap-1.5 text-slate-300">
                        {p.status === 'running' ? (
                          <Loader2 className="h-3 w-3 animate-spin text-cyan-400" />
                        ) : p.status === 'error' ? (
                          <XCircle className="h-3 w-3 text-rose-400" />
                        ) : p.status === 'skipped' ? (
                          <CircleSlash className="h-3 w-3 text-slate-500" />
                        ) : (
                          <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                        )}
                        {p.name}
                      </span>
                      <span
                        className={cx(
                          'truncate text-right',
                          p.status === 'error' ? 'text-rose-300' : 'text-slate-500'
                        )}
                        title={p.error}
                      >
                        {p.status === 'running'
                          ? 'searching…'
                          : p.status === 'skipped'
                            ? p.error
                            : p.status === 'error'
                              ? 'failed'
                              : `${p.count ?? 0}${p.status === 'cached' ? ' (cached)' : ''}`}
                      </span>
                    </li>
                  ) : null
                )}
              </ul>
            </Card>
          )}
        </div>
      </div>
      <SaveSearchModal open={saveOpen} criteria={clean(c)} onClose={() => setSaveOpen(false)} />
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }): React.JSX.Element {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-slate-500">{k}</dt>
      <dd className="text-slate-200">{v}</dd>
    </div>
  )
}
