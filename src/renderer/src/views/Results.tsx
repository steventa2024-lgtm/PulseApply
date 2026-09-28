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
import type { ResumeRecord, ScoredJob, VerificationStatus } from '../../../shared/types'
import { Badge, Button, Card, Chip, Empty, Modal, PageHeader, Select } from '../components/ui'
import { cx } from '../lib/cx'
import { call } from '../lib/api'
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

type ViewMode = 'results' | 'saved' | 'all' | 'dismissed'
type Sort = 'match' | 'date' | 'distance'
const PAGE = 30

export default function Results(): React.JSX.Element {
  const { lastSearch, updateJob, go, toast, setDraftCriteria } = useApp()
  const [mode, setMode] = useState<ViewMode>('results')
  const [other, setOther] = useState<ScoredJob[]>([])
  const [minScore, setMinScore] = useState(0)
  const [verif, setVerif] = useState<VerificationStatus | ''>('')
  const [sort, setSort] = useState<Sort>('match')
  const [shown, setShown] = useState(PAGE)
  const [selected, setSelected] = useState<ScoredJob | null>(null)
  const [links, setLinks] = useState<{ providerId: string; name: string; url: string }[]>([])

  const changeMode = (m: ViewMode): void => {
    setMode(m)
    setShown(PAGE)
  }

  useEffect(() => {
    if (mode === 'results') return
    call('jobs:list', {
      view: mode === 'saved' ? 'saved' : mode === 'dismissed' ? 'dismissed' : 'all',
      limit: 1000
    })
      .then(setOther)
      .catch((e) => toast((e as Error).message, 'error'))
  }, [mode, toast])

  useEffect(() => {
    if (lastSearch)
      call('search:manual-links', lastSearch.criteria)
        .then(setLinks)
        .catch(() => setLinks([]))
  }, [lastSearch])

  const base =
    mode === 'results' ? (lastSearch?.jobs ?? []).filter((j) => !j.state.dismissed) : other
  const jobs = useMemo(() => {
    const list = base.filter(
      (j) => (j.match?.score ?? 0) >= minScore && (!verif || j.verificationStatus === verif)
    )
    return [...list].sort((a, b) =>
      sort === 'date'
        ? (b.postedAt ?? b.discoveredAt).localeCompare(a.postedAt ?? a.discoveredAt)
        : sort === 'distance'
          ? (a.geo.distance ?? 1e9) - (b.geo.distance ?? 1e9)
          : (b.match?.score ?? -1) - (a.match?.score ?? -1) || b.relevance.score - a.relevance.score
    )
  }, [base, minScore, verif, sort])

  const replace = (j: ScoredJob | null): void => {
    if (!j) return
    updateJob(j)
    setOther((list) => list.map((x) => (x.id === j.id ? { ...x, ...j } : x)))
    setSelected((s) => (s && s.id === j.id ? { ...s, ...j } : s))
  }
  const save = async (j: ScoredJob): Promise<void> =>
    replace(await call('jobs:save', { id: j.id, saved: !j.state.saved }))
  const dismiss = async (j: ScoredJob): Promise<void> => {
    const res = await call('jobs:dismiss', { id: j.id, dismissed: !j.state.dismissed })
    replace(res)
    if (mode === 'dismissed') setOther((l) => l.filter((x) => x.id !== j.id))
    if (selected?.id === j.id) setSelected(null)
  }

  const stats = lastSearch?.stats
  const excluded = stats ? Object.entries(stats.excluded).filter(([, n]) => n) : []
  const failed = stats?.providers.filter((p) => p.status === 'error') ?? []
  const queried = stats?.providers.filter((p) => p.status === 'ok' || p.status === 'cached') ?? []

  return (
    <div>
      <PageHeader
        title="Results"
        subtitle={
          lastSearch && mode === 'results'
            ? `“${lastSearch.criteria.query}”${lastSearch.criteria.location ? ` near ${lastSearch.criteria.location}` : ''} · searched ${timeAgo(lastSearch.finishedAt)}`
            : 'Jobs stored in your local index'
        }
        actions={
          <Button
            icon={<RefreshCw className="h-3.5 w-3.5" />}
            onClick={() => {
              if (lastSearch) setDraftCriteria(lastSearch.criteria)
              go('search')
            }}
          >
            Refine search
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(['results', 'saved', 'all', 'dismissed'] as ViewMode[]).map((m) => (
          <Chip key={m} active={mode === m} onClick={() => changeMode(m)}>
            {m === 'results'
              ? `Last search (${(lastSearch?.jobs ?? []).filter((j) => !j.state.dismissed).length})`
              : m === 'all'
                ? 'All stored jobs'
                : m[0].toUpperCase() + m.slice(1)}
          </Chip>
        ))}
        <span className="mx-2 h-4 w-px bg-white/10" />
        <label className="text-[11px] text-slate-400">
          Min match
          <Select
            className="ml-1.5 inline-block w-20 py-1"
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
          >
            {[0, 40, 60, 75].map((v) => (
              <option key={v} value={v}>
                {v || 'any'}
              </option>
            ))}
          </Select>
        </label>
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

      {mode === 'results' && stats && (
        <Card className="mb-4">
          <div className="flex flex-wrap items-start justify-between gap-4 text-[11px]">
            <div className="space-y-1 text-slate-400">
              <p>
                <span className="text-slate-200">{stats.returned}</span> result
                {stats.returned === 1 ? '' : 's'} ({stats.newJobs} new) from {stats.fetched}{' '}
                listings across {queried.length} source
                {queried.length === 1 ? '' : 's'}; {stats.duplicatesMerged} duplicate
                {stats.duplicatesMerged === 1 ? '' : 's'} merged.
              </p>
              {excluded.length > 0 && (
                <p>
                  Filtered out:{' '}
                  {excluded.map(([k, n]) => `${n} ${EXCLUSION_LABEL[k] ?? k}`).join(' · ')}
                  {stats.rejectedMalformed ? ` · ${stats.rejectedMalformed} malformed` : ''}
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

      {jobs.length === 0 ? (
        <ResultsEmpty
          mode={mode}
          hasSearch={!!lastSearch}
          excluded={excluded.length > 0}
          failedAll={!!stats && queried.length === 0}
          onSearch={() => go('search')}
          onSources={() => go('sources')}
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
              <Button onClick={() => setShown((s) => s + PAGE)}>
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

function ResultsEmpty({
  mode,
  hasSearch,
  excluded,
  failedAll,
  onSearch,
  onSources
}: {
  mode: ViewMode
  hasSearch: boolean
  excluded: boolean
  failedAll: boolean
  onSearch: () => void
  onSources: () => void
}): React.JSX.Element {
  if (mode !== 'results')
    return (
      <Empty
        icon={<Layers className="h-8 w-8" />}
        title={`No ${mode === 'all' ? 'stored' : mode} jobs`}
      />
    )
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
        Every eligible source was skipped or failed (see the summary above). Local searches need at
        least one aggregator key (Adzuna, Jooble or USAJOBS) or registered employer boards.
      </Empty>
    )
  if (excluded)
    return (
      <Empty
        icon={<Layers className="h-8 w-8" />}
        title="Listings were found, but your filters excluded all of them"
        action={<Button onClick={onSearch}>Adjust filters</Button>}
      >
        The summary above lists why each listing was excluded (different occupation, outside radius,
        remote eligibility…). Try a wider radius or different work modes.
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
          Original listing
        </Button>
        <Button
          size="sm"
          variant="primary"
          icon={<Info className="h-3 w-3" />}
          onClick={job.state.applicationId ? () => go('applications') : onOpen}
        >
          {job.state.applicationId ? 'View application' : 'Details & apply'}
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
                : 'Apply with autofill'}
            </Button>
            <Button
              icon={<ArrowUpRight className="h-3.5 w-3.5" />}
              onClick={() =>
                void call('jobs:open-external', { url: job.applyUrl ?? job.sourceUrl })
              }
            >
              Open application page
            </Button>
            <Button
              icon={<ShieldCheck className="h-3.5 w-3.5" />}
              loading={verifying}
              onClick={verify}
            >
              Check availability
            </Button>
            <Button variant="ghost" onClick={onSave}>
              {job.state.saved ? 'Unsave' : 'Save'}
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
        title="Start application"
        onClose={() => setApplyOpen(false)}
        footer={
          <>
            <Button onClick={() => setApplyOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={starting} onClick={start}>
              Open & autofill
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
