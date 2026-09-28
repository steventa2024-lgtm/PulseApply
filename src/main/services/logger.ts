/**
 * Minimal logger that redacts secrets before anything reaches stdout or a log
 * file. Telegram bot tokens, API keys and `key=`/`app_key=` query parameters
 * are masked; call `registerSecret()` for any other value that must never be
 * printed.
 */
const secrets = new Set<string>()

const PATTERNS: [RegExp, string][] = [
  [/bot\d{5,}:[A-Za-z0-9_-]{20,}/g, 'bot<redacted>'],
  [/\b\d{6,}:[A-Za-z0-9_-]{30,}\b/g, '<telegram-token>'],
  [/([?&](?:app_key|app_id|api_key|apikey|key|token)=)[^&\s"']+/gi, '$1<redacted>'],
  [/(Authorization-Key["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi, '$1<redacted>'],
  [/(jooble\.org\/api\/)[A-Za-z0-9-]+/gi, '$1<redacted>']
]

export function registerSecret(value: string | undefined | null): void {
  if (value && value.length >= 6) secrets.add(value)
}

export function redact(input: unknown): string {
  let text: string
  if (input instanceof Error) text = `${input.name}: ${input.message}`
  else if (typeof input === 'string') text = input
  else {
    try {
      text = JSON.stringify(input)
    } catch {
      text = String(input)
    }
  }
  for (const s of secrets) text = text.split(s).join('<redacted>')
  for (const [re, rep] of PATTERNS) text = text.replace(re, rep)
  return text
}

type Level = 'debug' | 'info' | 'warn' | 'error'

let quiet = process.env.PULSEAPPLY_QUIET === '1'

export function setQuiet(value: boolean): void {
  quiet = value
}

function emit(level: Level, scope: string, message: unknown, extra?: unknown): void {
  if (quiet && level !== 'error') return
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} [${scope}] ${redact(message)}${
    extra !== undefined ? ' ' + redact(extra) : ''
  }`
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const log = {
  debug: (scope: string, msg: unknown, extra?: unknown) => {
    if (process.env.PULSEAPPLY_DEBUG === '1') emit('debug', scope, msg, extra)
  },
  info: (scope: string, msg: unknown, extra?: unknown) => emit('info', scope, msg, extra),
  warn: (scope: string, msg: unknown, extra?: unknown) => emit('warn', scope, msg, extra),
  error: (scope: string, msg: unknown, extra?: unknown) => emit('error', scope, msg, extra)
}
