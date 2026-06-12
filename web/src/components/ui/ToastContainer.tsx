import React from 'react'
import { clsx } from 'clsx'
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react'
import { useUIStore, type Toast } from '../../store/ui'

const icons = {
  success: <CheckCircle className="size-5 text-green-500" />,
  error:   <AlertCircle className="size-5 text-red-500" />,
  warning: <AlertTriangle className="size-5 text-amber-500" />,
  info:    <Info className="size-5 text-blue-500" />,
}

const ToastItem: React.FC<{ toast: Toast }> = ({ toast }) => {
  const removeToast = useUIStore((s) => s.removeToast)

  return (
    <div
      className={clsx(
        'flex items-start gap-3 w-80 rounded-xl border bg-white px-4 py-3 shadow-lg',
        'animate-in slide-in-from-right-5 duration-200',
      )}
    >
      <span className="mt-0.5 shrink-0">{icons[toast.variant]}</span>
      <p className="flex-1 text-sm text-ink-800">{toast.message}</p>
      <button
        onClick={() => removeToast(toast.id)}
        className="shrink-0 text-ink-400 hover:text-ink-600 transition-colors"
        aria-label="Dismiss"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}

export const ToastContainer: React.FC = () => {
  const toasts = useUIStore((s) => s.toasts)

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItem toast={t} />
        </div>
      ))}
    </div>
  )
}

export default ToastContainer
