import cron from 'node-cron'
import { BrowserWindow } from 'electron'
import { loadDatabase, saveDatabase, JobRecord } from './db'
import { scrapeTargetJobs } from './scraper'
import { scoreJobMatch } from './matcher'

export async function runSourcingPipeline(mainWindow?: BrowserWindow): Promise<JobRecord[]> {
  const db = loadDatabase()

  if (!db.profile) {
    console.log('[Scheduler] No profile loaded.')
    return []
  }

  const rawJobs = await scrapeTargetJobs()
  const scoredJobs: JobRecord[] = []

  for (const raw of rawJobs) {
    const match = scoreJobMatch(db.profile, raw.description, raw.requiredSkills)
    scoredJobs.push({
      id: raw.externalId,
      title: raw.title,
      company: raw.company,
      location: raw.location,
      source: raw.source,
      url: raw.url,
      salary: raw.salary,
      description: raw.description,
      requiredSkills: raw.requiredSkills,
      matchScore: match.score,
      matchedSkills: match.matchedSkills,
      missingSkills: match.missingSkills,
      discoveredAt: new Date().toISOString(),
      status: 'queued'
    })
  }

  scoredJobs.sort((a, b) => b.matchScore - a.matchScore)
  db.jobs = scoredJobs
  saveDatabase(db)

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('jobs:pipeline-updated', db.jobs)
    mainWindow.webContents.send('db:sync', db)
  }

  return db.jobs
}

export function startScheduler(mainWindow: BrowserWindow): void {
  cron.schedule('0 */3 * * *', async () => {
    await runSourcingPipeline(mainWindow)
  })
}

export function stopScheduler(): void {}
