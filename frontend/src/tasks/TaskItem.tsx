import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useToast } from '../components/ToastProvider'
import { dismissMobileDialog, useMobileDialogSwipeDismiss } from '../components/useMobileDialogSwipeDismiss'
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
  const showToast = useToast()
  const [dialogAction, setDialogAction] = useState<'edit' | 'archive' | 'delete' | null>(null)
  const [title, setTitle] = useState(task.title)
  const [dueDate, setDueDate] = useState(task.dueDate ?? '')
  const [assignedTo, setAssignedTo] = useState(task.assignedTo ?? '')
  const dialog = useRef<HTMLDialogElement>(null)
  const editTitleInput = useRef<HTMLInputElement>(null)
  const dialogTitleId = useId()
  const mutation = useMutation({
    mutationFn: (action: 'complete' | 'reopen' | 'archive') => action === 'archive'
      ? api.archive(task.id)
      : api.setCompleted(task.id, action === 'complete'),
    onSuccess: async (saved, action) => {
      if (action === 'archive') dismissDialog()
      const title = action === 'complete'
        ? 'Zadanie ukończone'
        : action === 'reopen'
          ? 'Przywrócono zadanie'
          : task.recurringActive ? 'Pominięto termin' : 'Zadanie zarchiwizowane'
      showToast({ kind: 'success', title, description: saved.title })
      await client.cancelQueries({ queryKey })
      client.setQueryData<Task[]>(queryKey, current => action === 'archive'
        ? current?.filter(item => item.id !== saved.id)
        : current?.map(item => item.id === saved.id ? saved : item))
      await client.invalidateQueries({ queryKey })
    },
    onError: (error, action) => showToast({
      kind: 'error',
      title: action === 'complete'
        ? 'Nie udało się ukończyć zadania'
        : action === 'reopen'
          ? 'Nie udało się przywrócić zadania'
          : task.recurringActive ? 'Nie udało się pominąć terminu' : 'Nie udało się zarchiwizować zadania',
      description: error.message,
      action: { label: 'Spróbuj ponownie', onClick: () => mutation.mutate(action) },
    }),
  })
  const update = useMutation({
    mutationFn: (input: UpdateTaskInput) => api.update(task.id, input),
    onSuccess: async saved => {
      dismissDialog()
      showToast({ kind: 'success', title: 'Zapisano zadanie', description: saved.title })
      await client.cancelQueries({ queryKey })
      client.setQueryData<Task[]>(queryKey, current => current?.map(item => item.id === saved.id ? saved : item))
      await client.invalidateQueries({ queryKey })
    },
    onError: (error, input) => showToast({ kind: 'error', title: 'Nie udało się zapisać zadania', description: error.message, action: { label: 'Spróbuj ponownie', onClick: () => update.mutate(input) } }),
  })
  const remove = useMutation({
    mutationFn: () => api.remove(task.id),
    onSuccess: async removedId => {
      dismissDialog()
      showToast({ kind: 'success', title: 'Usunięto zadanie', description: task.title })
      await client.cancelQueries({ queryKey })
      client.setQueryData<Task[]>(queryKey, current => current?.filter(item => item.id !== removedId))
      await client.invalidateQueries({ queryKey })
    },
    onError: error => showToast({ kind: 'error', title: 'Nie udało się usunąć zadania', description: error.message, action: { label: 'Spróbuj ponownie', onClick: () => remove.mutate() } }),
  })
  const busy = mutation.isPending || update.isPending || remove.isPending

  const swipeDialogRef = useMobileDialogSwipeDismiss(dialog, () => closeDialog(true), !busy && dialogAction === 'edit')

  function openEditor() {
    mutation.reset()
    update.reset()
    remove.reset()
    setTitle(task.title)
    setDueDate(task.dueDate ?? '')
    setAssignedTo(task.assignedTo ?? '')
    setDialogAction('edit')
  }

  function openConfirmation(action: 'archive' | 'delete') {
    mutation.reset()
    update.reset()
    remove.reset()
    setDialogAction(action)
  }

  function dismissDialog(afterSwipeAnimation = false) {
    if (afterSwipeAnimation) setDialogAction(null)
    else dismissMobileDialog(dialog.current, () => setDialogAction(null))
  }

  function closeDialog(afterSwipeAnimation = false) {
    if (!busy) dismissDialog(afterSwipeAnimation)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!title.trim() || update.isPending) return
    update.mutate({ title: title.trim(), dueDate: dueDate || null, assignedTo: assignedTo || null })
  }

  function confirmAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    if (dialogAction === 'archive') mutation.mutate('archive')
    if (dialogAction === 'delete') remove.mutate()
  }

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (dialogAction) {
      if (!element.open) {
        element.classList.remove('mobile-dialog-dragging', 'mobile-dialog-settling', 'mobile-dialog-dismissing')
        element.style.removeProperty('translate')
        const form = element.querySelector<HTMLElement>('.task-dialog-form')
        form?.classList.remove('mobile-dialog-dragging', 'mobile-dialog-settling')
        form?.style.removeProperty('translate')
        element.showModal()
      }
      if (window.matchMedia('(max-width: 680px)').matches) {
        element.focus({ preventScroll: true })
      } else if (dialogAction === 'edit') {
        editTitleInput.current?.focus()
      }
    } else if (element.open) {
      element.close()
    }
  }, [dialogAction])

  return (
    <li className={`task-item${task.completed ? ' task-completed' : ''}`}>
      <div className="task-row">
        <label className="task-check">
          <input type="checkbox" checked={task.completed} disabled={busy}
            onChange={() => mutation.mutate(task.completed ? 'reopen' : 'complete')}
            aria-label={`${task.completed ? 'Przywróć' : 'Ukończ'}: ${task.title}`} />
        </label>
        <button className="task-open-button" type="button" disabled={busy} onClick={openEditor} aria-label={`Edytuj zadanie: ${task.title}`}>
          <span className="task-details">
            <span className="task-title">{task.title}</span>
            <span className="task-meta">
              {task.dueDate ? <time dateTime={task.dueDate}>{formatDueDate(task.dueDate)}</time> : 'Bez terminu'}
              {assignedLabel && <><span aria-hidden="true"> · </span>{assignedLabel}</>}
            </span>
          </span>
        </button>
        <div className="item-actions">
          <button className="button-quiet task-action-icon" type="button" disabled={busy} onClick={openEditor} aria-label={`Edytuj: ${task.title}`} title="Edytuj">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L8 18l-4 1 1-4Z" /></svg>
          </button>
          {showArchive && <button className="button-quiet task-archive task-action-icon" type="button" disabled={busy} onClick={() => openConfirmation('archive')} aria-label={`${task.recurringActive ? 'Pomiń termin' : 'Archiwizuj'}: ${task.title}`} title={task.recurringActive ? 'Pomiń termin' : 'Archiwizuj'}>
            {task.recurringActive
              ? <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 5v14l11-7-11-7Z" /></svg>
              : <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 4h18v4H3z" /><path d="M5 8v12h14V8M10 12h4" /></svg>}
          </button>}
          {!task.recurringActive && <button className="button-quiet task-action-icon task-action-delete" type="button" disabled={busy} onClick={() => openConfirmation('delete')} aria-label={`Usuń: ${task.title}`} title="Usuń">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="m19 6-1 14H6L5 6" /><path d="M10 11v5M14 11v5" /></svg>
          </button>}
        </div>
      </div>
      <dialog
        ref={swipeDialogRef}
        className={dialogAction === 'edit' ? 'task-dialog' : 'task-confirm-dialog'}
        tabIndex={-1}
        aria-labelledby={dialogAction ? dialogTitleId : undefined}
        onCancel={event => {
          event.preventDefault()
          closeDialog()
        }}
        onClick={event => {
          if (event.target === event.currentTarget) closeDialog()
        }}
      >
        {dialogAction && (
          <form className={`task-dialog-form${dialogAction === 'edit' ? ' task-form' : ' task-confirm-dialog-form'}`} onSubmit={dialogAction === 'edit' ? submit : confirmAction}>
            <div className="task-dialog-header">
              <div>
                <h2 className="panel-title" id={dialogTitleId}>
                  {dialogAction === 'edit'
                    ? 'Edytuj zadanie'
                    : dialogAction === 'archive'
                      ? task.recurringActive ? 'Pominąć termin?' : 'Archiwizować zadanie?'
                      : 'Usunąć zadanie?'}
                </h2>
                {dialogAction !== 'archive' && <p className="panel-kicker">
                  {dialogAction === 'edit'
                    ? task.recurringActive ? 'Zmiany dotyczą tylko tego wystąpienia.' : 'Zmień tytuł, termin lub przypisanie.'
                    : 'Tej operacji nie można cofnąć.'}
                </p>}
              </div>
              <button className="button-quiet task-dialog-close" type="button" aria-label="Zamknij okno" disabled={busy} onClick={closeDialog}>×</button>
            </div>
            {dialogAction === 'edit'
              ? <fieldset disabled={update.isPending}>
                <label>Tytuł<input ref={editTitleInput} required value={title} onChange={event => setTitle(event.target.value)} /></label>
                {task.recurringActive && <p className="task-repeat-note">Serią zarządzasz w sekcji „Stałe zadania”.</p>}
                <div className="task-form-options">
                  <label>Termin {!task.recurringActive && <span className="optional">(opcjonalnie)</span>}<input type="date" required={task.recurringActive} value={dueDate} onChange={event => setDueDate(event.target.value)} /></label>
                  <label>Przypisz do<select value={assignedTo} onChange={event => setAssignedTo(event.target.value)}>
                    <option value="">Wspólne</option>
                    {members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
                  </select></label>
                </div>
              </fieldset>
              : <div className="task-dialog-content">
                {dialogAction === 'delete'
                  ? <p>Usunąć zadanie „{task.title}” na stałe?</p>
                  : task.recurringActive
                    ? <p>Pominąć bieżący termin zadania „{task.title}”?</p>
                    : <p>Przenieść zadanie „{task.title}” do archiwum?</p>}
              </div>}
            {dialogAction === 'edit' && <div className="task-dialog-secondary-actions">
              {showArchive && <button className="button-quiet" type="button" disabled={busy} onClick={() => openConfirmation('archive')}>
                {task.recurringActive ? 'Pomiń termin' : 'Archiwizuj'}
              </button>}
              {!task.recurringActive && <button className="button-quiet task-action-confirm-delete" type="button" disabled={busy} onClick={() => openConfirmation('delete')}>
                Usuń
              </button>}
            </div>}
            <div className="task-dialog-actions">
              {dialogAction === 'edit'
                ? <button className="primary-button" type="submit" disabled={!title.trim() || update.isPending}>{update.isPending ? 'Zapisuję…' : 'Zapisz'}</button>
                : <button className={dialogAction === 'delete' ? 'button-quiet task-action-confirm-delete' : 'primary-button'} type="submit" disabled={busy}>
                  {dialogAction === 'delete' ? remove.isPending ? 'Usuwam…' : 'Usuń zadanie' : mutation.isPending ? 'Zapisuję…' : task.recurringActive ? 'Pomiń termin' : 'Archiwizuj'}
                </button>}
              <button className="button-quiet" type="button" autoFocus={dialogAction !== 'edit'} disabled={busy} onClick={closeDialog}>Anuluj</button>
            </div>
          </form>
        )}
      </dialog>
      {mutation.isPending && <p className="task-feedback" role="status">Zapisuję…</p>}
    </li>
  )
}
