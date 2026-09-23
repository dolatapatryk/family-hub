import { useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthGate'
import { createHouseholdMembersApi, type HouseholdMember } from '../household/api'
import { createTasksApi, type CreateTaskInput } from './api'
import { formatDueDate, groupTasks, type Task } from './tasks'

type TasksApi = ReturnType<typeof createTasksApi>

function memberName(members: HouseholdMember[] | undefined, memberId: string | null) {
  if (!memberId) return 'Shared'
  return members?.find(member => member.id === memberId)?.name ?? 'Household member'
}

function TaskItem({ task, api, queryKey, members }: {
  task: Task
  api: TasksApi
  queryKey: readonly unknown[]
  members: HouseholdMember[] | undefined
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
            aria-label={`${task.completed ? 'Reopen' : 'Complete'} ${task.title}`} />
          <span className="task-details"><span className="task-title">{task.title}</span>
            <span className="task-meta">{task.dueDate && <><time dateTime={task.dueDate}>{formatDueDate(task.dueDate)}</time><span aria-hidden="true"> · </span></>}
              {memberName(members, task.assignedTo)}
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
  const { profile } = useAuth()
  const client = useQueryClient()
  const api = createTasksApi(profile.household_id, profile.id)
  const queryKey = ['tasks', profile.household_id]
  const [formOpen, setFormOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [notice, setNotice] = useState('')
  const addButton = useRef<HTMLButtonElement>(null)
  const householdMembersApi = createHouseholdMembersApi(profile.household_id)
  const householdMembers = useQuery({
    queryKey: ['members', profile.household_id],
    queryFn: ({ signal }) => householdMembersApi.list(signal),
  })
  const tasks = useQuery({ queryKey, queryFn: ({ signal }) => api.list(signal) })
  const create = useMutation({
    mutationFn: (input: CreateTaskInput) => api.create(input),
    onSuccess: async () => {
      setNotice('Task added.')
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
    if (title.trim() && !create.isPending) {
      create.mutate({
        title: title.trim(),
        dueDate: dueDate || null,
        assignedTo: assignedTo || null,
      })
    }
  }
  return (
    <>
      <p className="eyebrow">Tasks</p>
      <h1>Make room for what matters.</h1>
      <p className="intro">A shared place for the things that need doing.</p>
      <div className="tasks-toolbar">
        <p className="task-meta">Adding as {profile.name}</p>
        <button className="button-primary" ref={addButton} aria-expanded={formOpen} aria-controls="add-task-form" onClick={() => { if (!formOpen) { create.reset(); setNotice(''); setFormOpen(true) } }}>+ Add task</button>
      </div>
      {notice && <p role="status" className="task-notice">{notice}</p>}
      {formOpen && <form id="add-task-form" className="card task-form" onSubmit={submit}>
        <h2>Add a task</h2>
        <fieldset disabled={create.isPending}>
          <label>Title<input autoFocus required value={title} onChange={event => setTitle(event.target.value)} placeholder="What needs doing?" /></label>
          <div className="task-form-options">
            <label>Due date <span className="optional">(optional)</span><input type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} /></label>
            <label>Assigned to<select value={assignedTo} onChange={event => setAssignedTo(event.target.value)}><option value="">Shared</option>{householdMembers.data?.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
          </div>
          {householdMembers.isPending && <p className="task-meta" role="status">Loading household members…</p>}
          {householdMembers.isError && <p className="error-message" role="alert">Could not load household members: {householdMembers.error.message}</p>}
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
          {items.length ? <ul className="task-list">{items.map(task => <TaskItem key={task.id} task={task} api={api} queryKey={queryKey} members={householdMembers.data} />)}</ul> : <p className="section-empty">{heading === 'Today' ? 'Nothing due today.' : heading === 'No due date' ? 'No undated tasks.' : `No ${heading.toLowerCase()} tasks.`}</p>}
        </section>)}
      </div>}
    </>
  )
}
