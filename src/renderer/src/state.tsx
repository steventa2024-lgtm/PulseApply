import { useCallback, useMemo, useState, type ReactNode } from 'react'
import type { ScoredJob, SearchCriteria } from '../../shared/types'
import { Ctx, type LastSearch, type Toast, type View } from './lib/appContext'

export function AppProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [view, setView] = useState<View>('dashboard')
  const [lastSearch, setLastSearch] = useState<LastSearch | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [draftCriteria, setDraftCriteria] = useState<SearchCriteria | null>(null)

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
      draftCriteria,
      setDraftCriteria
    }),
    [view, lastSearch, updateJob, toasts, toast, dismissToast, draftCriteria]
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
