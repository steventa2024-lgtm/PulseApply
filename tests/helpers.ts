import fs from 'fs'
import os from 'os'
import path from 'path'
import { createServices, type ServiceOptions, type Services } from '../src/main/app/services'
import type { SecretCipher } from '../src/main/services/persistence/secrets'
import type { CandidateProfile } from '../src/shared/types'
import { emptyProfile } from '../src/main/services/persistence/candidateRepo'

export const RESOURCES = path.join(__dirname, '..', 'resources')
export const CHROMIUM = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  process.env.PULSEAPPLY_CHROMIUM_PATH
].find((p) => p && fs.existsSync(p))

/** Reversible stand-in for Electron safeStorage (marks values so tests can see they were encrypted). */
export class FakeCipher implements SecretCipher {
  readonly level = 'os' as const
  encrypt(plain: string): string {
    return 'enc:' + Buffer.from(plain).toString('base64')
  }
  decrypt(stored: string): string {
    if (!stored.startsWith('enc:')) throw new Error('not encrypted')
    return Buffer.from(stored.slice(4), 'base64').toString()
  }
}

export function tmpDir(prefix = 'pulseapply-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

export type Route = (
  url: URL,
  init: RequestInit | undefined
) => Response | Promise<Response> | undefined

/** Fake fetch that routes by URL; unknown URLs fail like a blocked network. */
export function fakeFetch(routes: Route[], log: string[] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    )
    log.push(`${init?.method ?? 'GET'} ${url.href}`)
    if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    for (const r of routes) {
      const res = await r(url, init)
      if (res) return res
    }
    throw new TypeError(`fetch failed (no route for ${url.hostname})`)
  }) as typeof fetch
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  })
}

export async function makeServices(
  overrides: Partial<ServiceOptions> = {}
): Promise<{ svc: Services; dir: string; events: { channel: string; payload: unknown }[] }> {
  const dir = overrides.userDataDir ?? tmpDir()
  const events: { channel: string; payload: unknown }[] = []
  const svc = await createServices({
    userDataDir: dir,
    resourcesDir: RESOURCES,
    cipher: new FakeCipher(),
    emit: (channel, payload) => events.push({ channel, payload }),
    appVersion: 'test',
    fetchImpl: fakeFetch([]),
    ...overrides
  })
  svc.store.settings.update({
    onlineGeocoding: false,
    ollama: { enabled: false, baseUrl: 'http://127.0.0.1:11434', model: 'nomic-embed-text' }
  })
  return { svc, dir, events }
}

export function warehouseBaristaProfile(): CandidateProfile {
  const p = emptyProfile()
  p.fullName = { value: 'Jordan Rivera', confidence: 1, source: 'user', confirmed: true }
  p.email = {
    value: 'jordan.rivera.test@example.com',
    confidence: 1,
    source: 'user',
    confirmed: true
  }
  p.phone = { value: '(562) 555-0147', confidence: 1, source: 'user', confirmed: true }
  p.location = { value: 'Lakewood, CA', confidence: 1, source: 'user', confirmed: true }
  p.workHistory = [
    {
      id: 'w1',
      title: 'Warehouse Associate',
      company: 'Harborline Distribution',
      current: true,
      months: 30,
      startDate: '2024-03',
      confidence: 1,
      confirmed: true,
      summary:
        'Order picking, packing, RF scanner, pallet jack, cycle counts, shipping and receiving, loading trucks'
    },
    {
      id: 'w2',
      title: 'Barista',
      company: 'Bluebird Coffee',
      current: false,
      months: 33,
      startDate: '2018-06',
      endDate: '2021-02',
      confidence: 1,
      confirmed: true,
      summary: 'Espresso, milk steaming, POS and cash handling, food safety, opening and closing'
    }
  ]
  p.skills = [
    'Inventory Management',
    'Order Picking',
    'RF Scanner',
    'Pallet Jack',
    'Espresso',
    'Cash Handling',
    'Customer Service',
    'Teamwork',
    'POS Systems'
  ].map((name) => ({
    name,
    source: 'user' as const,
    confirmed: true
  }))
  p.certifications = [{ name: 'California Food Handler Card', source: 'user', confirmed: true }]
  p.preferences.location = 'Lakewood, CA'
  return p
}

export function frontendProfile(): CandidateProfile {
  const p = emptyProfile()
  p.fullName = { value: 'Sam Lee', confidence: 1, source: 'user', confirmed: true }
  p.email = { value: 'sam.lee.dev@example.org', confidence: 1, source: 'user', confirmed: true }
  p.location = { value: 'Austin, TX', confidence: 1, source: 'user', confirmed: true }
  p.workHistory = [
    {
      id: 'w1',
      title: 'Junior Frontend Developer',
      company: 'Pixelworks',
      current: true,
      months: 18,
      confidence: 1,
      confirmed: true,
      summary: 'React, TypeScript, Tailwind, Jest, accessibility'
    }
  ]
  p.skills = ['JavaScript', 'TypeScript', 'React', 'HTML', 'CSS', 'Git', 'Tailwind'].map(
    (name) => ({ name, source: 'user' as const, confirmed: true })
  )
  return p
}
