import dns from 'dns/promises'
import net from 'net'

/**
 * URL validation used before (a) storing a job/apply URL, (b) opening it in the
 * system browser, (c) navigating the automation browser, and (d) fetching a
 * user-supplied careers page from the main process (SSRF protection).
 */

export function parseHttpUrl(value: string | undefined | null): URL | null {
  if (!value || typeof value !== 'string' || value.length > 2048) return null
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username || url.password) return null
  if (!url.hostname || url.hostname.length > 253) return null
  return url
}

function isPrivateIPv4(ip: string): boolean {
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  return (
    p[0] === 0 ||
    p[0] === 10 ||
    p[0] === 127 ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
    (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 192 && p[1] === 0 && p[2] === 0) ||
    (p[0] === 198 && (p[1] === 18 || p[1] === 19)) ||
    p[0] >= 224
  )
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  if (lower === '::' || lower === '::1') return true
  if (
    lower.startsWith('fe80') ||
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    lower.startsWith('ff')
  )
    return true
  const mapped = /::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower)
  if (mapped) return isPrivateIPv4(mapped[1])
  return false
}

export function isPrivateAddress(ip: string): boolean {
  const v = net.isIP(ip)
  if (v === 4) return isPrivateIPv4(ip)
  if (v === 6) return isPrivateIPv6(ip)
  return true
}

const LOCAL_HOSTNAMES =
  /^(localhost|localhost\.localdomain|.*\.local|.*\.internal|.*\.lan|.*\.home|.*\.corp)$/i

/** Synchronous check suitable for URLs from job providers and the renderer. */
export function isPublicHttpUrl(
  value: string | undefined | null,
  opts: { requireHttps?: boolean } = {}
): boolean {
  const url = parseHttpUrl(value)
  if (!url) return false
  if (opts.requireHttps && url.protocol !== 'https:') return false
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (LOCAL_HOSTNAMES.test(host)) return false
  if (net.isIP(host) && isPrivateAddress(host)) return false
  if (url.port && !['80', '443', '8080', '8443'].includes(url.port)) return false
  return true
}

/**
 * Resolves the hostname and rejects private/loopback/link-local targets.
 * Use before the main process fetches a URL that came from the user.
 */
export async function assertPublicUrl(value: string): Promise<URL> {
  if (!isPublicHttpUrl(value)) throw new Error('URL must be a public http(s) address')
  const url = parseHttpUrl(value)!
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (!net.isIP(host)) {
    const addrs = await dns.lookup(host, { all: true }).catch(() => [])
    if (addrs.length === 0) throw new Error(`Could not resolve ${host}`)
    if (addrs.some((a) => isPrivateAddress(a.address)))
      throw new Error('URL resolves to a private network address')
  }
  return url
}

/** Registrable-ish domain used to compare employer and apply destinations. */
export function baseDomain(value: string | undefined): string | undefined {
  const url = parseHttpUrl(value)
  if (!url) return undefined
  const parts = url.hostname
    .toLowerCase()
    .replace(/^www\./, '')
    .split('.')
  if (parts.length <= 2) return parts.join('.')
  const sld = parts[parts.length - 2]
  // co.uk, com.au, co.jp, ...
  if (
    sld.length <= 3 &&
    ['co', 'com', 'org', 'net', 'gov', 'ac', 'edu', 'ne', 'or'].includes(sld)
  ) {
    return parts.slice(-3).join('.')
  }
  return parts.slice(-2).join('.')
}

/** Strips tracking parameters so equal postings compare equal. */
export function canonicalizeUrl(value: string | undefined): string | undefined {
  const url = parseHttpUrl(value)
  if (!url) return undefined
  url.hash = ''
  for (const key of [...url.searchParams.keys()]) {
    if (
      /^(utm_|ref$|refs?rc$|source$|src$|gh_src$|lever-source|lever-origin|trk|trackingid|fbclid|gclid|mc_)/i.test(
        key
      )
    ) {
      url.searchParams.delete(key)
    }
  }
  url.hostname = url.hostname.toLowerCase()
  let s = url.toString()
  if (s.endsWith('/') && url.pathname !== '/') s = s.slice(0, -1)
  return s
}
