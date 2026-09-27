import { AppDatabase, JobRecord, CandidateInfo } from '../main/services/db'
import { ParsedProfile } from '../main/services/parser'
import { AutofillStatusUpdate } from '../main/services/autofill'

export interface IElectronAPI {
  ping: () => Promise<{ status: string; timestamp: number }>
  getDatabase: () => Promise<AppDatabase>
  saveCandidate: (candidate: CandidateInfo) => Promise<boolean>
  selectAndParseResume: () => Promise<{ success: boolean; profile?: ParsedProfile; candidate?: CandidateInfo; path?: string; error?: string }>
  parseResumePath: (filePath: string) => Promise<{ success: boolean; profile?: ParsedProfile; candidate?: CandidateInfo; path?: string; error?: string }>
  parseResumeBase64: (fileName: string, base64: string) => Promise<{ success: boolean; profile?: ParsedProfile; candidate?: CandidateInfo; path?: string; error?: string }>
  getPathForFile: (file: File) => string
  forceRunScraper: () => Promise<JobRecord[]>
  toggleScheduler: (activate: boolean) => Promise<boolean>
  onPipelineUpdated: (callback: (jobs: JobRecord[]) => void) => void
  onDatabaseSync: (callback: (db: AppDatabase) => void) => void
  startAutofill: (jobId: string) => Promise<{ success: boolean; finalUrl?: string }>
  confirmSubmission: (jobId: string) => Promise<boolean>
  cancelAutofill: () => Promise<boolean>
  onAutofillStatus: (callback: (update: AutofillStatusUpdate & { jobId: string }) => void) => void
}

declare global {
  interface Window {
    api: IElectronAPI
  }
}
