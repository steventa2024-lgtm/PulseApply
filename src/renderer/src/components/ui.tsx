import {
  useEffect,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes
} from 'react'
import { Loader2, X } from 'lucide-react'
import { cx } from '../lib/cx'
import type { Tone } from '../lib/format'

const TONES: Record<Tone, string> = {
  cyan: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
  green: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  amber: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  red: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  slate: 'border-white/10 bg-white/[0.04] text-slate-300',
  violet: 'border-violet-500/30 bg-violet-500/10 text-violet-300'
}

export function Badge({
  tone = 'slate',
  children,
  title,
  className
}: {
  tone?: Tone
  children: ReactNode
  title?: string
  className?: string
}): React.JSX.Element {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-medium',
        TONES[tone],
        className
      )}
    >
      {children}
    </span>
  )
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
const VARIANTS: Record<Variant, string> = {
  primary:
    'border-cyan-400/40 bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 font-semibold hover:brightness-110 shadow-[0_0_18px_rgba(6,182,212,0.25)]',
  secondary: 'border-white/10 bg-white/[0.05] text-slate-200 hover:bg-white/[0.09]',
  ghost: 'border-transparent bg-transparent text-slate-300 hover:bg-white/[0.06]',
  danger: 'border-rose-500/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25',
  success:
    'border-emerald-400/40 bg-gradient-to-r from-emerald-500 to-teal-600 text-slate-950 font-semibold hover:brightness-110'
}

export function Button({
  variant = 'secondary',
  loading,
  icon,
  children,
  className,
  size = 'md',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  loading?: boolean
  icon?: ReactNode
  size?: 'sm' | 'md'
}): React.JSX.Element {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 disabled:cursor-not-allowed disabled:opacity-45',
        size === 'sm' ? 'px-2.5 py-1 text-[11px]' : 'px-3.5 py-1.5 text-xs',
        VARIANTS[variant],
        className
      )}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {children}
    </button>
  )
}

export function Card({
  children,
  className,
  title,
  actions,
  subtitle
}: {
  children: ReactNode
  className?: string
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
}): React.JSX.Element {
  return (
    <section
      className={cx('rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5', className)}
    >
      {(title || actions) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-sm font-semibold text-white">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

export function PageHeader({
  title,
  subtitle,
  actions
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
}): React.JSX.Element {
  return (
    <div className="mb-6 flex items-end justify-between gap-4 border-b border-white/[0.06] pb-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">{title}</h1>
        {subtitle && <p className="mt-1 text-xs text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Label({
  children,
  hint,
  htmlFor
}: {
  children: ReactNode
  hint?: ReactNode
  htmlFor?: string
}): React.JSX.Element {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-400"
    >
      {children}
      {hint && <span className="ml-1 normal-case tracking-normal text-slate-500">{hint}</span>}
    </label>
  )
}

export const inputClass =
  'w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-xs text-white placeholder:text-slate-600 outline-none focus:border-cyan-400/70 disabled:opacity-50'

export function Input(props: InputHTMLAttributes<HTMLInputElement>): React.JSX.Element {
  return <input {...props} className={cx(inputClass, props.className)} />
}

export function Select({
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>): React.JSX.Element {
  return (
    <select {...props} className={cx(inputClass, 'pr-7', props.className)}>
      {children}
    </select>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: ReactNode
  disabled?: boolean
}): React.JSX.Element {
  return (
    <label
      className={cx(
        'inline-flex cursor-pointer items-center gap-2 text-xs text-slate-300',
        disabled && 'cursor-not-allowed opacity-50'
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative h-5 w-9 rounded-full border transition',
          checked ? 'border-cyan-400/50 bg-cyan-500/60' : 'border-white/15 bg-white/10'
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition',
            checked ? 'left-[18px]' : 'left-0.5'
          )}
        />
      </button>
      {label}
    </label>
  )
}

export function Chip({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'rounded-full border px-2.5 py-1 text-[11px] transition',
        active
          ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-200'
          : 'border-white/10 bg-white/[0.03] text-slate-400 hover:text-slate-200'
      )}
    >
      {children}
    </button>
  )
}

export function Empty({
  icon,
  title,
  children,
  action
}: {
  icon?: ReactNode
  title: string
  children?: ReactNode
  action?: ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 px-6 py-12 text-center">
      {icon && <div className="mb-3 text-slate-600">{icon}</div>}
      <p className="text-sm font-medium text-slate-300">{title}</p>
      {children && (
        <div className="mt-1.5 max-w-lg text-xs leading-relaxed text-slate-500">{children}</div>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Stat({
  label,
  value,
  hint,
  tone = 'cyan',
  onClick
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: Tone
  onClick?: () => void
}): React.JSX.Element {
  const color = {
    cyan: 'text-cyan-300',
    green: 'text-emerald-300',
    amber: 'text-amber-300',
    red: 'text-rose-300',
    slate: 'text-slate-200',
    violet: 'text-violet-300'
  }[tone]
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4 text-left transition enabled:hover:border-cyan-500/30 disabled:cursor-default"
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cx('mt-1.5 text-2xl font-bold tabular-nums', color)}>{value}</p>
      {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
    </button>
  )
}

export function Modal({
  open,
  title,
  children,
  onClose,
  footer
}: {
  open: boolean
  title: string
  children: ReactNode
  onClose: () => void
  footer?: ReactNode
}): React.JSX.Element | null {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-slate-900 p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-white/10"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="text-xs leading-relaxed text-slate-300">{children}</div>
        {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  )
}

export function Spinner({ label }: { label?: string }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 text-xs text-slate-400">
      <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
      {label}
    </div>
  )
}

export function ErrorNote({ error }: { error?: string | null }): React.JSX.Element | null {
  if (!error) return null
  return (
    <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
      {error}
    </p>
  )
}
