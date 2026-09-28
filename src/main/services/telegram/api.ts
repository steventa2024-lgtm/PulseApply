/**
 * Minimal Telegram Bot API client (https://core.telegram.org/bots/api).
 * The token is only ever placed in the request URL; errors and logs never
 * include it.
 */
export class TelegramError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfter?: number
  ) {
    super(message)
    this.name = 'TelegramError'
  }
}

export interface TgUser {
  id: number
  is_bot?: boolean
  first_name?: string
  username?: string
}

export interface TgChat {
  id: number
  type: string
  title?: string
  username?: string
  first_name?: string
}

export interface TgMessage {
  message_id: number
  chat: TgChat
  from?: TgUser
  text?: string
}

export interface TgCallbackQuery {
  id: string
  from: TgUser
  message?: TgMessage
  data?: string
}

export interface TgUpdate {
  update_id: number
  message?: TgMessage
  callback_query?: TgCallbackQuery
}

export type InlineButton = { text: string; url: string } | { text: string; callback_data: string }

export class TelegramApi {
  constructor(
    private readonly token: string,
    private readonly baseUrl = 'https://api.telegram.org',
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async call<T>(method: string, params: Record<string, unknown> = {}, signal?: AbortSignal, timeoutMs = 15_000): Promise<T> {
    const timeout = AbortSignal.timeout(timeoutMs)
    const s = signal ? AbortSignal.any([signal, timeout]) : timeout
    let res: Response
    try {
      res = await this.fetchImpl(`${this.baseUrl}/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: s
      })
    } catch (err) {
      if (signal?.aborted) throw err
      throw new TelegramError(timeout.aborted ? 'Telegram request timed out' : `Network error contacting Telegram: ${(err as Error).message}`, 0)
    }
    let body: { ok: boolean; result?: T; description?: string; error_code?: number; parameters?: { retry_after?: number } }
    try {
      body = await res.json()
    } catch {
      throw new TelegramError(`Telegram returned HTTP ${res.status}`, res.status)
    }
    if (!body.ok) {
      throw new TelegramError(body.description ?? `Telegram error ${res.status}`, body.error_code ?? res.status, body.parameters?.retry_after)
    }
    return body.result as T
  }

  getMe(signal?: AbortSignal): Promise<TgUser> {
    return this.call('getMe', {}, signal)
  }

  getWebhookInfo(signal?: AbortSignal): Promise<{ url: string; pending_update_count: number }> {
    return this.call('getWebhookInfo', {}, signal)
  }

  deleteWebhook(): Promise<boolean> {
    return this.call('deleteWebhook', { drop_pending_updates: false })
  }

  getUpdates(offset: number, timeoutSec: number, signal: AbortSignal): Promise<TgUpdate[]> {
    return this.call('getUpdates', { offset, timeout: timeoutSec, allowed_updates: ['message', 'callback_query'] }, signal, (timeoutSec + 15) * 1000)
  }

  sendMessage(chatId: string, text: string, keyboard?: InlineButton[][]): Promise<TgMessage> {
    return this.call('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {})
    })
  }

  answerCallbackQuery(id: string, text: string): Promise<boolean> {
    return this.call('answerCallbackQuery', { callback_query_id: id, text: text.slice(0, 200), show_alert: false })
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
