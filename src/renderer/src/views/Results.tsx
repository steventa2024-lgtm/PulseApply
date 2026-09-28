import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowUpRight,
  Bookmark,
  BookmarkCheck,
  Briefcase,
  ExternalLink,
  EyeOff,
  Info,
  Layers,
  MapPin,
  RefreshCw,
  Send,
  ShieldCheck,
  X
} from 'lucide-react'
import type {
  ExclusionReason,
  ResumeRecord,
  ScoredJob,
  VerificationStatus
} from '../../../shared/types'
import { Badge, Button, Card, Chip, Empty, Modal, PageHeader, Select } from '../components/ui'
import { cx } from '../lib/cx'
import { call, useEvent } from '../lib/api'
import {
  APP_STATE_LABEL,
  APP_STATE_TONE,
  EMPLOYMENT_LABEL,
  EXCLUSION_LABEL,
  GEO_LABEL,
  VERIFICATION_LABEL,
  formatSalary,
  timeAgo
} from '../lib/format'
import { useApp } from '../lib/appContext'

type ViewMode = 'eligible' | 'new' | 'review' | 'excluded' | 'saved' | 'archive' | 'dismissed'
type Sort = 'match' | 'date' | 'distance'
const PAGE = 30

const REASON_GROUPS: { id: string; label: string; reasons: ExclusionReason[] }[] = [
  {
    id: 'location',
    label: 'Location',
    reasons: ['outside_radius', 'outside_country', 'remote_ineligible']
  },
  {
    id: 'occupation',
    label: 'Occupation',
    reasons: ['irrelevant_occupation', 'excluded_occupation']
  },
  {
    id: 'workMode',
    label: 'Work mode',
    reasons: ['remote_not_requested', 'onsite_not_requested', 'work_mode']
  },
  { id: 'belowScore', label: 'Below minimum score', reasons: ['below_minimum_score'] },
  { id: 'expired', label: 'Expired', reasons: ['expired'] }
]

