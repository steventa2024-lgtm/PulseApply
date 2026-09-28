import type { Salary } from './types'

/** Formats a provider-stated salary. Missing salary is always "Not disclosed" — never estimated. */
export function formatSalary(s: Salary | undefined): string {
  if (!s || (s.min === undefined && s.max === undefined)) return 'Not disclosed'
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', {
      style: s.currency ? 'currency' : 'decimal',
      currency: s.currency ?? undefined,
      maximumFractionDigits: n < 1000 ? 2 : 0
    }).format(n)
  const range = s.min !== undefined && s.max !== undefined && s.max !== s.min ? `${fmt(s.min)} – ${fmt(s.max)}` : fmt((s.min ?? s.max)!)
  return s.period ? `${range} / ${s.period}` : range
}
