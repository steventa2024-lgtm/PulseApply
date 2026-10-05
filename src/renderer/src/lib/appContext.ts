import { createContext, useContext } from 'react'
import type {
  JobCounters,
  ScoredJob,
  SearchCriteria,
  SearchIntent,
  SearchStats
} from '../../../shared/types'

export type View =
  | 'dashboard'
  | 'search'
  | 'results'
  | 'tracker'
  | 'applications'
  | 'automation'
  | 'sources'
  | 'resume'
  | 'profile'
  | 'settings'

export interface LastSearch {
  criteria: SearchCriteria
  intent: SearchIntent
  stats: SearchStats
  jobs: ScoredJob[]
  review?: ScoredJob[]
  runId?: string
  finishedAt: string
}

export interface Toast {
  id: number
  tone: 'info' | 'success' | 'error'
  text: string
}

export interface AppState {
  view: View
  go: (v: View) => void
  lastSearch: LastSearch | null
  setLastSearch: (s: LastSearch | null) => void
  updateJob: (job: ScoredJob) => void
  toasts: Toast[]
  toast: (text: string, tone?: Toast['tone']) => void
  dismissToast: (id: number) => void
  /** Result counters from the database, evaluated against the active criteria. */
  counters: JobCounters | null
  refreshCounters: () => void
}

export const Ctx = createContext<AppState | null>(null)

export function useApp(): AppState {
  const c = useContext(Ctx)
  if (!c) throw new Error('useApp outside provider')
  return c
}
