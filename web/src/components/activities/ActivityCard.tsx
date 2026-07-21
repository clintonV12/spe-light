import React from 'react'
import { clsx } from 'clsx'
import { AlertCircle, Clock } from 'lucide-react'
import { Badge } from '../ui'
import type { Activity, Phase } from '../../types'

const phaseLabels: Record<Phase, string> = {
  P1: 'Analysis',
  P2: 'Strategy',
  P3: 'Operations',
}

const statusLabels: Record<Activity['status'], string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  review:      'Under review',
  complete:    'Complete',
}

const statusToVariant: Record<Activity['status'], 'neutral' | 'p1' | 'p2' | 'p3' | 'success'> = {
  not_started: 'neutral',
  in_progress: 'p2',
  review:      'p1',
  complete:    'success',
}

interface ActivityCardProps {
  activity: Activity
  onClick?: () => void
  className?: string
}

function isOverdue(activity: Activity): boolean {
  if (!activity.due_date || activity.status === 'complete') return false
  return new Date(activity.due_date) < new Date()
}

export const ActivityCard: React.FC<ActivityCardProps> = ({ activity, onClick, className }) => {
  const overdue = isOverdue(activity)

  return (
    <div
      onClick={onClick}
      className={clsx(
        'rounded-xl border bg-white p-4 shadow-sm transition-shadow',
        onClick && 'cursor-pointer hover:shadow-md',
        overdue && 'border-red-200',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={activity.phase.toLowerCase() as 'p1' | 'p2' | 'p3'}>
            {activity.phase} · {phaseLabels[activity.phase]}
          </Badge>
          <Badge variant={statusToVariant[activity.status]}>
            {statusLabels[activity.status]}
          </Badge>
        </div>
        {overdue && (
          <span className="flex items-center gap-1 text-xs text-red-500 shrink-0">
            <AlertCircle className="size-3.5" />
            Overdue
          </span>
        )}
      </div>

      <h3 className="mt-2 text-sm font-semibold text-ink-900 line-clamp-2">{activity.title}</h3>

      {activity.due_date && (
        <p className="mt-1 flex items-center gap-1 text-xs text-ink-400">
          <Clock className="size-3.5" />
          {new Date(activity.due_date).toLocaleDateString()}
        </p>
      )}
    </div>
  )
}

export default ActivityCard