import { useEffect, useState } from 'react'
import { Brain, Database, FlaskConical, Globe, MonitorSmartphone, Save } from 'lucide-react'
import type { AppInfo, AppSettings, SemanticStatus } from '../../../shared/types'
import {
  Badge,
  Button,
  Card,
  ErrorNote,
  Input,
  Label,
  PageHeader,
  Select,
  Spinner,
  Toggle
} from '../components/ui'
import { call } from '../lib/api'
import { dateTime } from '../lib/format'
import { useApp } from '../lib/appContext'

export default function Settings({
  info,
  onInfo
}: {
  info: AppInfo | null
  onInfo: (i: AppInfo) => void
}): React.JSX.Element {
  const { toast, go } = useApp()
  const [s, setS] = useState<AppSettings | null>(null)
  const [semantic, setSemantic] = useState<SemanticStatus | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    call('settings:get')
      .then(setS)
      .catch((e) => setError(e.message))
    call('matching:status')
      .then(setSemantic)
      .catch(() => undefined)
  }, [])
  if (!s) return <Spinner label="Loading settings…" />

  const save = async (patch: Partial<AppSettings>): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      const next = await call('settings:update', patch)
      setS(next)
      if ('ollama' in patch) setSemantic(await call('matching:status'))
      onInfo(await call('app:info'))
      toast('Settings saved', 'success')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageHeader title="Settings" />
      <ErrorNote error={error} />
      <div className="mt-2 grid gap-5 lg:grid-cols-2">
        <Card
          title={
            <span className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-cyan-300" /> Semantic matching (local, optional)
            </span>
          }
          subtitle="Uses Ollama on this computer for embeddings. No cloud AI or paid API is needed; without it, matching uses deterministic rules only."
          actions={
            semantic && (
              <Badge tone={semantic.active ? 'green' : 'amber'}>
                {semantic.active ? 'Active' : 'Inactive'}
              </Badge>
            )
          }
        >
          <p className="mb-3 text-xs text-slate-300">{semantic?.detail ?? 'Checking…'}</p>
          <div className="space-y-3">
            <Toggle
              checked={s.ollama.enabled}
              onChange={(v) => setS({ ...s, ollama: { ...s.ollama, enabled: v } })}
              label="Use Ollama embeddings when available"
            />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Ollama URL</Label>
                <Input
                  value={s.ollama.baseUrl}
                  onChange={(e) => setS({ ...s, ollama: { ...s.ollama, baseUrl: e.target.value } })}
                />
              </div>
              <div>
                <Label>Embedding model</Label>
                <Input
                  value={s.ollama.model}
                  onChange={(e) => setS({ ...s, ollama: { ...s.ollama, model: e.target.value } })}
                />
              </div>
            </div>
            <p className="text-[11px] text-slate-500">
              Install: ollama.com, then run{' '}
              <code className="text-slate-300">ollama pull nomic-embed-text</code>.
            </p>
            <Button
              size="sm"
              variant="primary"
              loading={saving}
              icon={<Save className="h-3 w-3" />}
              onClick={() => void save({ ollama: s.ollama })}
            >
              Save & test
            </Button>
          </div>
        </Card>

        <Card
          title={
            <span className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-cyan-300" /> Location & freshness
            </span>
          }
        >
          <div className="space-y-3">
            <Toggle
              checked={s.onlineGeocoding}
              onChange={(v) => void save({ onlineGeocoding: v })}
              label="Online geocoding fallback (OpenStreetMap Nominatim) for places not in the offline gazetteer"
            />
            <p className="text-[11px] text-slate-500">
              The offline gazetteer (GeoNames, CC BY 4.0) covers 112,000+ cities worldwide and US
              ZIP codes. Online lookups are cached and limited to 1 per second.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Mark jobs stale after (days unseen)</Label>
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={s.staleAfterDays}
                  onChange={(e) => setS({ ...s, staleAfterDays: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label>Strong-match threshold</Label>
                <Input
                  type="number"
                  min={40}
                  max={100}
                  value={s.matching.strongThreshold}
                  onChange={(e) =>
                    setS({
                      ...s,
                      matching: { ...s.matching, strongThreshold: Number(e.target.value) }
                    })
                  }
                />
              </div>
            </div>
            <Button
              size="sm"
              loading={saving}
              onClick={() =>
                void save({
                  staleAfterDays: s.staleAfterDays,
                  matching: {
                    weights: s.matching.weights,
                    strongThreshold: s.matching.strongThreshold
                  }
                })
              }
            >
              Save
            </Button>
          </div>
        </Card>

        <Card
          title={
            <span className="flex items-center gap-2">
              <MonitorSmartphone className="h-4 w-4 text-cyan-300" /> Application browser
            </span>
          }
          subtitle="PulseApply opens applications in a visible browser. By default it tries Playwright’s Chromium, then Google Chrome, then Microsoft Edge."
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Preferred browser</Label>
              <Select
                value={s.browser.channel ?? 'chromium'}
                onChange={(e) =>
                  setS({
                    ...s,
                    browser: {
                      ...s.browser,
                      channel: e.target.value as 'chromium' | 'chrome' | 'msedge'
                    }
                  })
                }
              >
                <option value="chromium">Playwright Chromium</option>
                <option value="chrome">Google Chrome</option>
                <option value="msedge">Microsoft Edge</option>
              </Select>
            </div>
            <div>
              <Label>Custom executable (optional)</Label>
              <Input
                value={s.browser.executablePath ?? ''}
                placeholder="C:\\Program Files\\…\\chrome.exe"
                onChange={(e) =>
                  setS({
                    ...s,
                    browser: { ...s.browser, executablePath: e.target.value || undefined }
                  })
                }
              />
            </div>
          </div>
          <Button
            size="sm"
            className="mt-3"
            loading={saving}
            onClick={() => void save({ browser: s.browser })}
          >
            Save
          </Button>
        </Card>

        <Card
          title={
            <span className="flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-amber-300" /> Demo mode
            </span>
          }
          subtitle="For practising the application workflow. Demo jobs and the practice form are clearly labelled and never shown in normal mode."
        >
          <Toggle
            checked={s.demoMode}
            onChange={(v) => void save({ demoMode: v })}
            label="Enable demo mode"
          />
          {s.demoMode && (
            <Button
              size="sm"
              className="mt-3"
              onClick={() =>
                void call('demo:seed')
                  .then(() => {
                    toast('Demo job created — open it from Results → All stored jobs', 'success')
                    go('results')
                  })
                  .catch((e) => toast(e.message, 'error'))
              }
            >
              Create a demo job
            </Button>
          )}
        </Card>

        <Card
          className="lg:col-span-2"
          title={
            <span className="flex items-center gap-2">
              <Database className="h-4 w-4 text-cyan-300" /> Data & privacy
            </span>
          }
        >
          {info && (
            <dl className="grid gap-2 text-[11px] md:grid-cols-2">
              <div>
                <dt className="text-slate-500">Data folder</dt>
                <dd className="break-all text-slate-200">{info.userDataPath}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Database</dt>
                <dd className="break-all text-slate-200">{info.dbPath}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Credential encryption</dt>
                <dd className="text-slate-200">
                  {info.secureStorage === 'os'
                    ? 'Operating-system keychain (DPAPI / Keychain / libsecret)'
                    : info.secureStorage === 'basic'
                      ? 'Basic (no OS keyring available on this Linux session)'
                      : 'Unavailable — credentials stored unencrypted'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Version</dt>
                <dd className="text-slate-200">
                  {info.version} {info.isPackaged ? '(packaged)' : '(development)'}
                </dd>
              </div>
              {info.migration && (
                <div className="md:col-span-2">
                  <dt className="text-slate-500">Upgrade from previous version</dt>
                  <dd className="text-slate-200">
                    Imported {dateTime(info.migration.at)} — backup at{' '}
                    <span className="break-all">{info.migration.backupPath}</span>
                    <ul className="mt-1 list-disc pl-5 text-slate-400">
                      {info.migration.notes.map((n) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
              )}
            </dl>
          )}
        </Card>
      </div>
    </div>
  )
}
