import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthGate'
import { PageHeader } from '../components/PageHeader'
import { useToast } from '../components/ToastProvider'
import { createHouseholdMembersApi, type HouseholdMember } from '../household/api'
import { createTasksApi, type CreateRecurringTaskInput, type CreateTaskInput } from './api'
import { TaskItem } from './TaskItem'
import { formatDueDate, groupTasks, type RecurrenceCadence, type RecurringTaskRule, type Task } from './tasks'

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

const cadenceLabels: Record<RecurrenceCadence, string> = {
  weekly: 'Co tydzień',
  monthly: 'Co miesiąc',
}

type AddTaskInput = CreateTaskInput & { cadence: RecurrenceCadence | '' }

function emptySectionMessage(heading: string) {
  if (heading === 'Today') return 'Na dziś nie ma zadań.'
  if (heading === 'No due date') return 'Nie ma zadań bez terminu.'
  if (heading === 'Completed') return 'Ukończone zadania pojawią się tutaj.'
  return `Brak zadań: ${sectionLabels[heading]?.toLocaleLowerCase('pl-PL') ?? heading.toLocaleLowerCase('pl-PL')}.`
}

export function TasksPage() {
  const { profile } = useAuth()
  const showToast = useToast()
  const client = useQueryClient()
  const api = createTasksApi(profile.household_id, profile.id)
  const queryKey = ['tasks', profile.household_id]
  const [formOpen, setFormOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [cadence, setCadence] = useState<RecurrenceCadence | ''>('')
  const addButton = useRef<HTMLButtonElement>(null)
  const dialogTitleId = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const titleInput = useRef<HTMLInputElement>(null)
  const householdMembersApi = createHouseholdMembersApi(profile.household_id)
  const householdMembers = useQuery({
    queryKey: ['members', profile.household_id],
    queryFn: ({ signal }) => householdMembersApi.list(signal),
  })
  const tasks = useQuery({ queryKey, queryFn: ({ signal }) => api.list(signal) })
  const recurringQueryKey = ['recurringTasks', profile.household_id]
  const recurringTasks = useQuery({ queryKey: recurringQueryKey, queryFn: ({ signal }) => api.listRecurring(signal) })
  const create = useMutation<Task | string, Error, AddTaskInput>({
    mutationFn: (input: AddTaskInput) => input.cadence
      ? api.createRecurring({
        title: input.title,
        startDate: input.dueDate ?? '',
        cadence: input.cadence,
        assignedTo: input.assignedTo,
      } satisfies CreateRecurringTaskInput)
      : api.create(input),
    onSuccess: async (_saved, input) => {
      showToast({
        kind: 'success',
        title: input.cadence ? 'Dodano stałe zadanie' : 'Dodano zadanie',
        description: input.cadence ? 'Następny termin pojawi się po ukończeniu lub pominięciu bieżącego.' : input.title,
      })
      setTitle('')
      setDueDate('')
      setAssignedTo('')
      setCadence('')
      setFormOpen(false)
      addButton.current?.focus()
      await client.invalidateQueries({ queryKey })
      await client.invalidateQueries({ queryKey: recurringQueryKey })
    },
    onError: (error, input) => showToast({ kind: 'error', title: 'Nie udało się dodać zadania', description: error.message, action: { label: 'Spróbuj ponownie', onClick: () => create.mutate(input) } }),
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (title.trim() && (!cadence || dueDate) && !create.isPending) {
      create.mutate({
        title: title.trim(),
        dueDate: dueDate || null,
        assignedTo: assignedTo || null,
        cadence,
      })
    }
  }

  function openTaskDialog() {
    create.reset()
    setFormOpen(true)
  }

  function closeTaskDialog() {
    if (create.isPending) return
    setTitle('')
    setDueDate('')
    setAssignedTo('')
    setCadence('')
    create.reset()
    setFormOpen(false)
  }

  const tasksBySection = tasks.data?.length ? groupTasks(tasks.data) : undefined
  const openCount = tasks.data?.filter(task => !task.completed).length ?? 0

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (formOpen) {
      if (!element.open) element.showModal()
      titleInput.current?.focus()
    } else if (element.open) {
      element.close()
    }
  }, [formOpen])

  return (
    <>
      <PageHeader
        eyebrow="Wspólny plan"
        title="Zadania"
        description="Zbierz drobne sprawy w jednym, wspólnym planie."
        action={<button className="primary-button" type="button" ref={addButton} aria-label={formOpen ? 'Zamknij dodawanie zadania' : 'Dodaj zadanie'} aria-expanded={formOpen} aria-controls="add-task-dialog" onClick={() => formOpen ? closeTaskDialog() : openTaskDialog()}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">{formOpen ? <path d="m18 6-12 12M6 6l12 12" /> : <path d="M12 5v14M5 12h14" />}</svg>
          <span>{formOpen ? 'Anuluj' : 'Dodaj zadanie'}</span>
        </button>}
      />
      {tasks.data && <div className="tasks-toolbar">
        <span className="small-muted">{openCount} otwartych · {tasks.data.length - openCount} ukończonych</span>
      </div>}
      <dialog
        id="add-task-dialog"
        ref={dialog}
        className="task-dialog"
        aria-labelledby={dialogTitleId}
        onCancel={event => {
          event.preventDefault()
          closeTaskDialog()
        }}
        onClick={event => {
          if (event.target === event.currentTarget) closeTaskDialog()
        }}
      >
        <form id="add-task-form" className="task-form task-dialog-form" onSubmit={submit}>
          <div className="task-dialog-header">
            <div><h2 className="panel-title" id={dialogTitleId}>Dodaj zadanie</h2><p className="panel-kicker">Dodaj termin lub przypisz je do domownika.</p></div>
            <button className="button-quiet task-dialog-close" type="button" aria-label="Zamknij okno dodawania zadania" disabled={create.isPending} onClick={closeTaskDialog}>×</button>
          </div>
          <fieldset disabled={create.isPending}>
            <label>Tytuł<input ref={titleInput} required value={title} onChange={event => setTitle(event.target.value)} placeholder="Co trzeba zrobić?" /></label>
            <div className="task-form-options">
              <label>Termin {!cadence && <span className="optional">(opcjonalnie)</span>}<input type="date" required={Boolean(cadence)} value={dueDate} onChange={event => setDueDate(event.target.value)} /></label>
              <label>Przypisz do<select value={assignedTo} onChange={event => setAssignedTo(event.target.value)}><option value="">Wspólne</option>{householdMembers.data?.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
            </div>
            <label className="task-repeat-field">Powtarzanie<select value={cadence} onChange={event => setCadence(event.target.value as RecurrenceCadence | '')}><option value="">Jednorazowo</option><option value="weekly">Co tydzień</option><option value="monthly">Co miesiąc</option></select></label>
            <p className="task-repeat-note">Rachunki z miesięczną kwotą i historią płatności dodaj w sekcji Rachunki.</p>
            {cadence && <p className="task-repeat-note">Następny termin utworzy się po ukończeniu lub pominięciu tego wystąpienia. Rytm liczy się od poprzedniego terminu; dla końca miesiąca data dopasuje się do ostatniego dnia.</p>}
            {householdMembers.isPending && <p className="task-meta" role="status">Ładuję domowników…</p>}
            {householdMembers.isError && <p className="error-message" role="alert">Nie udało się pobrać listy domowników: {householdMembers.error.message}</p>}
          </fieldset>
          <div className="task-dialog-actions"><button className="primary-button" type="submit" disabled={!title.trim() || (Boolean(cadence) && !dueDate) || create.isPending}>{create.isPending ? 'Dodaję…' : 'Dodaj zadanie'}</button><button type="button" className="button-quiet" disabled={create.isPending} onClick={closeTaskDialog}>Anuluj</button></div>
        </form>
      </dialog>
      {recurringTasks.isPending && <p className="task-meta" role="status">Ładuję stałe zadania…</p>}
      {recurringTasks.isError && <p className="error-message" role="alert">Nie udało się pobrać stałych zadań: {recurringTasks.error.message}</p>}
      {recurringTasks.data && recurringTasks.data.length > 0 && <section className="panel recurring-panel" aria-labelledby="recurring-tasks-title">
        <div className="panel-head"><div><h2 className="panel-title" id="recurring-tasks-title">Stałe zadania</h2><p className="panel-kicker">Wystąpienia tworzą się po ukończeniu lub pominięciu poprzedniego terminu.</p></div></div>
        <ul className="recurring-list">{recurringTasks.data.map(rule => <RecurringTaskRuleItem key={rule.id} rule={rule} api={api} taskQueryKey={queryKey} rulesQueryKey={recurringQueryKey} members={householdMembers.data} />)}</ul>
      </section>}
      {tasks.isPending && <p className="panel-message" role="status">Ładuję zadania…</p>}
      {tasks.isError && <div className="error-message" role="alert"><p>{tasks.error.message}</p><button className="button-quiet" disabled={tasks.isFetching} onClick={() => void tasks.refetch()}>{tasks.isFetching ? 'Ponawiam…' : 'Spróbuj ponownie'}</button></div>}
      {tasks.data?.length === 0 && <div className="panel empty-panel"><h2>Trochę oddechu.</h2><p>Nie ma jeszcze zadań. Dodaj pierwsze powyżej.</p></div>}
      {tasksBySection && <div className="task-sections">
        {Object.entries(tasksBySection).map(([heading, items]) => <TaskSection key={heading} heading={heading} items={items} api={api} queryKey={queryKey} members={householdMembers.data} />)}
      </div>}
    </>
  )
}

function RecurringTaskRuleItem({ rule, api, taskQueryKey, rulesQueryKey, members }: {
  rule: RecurringTaskRule
  api: ReturnType<typeof createTasksApi>
  taskQueryKey: readonly unknown[]
  rulesQueryKey: readonly unknown[]
  members: HouseholdMember[] | undefined
}) {
  const client = useQueryClient()
  const showToast = useToast()
  const [confirming, setConfirming] = useState(false)
  const stop = useMutation({
    mutationFn: () => api.stopRecurring(rule.id),
    onSuccess: async () => {
      setConfirming(false)
      showToast({ kind: 'success', title: 'Zatrzymano stałe zadanie', description: rule.title })
      await client.invalidateQueries({ queryKey: taskQueryKey })
      await client.invalidateQueries({ queryKey: rulesQueryKey })
    },
    onError: error => showToast({ kind: 'error', title: 'Nie udało się zatrzymać stałego zadania', description: error.message, action: { label: 'Spróbuj ponownie', onClick: () => stop.mutate() } }),
  })

  return <li className="recurring-item">
    <div className="recurring-item-copy">
      <strong>{rule.title}</strong>
      <span>{cadenceLabels[rule.cadence]} · Pierwszy termin: {formatDueDate(rule.startDate)} · {memberName(members, rule.assignedTo)}</span>
    </div>
    {!confirming
      ? <button className="text-button" type="button" disabled={stop.isPending} onClick={() => { stop.reset(); setConfirming(true) }}>Zatrzymaj</button>
      : <div className="recurring-confirm">
        <span>Zatrzymać tworzenie kolejnych wystąpień?</span>
        <button className="button-quiet" type="button" disabled={stop.isPending} onClick={() => stop.mutate()}>{stop.isPending ? 'Zatrzymuję…' : 'Zatrzymaj serię'}</button>
        <button className="text-button" type="button" disabled={stop.isPending} onClick={() => setConfirming(false)}>Anuluj</button>
      </div>}
  </li>
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
      {items.length ? <ul className="task-list">{items.map(task => <TaskItem key={task.id} task={task} api={api} queryKey={queryKey} members={members} assignedLabel={memberName(members, task.assignedTo)} />)}</ul> : <p className="section-empty">{emptySectionMessage(heading)}</p>}
    </section>
  )
}
