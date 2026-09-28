import { afterEach, describe, expect, it } from 'vitest'
import type { ScoredJob } from '../src/shared/types'
import type { Services } from '../src/main/app/services'
import { TelegramApi, type TgUpdate } from '../src/main/services/telegram/api'
import { normalizeDraft } from '../src/main/services/jobs/normalization/normalize'
import { CALLBACK_DATA_MAX_BYTES } from '../src/main/services/persistence/telegramRepo'
import { makeServices, tmpDir } from './helpers'

const TOKEN = '123456789:AAHfakeTokenForTestsOnly_abcdefghijklmn'

/** In-process fake of the Telegram Bot API with realistic getUpdates conflict semantics. */
class FakeTelegram {
  updates: TgUpdate[] = []
  sent: {
    chatId: string
    text: string
    keyboard?: { text: string; url?: string; callback_data?: string }[][]
  }[] = []
  answers: { id: string; text: string }[] = []
  conflicts = 0
  maxConcurrentPolls = 0
  forced409 = 0
  private active: { reject: (e: unknown) => void; resolve: () => void }[] = []
  private nextId = 1

  push(u: Omit<TgUpdate, 'update_id'>): void {
    this.updates.push({ update_id: this.nextId++, ...u })
    for (const a of this.active) a.resolve()
  }

  fetch: typeof fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = url.pathname.split('/').pop()!
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    const ok = (result: unknown): Response =>
      new Response(JSON.stringify({ ok: true, result }), { status: 200 })
    switch (method) {
      case 'getMe':
        return ok({ id: 1, is_bot: true, username: 'pulse_test_bot' })
      case 'getWebhookInfo':
        return ok({ url: '', pending_update_count: 0 })
      case 'sendMessage':
        this.sent.push({
          chatId: String(body.chat_id),
          text: body.text,
          keyboard: body.reply_markup?.inline_keyboard
        })
        return ok({
          message_id: this.sent.length,
          chat: { id: Number(body.chat_id), type: 'private' }
        })
      case 'answerCallbackQuery':
        this.answers.push({ id: body.callback_query_id, text: body.text })
        return ok(true)
      case 'getUpdates': {
        if (this.forced409 > 0) {
          this.forced409--
          this.conflicts++
          return new Response(
            JSON.stringify({
              ok: false,
              error_code: 409,
              description: 'Conflict: terminated by other getUpdates request'
            }),
            { status: 409 }
          )
        }
        // A new poll terminates any pending one with 409, like the real API.
        for (const a of this.active.splice(0)) {
          this.conflicts++
          a.reject(
            new Response(
              JSON.stringify({
                ok: false,
                error_code: 409,
                description: 'Conflict: terminated by other getUpdates request'
              }),
              { status: 409 }
            )
          )
        }
        const pending = (): TgUpdate[] =>
          this.updates.filter((u) => u.update_id >= (body.offset ?? 0))
        if (!pending().length) {
          let entry: { resolve: () => void; reject: (e: unknown) => void } | undefined
          await new Promise<void>((resolve, reject) => {
            entry = { resolve, reject }
            this.active.push(entry)
            this.maxConcurrentPolls = Math.max(this.maxConcurrentPolls, this.active.length)
            const t = setTimeout(resolve, (body.timeout ?? 1) * 1000)
            init?.signal?.addEventListener('abort', () => {
              clearTimeout(t)
              reject(new DOMException('Aborted', 'AbortError'))
            })
          }).finally(() => {
            this.active = this.active.filter((x) => x !== entry)
          })
        }
        return ok(pending())
      }
    }
    return new Response(JSON.stringify({ ok: false, error_code: 404, description: 'Not Found' }), {
      status: 404
    })
  }) as typeof fetch
}

/** fetch wrapper: rejected Response objects (409 terminations) are returned as responses. */
function wrap(fake: FakeTelegram): typeof fetch {
  return (async (i: string | URL | Request, init?: RequestInit) => {
    try {
      return await fake.fetch(i, init)
    } catch (e) {
      if (e instanceof Response) return e
      throw e
    }
  }) as typeof fetch
}

