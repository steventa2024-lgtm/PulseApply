import { describe, expect, it } from 'vitest'
import { createHandlers } from '../src/main/ipc/handlers'
import { makeServices } from './helpers'

function insertJob(svc: Awaited<ReturnType<typeof makeServices>>['svc'], id: string): void {
  svc.store.db.run(
    "INSERT INTO jobs (id, canonical_key, data, title, company, source, discovered_at, last_seen_at, verification_status) VALUES (?, ?, ?, 'Barista', 'Bean Co', 's', 'n', 'n', 'SOURCE_CONFIRMED')",
    [
      id,
      id,
      JSON.stringify({ id, title: 'Barista', company: 'Bean Co', sources: [], locations: [] })
    ]
  )
}

const host = {
  pickResumeFile: async () => null,
  saveJsonFile: async () => null,
  confirm: async () => true,
  openExternal: async () => undefined,
  appInfo: () => ({ version: 't', isPackaged: false })
}

describe('application tracker', () => {
  it('records applying, sets a follow-up, keeps history, survives restart', async () => {
    const made = await makeServices()
    const { svc, dir } = made
    insertJob(svc, 'j1')
    insertJob(svc, 'j2')
    const h = createHandlers(svc, host, () => undefined)

    await h['jobs:save']({ id: 'j2', saved: true })
    const applied = await h['tracker:update']({ jobId: 'j1', status: 'applied' })
    const t = applied!.state.tracking!
    expect(t.status).toBe('applied')
    expect(t.appliedAt).toBeDefined()
    const expected = new Date(Date.parse(t.appliedAt!) + 7 * 86400_000).toISOString().slice(0, 10)
    expect(t.followUpAt).toBe(expected)

    // Saved jobs appear on the tracker too.
    expect((await h['tracker:list']()).map((j) => j.id).sort()).toEqual(['j1', 'j2'])

    await h['tracker:update']({
      jobId: 'j1',
      status: 'interviewing',
      notes: 'Phone screen Tue 10am'
    })
    const later = (await h['tracker:update']({ jobId: 'j1', followUpAt: '2000-01-01' }))!
    expect(later.state.tracking!.history.map((x) => x.status)).toEqual(['applied', 'interviewing'])
    expect(later.state.tracking!.notes).toBe('Phone screen Tue 10am')

    const stats = await svc.dashboard()
    expect(stats.followUpsDue.map((f) => f.jobId)).toEqual(['j1'])
    expect(stats.tracking).toMatchObject({ interviewing: 1 })

    // Closing a job clears its follow-up.
    const closed = (await h['tracker:update']({ jobId: 'j1', status: 'rejected' }))!
    expect(closed.state.tracking!.followUpAt).toBeUndefined()
    await svc.shutdown()

    const { svc: again } = await makeServices({ userDataDir: dir })
    expect(again.store.tracking.get('j1')).toMatchObject({
      status: 'rejected',
      notes: 'Phone screen Tue 10am'
    })
    await again.shutdown()
  })

  it('a submitted or self-reported application moves the job to Applied, never backwards', async () => {
    const { svc } = await makeServices()
    insertJob(svc, 'j1')
    svc.store.tracking.markApplied('j1')
    expect(svc.store.tracking.get('j1')!.status).toBe('applied')
    svc.store.tracking.set('j1', { status: 'interviewing' })
    svc.store.tracking.markApplied('j1')
    expect(svc.store.tracking.get('j1')!.status).toBe('interviewing')
    await svc.shutdown()
  })
})

describe('new-job notifications', () => {
  it('a scheduled search notifies only about newly found matching jobs', async () => {
    const { fakeFetch, json } = await import('./helpers')
    const { adzunaPage } = await import('./fixtures/providerPayloads')
    const notes: { name: string; n: number }[] = []
    const { svc } = await makeServices({
      fetchImpl: fakeFetch([
        (u) =>
          u.hostname === 'api.adzuna.com'
            ? json(adzunaPage(Number(u.pathname.split('/').pop())))
            : undefined
      ]),
      notifyNewJobs: (name, jobs) => notes.push({ name, n: jobs.length })
    })
    svc.store.secrets.set('adzuna.appId', 'a')
    svc.store.secrets.set('adzuna.appKey', 'b')
    const s = svc.store.searches.save({
      name: 'Warehouse LA',
      criteria: { query: 'Warehouse Associate', location: 'Los Angeles, CA', radius: 20 },
      enabled: true,
      intervalMinutes: 60,
      notify: false,
      minScoreToNotify: 0
    })
    await svc.scheduler.runNow(s.id)
    expect(notes).toHaveLength(1)
    expect(notes[0].name).toBe('Warehouse LA')
    expect(notes[0].n).toBeGreaterThan(0)
    await svc.scheduler.runNow(s.id) // nothing new the second time
    expect(notes).toHaveLength(1)
    svc.store.settings.update({ notifications: { desktop: false } })
    await svc.shutdown()
  })
})
