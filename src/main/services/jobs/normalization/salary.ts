import type { Salary, SalaryPeriod } from '../../../../shared/types'

const CURRENCY_SYMBOLS: Record<string, string> = { $: 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₹': 'INR', 'C$': 'CAD', 'A$': 'AUD', 'CA$': 'CAD', 'AU$': 'AUD' }

export function periodFromText(text: string | undefined): SalaryPeriod | undefined {
  if (!text) return undefined
  const t = text.toLowerCase()
  if (/\b(hour|hr|hourly|\/h\b|per h\b|ph\b)/.test(t)) return 'hour'
  if (/\b(day|daily|per diem)\b/.test(t)) return 'day'
  if (/\b(week|weekly|wk)\b/.test(t)) return 'week'
  if (/\b(month|monthly|mo)\b/.test(t)) return 'month'
  if (/\b(year|yearly|annual|annually|annum|yr|pa|p\.a\.)\b/.test(t)) return 'year'
  return undefined
}

function toNumber(raw: string, k: boolean): number | undefined {
  let s = raw.trim()
  // "45.000" (de) vs "45,000" (en) vs "22.50"
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '')
  s = s.replace(/,(?=\d{3}\b)/g, '').replace(/,/g, '.')
  const n = Number(s)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return k ? n * 1000 : n
}

/**
 * Parses an explicitly stated pay range ("$20.00 - $24.50 / hr",
 * "USD 120,000–150,000 per year", "€50k-60k"). Returns undefined unless a
 * currency marker or pay period is present — bare numbers are not salaries.
 */
export function parseSalaryText(text: string | undefined, defaultCurrency?: string): Salary | undefined {
  if (!text) return undefined
  const re =
    /(C\$|A\$|CA\$|AU\$|[$€£¥₹]|\b(?:USD|EUR|GBP|CAD|AUD|INR|CHF|SEK|NOK|DKK|PLN|NZD|SGD|MXN|BRL|JPY)\b)?\s?(\d{1,3}(?:[,.]\d{3})+|\d+(?:[.,]\d{1,2})?)\s*(k|K)?\s*(?:(?:-|–|—|to|bis)\s*(C\$|A\$|[$€£¥₹]|\b(?:USD|EUR|GBP|CAD|AUD)\b)?\s?(\d{1,3}(?:[,.]\d{3})+|\d+(?:[.,]\d{1,2})?)\s*(k|K)?)?\s*(?:(?:\/|per|an|a)\s*)?(hour|hr|hourly|h\b|day|daily|week|weekly|month|monthly|year|yearly|annual(?:ly)?|annum|yr)?/i
  const m = re.exec(text)
  if (!m) return undefined
  const cur = m[1] ?? m[4]
  const periodWord = m[7]
  if (!cur && !periodWord) return undefined
  const min = toNumber(m[2], !!m[3] || (!!m[6] && !m[3] && Number(m[2]) < 1000 && Number(m[5]) < 1000))
  const max = m[5] ? toNumber(m[5], !!m[6] || !!m[3]) : undefined
  if (min === undefined) return undefined
  const currency = cur ? (CURRENCY_SYMBOLS[cur] ?? cur.toUpperCase()) : defaultCurrency
  let period = periodFromText(periodWord) ?? periodFromText(text)
  if (!period) period = min < 300 ? 'hour' : min >= 10_000 ? 'year' : undefined
  return { min, max: max && max >= min ? max : undefined, currency, period, raw: m[0].trim() }
}

/** Converts a salary to an approximate annual figure for comparison only. */
export function annualize(value: number, period: SalaryPeriod | undefined): number | undefined {
  switch (period) {
    case 'hour':
      return value * 2080
    case 'day':
      return value * 260
    case 'week':
      return value * 52
    case 'month':
      return value * 12
    case 'year':
      return value
    default:
      return undefined
  }
}

export { formatSalary } from '../../../../shared/format'
