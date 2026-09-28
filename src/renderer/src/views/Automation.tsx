import { useState } from 'react'
import {
  Bell,
  KeyRound,
  Pause,
  Play,
  Plus,
  RotateCw,
  Send,
  Trash2,
  UserCheck,
  UserX
} from 'lucide-react'
import type { SavedSearch, TelegramStatus } from '../../../shared/types'
import { Badge, Button, Card, Empty, ErrorNote, Input, PageHeader, Toggle } from '../components/ui'
import { useLoader } from '../lib/useLoader'
import { call, useEvent } from '../lib/api'
import { timeAgo, until } from '../lib/format'
import { useApp } from '../lib/appContext'
import { SaveSearchModal } from './Search'
import { EMPTY_CRITERIA } from '../lib/criteria'

export default function Automation(): React.JSX.Element {
  const { toast, lastSearch } = useApp()
  const searches = useLoader(() => call('searches:list'))
  const tg = useLoader(() => call('telegram:status'))
  const [newOpen, setNewOpen] = useState(false)
  useEvent('scheduler:updated', () => void searches.reload())
  useEvent('telegram:status', (s) => tg.setData(s))

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
    void searches.reload()
  }

  return (
    <div>
      <PageHeader
        title="Automation"
        subtitle="Scheduled searches run in the background while PulseApply is open, and Telegram alerts you only about new matching jobs."
        actions={
          <Button
            variant="primary"
            icon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => setNewOpen(true)}
          >
            New scheduled search
          </Button>
        }
      />
      <Card title="Scheduled searches" className="mb-5">
        {(searches.data ?? []).length === 0 ? (
          <Empty icon={<RotateCw className="h-7 w-7" />} title="No scheduled searches">
            Create one here or with “Save as scheduled search” on the Search page.
          </Empty>
        ) : (
          <div className="space-y-2">
            {searches.data!.map((s) => (
              <SearchRow key={s.id} s={s} onAction={run} />
            ))}
          </div>
        )}
      </Card>
      {tg.data && <TelegramCard status={tg.data} onStatus={tg.setData} />}
      <SaveSearchModal
        open={newOpen}
        criteria={lastSearch?.criteria ?? { ...EMPTY_CRITERIA, query: 'Warehouse Associate' }}
        onClose={() => {
          setNewOpen(false)
          void searches.reload()
        }}
      />
    </div>
  )
}

