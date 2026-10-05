import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  RefreshCw,
  Search as SearchIcon,
  UploadCloud
} from 'lucide-react'
import type { DashboardStats } from '../../../shared/types'
import { Button, Card, PageHeader, Stat } from '../components/ui'
import { useLoader } from '../lib/useLoader'
import { call, useEvent } from '../lib/api'
import { APP_STATE_LABEL, timeAgo } from '../lib/format'
import { useApp } from '../lib/appContext'

export default function Dashboard({
  stats,
  onRefresh
}: {
  stats: DashboardStats | null
  onRefresh: () => void
}): React.JSX.Element {
  const { go } = useApp()
  const profile = useLoader(() => call('profile:get'))
  const apps = useLoader(() =>
    call('applications:list', {
      states: ['NEEDS_USER_INPUT', 'READY_FOR_REVIEW', 'MANUAL_COMPLETION_REQUIRED', 'QUEUED']
    })
  )
  const runs = useLoader(() => call('searches:runs'))
  useEvent('applications:updated', () => void apps.reload())

  const noResume = profile.data && profile.data.resumes.length === 0
  const attention = apps.data ?? []

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Live counts from your local job index. Nothing here is estimated or placeholder data."
        actions={
          <>
            <Button icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={onRefresh}>
              Refresh
            </Button>
            <Button
              variant="primary"
              icon={<SearchIcon className="h-3.5 w-3.5" />}
              onClick={() => go('search')}
            >
              New search
            </Button>
          </>
        }
      />

      {noResume && (
        <Card className="mb-5 border-cyan-500/30 bg-cyan-500/[0.06]">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <UploadCloud className="h-6 w-6 text-cyan-300" />
              <div>
                <p className="text-sm font-semibold text-white">
                  Upload your resume to get match scores
                </p>
                <p className="text-xs text-slate-400">
                  Searches work without a resume, but PulseApply can only explain fit once it knows
                  your experience.
                </p>
              </div>
            </div>
            <Button variant="primary" onClick={() => go('profile')}>
              Go to profile
            </Button>
          </div>
        </Card>
      )}

      {stats?.counters && (
        <p className="mb-3 text-[11px] text-slate-400" data-testid="dashboard-criteria">
          All numbers use your active criteria:{' '}
          <span className="text-slate-200">{stats.counters.criteriaLabel}</span> ·{' '}
          {stats.counters.review} need location review · {stats.counters.excluded} excluded
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Eligible jobs"
          value={stats?.totalJobs ?? '…'}
          hint={`Meet your criteria · ${stats?.counters.historical ?? '…'} stored in total`}
          onClick={() => go('results')}
        />
        <Stat
          label="New eligible (24 h)"
          value={stats?.newJobs ?? '…'}
          hint="Meet your criteria, first seen in the last day"
        />
        <Stat
          label="Verified"
          value={stats?.verifiedJobs ?? '…'}
          tone="green"
          hint="Currently listed at source or employer"
        />
        <Stat
          label="Strong matches"
          value={stats?.strongMatches ?? '…'}
          tone="green"
          hint="Heuristic score ≥ threshold"
        />
        <Stat label="Saved" value={stats?.savedJobs ?? '…'} tone="slate" />
        <Stat
          label="In progress"
          value={stats?.applicationsInProgress ?? '…'}
          tone="amber"
          onClick={() => go('applications')}
        />
        <Stat
          label="Submitted (confirmed)"
          value={stats?.confirmedSubmitted ?? '…'}
          tone="green"
          hint="Confirmed by the destination site"
          onClick={() => go('applications')}
        />
        <Stat
          label="Unverified submissions"
          value={stats?.unverifiedSubmissions ?? '…'}
          tone="amber"
          hint="Outcome not confirmed"
          onClick={() => go('applications')}
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card title="Needs your attention" subtitle="Follow-ups and applications waiting on you">
          {(stats?.followUpsDue.length ?? 0) > 0 && (
            <ul className="mb-3 space-y-1.5" data-testid="followups">
              {stats!.followUpsDue.slice(0, 5).map((f) => (
                <li
                  key={f.jobId}
                  className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-white">Follow up: {f.title}</p>
                    <p className="truncate text-[11px] text-slate-400">
                      {f.company} · due {f.followUpAt}
                    </p>
                  </div>
                  <Button size="sm" onClick={() => go('tracker')}>
                    Open tracker
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {attention.length === 0 && !(stats?.followUpsDue.length ?? 0) ? (
            <p className="flex items-center gap-2 text-xs text-slate-500">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Nothing waiting.
            </p>
          ) : (
            <ul className="space-y-2">
              {attention.slice(0, 6).map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-white">{a.jobTitle}</p>
                    <p className="truncate text-[11px] text-slate-500">
                      {a.company} · {APP_STATE_LABEL[a.state]}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => go('applications')}
                    icon={<ArrowRight className="h-3 w-3" />}
                  >
                    Open
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {profile.data && profile.data.needsConfirmation.length > 0 && (
            <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Profile: {profile.data.needsConfirmation.join(', ')}. Confirm these before autofilling
              applications.
            </p>
          )}
          {stats && stats.providersNeedingCredentials > 0 && (
            <p className="mt-3 text-[11px] text-slate-400">
              {stats.providersNeedingCredentials} job source(s) need free API credentials for local
              search coverage.{' '}
              <button className="text-cyan-300 underline" onClick={() => go('sources')}>
                Set up sources
              </button>
            </p>
          )}
        </Card>

        <Card title="Recent searches" subtitle="Manual and scheduled runs">
          {(runs.data ?? []).length === 0 ? (
            <p className="text-xs text-slate-500">No searches yet.</p>
          ) : (
            <table className="w-full text-left text-[11px]">
              <thead className="text-slate-500">
                <tr>
                  <th className="pb-2 font-medium">When</th>
                  <th className="pb-2 font-medium">Trigger</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 text-right font-medium">Results</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {runs.data!.slice(0, 8).map((r) => (
                  <tr key={r.id} className="border-t border-white/[0.05]">
                    <td className="py-1.5">{timeAgo(r.startedAt)}</td>
                    <td>{r.trigger}</td>
                    <td
                      className={
                        r.status === 'ok'
                          ? 'text-emerald-300'
                          : r.status === 'error'
                            ? 'text-rose-300'
                            : 'text-slate-400'
                      }
                      title={r.error}
                    >
                      {r.status}
                    </td>
                    <td className="text-right tabular-nums">
                      {r.stats ? `${r.stats.returned} (${r.stats.newJobs} new)` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  )
}
