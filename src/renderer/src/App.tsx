import { useEffect, useState } from 'react'
import {
  Activity,
  Bell,
  Briefcase,
  Database,
  FileText,
  LayoutDashboard,
  Layers,
  Search as SearchIcon,
  Settings as SettingsIcon,
  X,
  Zap
} from 'lucide-react'
import { AppProvider } from './state'
import { useApp, type View } from './lib/appContext'
import { call, useEvent } from './lib/api'
import {} from './components/ui'
import { cx } from './lib/cx'
import type { AppInfo, DashboardStats } from '../../shared/types'
import Dashboard from './views/Dashboard'
import Search from './views/Search'
import Results from './views/Results'
import Applications from './views/Applications'
import Automation from './views/Automation'
import Sources from './views/Sources'
import Profile from './views/Profile'
import Settings from './views/Settings'

const NAV: { id: View; label: string; icon: typeof Layers }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'search', label: 'Search', icon: SearchIcon },
  { id: 'results', label: 'Results', icon: Layers },
  { id: 'applications', label: 'Applications', icon: Briefcase },
  { id: 'automation', label: 'Automation', icon: Bell },
  { id: 'sources', label: 'Sources', icon: Database },
  { id: 'profile', label: 'Profile', icon: FileText },
  { id: 'settings', label: 'Settings', icon: SettingsIcon }
]

function Shell(): React.JSX.Element {
  const { view, go, lastSearch, setLastSearch, toasts, dismissToast } = useApp()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)

  const refreshStats = (): void =>
    void call('dashboard:stats')
      .then(setStats)
      .catch(() => undefined)

  useEffect(() => {
    refreshStats()
    call('app:info')
      .then(setInfo)
      .catch(() => undefined)
    call('search:last')
      .then((s) => s && setLastSearch(s))
      .catch(() => undefined)
    const t = setInterval(refreshStats, 60_000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEvent('applications:updated', refreshStats)
  useEvent('jobs:changed', refreshStats)
  useEvent('scheduler:updated', refreshStats)
  useEvent('telegram:status', refreshStats)

  // Sidebar badges use the same data the pages render (no separate counters that can drift).
  const resultsCount = lastSearch ? lastSearch.jobs.filter((j) => !j.state.dismissed).length : 0
  const badges: Partial<Record<View, number>> = {
    results: resultsCount,
    applications: stats?.applicationsInProgress ?? 0
  }

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-[#090d16] font-sans text-slate-100">
      <div className="pointer-events-none absolute -left-32 -top-32 h-[420px] w-[420px] rounded-full bg-cyan-500/10 blur-[120px]" />
      <div className="pointer-events-none absolute -right-32 top-1/3 h-[480px] w-[480px] rounded-full bg-indigo-500/10 blur-[140px]" />

      <header className="app-drag relative z-10 flex h-10 w-full shrink-0 items-center justify-between border-b border-white/[0.06] bg-slate-950/40 px-4 backdrop-blur-2xl">
        <div className="flex items-center gap-3 text-xs font-semibold tracking-wide text-slate-300">
          <div className="flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br from-cyan-400 to-blue-600 shadow-[0_0_12px_rgba(6,182,212,0.4)]">
            <Zap className="h-3 w-3 text-slate-950" />
          </div>
          <span>PulseApply</span>
          <span className="font-mono text-[10px] text-slate-500">v{info?.version ?? '…'}</span>
          {info?.demoMode && (
            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
              DEMO MODE
            </span>
          )}
        </div>
        <div className="mr-36 flex items-center gap-2 text-[11px] text-slate-400">
          <Activity
            className={cx(
              'h-3.5 w-3.5',
              stats?.telegram === 'RUNNING' ? 'text-emerald-400' : 'text-slate-600'
            )}
          />
          Telegram {stats?.telegram?.toLowerCase() ?? '…'}
        </div>
      </header>

      <div className="relative z-10 flex flex-1 overflow-hidden">
        <aside className="flex w-56 shrink-0 select-none flex-col justify-between border-r border-white/[0.06] bg-slate-950/50 p-3 backdrop-blur-2xl">
          <nav className="space-y-1" aria-label="Main">
            {NAV.map((n) => {
              const Icon = n.icon
              const active = view === n.id
              return (
                <button
                  key={n.id}
                  onClick={() => go(n.id)}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-medium transition',
                    active
                      ? 'border border-cyan-500/30 bg-gradient-to-r from-cyan-500/15 to-transparent text-cyan-200'
                      : 'border border-transparent text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
                  )}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon className="h-4 w-4" />
                    {n.label}
                  </span>
                  {!!badges[n.id] && (
                    <span className="rounded-full bg-cyan-500/20 px-1.5 text-[10px] font-semibold text-cyan-300">
                      {badges[n.id]}
                    </span>
                  )}
                </button>
              )
            })}
          </nav>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-[11px] text-slate-400">
            <p className="font-medium text-slate-300">Scheduled searches</p>
            <p className="mt-0.5">{stats ? `${stats.scheduledSearches} active` : '…'}</p>
            <p className="mt-2 font-medium text-slate-300">Last successful search</p>
            <p className="mt-0.5">
              {stats?.lastSuccessfulSearchAt
                ? new Date(stats.lastSuccessfulSearchAt).toLocaleString()
                : 'None yet'}
            </p>
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto px-8 py-7">
          <div className="mx-auto max-w-6xl">
            {view === 'dashboard' && <Dashboard stats={stats} onRefresh={refreshStats} />}
            {view === 'search' && <Search />}
            {view === 'results' && <Results />}
            {view === 'applications' && <Applications />}
            {view === 'automation' && <Automation />}
            {view === 'sources' && <Sources />}
            {view === 'profile' && <Profile />}
            {view === 'settings' && <Settings info={info} onInfo={setInfo} />}
          </div>
        </main>
      </div>

      <div
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-96 flex-col gap-2"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              'pointer-events-auto flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-xs shadow-xl backdrop-blur-xl',
              t.tone === 'error'
                ? 'border-rose-500/40 bg-rose-950/80 text-rose-100'
                : t.tone === 'success'
                  ? 'border-emerald-500/40 bg-emerald-950/80 text-emerald-100'
                  : 'border-white/10 bg-slate-900/90 text-slate-200'
            )}
          >
            <span className="flex-1">{t.text}</span>
            <button onClick={() => dismissToast(t.id)} aria-label="Dismiss">
              <X className="h-3.5 w-3.5 opacity-60" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function App(): React.JSX.Element {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}
