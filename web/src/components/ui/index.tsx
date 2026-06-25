import React from 'react'
import { clsx } from 'clsx'

// ─── Button ─────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-white hover:bg-accent-600 focus-visible:ring-accent-400',
  secondary:
    'bg-white text-ink-800 border border-ink-200 hover:bg-ink-50 focus-visible:ring-ink-300',
  ghost:
    'text-ink-600 hover:bg-ink-100 focus-visible:ring-ink-300',
  danger:
    'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-400',
}

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
  lg: 'px-5 py-2.5 text-base',
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, disabled, children, className, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium',
        'transition-colors focus-visible:outline-none focus-visible:ring-2',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    >
      {loading && (
        <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </button>
  ),
)
Button.displayName = 'Button'

// ─── Badge ──────────────────────────────────────────────────────────────────

type BadgeVariant = 'p1' | 'p2' | 'p3' | 'success' | 'warning' | 'error' | 'neutral'

interface BadgeProps {
  variant?: BadgeVariant
  children: React.ReactNode
  className?: string
}

const badgeVariants: Record<BadgeVariant, string> = {
  p1:      'bg-p1-light text-p1-dark',
  p2:      'bg-p2-light text-p2-dark',
  p3:      'bg-p3-light text-p3-dark',
  success: 'bg-green-100 text-green-800',
  warning: 'bg-amber-100 text-amber-800',
  error:   'bg-red-100 text-red-800',
  neutral: 'bg-ink-100 text-ink-600',
}

export const Badge: React.FC<BadgeProps> = ({ variant = 'neutral', children, className }) => (
  <span
    className={clsx(
      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
      badgeVariants[variant],
      className,
    )}
  >
    {children}
  </span>
)

// ─── Input ──────────────────────────────────────────────────────────────────

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, id, className, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')
    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-ink-700">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={clsx(
            'w-full rounded-lg border bg-white px-3 py-2 text-sm text-ink-900',
            'placeholder:text-ink-400 transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-accent-400 focus:border-transparent',
            error ? 'border-red-400' : 'border-ink-200',
            className,
          )}
          {...props}
        />
        {hint && !error && <p className="text-xs text-ink-400">{hint}</p>}
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    )
  },
)
Input.displayName = 'Input'

// ─── Select ─────────────────────────────────────────────────────────────────

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  options: { value: string; label: string }[]
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, id, className, ...props }, ref) => {
    const selectId = id ?? label?.toLowerCase().replace(/\s+/g, '-')
    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={selectId} className="text-sm font-medium text-ink-700">
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={clsx(
            'w-full rounded-lg border bg-white px-3 py-2 text-sm text-ink-900',
            'focus:outline-none focus:ring-2 focus:ring-accent-400 focus:border-transparent',
            error ? 'border-red-400' : 'border-ink-200',
            className,
          )}
          {...props}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    )
  },
)
Select.displayName = 'Select'

// ─── Card ────────────────────────────────────────────────────────────────────

interface CardProps {
  children: React.ReactNode
  className?: string
  onClick?: () => void
}

export const Card: React.FC<CardProps> = ({ children, className, onClick }) => (
  <div
    onClick={onClick}
    className={clsx(
      'rounded-xl border border-ink-100 bg-white shadow-sm',
      onClick && 'cursor-pointer hover:shadow-md transition-shadow',
      className,
    )}
  >
    {children}
  </div>
)

// ─── ProgressBar ─────────────────────────────────────────────────────────────

interface ProgressBarProps {
  value: number       // 0–100
  variant?: 'p1' | 'p2' | 'p3' | 'default'
  size?: 'xs' | 'sm' | 'md'
  showLabel?: boolean
  className?: string
}

// Each variant gets a gradient pair (from → to) for a modern filled look
const progressGradients: Record<NonNullable<ProgressBarProps['variant']>, string> = {
  p1:      'from-amber-400 to-amber-500',
  p2:      'from-emerald-400 to-emerald-500',
  p3:      'from-violet-400 to-violet-500',
  default: 'from-blue-500 to-indigo-500',
}

const progressHeights: Record<NonNullable<ProgressBarProps['size']>, string> = {
  xs: 'h-1',
  sm: 'h-1.5',
  md: 'h-2',
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  variant = 'default',
  size = 'sm',
  showLabel,
  className,
}) => {
  const pct = Math.min(100, Math.max(0, value))
  return (
    <div className={clsx('flex items-center gap-2', className)}>
      <div className={clsx(
        'flex-1 rounded-full overflow-hidden',
        progressHeights[size],
        'bg-ink-100',
      )}>
        <div
          className={clsx(
            'h-full rounded-full bg-gradient-to-r transition-all duration-700 ease-out',
            progressGradients[variant],
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabel && (
        <span className="text-xs font-medium text-ink-500 w-8 text-right tabular-nums">
          {Math.round(pct)}%
        </span>
      )}
    </div>
  )
}

// ─── EmptyState ──────────────────────────────────────────────────────────────

interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
}

export const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description, action }) => (
  <div className="flex flex-col items-center justify-center py-16 text-center">
    {icon && <div className="mb-4 text-ink-300">{icon}</div>}
    <h3 className="text-base font-semibold text-ink-700">{title}</h3>
    {description && <p className="mt-1 text-sm text-ink-400 max-w-sm">{description}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
)
