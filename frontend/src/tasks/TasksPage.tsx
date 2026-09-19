import { useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createTasksApi } from './api'
import { formatDueDate, groupTasks, members, type Task } from './tasks'

const userId = import.meta.env.VITE_USER_ID || members[0].id
const api = createTasksApi(import.meta.env.VITE_API_URL || '/api', userId)
const queryKey = ['tasks', userId]

function TaskItem({ task }: { task: Task }) {
  const client = useQueryClient()
  const mutation = useMutation({
    mutationFn: (action: 'complete' | 'reopen' | 'archive') => api.action(task.id, action),
    onSuccess: () => client.invalidateQueries({ queryKey }),
  })
  return (
    <li className={`task-item${task.completed ? ' task-completed' : ''}`}>
      <div className="task-row">
        <label className="task-check">
          <input type="checkbox" checked={task.completed} disabled={mutation.isPending}
            onChange={() => mutation.mutate(task.completed ? 'reopen' : 'complete')}
            aria-label={`${task.completed ? 'Reopen' : 'Complete'} ${task.title}`} />
          <span className="task-details"><span className="task-title">{task.title}</span>
            <span className="task-meta">{task.dueDate && <><time dateTime={task.dueDate}>{formatDueDate(task.dueDate)}</time><span aria-hidden="true"> · </span></>}
              {task.assignedTo ? members.find(member => member.id === task.assignedTo)?.name ?? 'Household member' : 'Shared'}
            </span>
          </span>
        </label>
        <button className="button-quiet" disabled={mutation.isPending} onClick={() => mutation.mutate('archive')} aria-label={`Archive ${task.title}`}>Archive</button>
      </div>
      {mutation.isPending && <p className="task-feedback" role="status">Saving…</p>}
      {mutation.isError && <p className="error-message" role="alert">{mutation.error.message}</p>}
    </li>
  )
}

export function TasksPage() {
  const client = useQueryClient()
  const [formOpen, setFormOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [notice, setNotice] = useState('')
  const addButton = useRef<HTMLButtonElement>(null)
  const tasks = useQuery({ queryKey, queryFn: ({ signal }) => api.list(signal) })
  const create = useMutation({
    mutationFn: async () => {
      const task = await api.create({ title: title.trim(), dueDate: dueDate || null })
      // Creation and assignment are separate API operations. An assignment failure
      // must not invite retrying creation and accidentally duplicating the task.
      if (assignedTo) {
        try { await api.assign(task.id, assignedTo) }
        catch (error) { return `Task created, but assignment failed: ${error instanceof Error ? error.message : 'Please try again later.'} It is saved as a shared task.` }
      }
      return 'Task added.'
    },
    onSuccess: async message => {
      setNotice(message)
      setTitle('')
      setDueDate('')
      setAssignedTo('')
      setFormOpen(false)
      addButton.current?.focus()
      await client.invalidateQueries({ queryKey })
    },
  })
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (title.trim() && !create.isPending) create.mutate()
  }
  return (
    <>
      <p className="eyebrow">Tasks</p>
      <h1>Make room for what matters.</h1>
      <p className="intro">A shared place for the things that need doing.</p>
      <div className="tasks-toolbar">
        <p className="task-meta">Adding as {members.find(member => member.id === userId)?.name ?? 'configured user'}</p>
        <button className="button-primary" ref={addButton} aria-expanded={formOpen} aria-controls="add-task-form" onClick={() => { if (!formOpen) { create.reset(); setNotice(''); setFormOpen(true) } }}>+ Add task</button>
      </div>
      {notice && <p role="status" className="task-notice">{notice}</p>}
      {formOpen && <form id="add-task-form" className="card task-form" onSubmit={submit}>
        <h2>Add a task</h2>
        <fieldset disabled={create.isPending}>
          <label>Title<input autoFocus required value={title} onChange={event => setTitle(event.target.value)} placeholder="What needs doing?" /></label>
          <div className="task-form-options">
            <label>Due date <span className="optional">(optional)</span><input type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} /></label>
            <label>Assigned to<select value={assignedTo} onChange={event => setAssignedTo(event.target.value)}><option value="">Shared</option>{members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
          </div>
          {create.isError && <p className="error-message" role="alert">{create.error.message}</p>}
          <div className="form-actions"><button className="button-primary" type="submit" disabled={!title.trim()}>{create.isPending ? 'Adding…' : 'Add task'}</button><button type="button" className="button-quiet" onClick={() => { setFormOpen(false); addButton.current?.focus() }}>Cancel</button></div>
        </fieldset>
      </form>}
      {tasks.isPending && <p role="status">Loading tasks…</p>}
      {tasks.isError && <div className="error-message" role="alert"><p>{tasks.error.message}</p><button className="button-quiet" disabled={tasks.isFetching} onClick={() => void tasks.refetch()}>{tasks.isFetching ? 'Retrying…' : 'Try again'}</button></div>}
      {tasks.data && <div className="task-sections">
        {tasks.data.filter(task => !task.archivedAt).length === 0 && <div className="card"><h2>A little breathing room.</h2><p>No tasks yet. Add your first task above.</p></div>}
        {Object.entries(groupTasks(tasks.data)).map(([heading, items]) => <section key={heading} className="task-section" aria-label={heading}>
          <h2>{heading}<span className="task-count">{items.length}</span></h2>
          {items.length ? <ul className="task-list">{items.map(task => <TaskItem key={task.id} task={task} />)}</ul> : <p className="section-empty">{heading === 'Today' ? 'Nothing due today.' : heading === 'No due date' ? 'No undated tasks.' : `No ${heading.toLowerCase()} tasks.`}</p>}
        </section>)}
      </div>}
    </>
  )
}