export default function Results(): React.JSX.Element {
  const { lastSearch, go, toast, counters, refreshCounters } = useApp()
  const [mode, setMode] = useState<ViewMode>('eligible')
  const [reason, setReason] = useState<ExclusionReason | ''>('')
  const [jobsRaw, setJobs] = useState<ScoredJob[] | null>(null)
  const [verif, setVerif] = useState<VerificationStatus | ''>('')
  const [sort, setSort] = useState<Sort>('match')
  const [shown, setShown] = useState(PAGE)
  const [selected, setSelected] = useState<ScoredJob | null>(null)
  const [links, setLinks] = useState<{ providerId: string; name: string; url: string }[]>([])
  const [reload, setReload] = useState(0)

  const changeMode = (m: ViewMode): void => {
    setMode(m)
    setReason('')
    setShown(PAGE)
  }

  useEffect(() => {
    let live = true
    call('jobs:list', {
      view: mode,
      runId: mode === 'new' ? counters?.lastRun?.runId : undefined,
      reason: mode === 'excluded' && reason ? reason : undefined,
      limit: 2000
    })
      .then((j) => live && setJobs(j))
      .catch((e) => toast((e as Error).message, 'error'))
    return () => {
      live = false
    }
  }, [mode, reason, reload, counters?.criteriaKey, counters?.lastRun?.runId, toast])
  useEvent('jobs:changed', () => setReload((n) => n + 1))

  useEffect(() => {
    if (lastSearch)
      call('search:manual-links', lastSearch.criteria)
        .then(setLinks)
        .catch(() => setLinks([]))
  }, [lastSearch])

  const jobs = useMemo(() => {
    const list = (jobsRaw ?? []).filter((j) => !verif || j.verificationStatus === verif)
    return [...list].sort((a, b) =>
      sort === 'date'
        ? (b.postedAt ?? b.discoveredAt).localeCompare(a.postedAt ?? a.discoveredAt)
        : sort === 'distance'
          ? (a.geo.distance ?? 1e9) - (b.geo.distance ?? 1e9)
          : (b.match?.score ?? -1) - (a.match?.score ?? -1) || b.relevance.score - a.relevance.score
    )
  }, [jobsRaw, verif, sort])

  const replace = (j: ScoredJob | null): void => {
    if (!j) return
    setJobs((list) => (list ?? []).map((x) => (x.id === j.id ? { ...x, ...j } : x)))
    setSelected((cur) => (cur && cur.id === j.id ? { ...cur, ...j } : cur))
    refreshCounters()
  }
  const save = async (j: ScoredJob): Promise<void> =>
    replace(await call('jobs:save', { id: j.id, saved: !j.state.saved }))
  const dismiss = async (j: ScoredJob): Promise<void> => {
    await call('jobs:dismiss', { id: j.id, dismissed: !j.state.dismissed })
    setJobs((l) => (l ?? []).filter((x) => x.id !== j.id))
    if (selected?.id === j.id) setSelected(null)
    refreshCounters()
  }

  const stats = lastSearch?.stats
  const failed = stats?.providers.filter((p) => p.status === 'error') ?? []
  const queried = stats?.providers.filter((p) => p.status === 'ok' || p.status === 'cached') ?? []
  const skipped = stats?.providers.filter((p) => p.status === 'skipped') ?? []
  const c = counters
  const tabs: { id: ViewMode; label: string; n?: number; help: string }[] = [
    { id: 'eligible', label: 'Eligible', n: c?.eligible, help: 'Meet every criterion' },
    {
      id: 'new',
      label: 'New in last search',
      n: c?.eligibleNew,
      help: 'Eligible jobs first seen in your most recent search'
    },
    {
      id: 'review',
      label: 'Location could not be verified',
      n: c?.review,
      help: 'The posting does not say where the job is; check before applying'
    },
    { id: 'excluded', label: 'Excluded', n: c?.excluded, help: 'Failed at least one criterion' },
    { id: 'saved', label: 'Saved', n: c?.saved, help: 'Jobs you saved' },
    {
      id: 'archive',
      label: 'History',
      n: c?.historical,
      help: 'Every job ever stored, regardless of your current criteria'
    },
    { id: 'dismissed', label: 'Dismissed', n: c?.dismissed, help: 'Hidden by you' }
  ]

  return (
    <div>
      <PageHeader
        title="Results"
        subtitle={c ? `Criteria: ${c.criteriaLabel}` : 'Jobs stored in your local index'}
        actions={
          <Button icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => go('search')}>
            Edit criteria
          </Button>
        }
      />

      {c && (
        <div
          className="mb-4 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4 lg:grid-cols-6"
          data-testid="result-counters"
        >
          <Counter
            k="Newly fetched"
            v={c.lastRun?.newJobs ?? 0}
            sub={
              c.lastRun
                ? `of ${c.lastRun.fetched} in last search · ${timeAgo(c.lastRun.finishedAt ?? '')}`
                : 'no search yet'
            }
          />
          <Counter k="Historical" v={c.historical} sub="stored jobs (all searches)" />
          <Counter k="Currently eligible" v={c.eligible} sub="meet all criteria" tone="good" />
          <Counter k="Needs review" v={c.review} sub="location not verifiable" tone="warn" />
          <Counter
            k="Excluded"
            v={c.excluded}
            sub={`location ${c.excludedBy.location} · occupation ${c.excludedBy.occupation} · below score ${c.excludedBy.belowScore}`}
          />
          <Counter
            k="Unverified"
            v={c.unverified}
            sub={`eligible but stale/unverified · ${c.excludedBy.expired} expired`}
          />
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2" role="tablist">
        {tabs.map((t) => (
          <Chip key={t.id} active={mode === t.id} onClick={() => changeMode(t.id)}>
            <span title={t.help}>
              {t.label}
              {t.n !== undefined ? ` (${t.n})` : ''}
            </span>
          </Chip>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {mode === 'excluded' && (
          <label className="text-[11px] text-slate-400">
            Reason
            <Select
              className="ml-1.5 inline-block w-56 py-1"
              value={reason}
              onChange={(e) => setReason(e.target.value as ExclusionReason | '')}
            >
              <option value="">any</option>
              {REASON_GROUPS.flatMap((g) => g.reasons).map((r) => (
                <option key={r} value={r}>
                  {EXCLUSION_LABEL[r] ?? r}
                </option>
              ))}
              <option value="employment_type">{EXCLUSION_LABEL.employment_type}</option>
              <option value="salary_below_minimum">{EXCLUSION_LABEL.salary_below_minimum}</option>
            </Select>
          </label>
        )}
        <label className="text-[11px] text-slate-400">
          Verification
          <Select
            className="ml-1.5 inline-block w-40 py-1"
            value={verif}
            onChange={(e) => setVerif(e.target.value as VerificationStatus | '')}
          >
            <option value="">any</option>
            {Object.entries(VERIFICATION_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-[11px] text-slate-400">
          Sort
          <Select
            className="ml-1.5 inline-block w-28 py-1"
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
          >
            <option value="match">Best match</option>
            <option value="date">Newest</option>
            <option value="distance">Closest</option>
          </Select>
        </label>
      </div>

      {mode === 'review' && (
        <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
          Location could not be verified. These postings do not state a place PulseApply can check
          against your radius (e.g. “Multiple locations”). They are kept out of your main results —
          open the original listing to confirm where the job is.
        </p>
      )}
      {mode === 'archive' && (
        <p className="mb-3 text-[11px] text-slate-500">
          History shows every stored job from every search, including jobs that do not meet your
          current criteria. Nothing here is counted as a current result.
        </p>
      )}

      {stats && (mode === 'eligible' || mode === 'new') && (
        <Card className="mb-4">
          <div className="flex flex-wrap items-start justify-between gap-4 text-[11px]">
            <div className="space-y-1 text-slate-400">
              <p>
                Last search: {stats.fetched} listings from {queried.length} source
                {queried.length === 1 ? '' : 's'} → {stats.returned} eligible
                {stats.review ? `, ${stats.review} location unverified` : ''};{' '}
                {stats.duplicatesMerged} duplicate
                {stats.duplicatesMerged === 1 ? '' : 's'} merged.
              </p>
              {Object.entries(stats.excluded).filter(([, n]) => n).length > 0 && (
                <p>
                  Filtered out:{' '}
                  {Object.entries(stats.excluded)
                    .filter(([, n]) => n)
                    .map(([k, n]) => `${n} ${EXCLUSION_LABEL[k] ?? k}`)
                    .join(' · ')}
                  {stats.rejectedMalformed ? ` · ${stats.rejectedMalformed} malformed` : ''}
                </p>
              )}
              {skipped.length > 0 && (
                <p className="text-slate-500">
                  Not queried: {skipped.map((f) => `${f.providerName} (${f.reason})`).join('; ')}
                </p>
              )}
              {failed.length > 0 && (
                <p className="text-rose-300">
                  Unavailable: {failed.map((f) => `${f.providerName} (${f.reason})`).join('; ')}
                </p>
              )}
              {lastSearch?.intent.notes.map((n) => (
                <p key={n} className="text-amber-300/90">
                  {n}
                </p>
              ))}
            </div>
            {links.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="text-slate-500"
                  title="These sites have no authorized API; PulseApply opens the search for you to browse manually."
                >
                  Also browse manually:
                </span>
                {links.map((l) => (
                  <Button
                    key={l.providerId}
                    size="sm"
                    icon={<ExternalLink className="h-3 w-3" />}
                    onClick={() => void call('jobs:open-external', { url: l.url })}
                  >
                    {l.name}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}

      {jobsRaw === null ? (
        <p className="text-xs text-slate-500">Loading…</p>
      ) : jobs.length === 0 ? (
        <ResultsEmpty
          mode={mode}
          hasSearch={!!c?.lastRun}
          excluded={(c?.excluded ?? 0) > 0}
          failedAll={!!stats && queried.length === 0}
          onSearch={() => go('search')}
          onSources={() => go('sources')}
          onExcluded={() => changeMode('excluded')}
        />
      ) : (
        <div className="space-y-3">
          {jobs.slice(0, shown).map((j) => (
            <JobCard
              key={j.id}
              job={j}
              onOpen={() => setSelected(j)}
              onSave={() => void save(j)}
              onDismiss={() => void dismiss(j)}
            />
          ))}
          {jobs.length > shown && (
            <div className="flex justify-center pt-2">
              <Button onClick={() => setShown((x) => x + PAGE)}>
                Show {Math.min(PAGE, jobs.length - shown)} more
              </Button>
            </div>
          )}
        </div>
      )}

      {selected && (
        <JobDetail
          job={selected}
          onClose={() => setSelected(null)}
          onChange={replace}
          onSave={() => void save(selected)}
          onDismiss={() => void dismiss(selected)}
        />
      )}
    </div>
  )
}

function Counter({
  k,
  v,
  sub,
  tone
}: {
  k: string
  v: number
  sub: string
  tone?: 'good' | 'warn'
}): React.JSX.Element {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2">
      <p className="text-slate-400">{k}</p>
      <p
        className={cx(
          'font-mono text-lg font-bold',
          tone === 'good' ? 'text-emerald-300' : tone === 'warn' ? 'text-amber-300' : 'text-white'
        )}
      >
        {v}
      </p>
      <p className="truncate text-[10px] text-slate-500" title={sub}>
        {sub}
      </p>
    </div>
  )
}

function ResultsEmpty({
  mode,
  hasSearch,
  excluded,
  failedAll,
  onSearch,
  onSources,
  onExcluded
}: {
  mode: ViewMode
  hasSearch: boolean
  excluded: boolean
  failedAll: boolean
  onSearch: () => void
  onSources: () => void
  onExcluded: () => void
}): React.JSX.Element {
  if (mode !== 'eligible' && mode !== 'new')
    return <Empty icon={<Layers className="h-8 w-8" />} title="Nothing here" />
  if (!hasSearch)
    return (
      <Empty
        icon={<Layers className="h-8 w-8" />}
        title="No search yet"
        action={
          <Button variant="primary" onClick={onSearch}>
            Start a search
          </Button>
        }
      >
        Results appear here after you search.
      </Empty>
    )
  if (failedAll)
    return (
      <Empty
        icon={<AlertTriangle className="h-8 w-8" />}
        title="No job source could be queried"
        action={<Button onClick={onSources}>Check sources</Button>}
      >
        Every eligible source was skipped or failed. Local searches need at least one aggregator key
        (Adzuna, Jooble, CareerOneStop or USAJOBS) or registered employer boards.
      </Empty>
    )
  if (excluded)
    return (
      <Empty
        icon={<Layers className="h-8 w-8" />}
        title="No stored job meets your current criteria"
        action={
          <div className="flex gap-2">
            <Button onClick={onExcluded}>See why jobs were excluded</Button>
            <Button onClick={onSearch}>Edit criteria</Button>
          </div>
        }
      >
        Jobs from earlier searches are kept in History but are only shown here when they meet your
        current occupation, location and work-mode criteria.
      </Empty>
    )
  return (
    <Empty
      icon={<Layers className="h-8 w-8" />}
      title="The connected sources returned no matching listings"
      action={<Button onClick={onSources}>Add more sources</Button>}
    >
      Coverage depends on the sources you have connected. Adding API keys or employer career pages
      increases local coverage.
    </Empty>
  )
}

function ScorePill({ job }: { job: ScoredJob }): React.JSX.Element {
  if (!job.match)
    return (
      <div
        className="text-right text-[10px] text-slate-500"
        title="Upload a resume on the Profile page to see match scores"
      >
        No score
        <br />
        (no profile)
      </div>
    )
  const tone =
    job.match.band === 'strong'
      ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10'
      : job.match.band === 'good'
        ? 'text-cyan-300 border-cyan-500/30 bg-cyan-500/10'
        : job.match.band === 'partial'
          ? 'text-amber-300 border-amber-500/30 bg-amber-500/10'
          : 'text-slate-400 border-white/10 bg-white/[0.03]'
  return (
    <div className="flex flex-col items-end" title={job.match.disclaimer}>
      <div className={cx('flex items-baseline gap-0.5 rounded-xl border px-3 py-1', tone)}>
        <span className="font-mono text-lg font-black">{job.match.score}</span>
        <span className="text-[10px]">/100</span>
      </div>
      <span className="mt-1 text-[10px] text-slate-500">{job.match.band} match</span>
    </div>
  )
}

function JobCard({
  job,
  onOpen,
  onSave,
  onDismiss
}: {
  job: ScoredJob
  onOpen: () => void
  onSave: () => void
  onDismiss: () => void
}): React.JSX.Element {
  const v = VERIFICATION_LABEL[job.verificationStatus]
  const { go } = useApp()
  return (
    <article className="group rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 transition hover:border-cyan-500/30">
      <div className="flex items-start justify-between gap-4">
        <button onClick={onOpen} className="min-w-0 flex-1 text-left">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <Badge tone={v.tone} title={v.help}>
              <ShieldCheck className="h-3 w-3" /> {v.label}
            </Badge>
            <Badge title={job.sources.map((s) => s.providerName).join(', ')}>
              {job.sources.length > 1
                ? `Found through ${job.sources.length} sources`
                : job.sources[0]?.providerName}
            </Badge>
            {job.isNew && <Badge tone="violet">New</Badge>}
            {job.eligibility && job.eligibility.status !== 'eligible' && (
              <Badge
                tone={job.eligibility.status === 'review' ? 'amber' : 'red'}
                title={job.eligibility.exclusionReasons
                  .map((r) => EXCLUSION_LABEL[r] ?? r)
                  .join(', ')}
              >
                {job.eligibility.summary}
              </Badge>
            )}
            {job.eligibility?.locationStatus === 'outside_preferred' && (
              <Badge tone="amber">Outside your preferred area</Badge>
            )}
            {job.isDemo && <Badge tone="amber">DEMO</Badge>}
            {job.state.applicationState && (
              <Badge tone={APP_STATE_TONE[job.state.applicationState]}>
                {APP_STATE_LABEL[job.state.applicationState]}
              </Badge>
            )}
            {job.scamSignals.length > 0 && (
              <Badge tone="red" title={job.scamSignals.join('\n')}>
                <AlertTriangle className="h-3 w-3" /> {job.scamSignals.length} warning
                {job.scamSignals.length > 1 ? 's' : ''}
              </Badge>
            )}
          </div>
          <h3 className="truncate text-[15px] font-semibold text-white group-hover:text-cyan-200">
            {job.title}
          </h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-400">
            <span className="flex items-center gap-1">
              <Briefcase className="h-3 w-3" />
              {job.company}
            </span>
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {job.locationText || '—'}
            </span>
            <span>
              · {job.postedAt ? `posted ${timeAgo(job.postedAt)}` : 'post date not given'}
            </span>
          </p>
          <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
            <Badge tone={GEO_LABEL[job.geo.eligibility]}>
              {job.geo.note ?? job.geo.eligibility.replace(/_/g, ' ')}
            </Badge>
            <Badge
              tone={job.salary ? 'green' : 'slate'}
              title={
                job.salaryEstimateDiscarded
                  ? 'The provider only had an estimated salary, which PulseApply does not show as advertised pay.'
                  : undefined
              }
            >
              {formatSalary(job.salary)}
            </Badge>
            {job.employmentTypes.map((t) => (
              <Badge key={t}>{EMPLOYMENT_LABEL[t]}</Badge>
            ))}
            {job.workModes.map((m) => (
              <Badge key={m}>{m}</Badge>
            ))}
          </p>
          {job.match && (
            <p className="mt-2 line-clamp-2 text-[11px] text-slate-400">
              {job.match.explanation.slice(0, 3).join(' · ')}
            </p>
          )}
        </button>
        <ScorePill job={job} />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-white/[0.05] pt-3">
        <Button size="sm" variant="ghost" icon={<EyeOff className="h-3 w-3" />} onClick={onDismiss}>
          {job.state.dismissed ? 'Restore' : 'Dismiss'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={
            job.state.saved ? (
              <BookmarkCheck className="h-3 w-3 text-cyan-300" />
            ) : (
              <Bookmark className="h-3 w-3" />
            )
          }
          onClick={onSave}
        >
          {job.state.saved ? 'Saved' : 'Save'}
        </Button>
        <Button
          size="sm"
          icon={<ExternalLink className="h-3 w-3" />}
          onClick={() =>
            void call('jobs:open-external', { url: job.canonicalJobUrl ?? job.sourceUrl })
          }
        >
          Open original listing
        </Button>
        <Button
          size="sm"
          variant="primary"
          icon={<Info className="h-3 w-3" />}
          onClick={job.state.applicationId ? () => go('applications') : onOpen}
        >
          {job.state.applicationId ? 'View application' : 'Details'}
        </Button>
      </div>
    </article>
  )
}

function JobDetail({
  job,
  onClose,
  onChange,
  onSave,
  onDismiss
}: {
  job: ScoredJob
  onClose: () => void
  onChange: (j: ScoredJob | null) => void
  onSave: () => void
  onDismiss: () => void
}): React.JSX.Element {
  const { go, toast } = useApp()
  const [verifying, setVerifying] = useState(false)
  const [applyOpen, setApplyOpen] = useState(false)
  const [resumes, setResumes] = useState<ResumeRecord[]>([])
  const [resumeId, setResumeId] = useState<string>('')
  const [starting, setStarting] = useState(false)
  useEffect(() => {
    call('profile:get')
      .then((p) => {
        setResumes(p.resumes)
        setResumeId(p.resumes.find((r) => r.isDefault)?.id ?? p.resumes[0]?.id ?? '')
      })
      .catch(() => undefined)
  }, [job.id])
  const v = VERIFICATION_LABEL[job.verificationStatus]
  const verify = async (): Promise<void> => {
    setVerifying(true)
    try {
      onChange(await call('jobs:verify', { id: job.id }))
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setVerifying(false)
    }
  }
  const start = async (): Promise<void> => {
    setStarting(true)
    try {
      await call('applications:start', { jobId: job.id, resumeId: resumeId || undefined })
      toast('Opening the real application page in a browser window…', 'success')
      setApplyOpen(false)
      go('applications')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setStarting(false)
    }
  }
  return (
    <>
      <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onClick={onClose}>
        <aside
          className="h-full w-full max-w-2xl overflow-y-auto border-l border-white/10 bg-slate-950 p-6 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
          aria-label="Job details"
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-white">{job.title}</h2>
              <p className="text-xs text-slate-400">
                {job.company} · {job.locationText}
              </p>
            </div>
            <button
              onClick={onClose}
              className="rounded p-1 text-slate-400 hover:bg-white/10"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            <Button
              variant="primary"
              icon={<Send className="h-3.5 w-3.5" />}
              onClick={() => setApplyOpen(true)}
              disabled={
                !!job.state.applicationId &&
                job.state.applicationState !== 'CANCELLED' &&
                job.state.applicationState !== 'FAILED'
              }
            >
              {job.state.applicationId
                ? APP_STATE_LABEL[job.state.applicationState!]
                : 'Prepare application'}
            </Button>
            <Button
              icon={
                job.state.saved ? (
                  <BookmarkCheck className="h-3.5 w-3.5" />
                ) : (
                  <Bookmark className="h-3.5 w-3.5" />
                )
              }
              onClick={onSave}
            >
              {job.state.saved ? 'Saved' : 'Save job'}
            </Button>
            <Button
              icon={<ArrowUpRight className="h-3.5 w-3.5" />}
              onClick={() =>
                void call('jobs:open-external', { url: job.canonicalJobUrl ?? job.sourceUrl })
              }
            >
              Open original listing
            </Button>
            <Button
              icon={<ShieldCheck className="h-3.5 w-3.5" />}
              loading={verifying}
              onClick={verify}
            >
              Check availability
            </Button>
            <Button variant="ghost" onClick={onDismiss}>
              Dismiss
            </Button>
          </div>

          {job.scamSignals.length > 0 && (
            <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-100">
              <p className="mb-1 flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="h-3.5 w-3.5" /> Possible scam warning signs
              </p>
              <ul className="list-disc space-y-0.5 pl-5">
                {job.scamSignals.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}

          {job.eligibility && (
            <Card
              className="mb-4"
              title={
                job.eligibility.status === 'eligible'
                  ? 'Meets your criteria'
                  : job.eligibility.status === 'review'
                    ? 'Location could not be verified'
                    : 'Does not meet your criteria'
              }
              subtitle="Hard filters are checked before any score is calculated"
            >
              <dl className="grid grid-cols-3 gap-2 text-[11px]">
                <Fact k="Occupation" v={job.eligibility.occupationStatus} />
                <Fact k="Location" v={job.eligibility.locationStatus.replace(/_/g, ' ')} />
                <Fact k="Work mode" v={job.eligibility.workModeStatus} />
              </dl>
              {job.eligibility.exclusionReasons.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-[11px] text-rose-200">
                  {job.eligibility.exclusionReasons.map((r) => (
                    <li key={r}>{EXCLUSION_LABEL[r] ?? r}</li>
                  ))}
                </ul>
              )}
              {job.eligibility.missingData.length > 0 && (
                <p className="mt-2 text-[11px] text-slate-400">
                  Not stated in the posting: {job.eligibility.missingData.join(', ')}
                </p>
              )}
            </Card>
          )}

          {job.match ? (
            <Card
              className="mb-4"
              title={`Match ${job.match.score}/100 — ${job.match.band}`}
              subtitle={
                job.match.semanticActive
                  ? `Includes local semantic similarity (${job.match.semanticModel})`
                  : 'Deterministic rules (semantic matching inactive)'
              }
            >
              <ul className="mb-3 space-y-1 text-xs text-slate-200">
                {job.match.explanation.map((e) => (
                  <li key={e}>• {e}</li>
                ))}
              </ul>
              <table className="w-full text-[11px]">
                <thead className="text-slate-500">
                  <tr>
                    <th className="pb-1 text-left font-medium">Criterion</th>
                    <th className="pb-1 text-right font-medium">Weight</th>
                    <th className="pb-1 text-right font-medium">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {job.match.criteria.map((c) => (
                    <tr key={c.key} className="border-t border-white/[0.05] align-top">
                      <td className="py-1.5 pr-2">
                        <p className="text-slate-200">{c.label}</p>
                        <p className="text-slate-500">{c.evidence}</p>
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-slate-400">{c.weight}</td>
                      <td className="py-1.5 text-right tabular-nums text-slate-200">
                        {c.score === null ? 'n/a' : `${Math.round(c.score * 100)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[10px] text-slate-500">{job.match.disclaimer}</p>
            </Card>
          ) : job.eligibility?.status === 'excluded' ? (
            <p className="mb-4 rounded-lg border border-white/10 p-3 text-xs text-slate-400">
              Not scored: jobs that fail your criteria are not given a match score.
            </p>
          ) : (
            <p className="mb-4 rounded-lg border border-white/10 p-3 text-xs text-slate-400">
              Upload a resume on the Profile page to see how this job matches your qualifications.
            </p>
          )}

          <Card
            className="mb-4"
            title="Facts"
            subtitle="Values marked * were derived by PulseApply, not stated by the source"
          >
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
              <Fact
                k="Pay"
                v={formatSalary(job.salary) + (job.inferredFields.includes('salary') ? ' *' : '')}
              />
              <Fact
                k="Posted"
                v={job.postedAt ? new Date(job.postedAt).toLocaleDateString() : 'Not given'}
              />
              <Fact
                k="Closes"
                v={job.expiresAt ? new Date(job.expiresAt).toLocaleDateString() : 'Not given'}
              />
              <Fact
                k="Work mode"
                v={
                  job.workModes.join(', ') + (job.inferredFields.includes('workModes') ? ' *' : '')
                }
              />
              <Fact
                k="Type"
                v={job.employmentTypes.map((t) => EMPLOYMENT_LABEL[t]).join(', ') || 'Not given'}
              />
              <Fact
                k="Occupation"
                v={job.occupation ? `${job.occupation.label} *` : 'Unclassified'}
              />
              <Fact k="Location check" v={job.geo.note ?? job.geo.eligibility} />
              <Fact
                k="Remote eligibility"
                v={
                  job.remoteEligibility
                    ? `${job.remoteEligibility.kind}${job.remoteEligibility.raw ? ` (${job.remoteEligibility.raw})` : ''}`
                    : '—'
                }
              />
              {job.requiredCertifications.length > 0 && (
                <Fact
                  k="Certifications asked"
                  v={job.requiredCertifications.join(', ').replace(/_/g, ' ')}
                />
              )}
              {job.minYearsExperience !== undefined && (
                <Fact k="Experience asked" v={`${job.minYearsExperience}+ years`} />
              )}
            </dl>
          </Card>

          <Card className="mb-4" title="Verification" subtitle={v.help}>
            <Badge tone={v.tone}>{v.label}</Badge>
            <ul className="mt-2 space-y-1 text-[11px] text-slate-400">
              {job.verificationNotes.map((n) => (
                <li key={n}>• {n}</li>
              ))}
            </ul>
            {job.lastVerifiedAt && (
              <p className="mt-2 text-[10px] text-slate-500">
                Last checked {timeAgo(job.lastVerifiedAt)}
              </p>
            )}
          </Card>

          <Card
            className="mb-4"
            title={`Sources (${job.sources.length})`}
            subtitle="Where this listing was found"
          >
            <ul className="space-y-2 text-[11px]">
              {job.sources.map((s) => (
                <li
                  key={`${s.providerId}:${s.sourceJobId}`}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="text-slate-300">
                    {s.providerName} {s.employerDirect && <Badge tone="green">employer</Badge>}
                    <span className="ml-1 text-slate-500">seen {timeAgo(s.fetchedAt)}</span>
                  </span>
                  <button
                    className="truncate text-cyan-300 hover:underline"
                    onClick={() => void call('jobs:open-external', { url: s.sourceUrl })}
                  >
                    {new URL(s.sourceUrl).hostname}
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          <Card
            title="Description"
            subtitle="Shown as plain text exactly as provided (untrusted content)"
          >
            <pre className="max-h-[480px] overflow-y-auto whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-300">
              {job.description || 'No description provided by the source.'}
            </pre>
          </Card>
        </aside>
      </div>

      <Modal
        open={applyOpen}
        title="Prepare application"
        onClose={() => setApplyOpen(false)}
        footer={
          <>
            <Button onClick={() => setApplyOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={starting} onClick={start}>
              Open real application page & autofill
            </Button>
          </>
        }
      >
        <p>
          PulseApply will open the real application page (
          {job.applicationSupport === 'manual' ? 'no known form' : job.applicationSupport}) in a
          visible browser window, fill in the fields it can answer from your approved profile,
          attach your resume, and stop for your review.
        </p>
        <p className="mt-2 text-amber-200">
          Nothing is submitted until you explicitly approve it, and questions about work
          authorization, sponsorship, demographics, criminal history or certifications are left for
          you unless you pre-approved an answer.
        </p>
        <div className="mt-3">
          <label
            className="mb-1 block text-[11px] uppercase tracking-wide text-slate-400"
            htmlFor="resume-select"
          >
            Resume to attach
          </label>
          {resumes.length === 0 ? (
            <p className="text-rose-300">
              No resume uploaded — the resume field will be left for you.
            </p>
          ) : (
            <Select
              id="resume-select"
              value={resumeId}
              onChange={(e) => setResumeId(e.target.value)}
            >
              {resumes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                  {r.isDefault ? ' (default)' : ''}
                </option>
              ))}
            </Select>
          )}
        </div>
      </Modal>
    </>
  )
}

function Fact({ k, v }: { k: string; v: string }): React.JSX.Element {
  return (
    <div>
      <dt className="text-slate-500">{k}</dt>
      <dd className="text-slate-200">{v}</dd>
    </div>
  )
}
