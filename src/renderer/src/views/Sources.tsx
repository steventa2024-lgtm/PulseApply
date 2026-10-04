import { useState } from 'react'
import {
  Building2,
  Compass,
  ExternalLink,
  KeyRound,
  Plus,
  Search as SearchIcon,
  Trash2
} from 'lucide-react'
import type { AtsProvider, EmployerRecord, ProviderInfo } from '../../../shared/types'
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorNote,
  Input,
  PageHeader,
  Select,
  Toggle
} from '../components/ui'
import { useLoader } from '../lib/useLoader'
import { call } from '../lib/api'
import { PROVIDER_STATUS, timeAgo } from '../lib/format'
import { JobInboxCard } from './AddJob'
import { useApp } from '../lib/appContext'

const KIND_ORDER: { kind: ProviderInfo['kind']; title: string; subtitle: string }[] = [
  {
    kind: 'aggregator',
    title: 'Local & international aggregators',
    subtitle: 'Keyword + location search in local markets. Free developer keys required.'
  },
  { kind: 'government', title: 'Government', subtitle: 'Official public-sector hiring sites.' },
  {
    kind: 'ats',
    title: 'Employer applicant-tracking boards',
    subtitle: 'Direct employer feeds. Each covers only the employers you register below.'
  },
  {
    kind: 'employer_site',
    title: 'Employer career pages',
    subtitle: 'Pages publishing structured JobPosting data.'
  },
  {
    kind: 'remote_board',
    title: 'Remote job boards',
    subtitle: 'Queried only when you search for remote work.'
  },
  {
    kind: 'discovery',
    title: 'Discovery',
    subtitle: 'Finds employer job boards to add; not a job source itself.'
  },
  {
    kind: 'restricted',
    title: 'Restricted sites (manual browsing)',
    subtitle:
      'No authorized API access. PulseApply never scrapes them; it can open a pre-filled search for you.'
  }
]

export default function Sources(): React.JSX.Element {
  const providers = useLoader(() => call('sources:list'))
  const employers = useLoader(() => call('employers:list'))
  return (
    <div>
      <PageHeader
        title="Sources"
        subtitle="Every job PulseApply shows comes from one of these sources. Status reflects real requests, not assumptions."
      />
      <JobInboxCard />
      {KIND_ORDER.map((g) => {
        const list = (providers.data ?? []).filter((p) => p.kind === g.kind)
        if (!list.length) return null
        return (
          <section key={g.kind} className="mb-6">
            <h2 className="text-sm font-semibold text-white">{g.title}</h2>
            <p className="mb-3 text-xs text-slate-500">{g.subtitle}</p>
            <div className="grid gap-3 lg:grid-cols-2">
              {list.map((p) => (
                <ProviderCard key={p.id} p={p} onChange={(l) => providers.setData(l)} />
              ))}
            </div>
          </section>
        )
      })}
      <EmployerRegistry
        employers={employers.data ?? []}
        onChange={(l) => employers.setData(l)}
        reload={employers.reload}
      />
    </div>
  )
}

