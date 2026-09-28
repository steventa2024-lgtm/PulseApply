import type { ScoredJob, TelegramState, TelegramStatus } from '../../../shared/types'
import { formatSalary } from '../../../shared/format'
import type { Store } from '../persistence/store'
import { decodeCallbackData, encodeCallbackData } from '../persistence/telegramRepo'
import { DuplicateApplicationError } from '../persistence/applicationsRepo'
import {
  TelegramApi,
  TelegramError,
  escapeHtml,
  type InlineButton,
  type TgCallbackQuery,
  type TgMessage,
  type TgUpdate
} from './api'
import { PollingLock } from './pollingLock'
import { isPublicHttpUrl } from '../jobs/verification/urlSafety'
import { log } from '../logger'

export const TOKEN_KEY = 'telegram.botToken'
const OFFSET_KEY = 'telegram_offset'
const ENABLED_KEY = 'telegram_enabled'
const MAX_CONFLICTS = 6

export interface TelegramDeps {
  store: Store
  lockDir: string
  queueApplication: (jobId: string) => { id: string }
  emit: (status: TelegramStatus) => void
  apiFactory?: (token: string) => TelegramApi
  pollTimeoutSec?: number
  /** Base delay for 409 conflict backoff (doubles per attempt, max 30s). */
  conflictBackoffMs?: number
}

/**
 * Telegram bot with a serialized lifecycle:
 *   STOPPED -> STARTING -> RUNNING -> STOPPING -> STOPPED   (ERROR on failure)
 *
 * Root causes of the historical 409 "Conflict: terminated by other getUpdates
 * request" and how each is addressed:
 *  1. Two app instances polling one token -> Electron single-instance lock +
 *     per-token polling lock file (PollingLock).
 *  2. Restart/toggle while the previous long-poll is still open -> start/stop
 *     are queued on one promise chain; stop aborts the in-flight request and
 *     awaits the loop before a new loop can start.
 *  3. A killed process's long-poll lingering server-side -> 409 is retried
 *     with bounded backoff instead of crashing; persistent conflicts surface
 *     as a clear ERROR state.
 *  4. A configured webhook -> detected via getWebhookInfo and reported.
 *
 * Callback buttons carry `<action>:<random token>` backed by the database,
 * so a button always resolves to its original job — across newer batches and
 * across restarts — instead of the old positional `a:0` mapping.
 */
export class TelegramService {
  private state: TelegramState = 'STOPPED'
  private detail = 'Not started'
  private chain: Promise<unknown> = Promise.resolve()
  private abort: AbortController | null = null
  private loopDone: Promise<void> | null = null
  private lock: PollingLock | null = null
  private api: TelegramApi | null = null
  private botUsername?: string
  private lastPollAt?: string
  private conflictCount = 0
  private generation = 0

  constructor(private readonly deps: TelegramDeps) {}

  private get store(): Store {
    return this.deps.store
  }

  status(): TelegramStatus {
    const chats = this.store.telegram.chats()
    return {
      state: this.state,
      detail: this.detail,
      tokenConfigured: !!this.store.secrets.get(TOKEN_KEY),
      botUsername: this.botUsername,
      authorizedChats: chats
        .filter((c) => c.status === 'authorized')
        .map((c) => ({ chatId: c.chatId, label: c.label, addedAt: c.addedAt ?? c.seenAt })),
      pendingChats: chats
        .filter((c) => c.status === 'pending')
        .map((c) => ({ chatId: c.chatId, label: c.label, seenAt: c.seenAt })),
      lastPollAt: this.lastPollAt,
      conflictCount: this.conflictCount,
      notificationsEnabled: this.store.settings.getRaw<boolean>(ENABLED_KEY, false)
    }
  }

  private setState(state: TelegramState, detail: string): void {
    this.state = state
    this.detail = detail
    this.deps.emit(this.status())
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.catch(() => undefined).then(fn)
    this.chain = next
    return next
  }

  setToken(token: string): Promise<TelegramStatus> {
    return this.enqueue(async () => {
      await this.stopInternal()
      if (token.trim() && !/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(token.trim()))
        throw new Error('That does not look like a Telegram bot token (expected 123456:ABC…)')
      this.store.secrets.set(TOKEN_KEY, token)
      this.store.settings.setRaw(OFFSET_KEY, 0)
      this.botUsername = undefined
      this.setState(
        'STOPPED',
        token.trim() ? 'Token saved. Start the bot to connect.' : 'Token removed.'
      )
      return this.status()
    })
  }

