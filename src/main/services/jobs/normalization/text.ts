/**
 * Converts untrusted provider HTML into plain text. Output is only ever
 * rendered as text in the UI (never as HTML), so this is about readability;
 * scripts, styles and other executable content are dropped entirely.
 */
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  bull: '•',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  middot: '·',
  eacute: 'é',
  egrave: 'è',
  aacute: 'á',
  oacute: 'ó',
  uacute: 'ú',
  iacute: 'í',
  ntilde: 'ñ',
  uuml: 'ü',
  ouml: 'ö',
  auml: 'ä',
  szlig: 'ß',
  copy: '©',
  reg: '®',
  trade: '™',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  deg: '°',
  times: '×'
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code =
        e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ''
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

const TAG = /<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>/i
const ESCAPED_TAG = /&(?:amp;)*lt;\/?[a-z][a-z0-9-]*(?:\s[^&]*?)?\/?&(?:amp;)*gt;/i

function stripTags(html: string): string {
  return html
    .replace(/<(script|style|noscript|iframe|object|embed|svg|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '\n• ')
    .replace(
      /<\s*\/(p|div|h[1-6]|ul|ol|li|tr|section|article|header|footer|blockquote)\s*>/gi,
      '\n'
    )
    .replace(/<\s*(p|div|h[1-6]|ul|ol|tr|section|article|blockquote)(\s[^>]*)?>/gi, '\n')
    .replace(/<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>/gi, ' ')
}

/** True when text still contains markup (raw or entity-escaped tags). */
export function looksLikeHtml(text: string): boolean {
  return TAG.test(text) || ESCAPED_TAG.test(text)
}

/**
 * Converts provider HTML to plain text. Handles HTML that was escaped once or
 * several times (Greenhouse `content`, some RSS feeds) and HTML nested inside
 * escaped HTML, so no tags or entities ever reach the UI.
 */
export function htmlToText(html: string | undefined, maxLength = 20_000): string {
  if (!html) return ''
  let s = html
  for (let pass = 0; pass < 4; pass++) {
    s = decodeEntities(stripTags(s))
    if (!looksLikeHtml(s)) break
  }
  s = s
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return s.length > maxLength ? s.slice(0, maxLength) + '…' : s
}

export function cleanInline(s: string | undefined, max = 300): string {
  if (!s) return ''
  const t = decodeEntities(s.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
  return t.length > max ? t.slice(0, max) : t
}

const SECTION_HEAD =
  /^(?:#+\s*)?(what you'?ll do|what you will do|responsibilities|duties|key responsibilities|essential duties|your role|the role|job duties|requirements|qualifications|what we'?re looking for|what you'?ll need|who you are|you have|must have|minimum qualifications|basic qualifications|required qualifications|required skills|preferred qualifications|nice to have|bonus points|preferred|pluses|benefits|perks|about us|about the company|compensation|pay)\b.*$/i

export interface Sections {
  responsibilities: string[]
  required: string[]
  preferred: string[]
  other: string[]
}

/** Splits a plain-text description into sections by common headings. */
export function splitSections(text: string): Sections {
  const out: Sections = { responsibilities: [], required: [], preferred: [], other: [] }
  let bucket: keyof Sections = 'other'
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const head = SECTION_HEAD.exec(line.replace(/:$/, ''))
    if (head && line.length < 80) {
      const h = head[1].toLowerCase()
      if (/responsib|duties|what you|your role|the role/.test(h)) bucket = 'responsibilities'
      else if (/preferred|nice to have|bonus|pluses/.test(h)) bucket = 'preferred'
      else if (
        /requirement|qualification|looking for|need|who you are|you have|must have|required/.test(h)
      )
        bucket = 'required'
      else bucket = 'other'
      continue
    }
    out[bucket].push(line.replace(/^[•\-*·]\s*/, ''))
  }
  return out
}
