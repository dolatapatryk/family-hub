import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthGate'
import { PageHeader } from '../components/PageHeader'
import { createHouseholdMembersApi, type HouseholdMember } from '../household/api'
import { createTasksApi, type CreateTaskInput } from './api'
import { TaskItem } from './TaskItem'
import { groupTasks, type Task } from './tasks'

function memberName(members: HouseholdMember[] | undefined, memberId: string | null) {
  if (!memberId) return 'Wspólne'
  return members?.find(member => member.id === memberId)?.name ?? 'Domownik'
}

const sectionLabels: Record<string, string> = {
  Overdue: 'Po terminie',
  Today: 'Dziś',
  Upcoming: 'Nadchodzące',
  'No due date': 'Bez terminu',
  Completed: 'Ukończone',
}

function emptySectionMessage(heading: string) {
  if (heading === 'Today') return 'Na dziś nie ma zadań.'
  if (heading === 'No due date') return 'Nie ma zadań bez terminu.'
  if (heading === 'Completed') return 'Ukończone zadania pojawią się tutaj.'
  return `Brak zadań: ${sectionLabels[heading]?.toLocaleLowerCase('pl-PL') ?? heading.toLocaleLowerCase('pl-PL')}.`
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
  const titleInput = useRef<HTMLInputElement>(null)
  const householdMembersApi = createHouseholdMembersApi(profile.household_id)
  const householdMembers = useQuery({
    queryKey: ['members', profile.household_id],
    queryFn: ({ signal }) => householdMembersApi.list(signal),
  })
  const tasks = useQuery({ queryKey, queryFn: ({ signal }) => api.list(signal) })
  const create = useMutation({
    mutationFn: (input: CreateTaskInput) => api.create(input),
    onSuccess: async () => {
      setNotice('Zadanie dodane.')
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

  const tasksBySection = tasks.data?.length ? groupTasks(tasks.data) : undefined
  const openCount = tasks.data?.filter(task => !task.completed).length ?? 0

  useEffect(() => {
    if (formOpen) titleInput.current?.focus()
  }, [formOpen])

  return (
    <>
      <PageHeader
        eyebrow="Wspólny plan"
        title="Zadania"
        description="Zbierz drobne sprawy w jednym, wspólnym planie."
        action={<button className="primary-button" type="button" ref={addButton} aria-label={formOpen ? 'Anuluj dodawanie zadania' : 'Dodaj zadanie'} aria-expanded={formOpen} aria-controls="add-task-form" onClick={() => { if (!formOpen) { create.reset(); setNotice('') } setFormOpen(open => !open) }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">{formOpen ? <path d="m18 6-12 12M6 6l12 12" /> : <path d="M12 5v14M5 12h14" />}</svg>
          <span>{formOpen ? 'Anuluj' : 'Dodaj zadanie'}</span>
        </button>}
      />
      <div className="tasks-toolbar">
        <p className="task-meta">Dodajesz jako <strong>{profile.name}</strong></p>
        {tasks.data && <span className="small-muted">{openCount} otwartych · {tasks.data.length - openCount} ukończonych</span>}
      </div>
      {notice && <p role="status" className="task-notice">{notice}</p>}
      <form id="add-task-form" className="panel task-form" hidden={!formOpen} onSubmit={submit}>
        <div className="panel-head"><div><h2 className="panel-title">Dodaj zadanie</h2><p className="panel-kicker">Dodaj termin lub przypisz je do domownika.</p></div></div>
        <fieldset disabled={create.isPending}>
          <label>Tytuł<input ref={titleInput} required value={title} onChange={event => setTitle(event.target.value)} placeholder="Co trzeba zrobić?" /></label>
          <div className="task-form-options">
            <label>Termin <span className="optional">(opcjonalnie)</span><input type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} /></label>
            <label>Przypisz do<select value={assignedTo} onChange={event => setAssignedTo(event.target.value)}><option value="">Wspólne</option>{householdMembers.data?.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
          </div>
          {householdMembers.isPending && <p className="task-meta" role="status">Ładuję domowników…</p>}
          {householdMembers.isError && <p className="error-message" role="alert">Nie udało się pobrać listy domowników: {householdMembers.error.message}</p>}
          {create.isError && <p className="error-message" role="alert">{create.error.message}</p>}
          <div className="form-actions"><button className="primary-button" type="submit" disabled={!title.trim()}>{create.isPending ? 'Dodaję…' : 'Dodaj zadanie'}</button><button type="button" className="button-quiet" onClick={() => { setFormOpen(false); addButton.current?.focus() }}>Anuluj</button></div>
        </fieldset>
      </form>
      {tasks.isPending && <p className="panel-message" role="status">Ładuję zadania…</p>}
      {tasks.isError && <div className="error-message" role="alert"><p>{tasks.error.message}</p><button className="button-quiet" disabled={tasks.isFetching} onClick={() => void tasks.refetch()}>{tasks.isFetching ? 'Ponawiam…' : 'Spróbuj ponownie'}</button></div>}
      {tasks.data?.length === 0 && <div className="panel empty-panel"><h2>Trochę oddechu.</h2><p>Nie ma jeszcze zadań. Dodaj pierwsze powyżej.</p></div>}
      {tasksBySection && <div className="task-sections">
        {Object.entries(tasksBySection).map(([heading, items]) => <TaskSection key={heading} heading={heading} items={items} api={api} queryKey={queryKey} members={householdMembers.data} />)}
      </div>}
    </>
  )
}

function TaskSection({ heading, items, api, queryKey, members }: {
  heading: string
  items: Task[]
  api: ReturnType<typeof createTasksApi>
  queryKey: readonly unknown[]
  members: HouseholdMember[] | undefined
}) {
  return (
    <section className="task-section" aria-label={sectionLabels[heading] ?? heading}>
      <h2>{sectionLabels[heading] ?? heading}<span className="task-count">{items.length}</span></h2>
      {items.length ? <ul className="task-list">{items.map(task => <TaskItem key={task.id} task={task} api={api} queryKey={queryKey} assignedLabel={memberName(members, task.assignedTo)} />)}</ul> : <p className="section-empty">{emptySectionMessage(heading)}</p>}
    </section>
  )
}