function SearchRow({
  s,
  onAction
}: {
  s: SavedSearch
  onAction: (fn: () => Promise<unknown>) => Promise<void>
}): React.JSX.Element {
  const c = s.criteria
  const [busy, setBusy] = useState(false)
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.07] px-4 py-3">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-xs font-semibold text-white">
          {s.name}
          {s.running && <Badge tone="cyan">running</Badge>}
          {!s.enabled && <Badge>paused</Badge>}
          {s.notify && <Badge tone="violet">Telegram ≥ {s.minScoreToNotify}</Badge>}
        </p>
        <p className="mt-0.5 text-[11px] text-slate-400">
          “{c.query}”{c.location ? ` · ${c.location}` : ''}
          {c.radius && c.location ? ` · ${c.radius} ${c.radiusUnit ?? 'mi'}` : ''}
          {c.workModes?.length ? ` · ${c.workModes.join('/')}` : ''} · every{' '}
          {s.intervalMinutes >= 60 ? `${s.intervalMinutes / 60} h` : `${s.intervalMinutes} min`}
        </p>
        <p className="mt-0.5 text-[11px] text-slate-500">
          Last run {timeAgo(s.lastRunAt)}
          {s.lastResultCount !== undefined
            ? ` · ${s.lastResultCount} results, ${s.lastNewCount ?? 0} new`
            : ''}{' '}
          · next {s.enabled ? until(s.nextRunAt) : '—'}
        </p>
        {s.lastError && (
          <p className="mt-0.5 text-[11px] text-rose-300">
            Error: {s.lastError} (retrying with backoff, {s.consecutiveFailures} failure
            {s.consecutiveFailures === 1 ? '' : 's'})
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          loading={busy}
          disabled={s.running}
          icon={<Play className="h-3 w-3" />}
          onClick={async () => {
            setBusy(true)
            await onAction(() => call('searches:run-now', { id: s.id }))
            setBusy(false)
          }}
        >
          Run now
        </Button>
        {s.running && (
          <Button
            size="sm"
            variant="danger"
            onClick={() => void onAction(() => call('searches:cancel', { id: s.id }))}
          >
            Stop
          </Button>
        )}
        <Button
          size="sm"
          icon={s.enabled ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          onClick={() =>
            void onAction(() => call('searches:set-enabled', { id: s.id, enabled: !s.enabled }))
          }
        >
          {s.enabled ? 'Pause' : 'Resume'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<Trash2 className="h-3 w-3" />}
          onClick={() => void onAction(() => call('searches:delete', { id: s.id }))}
          aria-label="Delete search"
        />
      </div>
    </div>
  )
}

function TelegramCard({
  status,
  onStatus
}: {
  status: TelegramStatus
  onStatus: (s: TelegramStatus) => void
}): React.JSX.Element {
  const { toast } = useApp()
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const act = async (label: string, fn: () => Promise<TelegramStatus | boolean>): Promise<void> => {
    setBusy(label)
    setError(null)
    try {
      const r = await fn()
      if (typeof r === 'object') onStatus(r)
      else toast('Test message sent', 'success')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }
  const tone =
    status.state === 'RUNNING'
      ? 'green'
      : status.state === 'ERROR'
        ? 'red'
        : status.state === 'STOPPED'
          ? 'slate'
          : 'cyan'
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-cyan-300" /> Telegram notifications
        </span>
      }
      subtitle={
        status.botUsername
          ? `Bot @${status.botUsername}`
          : 'Create a bot with @BotFather, paste its token, start it, then send /start to your bot.'
      }
      actions={<Badge tone={tone}>{status.state}</Badge>}
    >
      <p className="mb-3 text-xs text-slate-300">{status.detail}</p>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="min-w-[280px] flex-1">
          <label
            className="mb-1 block text-[11px] uppercase tracking-wide text-slate-400"
            htmlFor="tg-token"
          >
            Bot token{' '}
            {status.tokenConfigured && (
              <span className="normal-case text-emerald-300">(configured — stored encrypted)</span>
            )}
          </label>
          <Input
            id="tg-token"
            type="password"
            autoComplete="off"
            placeholder={
              status.tokenConfigured ? '•••••••• (enter a new token to replace)' : '123456789:AA…'
            }
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>
        <Button
          icon={<KeyRound className="h-3.5 w-3.5" />}
          loading={busy === 'token'}
          disabled={!token.trim()}
          onClick={() =>
            act('token', async () => {
              const s = await call('telegram:set-token', { token })
              setToken('')
              return s
            })
          }
        >
          Save token
        </Button>
        {status.state === 'RUNNING' || status.state === 'STARTING' ? (
          <Button
            variant="danger"
            loading={busy === 'stop'}
            onClick={() => act('stop', () => call('telegram:stop'))}
          >
            Stop bot
          </Button>
        ) : (
          <Button
            variant="primary"
            loading={busy === 'start'}
            disabled={!status.tokenConfigured}
            onClick={() => act('start', () => call('telegram:start'))}
          >
            Start bot
          </Button>
        )}
        {/webhook/i.test(status.detail) && (
          <Button
            loading={busy === 'hook'}
            onClick={() => act('hook', () => call('telegram:clear-webhook'))}
          >
            Remove webhook
          </Button>
        )}
        <Button
          icon={<Send className="h-3.5 w-3.5" />}
          loading={busy === 'test'}
          disabled={status.state !== 'RUNNING'}
          onClick={() => act('test', () => call('telegram:test'))}
        >
          Send test
        </Button>
      </div>
      <ErrorNote error={error} />
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
            Authorized chats
          </p>
          {status.authorizedChats.length === 0 ? (
            <p className="text-[11px] text-slate-500">
              None. Only authorized chats receive jobs or can press buttons.
            </p>
          ) : (
            status.authorizedChats.map((c) => (
              <div
                key={c.chatId}
                className="mb-1.5 flex items-center justify-between rounded-lg border border-white/[0.06] px-3 py-1.5 text-[11px]"
              >
                <span className="text-slate-200">
                  {c.label} <span className="text-slate-500">({c.chatId})</span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<UserX className="h-3 w-3" />}
                  onClick={() => act('revoke', () => call('telegram:revoke', { chatId: c.chatId }))}
                >
                  Revoke
                </Button>
              </div>
            ))
          )}
        </div>
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
            Waiting for approval
          </p>
          {status.pendingChats.length === 0 ? (
            <p className="text-[11px] text-slate-500">
              Send /start to your bot; the chat appears here for you to approve.
            </p>
          ) : (
            status.pendingChats.map((c) => (
              <div
                key={c.chatId}
                className="mb-1.5 flex items-center justify-between rounded-lg border border-amber-500/20 px-3 py-1.5 text-[11px]"
              >
                <span className="text-slate-200">
                  {c.label}{' '}
                  <span className="text-slate-500">
                    ({c.chatId}, {timeAgo(c.seenAt)})
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="primary"
                  icon={<UserCheck className="h-3 w-3" />}
                  onClick={() =>
                    act('auth', () => call('telegram:authorize', { chatId: c.chatId }))
                  }
                >
                  Authorize
                </Button>
              </div>
            ))
          )}
        </div>
      </div>
      <div className="mt-4">
        <Toggle
          checked={status.state === 'RUNNING'}
          onChange={(v) =>
            void act(v ? 'start' : 'stop', () => call(v ? 'telegram:start' : 'telegram:stop'))
          }
          disabled={!status.tokenConfigured}
          label="Start automatically when PulseApply opens"
        />
      </div>
      <p className="mt-3 text-[11px] text-slate-500">
        Buttons in Telegram (Save, Apply, Dismiss) are tied to the exact job and chat, keep working
        after restarts, and expire after 14 days. “Apply” only queues the application — the browser
        opens when you are at your computer. Your resume and personal details are never sent to
        Telegram.
      </p>
    </Card>
  )
}