  /** Starts polling if enabled and a token is configured. Safe to call repeatedly. */
  start(): Promise<TelegramStatus> {
    return this.enqueue(async () => {
      this.store.settings.setRaw(ENABLED_KEY, true)
      await this.startInternal()
      return this.status()
    })
  }

  stop(persistDisabled = true): Promise<TelegramStatus> {
    return this.enqueue(async () => {
      if (persistDisabled) this.store.settings.setRaw(ENABLED_KEY, false)
      await this.stopInternal()
      this.setState('STOPPED', 'Stopped')
      return this.status()
    })
  }

  /** Called at app launch: resumes polling only if the user had it enabled. */
  resumeIfEnabled(): Promise<TelegramStatus> {
    if (!this.store.settings.getRaw<boolean>(ENABLED_KEY, false))
      return Promise.resolve(this.status())
    return this.enqueue(async () => {
      await this.startInternal()
      return this.status()
    })
  }

  clearWebhook(): Promise<TelegramStatus> {
    return this.enqueue(async () => {
      const token = this.store.secrets.get(TOKEN_KEY)
      if (!token) throw new Error('No bot token configured')
      await this.makeApi(token).deleteWebhook()
      this.setState('STOPPED', 'Webhook removed. You can start polling now.')
      return this.status()
    })
  }

  private makeApi(token: string): TelegramApi {
    return this.deps.apiFactory ? this.deps.apiFactory(token) : new TelegramApi(token)
  }

  private async startInternal(): Promise<void> {
    if (this.state === 'RUNNING' || this.state === 'STARTING') return
    const token = this.store.secrets.get(TOKEN_KEY)
    if (!token) {
      this.setState('STOPPED', 'No bot token configured')
      return
    }
    this.setState('STARTING', 'Connecting to Telegram…')
    const lock = new PollingLock(this.deps.lockDir, token)
    const held = lock.acquire()
    if (held) {
      this.setState('ERROR', held)
      return
    }
    const api = this.makeApi(token)
    try {
      const me = await api.getMe()
      this.botUsername = me.username
      const hook = await api.getWebhookInfo()
      if (hook.url) {
        lock.release()
        this.setState(
          'ERROR',
          'This bot has a webhook configured, so polling would fail with 409. Use “Remove webhook” if you no longer need it.'
        )
        return
      }
    } catch (err) {
      lock.release()
      const e = err as TelegramError
      this.setState(
        'ERROR',
        e.status === 401 || e.status === 404
          ? 'Telegram rejected the bot token (unauthorized).'
          : `Could not reach Telegram: ${e.message}`
      )
      return
    }
    this.api = api
    this.lock = lock
    this.abort = new AbortController()
    this.conflictCount = 0
    const gen = ++this.generation
    this.setState('RUNNING', `Connected as @${this.botUsername ?? 'bot'}`)
    this.loopDone = this.loop(gen, api, this.abort.signal).catch((err) =>
      log.error('telegram', err)
    )
  }

  private async stopInternal(): Promise<void> {
    if (this.state === 'STOPPED' || this.state === 'ERROR') {
      this.lock?.release()
      this.lock = null
      return
    }
    this.setState('STOPPING', 'Stopping…')
    this.generation++
    this.abort?.abort()
    if (this.loopDone) {
      await Promise.race([this.loopDone, new Promise((r) => setTimeout(r, 5000))])
    }
    this.loopDone = null
    this.abort = null
    this.api = null
    this.lock?.release()
    this.lock = null
  }

