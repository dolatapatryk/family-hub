import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { HouseholdMember } from '../household/api'
import { formatDueDate, type Task } from './tasks'
import type { CreateTasksApi, UpdateTaskInput } from './types'

export function TaskItem({ task, api, queryKey, showArchive = true, assignedLabel, members = [] }: {
  task: Task
  api: CreateTasksApi
  queryKey: readonly unknown[]
  showArchive?: boolean
  assignedLabel?: string
  members?: HouseholdMember[]
}) {
  const client = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [title, setTitle] = useState(task.title)
  const [dueDate, setDueDate] = useState(task.dueDate ?? '')
  const [assignedTo, setAssignedTo] = useState(task.assignedTo ?? '')
  const mutation = useMutation({
    mutationFn: (action: 'complete' | 'reopen' | 'archive') => action === 'archive'
      ? api.archive(task.id)
      : api.setCompleted(task.id, action === 'complete'),
    onSuccess: async (saved, action) => {
      await client.cancelQueries({ queryKey })
      client.setQueryData<Task[]>(queryKey, current => action === 'archive'
        ? current?.filter(item => item.id !== saved.id)
        : current?.map(item => item.id === saved.id ? saved : item))
      await client.invalidateQueries({ queryKey })
    },
  })
  const update = useMutation({
    mutationFn: (input: UpdateTaskInput) => api.update(task.id, input),
    onSuccess: async saved => {
      setEditing(false)
      await client.cancelQueries({ queryKey })
      client.setQueryData<Task[]>(queryKey, current => current?.map(item => item.id === saved.id ? saved : item))
      await client.invalidateQueries({ queryKey })
    },
  })
  const remove = useMutation({
    mutationFn: () => api.remove(task.id),
    onSuccess: async removedId => {
      await client.cancelQueries({ queryKey })
      client.setQueryData<Task[]>(queryKey, current => current?.filter(item => item.id !== removedId))
      await client.invalidateQueries({ queryKey })
    },
  })
  const busy = mutation.isPending || update.isPending || remove.isPending

  function openEditor() {
    update.reset()
    remove.reset()
    setTitle(task.title)
    setDueDate(task.dueDate ?? '')
    setAssignedTo(task.assignedTo ?? '')
    setConfirmingDelete(false)
    setEditing(true)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!title.trim() || update.isPending) return
    update.mutate({ title: title.trim(), dueDate: dueDate || null, assignedTo: assignedTo || null })
  }

  return (
    <li className={`task-item${task.completed ? ' task-completed' : ''}`}>
      <div className="task-row">
        <label className="task-check">
          <input type="checkbox" checked={task.completed} disabled={busy}
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
        <div className="item-actions">
          <button className="text-button" type="button" disabled={busy} onClick={openEditor} aria-label={`Edytuj: ${task.title}`}>Edytuj</button>
          {showArchive && <button className="button-quiet task-archive" type="button" disabled={busy} onClick={() => mutation.mutate('archive')} aria-label={`Archiwizuj: ${task.title}`}>Archiwizuj</button>}
          <button className="text-button item-remove-button" type="button" disabled={busy} onClick={() => { update.reset(); remove.reset(); setEditing(false); setConfirmingDelete(true) }} aria-label={`Usuń: ${task.title}`}>Usuń</button>
        </div>
      </div>
      {editing && <form className="item-edit-form task-item-edit" onSubmit={submit} aria-label={`Edytuj zadanie: ${task.title}`}>
        <label>Tytuł<input required value={title} disabled={update.isPending} onChange={event => setTitle(event.target.value)} /></label>
        <div className="item-edit-fields task-edit-fields">
          <label>Termin <span className="optional">(opcjonalnie)</span><input type="date" value={dueDate} disabled={update.isPending} onChange={event => setDueDate(event.target.value)} /></label>
          <label>Przypisz do<select value={assignedTo} disabled={update.isPending} onChange={event => setAssignedTo(event.target.value)}>
            <option value="">Wspólne</option>
            {members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
          </select></label>
        </div>
        {update.isError && <p className="error-message" role="alert">Nie udało się zapisać zadania: {update.error.message}</p>}
        <div className="form-actions">
          <button className="primary-button" type="submit" disabled={!title.trim() || update.isPending}>{update.isPending ? 'Zapisuję…' : 'Zapisz'}</button>
          <button className="text-button" type="button" disabled={update.isPending} onClick={() => setEditing(false)}>Anuluj</button>
        </div>
      </form>}
      {confirmingDelete && <div className="item-delete-confirmation" role="group" aria-label={`Potwierdź usunięcie zadania: ${task.title}`}>
        <p>Usunąć zadanie „{task.title}” na stałe?</p>
        <div className="form-actions">
          <button className="button-quiet" type="button" disabled={remove.isPending} onClick={() => remove.mutate()}>{remove.isPending ? 'Usuwam…' : 'Usuń zadanie'}</button>
          <button className="text-button" type="button" disabled={remove.isPending} onClick={() => setConfirmingDelete(false)}>Anuluj</button>
        </div>
        {remove.isError && <p className="error-message" role="alert">Nie udało się usunąć zadania: {remove.error.message}</p>}
      </div>}
      {mutation.isPending && <p className="task-feedback" role="status">Zapisuję…</p>}
      {mutation.isError && <p className="error-message" role="alert">{mutation.error.message}</p>}
    </li>
  )
}
