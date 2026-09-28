import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { JobCounters, ScoredJob } from '../../shared/types'
import { call, useEvent } from './lib/api'
import { Ctx, type LastSearch, type Toast, type View } from './lib/appContext'

export function AppProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [view, setView] = useState<View>('dashboard')
  const [lastSearch, setLastSearch] = useState<LastSearch | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [counters, setCounters] = useState<JobCounters | null>(null)
  const refreshCounters = useCallback(() => {
    call('jobs:counters')
      .then(setCounters)
      .catch(() => undefined)
  }, [])
  useEffect(() => refreshCounters(), [refreshCounters])
  useEvent('jobs:changed', refreshCounters)

  const dismissToast = useCallback(
    (id: number) => setToasts((t) => t.filter((x) => x.id !== id)),
    []
  )
  const toast = useCallback(
    (text: string, tone: Toast['tone'] = 'info') => {
      const id = Date.now() + Math.random()
      setToasts((t) => [...t.slice(-3), { id, tone, text }])
      setTimeout(() => dismissToast(id), tone === 'error' ? 8000 : 4000)
    },
    [dismissToast]
  )
  const updateJob = useCallback((job: ScoredJob) => {
    setLastSearch((s) =>
      s ? { ...s, jobs: s.jobs.map((j) => (j.id === job.id ? { ...j, ...job } : j)) } : s
    )
  }, [])

  const value = useMemo(
    () => ({
      view,
      go: setView,
      lastSearch,
      setLastSearch,
      updateJob,
      toasts,
      toast,
      dismissToast,
      counters,
      refreshCounters
    }),
    [view, lastSearch, updateJob, toasts, toast, dismissToast, counters, refreshCounters]
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
