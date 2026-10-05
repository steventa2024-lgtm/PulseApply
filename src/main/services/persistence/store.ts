import { AppDb } from './database'
import { SecretStore, type SecretCipher } from './secrets'
import { SettingsRepo } from './settings'
import { JobsRepo } from './jobsRepo'
import { ApplicationsRepo } from './applicationsRepo'
import { SearchesRepo } from './searchesRepo'
import { EmployersRepo, ProvidersRepo } from './providersRepo'
import { TelegramRepo } from './telegramRepo'
import { CandidateRepo } from './candidateRepo'
import { ResumeDocsRepo } from './resumeDocsRepo'
import { TrackingRepo } from './trackingRepo'

export interface Store {
  db: AppDb
  secrets: SecretStore
  settings: SettingsRepo
  jobs: JobsRepo
  applications: ApplicationsRepo
  searches: SearchesRepo
  providers: ProvidersRepo
  employers: EmployersRepo
  telegram: TelegramRepo
  candidate: CandidateRepo
  resumeDocs: ResumeDocsRepo
  tracking: TrackingRepo
}

export async function openStore(filePath: string | null, cipher: SecretCipher): Promise<Store> {
  const db = await AppDb.open(filePath)
  const secrets = new SecretStore(db, cipher)
  return {
    db,
    secrets,
    settings: new SettingsRepo(db),
    jobs: new JobsRepo(db),
    applications: new ApplicationsRepo(db),
    searches: new SearchesRepo(db),
    providers: new ProvidersRepo(db),
    employers: new EmployersRepo(db),
    telegram: new TelegramRepo(db),
    candidate: new CandidateRepo(db, secrets),
    resumeDocs: new ResumeDocsRepo(db),
    tracking: new TrackingRepo(db)
  }
}
