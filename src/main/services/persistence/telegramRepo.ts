import { randomBytes, randomUUID } from 'crypto'
import type { AppDb } from './database'

export type CallbackAction = 's' | 'a' | 'd'

export interface CallbackRecord {
  token: string
  action: CallbackAction
  jobId: string
  notificationId?: string
  chatId: string
  createdAt: string
  expiresAt: string
  consumedAt?: string
  result?: string
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
/** Telegram rejects callback_data longer than 64 bytes. */
export const CALLBACK_DATA_MAX_BYTES = 64
export const CALLBACK_TTL_MS = 14 * 86400_000

function shortToken(len = 12): string {
  const bytes = randomBytes(len)
  let out = ''
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
  return out
}

export function encodeCallbackData(action: CallbackAction, token: string): string {
  const data = `${action}:${token}`
  if (Buffer.byteLength(data, 'utf8') > CALLBACK_DATA_MAX_BYTES) {
    throw new Error('callback_data exceeds Telegram 64-byte limit')
  }
  return data
}

export function decodeCallbackData(data: string | undefined): { action: CallbackAction; token: string } | null {
  if (!data) return null
  const m = /^([sad]):([A-Za-z0-9]{8,32})$/.exec(data)
  return m ? { action: m[1] as CallbackAction, token: m[2] } : null
}

export class TelegramRepo {
  constructor(private readonly db: AppDb) {}

  // --- chats ---------------------------------------------------------------

  chats(status?: 'authorized' | 'pending' | 'revoked'): { chatId: string; label: string; status: string; seenAt: string; addedAt?: string }[] {
    const rows = status
      ? this.db.all<{ chat_id: string; label: string; status: string; seen_at: string; added_at: string | null }>(
          'SELECT * FROM telegram_chats WHERE status = ? ORDER BY seen_at DESC',
          [status]
        )
      : this.db.all<{ chat_id: string; label: string; status: string; seen_at: string; added_at: string | null }>(
          'SELECT * FROM telegram_chats ORDER BY seen_at DESC'
        )
    return rows.map((r) => ({ chatId: r.chat_id, label: r.label, status: r.status, seenAt: r.seen_at, addedAt: r.added_at ?? undefined }))
  }

  isAuthorized(chatId: string): boolean {
    return !!this.db.get("SELECT 1 AS x FROM telegram_chats WHERE chat_id = ? AND status = 'authorized'", [chatId])
  }

  notePending(chatId: string, label: string): void {
    const now = new Date().toISOString()
    this.db.run(
      `INSERT INTO telegram_chats (chat_id, label, status, seen_at) VALUES (?, ?, 'pending', ?)
       ON CONFLICT(chat_id) DO UPDATE SET seen_at = excluded.seen_at, label = excluded.label`,
      [chatId, label.slice(0, 80), now]
    )
  }

  authorize(chatId: string, label?: string): void {
    const now = new Date().toISOString()
    this.db.run(
      `INSERT INTO telegram_chats (chat_id, label, status, seen_at, added_at) VALUES (?, ?, 'authorized', ?, ?)
       ON CONFLICT(chat_id) DO UPDATE SET status = 'authorized', added_at = excluded.added_at`,
      [chatId, (label ?? chatId).slice(0, 80), now, now]
    )
  }

  revoke(chatId: string): void {
    this.db.run("UPDATE telegram_chats SET status = 'revoked' WHERE chat_id = ?", [chatId])
  }

  // --- notifications & callbacks -------------------------------------------

  recordNotification(input: { searchId?: string; chatId: string; messageId?: number; jobIds: string[]; kind: string }): string {
    const id = randomUUID()
    this.db.run(
      'INSERT INTO telegram_notifications (id, search_id, chat_id, message_id, job_ids, kind, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, input.searchId ?? null, input.chatId, input.messageId ?? null, JSON.stringify(input.jobIds), input.kind, new Date().toISOString()]
    )
    return id
  }

  setNotificationMessageId(id: string, messageId: number): void {
    this.db.run('UPDATE telegram_notifications SET message_id = ? WHERE id = ?', [messageId, id])
  }

  notificationCount(): number {
    return this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM telegram_notifications')?.n ?? 0
  }

  /** Creates a persistent, unguessable callback token bound to one job and one chat. */
  createCallback(action: CallbackAction, jobId: string, chatId: string, notificationId?: string, ttlMs = CALLBACK_TTL_MS): CallbackRecord {
    const now = Date.now()
    for (let attempt = 0; attempt < 5; attempt++) {
      const token = shortToken()
      try {
        this.db.run(
          `INSERT INTO telegram_callbacks (token, action, job_id, notification_id, chat_id, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [token, action, jobId, notificationId ?? null, chatId, new Date(now).toISOString(), new Date(now + ttlMs).toISOString()]
        )
        return this.getCallback(token)!
      } catch {
        // token collision: retry
      }
    }
    throw new Error('Could not allocate callback token')
  }

  getCallback(token: string): CallbackRecord | undefined {
    const r = this.db.get<{
      token: string
      action: string
      job_id: string
      notification_id: string | null
      chat_id: string
      created_at: string
      expires_at: string
      consumed_at: string | null
      result: string | null
    }>('SELECT * FROM telegram_callbacks WHERE token = ?', [token])
    if (!r) return undefined
    return {
      token: r.token,
      action: r.action as CallbackAction,
      jobId: r.job_id,
      notificationId: r.notification_id ?? undefined,
      chatId: r.chat_id,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      consumedAt: r.consumed_at ?? undefined,
      result: r.result ?? undefined
    }
  }

  /** Atomically consumes a callback. Returns false if it was already consumed. */
  consume(token: string, result: string): boolean {
    return (
      this.db.run('UPDATE telegram_callbacks SET consumed_at = ?, result = ? WHERE token = ? AND consumed_at IS NULL', [
        new Date().toISOString(),
        result,
        token
      ]) === 1
    )
  }

  pruneExpired(): void {
    this.db.run('DELETE FROM telegram_callbacks WHERE expires_at < ?', [new Date(Date.now() - 30 * 86400_000).toISOString()])
  }
}
