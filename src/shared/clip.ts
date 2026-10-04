/**
 * Reads the job the user is looking at in the Browse & Save window.
 *
 * Self-contained on purpose (no imports, no outer references): the preload
 * script calls it directly, and tests serialize it with toString() and run it
 * in a real browser page. It only reads the page the user opened; it never
 * navigates, scrolls, clicks or loads anything.
 */
export interface ClippedJob {
  url: string
  site: string
  title?: string
  company?: string
  location?: string
  description?: string
  salary?: string
  employmentType?: string
  postedAt?: string
  remote?: boolean
  /** schema.org JobPosting objects found on the page (JSON-LD). */
  jsonLd: Record<string, unknown>[]
  /** How the fields were found, for the user's information. */
  method: 'json-ld' | 'page' | 'partial'
}

export function readJobFromPage(d: Document, href: string): ClippedJob {
  const text = (sel: string): string | undefined => {
    const el = d.querySelector(sel) as HTMLElement | null
    const t = el ? (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : ''
    return t || undefined
  }
  const longText = (sel: string): string | undefined => {
    const el = d.querySelector(sel) as HTMLElement | null
    const t = el ? (el.innerText || el.textContent || '').trim() : ''
    return t ? t.slice(0, 20000) : undefined
  }
  const meta = (name: string): string | undefined => {
    const el = d.querySelector(`meta[property="${name}"], meta[name="${name}"]`)
    const c = el ? (el.getAttribute('content') || '').trim() : ''
    return c || undefined
  }

  let url = href
  let host = ''
  try {
    const u = new URL(href)
    host = u.hostname.replace(/^www\./, '')
    // Search pages show the selected job in a side panel: point at the job itself.
    const liId = u.searchParams.get('currentJobId')
    if (/linkedin\.com$/.test(host) && liId) url = `https://www.linkedin.com/jobs/view/${liId}/`
    const vjk = u.searchParams.get('vjk') || u.searchParams.get('jk')
    if (/(^|\.)indeed\.[a-z.]+$/.test(host) && vjk) url = `${u.origin}/viewjob?jk=${vjk}`
  } catch {
    // keep href
  }

  // 1. Structured data (what Google for Jobs reads).
  const jsonLd: Record<string, unknown>[] = []
  const scripts = d.querySelectorAll('script[type="application/ld+json"]')
  for (let i = 0; i < scripts.length; i++) {
    try {
      const parsed = JSON.parse(scripts[i].textContent || '')
      const stack: unknown[] = Array.isArray(parsed) ? parsed : [parsed]
      while (stack.length) {
        const n = stack.pop() as Record<string, unknown> | null
        if (!n || typeof n !== 'object') continue
        if (Array.isArray(n['@graph'])) stack.push(...(n['@graph'] as unknown[]))
        const t = n['@type']
        if (t === 'JobPosting' || (Array.isArray(t) && t.indexOf('JobPosting') >= 0)) jsonLd.push(n)
      }
    } catch {
      // ignore malformed blocks
    }
  }

  // 2. Visible page, using each site's current layout, then generic fallbacks.
  const first = (...sels: string[]): string | undefined => {
    for (const s of sels) {
      const v = text(s)
      if (v) return v
    }
    return undefined
  }
  const firstLong = (...sels: string[]): string | undefined => {
    for (const s of sels) {
      const v = longText(s)
      if (v) return v
    }
    return undefined
  }
  let title: string | undefined
  let company: string | undefined
  let location: string | undefined
  let description: string | undefined
  let salary: string | undefined
  let employmentType: string | undefined

  if (/linkedin\.com$/.test(host)) {
    title = first(
      '.job-details-jobs-unified-top-card__job-title',
      '.jobs-unified-top-card__job-title',
      'h1.top-card-layout__title',
      '.topcard__title',
      'h1'
    )
    company = first(
      '.job-details-jobs-unified-top-card__company-name',
      '.jobs-unified-top-card__company-name',
      'a.topcard__org-name-link',
      '.topcard__flavor a',
      '.topcard__org-name-link'
    )
    const primary = first(
      '.job-details-jobs-unified-top-card__primary-description-container',
      '.job-details-jobs-unified-top-card__tertiary-description-container',
      '.jobs-unified-top-card__bullet',
      '.topcard__flavor--bullet'
    )
    location = primary ? primary.split('·')[0].trim() : undefined
    description = firstLong(
      '#job-details',
      '.jobs-description__content',
      '.show-more-less-html__markup',
      '.description__text'
    )
  } else if (/(^|\.)indeed\.[a-z.]+$/.test(host)) {
    title = first(
      'h1.jobsearch-JobInfoHeader-title',
      '[data-testid="jobsearch-JobInfoHeader-title"]',
      '.jobsearch-JobInfoHeader-title',
      'h2.jobsearch-JobInfoHeader-title',
      'h1'
    )
    company = first(
      '[data-testid="inlineHeader-companyName"]',
      '[data-company-name="true"]',
      '.jobsearch-CompanyInfoContainer a',
      '.jobsearch-InlineCompanyRating div'
    )
    location = first(
      '[data-testid="inlineHeader-companyLocation"]',
      '[data-testid="job-location"]',
      '[data-testid="jobsearch-JobInfoHeader-companyLocation"]',
      '.jobsearch-JobInfoHeader-subtitle > div:last-child'
    )
    salary = first(
      '#salaryInfoAndJobType span',
      '[data-testid="jobsearch-OtherJobDetailsContainer"] span'
    )
    description = firstLong('#jobDescriptionText', '.jobsearch-jobDescriptionText')
  } else if (/glassdoor\.[a-z.]+$/.test(host)) {
    title = first('[data-test="job-title"]', 'h1')
    company = first('[data-test="employer-name"]', '[data-test="employerName"]')
    location = first('[data-test="location"]', '[data-test="emp-location"]')
    salary = first('[data-test="detailSalary"]')
    description = firstLong('[class*="JobDetails_jobDescription"]', '#JobDescriptionContainer')
  } else if (/ziprecruiter\.com$/.test(host)) {
    title = first('h1.job_title', 'h1')
    company = first(
      '.hiring_company_text a',
      'a.hiring_company',
      '[data-testid="job-details-company"]'
    )
    location = first('.location_text', '[data-testid="job-details-location"]')
    description = firstLong('.job_description', '.jobDescriptionSection')
  }

  title = title ?? first('h1') ?? meta('og:title')
  description = description ?? meta('og:description') ?? meta('description')

  const remote = /\bremote\b|work from home/i.test(`${location ?? ''} ${title ?? ''}`)
  const method: ClippedJob['method'] = jsonLd.length
    ? 'json-ld'
    : title && company && location
      ? 'page'
      : 'partial'
  return {
    url,
    site: host,
    title,
    company,
    location,
    description,
    salary,
    employmentType,
    remote,
    jsonLd: jsonLd.slice(0, 3),
    method
  }
}