const services: Services[] = []
afterEach(async () => {
  for (const s of services.splice(0)) await s.shutdown()
})

async function setup(fake: FakeTelegram, dir = tmpDir()): Promise<Services> {
  const { svc } = await makeServices({
    userDataDir: dir,
    telegramApiFactory: (t) => new TelegramApi(t, 'https://api.telegram.test', wrap(fake)),
    telegramPollTimeoutSec: 1,
    telegramConflictBackoffMs: 50
  })
  services.push(svc)
  return svc
}

function seedJob(svc: Services, title: string): ScoredJob {
  const j = normalizeDraft(
    {
      sourceJobId: title,
      sourceUrl: `https://example.com/jobs/${encodeURIComponent(title)}`,
      title,
      company: 'Acme',
      locationText: 'Carson, CA',
      employerDirect: false
    },
    { providerId: 'test', providerName: 'Test', geo: svc.geo }
  ).job!
  const scored: ScoredJob = {
    ...j,
    geo: { eligibility: 'within_radius', note: '5 mi' },
    relevance: { score: 1, basis: '' },
    state: { saved: false, dismissed: false }
  }
  svc.store.jobs.upsertMany([scored])
  return svc.store.jobs.get(j.id)!
}

const until = async (fn: () => boolean, ms = 4000): Promise<void> => {
  const t0 = Date.now()
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timeout waiting for condition')
    await new Promise((r) => setTimeout(r, 25))
  }
}

function cb(chatId: number, data: string, id = String(Math.random())): Omit<TgUpdate, 'update_id'> {
  return {
    callback_query: {
      id,
      from: { id: chatId },
      message: { message_id: 1, chat: { id: chatId, type: 'private' } },
      data
    }
  }
}

describe('Telegram lifecycle', () => {
  it('start/stop/restart never creates overlapping polls', async () => {
    const fake = new FakeTelegram()
    const svc = await setup(fake)
    await svc.telegram.setToken(TOKEN)
    expect((await svc.telegram.start()).state).toBe('RUNNING')
    expect((await svc.telegram.stop()).state).toBe('STOPPED')
    expect((await svc.telegram.start()).state).toBe('RUNNING')
    // Rapid toggling without awaiting in between.
    const ops = [
      svc.telegram.stop(),
      svc.telegram.start(),
      svc.telegram.stop(),
      svc.telegram.start(),
      svc.telegram.start()
    ]
    await Promise.all(ops)
    await new Promise((r) => setTimeout(r, 1500))
    expect(svc.telegram.status().state).toBe('RUNNING')
    expect(fake.conflicts).toBe(0)
    expect(fake.maxConcurrentPolls).toBe(1)
  })

  it('a second instance cannot poll the same token', async () => {
    const fake = new FakeTelegram()
    const dir = tmpDir()
    const a = await setup(fake, dir)
    await a.telegram.setToken(TOKEN)
    await a.telegram.start()
    const b = await setup(fake, dir)
    await b.telegram.setToken(TOKEN)
    const st = await b.telegram.start()
    expect(st.state).toBe('ERROR')
    expect(st.detail).toMatch(/already (running|polling)/)
    expect(fake.conflicts).toBe(0)
  })

  it('recovers from transient 409 and reports persistent 409 clearly', async () => {
    const fake = new FakeTelegram()
    const svc = await setup(fake)
    await svc.telegram.setToken(TOKEN)
    fake.forced409 = 2
    await svc.telegram.start()
    await until(
      () =>
        fake.forced409 === 0 &&
        svc.telegram.status().conflictCount === 0 &&
        !!svc.telegram.status().lastPollAt,
      15000
    )
    expect(svc.telegram.status().state).toBe('RUNNING')
    await svc.telegram.stop()
    fake.forced409 = 100
    await svc.telegram.start()
    await until(() => svc.telegram.status().state === 'ERROR', 20000)
    expect(svc.telegram.status().detail).toMatch(/409/)
  }, 60_000)
})