  private async sleep(ms: number, signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, ms)
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(t)
          resolve()
        },
        { once: true }
      )
    })
  }

  private async loop(gen: number, api: TelegramApi, signal: AbortSignal): Promise<void> {
    let backoff = 1000
    let offset = this.store.settings.getRaw<number>(OFFSET_KEY, 0)
    while (gen === this.generation && !signal.aborted) {
      try {
        const updates = await api.getUpdates(offset, this.deps.pollTimeoutSec ?? 25, signal)
        this.lastPollAt = new Date().toISOString()
        this.lock?.heartbeat()
        if (this.conflictCount) {
          this.conflictCount = 0
          this.setState('RUNNING', `Connected as @${this.botUsername ?? 'bot'}`)
        }
        backoff = 1000
        for (const u of updates) {
          offset = Math.max(offset, u.update_id + 1)
          this.store.settings.setRaw(OFFSET_KEY, offset)
          await this.handleUpdate(api, u).catch((err) =>
            log.warn('telegram', `Update ${u.update_id} failed: ${(err as Error).message}`)
          )
        }
      } catch (err) {
        if (signal.aborted || gen !== this.generation) break
        const e = err as TelegramError
        if (e.status === 409) {
          this.conflictCount++
          if (this.conflictCount >= MAX_CONFLICTS) {
            this.generation++
            this.lock?.release()
            this.lock = null
            this.setState(
              'ERROR',
              'Telegram keeps reporting 409: another program or computer is polling this bot token (or a webhook is set). Stop the other client, then start again.'
            )
            return
          }
          this.setState(
            'RUNNING',
            `Waiting for a previous Telegram session to expire (409, attempt ${this.conflictCount}/${MAX_CONFLICTS})…`
          )
          await this.sleep(
            Math.min(30_000, (this.deps.conflictBackoffMs ?? 2000) * 2 ** (this.conflictCount - 1)),
            signal
          )
          continue
        }
        if (e.status === 401 || e.status === 404) {
          this.generation++
          this.lock?.release()
          this.lock = null
          this.setState('ERROR', 'Telegram rejected the bot token.')
          return
        }
        const wait = e.retryAfter ? e.retryAfter * 1000 : backoff
        log.warn('telegram', `Polling error: ${e.message}; retrying in ${Math.round(wait / 1000)}s`)
        await this.sleep(wait, signal)
        backoff = Math.min(60_000, backoff * 2)
      }
    }
  }

  // --- updates ---------------------------------------------------------------

  async handleUpdate(api: TelegramApi, u: TgUpdate): Promise<void> {
    if (u.callback_query) await this.handleCallback(api, u.callback_query)
    else if (u.message?.text) await this.handleMessage(api, u.message)
  }

  private chatLabel(m: TgMessage): string {
    return (
      m.chat.title ??
      ([m.from?.first_name, m.from?.username ? `@${m.from.username}` : '']
        .filter(Boolean)
        .join(' ') ||
        String(m.chat.id))
    )
  }

  private async handleMessage(api: TelegramApi, m: TgMessage): Promise<void> {
    const chatId = String(m.chat.id)
    const cmd = (m.text ?? '').trim().split(/\s+/)[0].toLowerCase().replace(/@.*$/, '')
    if (!this.store.telegram.isAuthorized(chatId)) {
      if (cmd === '/start') {
        this.store.telegram.notePending(chatId, this.chatLabel(m))
        this.deps.emit(this.status())
        await api.sendMessage(
          chatId,
          `This chat is not authorized yet.\nChat ID: <code>${escapeHtml(chatId)}</code>\nApprove it in PulseApply → Automation → Telegram.`
        )
      }
      return
    }
    if (cmd === '/start' || cmd === '/help') {
      await api.sendMessage(
        chatId,
        'PulseApply is connected ✅\nYou will receive new matching jobs from your scheduled searches.\n/status — summary\n/pause — pause scheduled searches\n/resume — resume them'
      )
    } else if (cmd === '/status') {
      const s = this.store.jobs.stats(new Date(Date.now() - 86400_000).toISOString(), 75)
      const searches = this.store.searches.list()
      await api.sendMessage(
        chatId,
        `Jobs meeting your criteria: ${s.total}\nNew in 24h: ${s.newJobs}\nStrong matches: ${s.strong}\nScheduled searches: ${searches.filter((x) => x.enabled).length}/${searches.length} active`
      )
    } else if (cmd === '/pause' || cmd === '/resume') {
      for (const s of this.store.searches.list())
        this.store.searches.setEnabled(s.id, cmd === '/resume')
      await api.sendMessage(
        chatId,
        cmd === '/pause' ? 'Scheduled searches paused.' : 'Scheduled searches resumed.'
      )
    }
  }

  async handleCallback(api: TelegramApi, cb: TgCallbackQuery): Promise<string> {
    const answer = async (text: string): Promise<string> => {
      await api.answerCallbackQuery(cb.id, text).catch(() => undefined)
      return text
    }
    const chatId = String(cb.message?.chat.id ?? cb.from.id)
    const fromId = String(cb.from.id)
    const chatAuthorized = this.store.telegram.isAuthorized(chatId)
    // In a group chat the person pressing the button must be authorized too.
    const userAuthorized =
      chatId === fromId ? chatAuthorized : this.store.telegram.isAuthorized(fromId)
    if (!chatAuthorized || !userAuthorized) {
      log.warn('telegram', `Rejected callback from unauthorized chat ${chatId}`)
      return answer('This chat is not authorized for PulseApply.')
    }
    const decoded = decodeCallbackData(cb.data)
    if (!decoded) return answer('Unknown button.')
    const rec = this.store.telegram.getCallback(decoded.token)
    if (!rec || rec.action !== decoded.action) return answer('This button is no longer recognised.')
    if (rec.chatId !== chatId) return answer('This button belongs to another chat.')
    if (rec.expiresAt < new Date().toISOString())
      return answer('This button has expired. Open PulseApply to see current jobs.')
    const job = this.store.jobs.get(rec.jobId)
    if (!job) return answer('This job is no longer available in PulseApply.')

    switch (rec.action) {
      case 's':
        this.store.jobs.setSaved(job.id, true)
        return answer(`Saved: ${job.title}`)
      case 'd':
        this.store.jobs.setDismissed(job.id, true)
        return answer(`Dismissed: ${job.title}`)
      case 'a': {
        // Atomic consume: a double-tap or a re-delivered update cannot queue twice.
        if (!this.store.telegram.consume(rec.token, 'queued'))
          return answer('Already handled — check the Applications page in PulseApply.')
        try {
          this.deps.queueApplication(job.id)
          return answer(
            `Queued "${job.title}". Open PulseApply on your computer to review and submit.`
          )
        } catch (err) {
          if (err instanceof DuplicateApplicationError) {
            return answer(
              err.existingState === 'SUBMITTED'
                ? 'You already applied to this job.'
                : 'An application for this job is already in progress.'
            )
          }
          return answer(`Could not queue: ${(err as Error).message}`)
        }
      }
    }
  }

  // --- notifications ----------------------------------------------------------

  /** Builds the message + keyboard for one job (exported for tests). */
  jobMessage(
    job: ScoredJob,
    chatId: string,
    notificationId: string
  ): { text: string; keyboard: InlineButton[][] } {
    const score = job.match
      ? `Match ${job.match.score}/100 (${job.match.band})`
      : 'Match: upload a resume to score'
    const where = job.geo?.note ?? job.locationText ?? ''
    const text = [
      `<b>${escapeHtml(job.title)}</b>`,
      escapeHtml(job.company),
      escapeHtml(where),
      `Pay: ${escapeHtml(formatSalary(job.salary))}`,
      escapeHtml(score),
      `Source: ${escapeHtml(job.sources.map((s) => s.providerName).join(', '))}${job.scamSignals.length ? '\n⚠️ Check warnings in the app' : ''}`
    ]
      .filter(Boolean)
      .join('\n')
    const row: InlineButton[] = []
    const url = job.canonicalJobUrl ?? job.sourceUrl
    if (isPublicHttpUrl(url)) row.push({ text: 'Open ↗', url })
    for (const [action, label] of [
      ['s', '⭐ Save'],
      ['a', '📝 Apply'],
      ['d', '✖']
    ] as const) {
      const rec = this.store.telegram.createCallback(action, job.id, chatId, notificationId)
      row.push({ text: label, callback_data: encodeCallbackData(action, rec.token) })
    }
    return { text, keyboard: [row] }
  }

  /** Sends new matching jobs to every authorized chat. Returns the number of messages sent. */
  async sendJobBatch(
    jobs: ScoredJob[],
    context: { searchId?: string; searchName: string }
  ): Promise<number> {
    if (this.state !== 'RUNNING' || !this.api) return 0
    const chats = this.store.telegram.chats('authorized')
    let sent = 0
    for (const chat of chats) {
      const notificationId = this.store.telegram.recordNotification({
        searchId: context.searchId,
        chatId: chat.chatId,
        jobIds: jobs.map((j) => j.id),
        kind: 'batch'
      })
      await this.api.sendMessage(
        chat.chatId,
        `🔔 <b>${jobs.length} new job${jobs.length === 1 ? '' : 's'}</b> for “${escapeHtml(context.searchName)}”`
      )
      sent++
      for (const job of jobs.slice(0, 10)) {
        const { text, keyboard } = this.jobMessage(job, chat.chatId, notificationId)
        await new Promise((r) => setTimeout(r, 1100))
        await this.api.sendMessage(chat.chatId, text, keyboard)
        sent++
      }
      if (jobs.length > 10) {
        await this.api.sendMessage(chat.chatId, `…and ${jobs.length - 10} more in PulseApply.`)
        sent++
      }
    }
    return sent
  }

  async sendTest(): Promise<void> {
    if (this.state !== 'RUNNING' || !this.api) throw new Error('Start the bot first')
    const chats = this.store.telegram.chats('authorized')
    if (!chats.length)
      throw new Error(
        'No authorized chats yet. Send /start to your bot, then approve the chat here.'
      )
    for (const c of chats) await this.api.sendMessage(c.chatId, 'PulseApply test message ✅')
  }

  isRunning(): boolean {
    return this.state === 'RUNNING'
  }

  /** Awaitable shutdown used by app quit. */
  shutdown(): Promise<unknown> {
    return this.stop(false)
  }
}