function ProviderCard({
  p,
  onChange
}: {
  p: ProviderInfo
  onChange: (l: ProviderInfo[]) => void
}): React.JSX.Element {
  const { toast, lastSearch } = useApp()
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const st = PROVIDER_STATUS[p.status]
  const saveCreds = async (): Promise<void> => {
    setBusy(true)
    try {
      onChange(await call('sources:set-credentials', { providerId: p.id, values }))
      setValues({})
      toast(`${p.name} credentials saved (encrypted)`, 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<{ ok: boolean; message: string; sample: string[] } | null>(null)
  const runTest = async (): Promise<void> => {
    setTesting(true)
    try {
      const r = await call('sources:test', { providerId: p.id })
      setTest(r)
      onChange(await call('sources:list'))
    } catch (e) {
      setTest({ ok: false, message: (e as Error).message, sample: [] })
    } finally {
      setTesting(false)
    }
  }
  const manualUrl = p.manualSearchUrlTemplate
    ? p.manualSearchUrlTemplate
        .replace('{q}', encodeURIComponent(lastSearch?.criteria.query ?? ''))
        .replace('{l}', encodeURIComponent(lastSearch?.criteria.location ?? ''))
    : undefined
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-white">{p.name}</p>
          <p className="mt-0.5 text-[11px] text-slate-400">{p.description}</p>
        </div>
        <Badge tone={st.tone}>{st.label}</Badge>
      </div>
      <p className="mt-2 text-[11px] text-slate-300">{p.statusDetail}</p>
      {test && (
        <div
          className={`mt-2 rounded-lg border p-2 text-[11px] ${test.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100' : 'border-rose-500/30 bg-rose-500/10 text-rose-100'}`}
          data-testid={`test-${p.id}`}
        >
          <p>{test.ok ? test.message : `Test failed: ${test.message}`}</p>
          {test.sample.length > 0 && (
            <ul className="mt-1 list-disc pl-4 text-slate-200">
              {test.sample.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <dl className="mt-2 space-y-0.5 text-[11px] text-slate-500">
        <div>Markets: {p.markets}</div>
        <div>Limits: {p.rateLimitNote}</div>
        {p.lastSuccessAt && (
          <div>
            Last successful fetch: {timeAgo(p.lastSuccessAt)} ({p.lastCount ?? 0} jobs)
          </div>
        )}
        {p.lastError && p.status === 'ERROR' && (
          <div className="text-rose-300">Last error: {p.lastError}</div>
        )}
        {p.termsNote && <div>{p.termsNote}</div>}
      </dl>
      {p.credentials.length > 0 && (
        <div className="mt-3 space-y-2 border-t border-white/[0.06] pt-3">
          {p.credentials.map((c) => (
            <div key={c.key}>
              <label className="mb-1 block text-[11px] text-slate-400" htmlFor={c.key}>
                {c.label}
                {p.credentialsConfigured[c.key] && (
                  <span className="ml-1 text-emerald-300">✓ configured</span>
                )}
                {c.help && <span className="ml-1 text-slate-500">— {c.help}</span>}
              </label>
              <Input
                id={c.key}
                type={c.secret ? 'password' : 'text'}
                autoComplete="off"
                placeholder={p.credentialsConfigured[c.key] ? 'Enter a new value to replace' : ''}
                value={values[c.key] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [c.key]: e.target.value }))}
              />
            </div>
          ))}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="primary"
              loading={busy}
              disabled={!Object.values(values).some((v) => v.trim())}
              icon={<KeyRound className="h-3 w-3" />}
              onClick={saveCreds}
            >
              Save credentials
            </Button>
            {Object.values(p.credentialsConfigured).some(Boolean) && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void call('sources:clear-credentials', { providerId: p.id }).then(onChange)
                }
              >
                Remove
              </Button>
            )}
          </div>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        {p.kind !== 'restricted' ? (
          <Toggle
            checked={p.enabled}
            onChange={(v) =>
              void call('sources:set-enabled', { id: p.id, enabled: v }).then(onChange)
            }
            label="Enabled"
          />
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          {!p.manualSearchUrlTemplate && p.kind !== 'discovery' && p.enabled && (
            <Button
              size="sm"
              loading={testing}
              onClick={() => void runTest()}
              title="Sends one small real search using your current criteria"
            >
              Test
            </Button>
          )}
          {p.manualSearchUrlTemplate && (
            <Button
              size="sm"
              variant="primary"
              icon={<Compass className="h-3 w-3" />}
              onClick={() =>
                void call('jobs:browse', { providerId: p.id }).catch((e) =>
                  toast((e as Error).message, 'error')
                )
              }
              title="Opens the site in a PulseApply window with a “Save job” button"
            >
              Browse & Save
            </Button>
          )}
          {manualUrl && (
            <Button
              size="sm"
              icon={<ExternalLink className="h-3 w-3" />}
              onClick={() => void call('jobs:open-external', { url: manualUrl })}
            >
              Open in my browser
            </Button>
          )}
          {p.signupUrl && (
            <Button
              size="sm"
              variant="ghost"
              icon={<ExternalLink className="h-3 w-3" />}
              onClick={() => void call('jobs:open-external', { url: p.signupUrl! })}
            >
              Get a key
            </Button>
          )}
          {p.docsUrl && (
            <Button
              size="sm"
              variant="ghost"
              icon={<ExternalLink className="h-3 w-3" />}
              onClick={() => void call('jobs:open-external', { url: p.docsUrl! })}
            >
              Docs
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function EmployerRegistry({
  employers,
  onChange,
  reload
}: {
  employers: EmployerRecord[]
  onChange: (l: EmployerRecord[]) => void
  reload: () => Promise<void>
}): React.JSX.Element {
  const { toast, lastSearch } = useApp()
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [provider, setProvider] = useState<Exclude<AtsProvider, 'jsonld'>>('greenhouse')
  const [board, setBoard] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<Awaited<ReturnType<typeof discover>>>([])
  const discover = (): Promise<
    {
      provider: Exclude<AtsProvider, 'jsonld'>
      boardId: string
      name?: string
      jobCount?: number
      exampleUrl?: string
      alreadyRegistered: boolean
    }[]
  > => call('employers:discover', lastSearch?.criteria ?? { query: '' })

  const wrap = async (label: string, fn: () => Promise<void>): Promise<void> => {
    setBusy(label)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-cyan-300" /> Employer registry
        </span>
      }
      subtitle="Greenhouse, Lever, Ashby and SmartRecruiters APIs are per-employer: add the employers you want PulseApply to check directly. Identifiers are validated against the live board before saving."
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
            Add from a careers page URL
          </p>
          <Input
            placeholder="https://www.example.com/careers or https://jobs.lever.co/company"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Input
            placeholder="Employer name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button
            variant="primary"
            size="sm"
            loading={busy === 'url'}
            disabled={!url.trim()}
            icon={<Plus className="h-3 w-3" />}
            onClick={() =>
              wrap('url', async () => {
                onChange(await call('employers:add-url', { url, name: name || undefined }))
                setUrl('')
                setName('')
                toast('Employer added', 'success')
              })
            }
          >
            Detect & add
          </Button>
          <p className="text-[10px] text-slate-500">
            PulseApply looks for an embedded ATS board or schema.org JobPosting data, and respects
            the site’s robots.txt.
          </p>
        </div>
        <div className="space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
            Or add a board identifier
          </p>
          <div className="grid grid-cols-[150px_1fr] gap-2">
            <Select
              value={provider}
              onChange={(e) => setProvider(e.target.value as Exclude<AtsProvider, 'jsonld'>)}
            >
              <option value="greenhouse">Greenhouse</option>
              <option value="lever">Lever</option>
              <option value="ashby">Ashby</option>
              <option value="smartrecruiters">SmartRecruiters</option>
            </Select>
            <Input
              placeholder="board token, e.g. acmecoffee"
              value={board}
              onChange={(e) => setBoard(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            loading={busy === 'board'}
            disabled={!board.trim()}
            icon={<Plus className="h-3 w-3" />}
            onClick={() =>
              wrap('board', async () => {
                await call('employers:add-board', { provider, boardId: board.trim() })
                setBoard('')
                await reload()
                toast('Board validated and added', 'success')
              })
            }
          >
            Validate & add
          </Button>
          <div className="pt-2">
            <Button
              size="sm"
              variant="ghost"
              loading={busy === 'discover'}
              icon={<SearchIcon className="h-3 w-3" />}
              onClick={() => wrap('discover', async () => setCandidates(await discover()))}
              title="Uses the Brave Search API (key required on this page) to find employer boards for your last search"
            >
              Discover boards for my last search
            </Button>
          </div>
        </div>
      </div>
      <div className="mt-3">
        <ErrorNote error={error} />
      </div>
      {candidates.length > 0 && (
        <div className="mt-4 rounded-xl border border-cyan-500/20 p-3">
          <p className="mb-2 text-[11px] text-slate-400">
            Validated boards found via search (not added until you choose):
          </p>
          {candidates.map((c) => (
            <div
              key={`${c.provider}:${c.boardId}`}
              className="flex items-center justify-between py-1 text-[11px]"
            >
              <span className="text-slate-200">
                {c.name ?? c.boardId} <Badge>{c.provider}</Badge>{' '}
                <span className="text-slate-500">{c.jobCount ?? '?'} open postings</span>
              </span>
              <Button
                size="sm"
                disabled={c.alreadyRegistered}
                onClick={() =>
                  wrap('add-' + c.boardId, async () => {
                    await call('employers:add-board', {
                      provider: c.provider,
                      boardId: c.boardId,
                      name: c.name
                    })
                    setCandidates((l) =>
                      l.map((x) => (x === c ? { ...x, alreadyRegistered: true } : x))
                    )
                    await reload()
                  })
                }
              >
                {c.alreadyRegistered ? 'Added' : 'Add'}
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="mt-5">
        {employers.length === 0 ? (
          <Empty title="No employers registered">
            Add the career pages of employers near you — coffee chains, warehouses, hospitals,
            hotels — so PulseApply can check their official boards directly.
          </Empty>
        ) : (
          <table className="w-full text-left text-[11px]">
            <thead className="text-slate-500">
              <tr>
                <th className="pb-2 font-medium">Employer</th>
                <th className="pb-2 font-medium">Source</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium">Jobs</th>
                <th className="pb-2 font-medium">Last sync</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {employers.map((e) => (
                <tr key={e.id} className="border-t border-white/[0.05]">
                  <td className="py-2 text-slate-200">{e.name}</td>
                  <td className="text-slate-400" title={e.boardId}>
                    {e.atsProvider === 'jsonld' ? 'career page' : e.atsProvider}
                  </td>
                  <td>
                    <Badge
                      tone={
                        e.status === 'active'
                          ? 'green'
                          : e.status === 'invalid' || e.status === 'error'
                            ? 'red'
                            : 'amber'
                      }
                      title={e.statusDetail}
                    >
                      {e.status}
                    </Badge>
                  </td>
                  <td className="tabular-nums text-slate-300">{e.jobCount ?? '—'}</td>
                  <td className="text-slate-400">{timeAgo(e.lastSyncAt)}</td>
                  <td className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Trash2 className="h-3 w-3" />}
                      aria-label={`Remove ${e.name}`}
                      onClick={() => void call('employers:remove', { id: e.id }).then(onChange)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  )
}
