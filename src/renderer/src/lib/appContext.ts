import { createContext, useContext } from 'react'
import type { ScoredJob, SearchCriteria, SearchIntent, SearchStats } from '../../../shared/types'

export type View =
  | 'dashboard'
  | 'search'
  | 'results'
  | 'applications'
  | 'automation'
  | 'sources'
  | 'profile'
  | 'settings'

export interface LastSearch {
  criteria: SearchCriteria
  intent: SearchIntent
  stats: SearchStats
  jobs: ScoredJob[]
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
  draftCriteria: SearchCriteria | null
  setDraftCriteria: (c: SearchCriteria | null) => void
}

export const Ctx = createContext<AppState | null>(null)

export function useApp(): AppState {
  const c = useContext(Ctx)
  if (!c) throw new Error('useApp outside provider')
  return c
}
