import { useQueryClient, useMutation } from '@tanstack/react-query'
import { formatDueDate, type Task } from './tasks'
import type { CreateTasksApi } from './types'

export function TaskItem({ task, api, queryKey, showArchive = true, assignedLabel }: {
  task: Task
  api: CreateTasksApi
  queryKey: readonly unknown[]
  showArchive?: boolean
  assignedLabel?: string
}) {
  const client = useQueryClient()
  const mutation = useMutation({
    mutationFn: (action: 'complete' | 'reopen' | 'archive') => action === 'archive'
      ? api.archive(task.id)
      : api.setCompleted(task.id, action === 'complete'),
    onSuccess: () => client.invalidateQueries({ queryKey }),
  })

  return (
    <li className={`task-item${task.completed ? ' task-completed' : ''}`}>
      <div className="task-row">
        <label className="task-check">
          <input type="checkbox" checked={task.completed} disabled={mutation.isPending}
            onChange={() => mutation.mutate(task.completed ? 'reopen' : 'complete')}
            aria-label={`${task.completed ? 'Przywróć' : 'Ukończ'}: ${task.title}`} />
          <span className="task-details">
            <span className="task-title">{task.title}</span>
            <span className="task-meta">
              {task.dueDate ? <time dateTime={task.dueDate}>{formatDueDate(task.dueDate)}</time> : 'Bez terminu'}
              {assignedLabel && <><span aria-hidden="true"> · </span>{assignedLabel}</>}
            </span>
          </span>
        </label>
        {showArchive && <button className="button-quiet task-archive" disabled={mutation.isPending} onClick={() => mutation.mutate('archive')} aria-label={`Archiwizuj: ${task.title}`}>Archiwizuj</button>}
      </div>
      {mutation.isPending && <p className="task-feedback" role="status">Zapisuję…</p>}
      {mutation.isError && <p className="error-message" role="alert">{mutation.error.message}</p>}
    </li>
  )
}
