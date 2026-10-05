import type { ApplyOption } from '../../../../shared/types'
import { canonicalizeUrl, isPublicHttpUrl } from '../verification/urlSafety'

const BOARD_NAMES: [RegExp, string][] = [
  [/(^|\.)linkedin\.com$/, 'LinkedIn'],
  [/(^|\.)indeed\.[a-z.]+$/, 'Indeed'],
  [/(^|\.)glassdoor\.[a-z.]+$/, 'Glassdoor'],
  [/(^|\.)ziprecruiter\.com$/, 'ZipRecruiter'],
  [/(^|\.)monster\.com$/, 'Monster'],
  [/(^|\.)simplyhired\.com$/, 'SimplyHired'],
  [/(^|\.)snagajob\.com$/, 'Snagajob'],
  [/(^|\.)careerbuilder\.com$/, 'CareerBuilder'],
  [/(^|\.)talent\.com$/, 'Talent.com'],
  [/(^|\.)jooble\.org$/, 'Jooble'],
  [/(^|\.)adzuna\.[a-z.]+$/, 'Adzuna'],
  [/(^|\.)usajobs\.gov$/, 'USAJOBS']
]

export function isJobBoard(url: string): boolean {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '')
    return BOARD_NAMES.some(([re]) => re.test(h)) || /(^|\.)google\.com$/.test(h)
  } catch {
    return false
  }
}

export function siteLabel(url: string, fallback?: string): string {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '')
    return BOARD_NAMES.find(([re]) => re.test(h))?.[1] ?? fallback ?? h
  } catch {
    return fallback ?? url
  }
}

/** Merges apply options, removing duplicates and unsafe links; employer sites first. */
export function mergeApplyOptions(
  ...lists: (ApplyOption[] | undefined)[]
): ApplyOption[] | undefined {
  const seen = new Map<string, ApplyOption>()
  for (const list of lists)
    for (const o of list ?? []) {
      if (!o?.url || !isPublicHttpUrl(o.url)) continue
      const key = canonicalizeUrl(o.url) ?? o.url
      const prev = seen.get(key)
      seen.set(key, prev ? { ...prev, direct: prev.direct || o.direct } : o)
    }
  const out = [...seen.values()].sort((a, b) => Number(b.direct) - Number(a.direct))
  return out.length ? out.slice(0, 12) : undefined
}
