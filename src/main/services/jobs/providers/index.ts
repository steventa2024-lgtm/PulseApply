import type { JobProvider } from './types'
import { arbeitnowProvider, himalayasProvider, jobicyProvider, remoteOkProvider, remotiveProvider } from './remoteBoards'
import { adzunaProvider, joobleProvider, usajobsProvider } from './aggregators'
import { ashbyProvider, greenhouseProvider, leverProvider, smartRecruitersProvider } from './ats'
import { careerPagesProvider } from './careerPages'
import { glassdoorProvider, indeedProvider, linkedinProvider, zipRecruiterProvider } from './restricted'

/** Licensed web-search API used to discover employer ATS boards (not a job source itself). */
export const braveDiscoveryProvider: JobProvider = {
  id: 'brave',
  name: 'Brave Search API (employer discovery)',
  kind: 'discovery',
  description: 'Finds public employer job boards (Greenhouse, Lever, Ashby, SmartRecruiters) for an occupation and city so you can add them.',
  markets: 'Worldwide web index',
  docsUrl: 'https://api-dashboard.search.brave.com/app/documentation/web-search/get-started',
  signupUrl: 'https://brave.com/search/api/',
  termsNote: 'Licensed search API (free tier available). Search results are only used to suggest employer boards; job data always comes from the boards themselves.',
  credentials: [{ key: 'brave.apiKey', label: 'Subscription token', secret: true, required: true }],
  defaultEnabled: true,
  rateLimit: { minIntervalMs: 1100, note: '1 request/second (free tier).' },
  cacheTtlMs: 24 * 60 * 60_000,
  timeoutMs: 15_000,
  hosts: ['api.search.brave.com'],
  supports: () => ({ ok: false, reason: 'Used by employer discovery, not direct job search' }),
  isConfigured: (secret) => !!secret('brave.apiKey'),
  fetch: async () => [],
  normalize: () => null
}

export const ALL_PROVIDERS: JobProvider[] = [
  adzunaProvider,
  joobleProvider,
  usajobsProvider,
  greenhouseProvider,
  leverProvider,
  ashbyProvider,
  smartRecruitersProvider,
  careerPagesProvider,
  remoteOkProvider,
  remotiveProvider,
  arbeitnowProvider,
  jobicyProvider,
  himalayasProvider,
  braveDiscoveryProvider,
  linkedinProvider,
  indeedProvider,
  zipRecruiterProvider,
  glassdoorProvider
]

export function providerById(id: string): JobProvider | undefined {
  return ALL_PROVIDERS.find((p) => p.id === id)
}
