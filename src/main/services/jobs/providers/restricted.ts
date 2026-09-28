import type { JobProvider } from './types'

/**
 * Sources without an open job-search API. PulseApply never scrapes them or
 * automates their logged-in pages. They are listed so the user can see their
 * status and open a pre-filled search to browse manually ("user-assisted").
 */
function manualProvider(p: Omit<JobProvider, 'supports' | 'isConfigured' | 'fetch' | 'normalize' | 'credentials' | 'defaultEnabled' | 'rateLimit' | 'cacheTtlMs' | 'timeoutMs' | 'hosts' | 'kind' | 'manualOnly'>): JobProvider {
  return {
    ...p,
    kind: 'restricted',
    credentials: [],
    defaultEnabled: true,
    rateLimit: { minIntervalMs: 0, note: 'Not queried automatically.' },
    cacheTtlMs: 0,
    timeoutMs: 0,
    hosts: [],
    manualOnly: true,
    supports: () => ({ ok: false, reason: 'No authorized API access; open the search in your browser instead' }),
    isConfigured: () => false,
    fetch: async () => [],
    normalize: () => null
  }
}

export const linkedinProvider = manualProvider({
  id: 'linkedin',
  name: 'LinkedIn Jobs',
  description: 'LinkedIn’s job APIs are limited to approved partners; automated scraping violates its terms.',
  markets: 'Worldwide (manual browsing)',
  docsUrl: 'https://learn.microsoft.com/en-us/linkedin/talent/job-postings',
  termsNote: 'Requires a LinkedIn partner agreement for API access. PulseApply opens a pre-filled search for you to browse.',
  manualSearchUrlTemplate: 'https://www.linkedin.com/jobs/search/?keywords={q}&location={l}'
})

export const indeedProvider = manualProvider({
  id: 'indeed',
  name: 'Indeed',
  description: 'Indeed’s public job-search (Publisher) API is closed to new integrations; scraping is prohibited.',
  markets: 'Worldwide (manual browsing)',
  docsUrl: 'https://docs.indeed.com/',
  termsNote: 'Licensed access only. PulseApply opens a pre-filled Indeed search for you to browse.',
  manualSearchUrlTemplate: 'https://www.indeed.com/jobs?q={q}&l={l}'
})

export const zipRecruiterProvider = manualProvider({
  id: 'ziprecruiter',
  name: 'ZipRecruiter',
  description: 'Job-search API available only to approved partners.',
  markets: 'US, Canada, UK (manual browsing)',
  termsNote: 'Partner access only. PulseApply opens a pre-filled search for you to browse.',
  manualSearchUrlTemplate: 'https://www.ziprecruiter.com/jobs-search?search={q}&location={l}'
})

export const glassdoorProvider = manualProvider({
  id: 'glassdoor',
  name: 'Glassdoor',
  description: 'No public job-search API.',
  markets: 'Worldwide (manual browsing)',
  termsNote: 'PulseApply opens a pre-filled search for you to browse.',
  manualSearchUrlTemplate: 'https://www.glassdoor.com/Job/jobs.htm?sc.keyword={q}&locKeyword={l}'
})

/** Indeed uses country-specific domains. */
export function indeedDomain(country: string | undefined): string {
  const map: Record<string, string> = {
    US: 'www.indeed.com', GB: 'uk.indeed.com', CA: 'ca.indeed.com', AU: 'au.indeed.com', DE: 'de.indeed.com', FR: 'fr.indeed.com',
    IN: 'in.indeed.com', IE: 'ie.indeed.com', NL: 'nl.indeed.com', ES: 'es.indeed.com', IT: 'it.indeed.com', MX: 'mx.indeed.com',
    BR: 'br.indeed.com', NZ: 'nz.indeed.com', SG: 'sg.indeed.com', ZA: 'za.indeed.com', JP: 'jp.indeed.com', CH: 'ch.indeed.com',
    AT: 'at.indeed.com', BE: 'be.indeed.com', PL: 'pl.indeed.com', SE: 'se.indeed.com'
  }
  return map[country ?? 'US'] ?? 'www.indeed.com'
}

export function manualSearchUrl(provider: JobProvider, query: string, location: string, country?: string): string | undefined {
  if (!provider.manualSearchUrlTemplate) return undefined
  let url = provider.manualSearchUrlTemplate.replace('{q}', encodeURIComponent(query)).replace('{l}', encodeURIComponent(location))
  if (provider.id === 'indeed') url = url.replace('www.indeed.com', indeedDomain(country))
  return url
}