describe('Telegram authorization and callbacks', () => {
  it('pairs chats explicitly and never answers unauthorized chats with data', async () => {
    const fake = new FakeTelegram()
    const svc = await setup(fake)
    await svc.telegram.setToken(TOKEN)
    await svc.telegram.start()
    fake.push({
      message: {
        message_id: 1,
        chat: { id: 555, type: 'private' },
        from: { id: 555, first_name: 'Stranger' },
        text: '/start'
      }
    })
    await until(() => fake.sent.length === 1)
    expect(fake.sent[0].text).toMatch(/not authorized/)
    expect(svc.telegram.status().pendingChats.map((c) => c.chatId)).toContain('555')
    fake.push({ message: { message_id: 2, chat: { id: 555, type: 'private' }, text: '/status' } })
    await new Promise((r) => setTimeout(r, 300))
    expect(fake.sent.length).toBe(1)
  })

  it('buttons resolve to their original job across newer batches, restarts and duplicates', async () => {
    const fake = new FakeTelegram()
    const dir = tmpDir()
    let svc = await setup(fake, dir)
    await svc.telegram.setToken(TOKEN)
    svc.store.telegram.authorize('777', 'Me')
    await svc.telegram.start()
    const jobA = seedJob(svc, 'Warehouse Associate A')
    const jobB = seedJob(svc, 'Warehouse Associate B')

    await svc.telegram.sendJobBatch([jobA], { searchName: 'Batch 1' })
    const msgA = fake.sent.find((m) => m.text.includes('Warehouse Associate A'))!
    const applyA = msgA.keyboard![0].find((b) => b.text.includes('Apply'))!.callback_data!
    const saveA = msgA.keyboard![0].find((b) => b.text.includes('Save'))!.callback_data!
    expect(Buffer.byteLength(applyA)).toBeLessThanOrEqual(CALLBACK_DATA_MAX_BYTES)
    expect(applyA).not.toMatch(/^a:0$/)
    expect(msgA.keyboard![0][0]).toMatchObject({ text: 'Open ↗', url: jobA.sourceUrl })

    // A newer batch must not change what the old button means.
    await svc.telegram.sendJobBatch([jobB], { searchName: 'Batch 2' })
    fake.push(cb(777, applyA, 'q1'))
    await until(() => fake.answers.some((a) => a.id === 'q1'))
    expect(fake.answers.find((a) => a.id === 'q1')!.text).toMatch(/Queued "Warehouse Associate A"/)
    const apps = svc.store.applications.list()
    expect(apps).toHaveLength(1)
    expect(apps[0]).toMatchObject({ jobId: jobA.id, state: 'QUEUED', origin: 'telegram' })

    // Duplicate press.
    fake.push(cb(777, applyA, 'q2'))
    await until(() => fake.answers.some((a) => a.id === 'q2'))
    expect(fake.answers.find((a) => a.id === 'q2')!.text).toMatch(/Already handled/)
    expect(svc.store.applications.list()).toHaveLength(1)

    // Unauthorized chat pressing a valid button.
    fake.push(cb(999, saveA, 'q3'))
    await until(() => fake.answers.some((a) => a.id === 'q3'))
    expect(fake.answers.find((a) => a.id === 'q3')!.text).toMatch(/not authorized/)
    expect(svc.store.jobs.get(jobA.id)!.state.saved).toBe(false)

    // Restart the whole app; the persisted button still resolves.
    await svc.shutdown()
    services.splice(services.indexOf(svc), 1)
    svc = await setup(fake, dir)
    await svc.telegram.resumeIfEnabled()
    expect(svc.telegram.status().state).toBe('RUNNING')
    fake.push(cb(777, saveA, 'q4'))
    await until(() => fake.answers.some((a) => a.id === 'q4'))
    expect(fake.answers.find((a) => a.id === 'q4')!.text).toMatch(/Saved: Warehouse Associate A/)
    expect(svc.store.jobs.get(jobA.id)!.state.saved).toBe(true)

    // Unknown / forged token.
    fake.push(cb(777, 's:AAAAAAAAAAAA', 'q5'))
    await until(() => fake.answers.some((a) => a.id === 'q5'))
    expect(fake.answers.find((a) => a.id === 'q5')!.text).toMatch(/no longer recognised/)
    expect(fake.conflicts).toBe(0)
  }, 30_000)
})
