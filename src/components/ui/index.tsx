'use client'

import { forwardRef } from 'react'
import { cn } from '@/lib/cn'

// ── Bouton ────────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'onair'
type ButtonSize = 'sm' | 'md'

const BUTTON_BASE =
  'inline-flex select-none items-center justify-center gap-1.5 rounded-md border font-medium ' +
  'transition-colors duration-120 disabled:cursor-not-allowed disabled:opacity-40'

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'border-accent/40 bg-accent text-bg hover:bg-accent/90',
  secondary: 'border-line bg-surface2 text-txt hover:bg-line',
  ghost: 'border-transparent bg-transparent text-txt2 hover:bg-surface2 hover:text-txt',
  danger: 'border-crit/40 bg-crit/15 text-crit hover:bg-crit/25',
  onair: 'border-onair bg-onair text-white shadow-onair hover:bg-onair/90',
}

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2 text-xs',
  md: 'h-9 px-3 text-sm',
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'secondary', size = 'md', type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)}
      {...props}
    />
  )
})

// ── Panneau ───────────────────────────────────────────────────────────────────

export function Panel({
  title,
  actions,
  className,
  bodyClassName,
  children,
}: {
  title?: string
  actions?: React.ReactNode
  className?: string
  bodyClassName?: string
  children: React.ReactNode
}) {
  return (
    <section className={cn('panel flex min-h-0 flex-col', className)}>
      {(title || actions) && (
        <header className="panel-header shrink-0">
          {title ? <h2 className="panel-title">{title}</h2> : <span />}
          {actions}
        </header>
      )}
      <div className={cn('min-h-0 flex-1 overflow-auto p-3', bodyClassName)}>{children}</div>
    </section>
  )
}

// ── Badge d'état ──────────────────────────────────────────────────────────────

type Tone = 'neutral' | 'ok' | 'warn' | 'crit' | 'accent' | 'onair'

const TONES: Record<Tone, string> = {
  neutral: 'border-line bg-surface2 text-txt2',
  ok: 'border-ok/35 bg-ok/10 text-ok',
  warn: 'border-warn/35 bg-warn/10 text-warn',
  crit: 'border-crit/35 bg-crit/10 text-crit',
  accent: 'border-accent/35 bg-accent/10 text-accent',
  onair: 'border-onair bg-onair text-white',
}

export function Badge({
  tone = 'neutral',
  pulse = false,
  className,
  children,
}: {
  tone?: Tone
  pulse?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-[0.08em]',
        TONES[tone],
        pulse && 'animate-pulseSoft',
        className,
      )}
    >
      {children}
    </span>
  )
}

// ── Champs de formulaire ──────────────────────────────────────────────────────

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string
  hint?: string
  error?: string | null
  htmlFor?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="metric-label block">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-crit">{error}</p>
      ) : hint ? (
        <p className="text-xs text-txt2">{hint}</p>
      ) : null}
    </div>
  )
}

const CONTROL =
  'w-full rounded-md border border-line bg-bg px-2.5 py-1.5 text-sm text-txt ' +
  'placeholder:text-txt2/60 disabled:opacity-50'

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(CONTROL, className)} {...props} />
  },
)

export const Select = forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, ...props }, ref) {
  return <select ref={ref} className={cn(CONTROL, 'pr-8', className)} {...props} />
})

// ── Valeur mesurée ────────────────────────────────────────────────────────────

/**
 * Affiche une mesure. `null` ou `undefined` s'affiche « — » et jamais « 0 ».
 * C'est une règle de fond : « 0 fps » et « non mesuré » ne veulent pas dire la
 * même chose pour un technicien en direct.
 */
export function Metric({
  label,
  value,
  unit,
  tone = 'neutral',
}: {
  label: string
  value: number | string | null | undefined
  unit?: string
  tone?: Tone
}) {
  const unknown = value === null || value === undefined || value === ''
  const toneClass =
    tone === 'ok'
      ? 'text-ok'
      : tone === 'warn'
        ? 'text-warn'
        : tone === 'crit'
          ? 'text-crit'
          : 'text-txt'
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="metric-label">{label}</span>
      <span className={cn('tabular text-xs', unknown ? 'text-txt2/60' : toneClass)}>
        {unknown ? '—' : `${typeof value === 'number' ? formatNumber(value) : value}${unit ?? ''}`}
      </span>
    </div>
  )
}

function formatNumber(value: number): string {
  if (Math.abs(value) >= 100) return String(Math.round(value))
  if (Math.abs(value) >= 10) return value.toFixed(1)
  return value.toFixed(2).replace(/\.00$/, '')
}

// ── Message d'alerte ──────────────────────────────────────────────────────────

export function Notice({
  tone = 'neutral',
  title,
  children,
}: {
  tone?: Tone
  title?: string
  children: React.ReactNode
}) {
  const border =
    tone === 'crit'
      ? 'border-crit/40 bg-crit/10'
      : tone === 'warn'
        ? 'border-warn/40 bg-warn/10'
        : tone === 'ok'
          ? 'border-ok/40 bg-ok/10'
          : 'border-line bg-surface2'
  return (
    <div className={cn('rounded-md border px-3 py-2 text-sm', border)}>
      {title && <p className="mb-0.5 font-semibold">{title}</p>}
      <div className="text-txt2">{children}</div>
    </div>
  )
}
