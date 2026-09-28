import type { HttpClient } from '../adapters/http'

/**
 * Minimal robots.txt support (RFC 9309 subset): user-agent groups, Allow /
 * Disallow with longest-match precedence and `*` / `$` wildcards, and Sitemap
 * directives. Pages disallowed for PulseApply or `*` are never fetched.
 */
export interface RobotsRules {
  allow: string[]
  disallow: string[]
  sitemaps: string[]
}

export function parseRobots(text: string, agent = 'pulseapply'): RobotsRules {
  const groups: { agents: string[]; allow: string[]; disallow: string[] }[] = []
  const sitemaps: string[] = []
  let current: { agents: string[]; allow: string[]; disallow: string[] } | null = null
  let lastWasAgent = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim()
    if (!line) continue
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line)
    if (!m) continue
    const key = m[1].toLowerCase()
    const value = m[2].trim()
    if (key === 'sitemap') {
      sitemaps.push(value)
      continue
    }
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], allow: [], disallow: [] }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    if (!current) continue
    if (key === 'allow' && value) current.allow.push(value)
    if (key === 'disallow' && value) current.disallow.push(value)
  }
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && agent.includes(a)))
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'))
  return {
    allow: chosen.flatMap((g) => g.allow),
    disallow: chosen.flatMap((g) => g.disallow),
    sitemaps
  }
}

function toRegex(rule: string): RegExp {
  const anchored = rule.endsWith('$')
  const body = (anchored ? rule.slice(0, -1) : rule)
    .split('*')
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp('^' + body + (anchored ? '$' : ''))
}

export function isAllowed(rules: RobotsRules, pathAndQuery: string): boolean {
  let best: { len: number; allow: boolean } | null = null
  for (const r of rules.allow) {
    if (toRegex(r).test(pathAndQuery) && (!best || r.length >= best.len)) best = { len: r.length, allow: true }
  }
  for (const r of rules.disallow) {
    if (toRegex(r).test(pathAndQuery) && (!best || r.length > best.len)) best = { len: r.length, allow: false }
  }
  return best ? best.allow : true
}

const cache = new Map<string, { rules: RobotsRules; at: number }>()

export async function robotsFor(http: HttpClient, origin: string, signal?: AbortSignal): Promise<RobotsRules> {
  const hit = cache.get(origin)
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.rules
  let rules: RobotsRules = { allow: [], disallow: [], sitemaps: [] }
  try {
    const res = await http.request({ url: `${origin}/robots.txt`, signal, timeoutMs: 10_000, retries: 1, acceptStatuses: [401, 403, 404, 410], maxBytes: 512 * 1024 })
    if (res.status === 401 || res.status === 403) {
      rules = { allow: [], disallow: ['/'], sitemaps: [] }
    } else if (res.status === 200) {
      rules = parseRobots(res.text)
    }
  } catch {
    // Unreachable robots.txt: treat as no restrictions (RFC 9309 §2.3.1.3 for 4xx; network errors are rare here).
  }
  cache.set(origin, { rules, at: Date.now() })
  return rules
}
