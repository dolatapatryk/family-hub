import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AgendaSwitcher, EventList } from '../calendar/AgendaComponents'
import { agenda, type AgendaDay } from '../calendar/agenda'
import { PageHeader } from '../components/PageHeader'
import { useAuth } from '../auth/AuthGate'
import { createShoppingApi } from '../shopping/api'
import { ShoppingItemRow } from '../shopping/ShoppingItemRow'
import { createTasksApi } from '../tasks/api'
import { TaskItem } from '../tasks/TaskItem'

function MetricIcon({ kind }: { kind: 'tasks' | 'calendar' | 'shopping' }) {
  const icon = {
    tasks: <><path d="m8 6 2 2 4-4M8 13l2 2 4-4M8 20l2 2 4-4" /><path d="M18 7h3m-3 7h3m-3 7h3" /></>,
    calendar: <><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M16 2v4M8 2v4M3 10h18M8 14h2m4 0h2" /></>,
    shopping: <><path d="M3 4h2l2.1 11.1a2 2 0 0 0 2 1.6h8.7a2 2 0 0 0 2-1.6L21 8H6" /><circle cx="10" cy="20" r="1" /><circle cx="18" cy="20" r="1" /></>,
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icon[kind]}</svg>
}

function Metric({ kind, tone, number, label }: { kind: 'tasks' | 'calendar' | 'shopping'; tone: string; number: number | string; label: string }) {
  return (
    <article className="metric">
      <div className={`metric-icon ${tone}`}><MetricIcon kind={kind} /></div>
      <div><div className="metric-number">{number}</div><div className="metric-label">{label}</div></div>
    </article>
  )
}

function PlusIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
}

export function DashboardPage() {
  const { profile } = useAuth()
  const client = useQueryClient()
  const tasksApi = createTasksApi(profile.household_id, profile.id)
  const shoppingApi = createShoppingApi(profile.household_id, profile.id)
  const taskKey = ['tasks', profile.household_id]
  const shoppingKey = ['shoppingItems', profile.household_id]
  const tasks = useQuery({ queryKey: taskKey, queryFn: ({ signal }) => tasksApi.list(signal) })
  const shopping = useQuery({ queryKey: shoppingKey, queryFn: ({ signal }) => shoppingApi.list(signal) })
  const [selectedDay, setSelectedDay] = useState<AgendaDay>('today')
  const [formOpen, setFormOpen] = useState(false)
  const [title, setTitle] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const addTask = useMutation({
    mutationFn: (taskTitle: string) => tasksApi.create({ title: taskTitle, dueDate: null }),
    onSuccess: async () => {
      setTitle('')
      setFormOpen(false)
      await client.invalidateQueries({ queryKey: taskKey })
    },
  })

  useEffect(() => {
    if (formOpen) input.current?.focus()
  }, [formOpen])

  function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedTitle = title.trim()
    if (!trimmedTitle || addTask.isPending) return
    addTask.mutate(trimmedTitle)
  }

  const allTasks = tasks.data ?? []
  const openTasks = allTasks.filter(task => !task.completed)
  const doneCount = allTasks.length - openTasks.length
  const openShopping = (shopping.data ?? []).filter(item => !item.completed)
  const selectedAgenda = agenda[selectedDay]
  const dateLabel = new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()).toLocaleUpperCase('pl-PL')
  const visibleTasks = openTasks.slice(0, 4)
  const visibleShopping = openShopping.slice(0, 3)
  const progress = allTasks.length ? Math.round((doneCount / allTasks.length) * 100) : 0

  return (
    <>
      <PageHeader
        eyebrow={dateLabel}
        title="Dziś w domu"
        description="Zadania, zakupy i najbliższe plany w jednym miejscu."
        action={<button className="primary-button" type="button" aria-expanded={formOpen} aria-controls="quick-task-form" onClick={() => { if (!formOpen) addTask.reset(); setFormOpen(open => !open) }}><PlusIcon /><span>Dodaj zadanie</span></button>}
      />

      <div className="household-note" role="note">
        <span className="note-icon" aria-hidden="true">i</span>
        <span><strong>Wspólny plan domu.</strong> Zadania i zakupy są widoczne dla wszystkich domowników.</span>
      </div>

      <form className="quick-form" id="quick-task-form" hidden={!formOpen} onSubmit={submitTask}>
        <input ref={input} type="text" maxLength={90} required value={title} onChange={event => setTitle(event.target.value)} placeholder="Co trzeba zrobić?" aria-label="Treść nowego zadania" disabled={addTask.isPending} />
        <button className="primary-button" type="submit" disabled={!title.trim() || addTask.isPending}>{addTask.isPending ? 'Dodaję…' : 'Dodaj'}</button>
        <button className="text-button" type="button" onClick={() => { setFormOpen(false); setTitle('') }}>Anuluj</button>
        {addTask.isError && <p className="error-message form-error" role="alert">{addTask.error.message}</p>}
      </form>

      <section className="metrics" aria-label="Podsumowanie">
        <Metric kind="tasks" tone="lime" number={tasks.isPending ? '—' : openTasks.length} label="otwarte zadania" />
        <Metric kind="calendar" tone="blue" number={agenda.today.events.length} label="plany na dziś" />
        <Metric kind="shopping" tone="orange" number={shopping.isPending ? '—' : openShopping.length} label="pozycji na liście" />
      </section>

      <div className="dashboard-grid">
        <section className="panel" aria-labelledby="dashboard-tasks-title">
          <div className="panel-head">
            <div><h2 className="panel-title" id="dashboard-tasks-title">Plan na dziś</h2><p className="panel-kicker">Małe rzeczy, które robią różnicę</p></div>
            <Link className="link-button" to="/tasks">Wszystkie <span className="arrow" aria-hidden="true">›</span></Link>
          </div>
          {tasks.isPending && <p className="panel-message" role="status">Ładuję zadania…</p>}
          {tasks.isError && <div className="panel-message error-message" role="alert">Nie udało się pobrać zadań. <button className="link-button" type="button" onClick={() => void tasks.refetch()}>Spróbuj ponownie</button></div>}
          {tasks.data && <ul className="task-list dashboard-list">
            {visibleTasks.length ? visibleTasks.map(task => <TaskItem key={task.id} task={task} api={tasksApi} queryKey={taskKey} showArchive={false} />) : <li className="empty-state">Nie ma otwartych zadań. Dodaj pierwsze zadanie.</li>}
          </ul>}
          {tasks.data && <div className="panel-foot">
            <span>Ukończone {doneCount} z {allTasks.length}</span>
            <span className="progress-track" role="progressbar" aria-label="Ukończone zadania" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span className="progress-bar" style={{ width: `${progress}%` }} /></span>
          </div>}
        </section>

        <section className="panel" aria-labelledby="dashboard-agenda-title">
          <div className="panel-head">
            <div><h2 className="panel-title" id="dashboard-agenda-title">Najbliższe plany</h2><p className="panel-kicker">{selectedAgenda.label} · przykładowy kalendarz</p></div>
            <AgendaSwitcher selectedDay={selectedDay} onSelect={setSelectedDay} />
          </div>
          <EventList events={selectedAgenda.events.slice(0, 3)} label={selectedAgenda.title} />
          <div className="panel-foot"><span>Przykładowe wydarzenia</span><Link className="link-button" to="/calendar">Otwórz kalendarz <span className="arrow" aria-hidden="true">›</span></Link></div>
        </section>
      </div>

      <div className="lower-grid">
        <section className="panel" aria-labelledby="dashboard-shopping-title">
          <div className="panel-head">
            <div><h2 className="panel-title" id="dashboard-shopping-title">Lista zakupów</h2><p className="panel-kicker">Wspólna lista, zawsze pod ręką</p></div>
            <Link className="link-button" to="/shopping">Otwórz listę <span className="arrow" aria-hidden="true">›</span></Link>
          </div>
          {shopping.isPending && <p className="panel-message" role="status">Ładuję listę…</p>}
          {shopping.isError && <p className="panel-message error-message" role="alert">Nie udało się pobrać listy zakupów.</p>}
          {shopping.data && <ul className="task-list dashboard-list">
            {visibleShopping.length ? visibleShopping.map(item => <ShoppingItemRow key={item.id} item={item} api={shoppingApi} queryKey={shoppingKey} />) : <li className="empty-state">Lista jest pusta. Dodaj produkt.</li>}
          </ul>}
        </section>
        <article className="panel week-note">
          <div className="note-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.64 5.64l2.12 2.12m8.48 8.48 2.12 2.12m0-12.72-2.12 2.12m-8.48 8.48-2.12 2.12" /><circle cx="12" cy="12" r="4" /></svg></div>
          <div><h2>Prościej, kiedy plan jest wspólny</h2><p>Dodaj zadanie, odhacz zakupy albo sprawdź przykładowe wydarzenia z kalendarza.</p></div>
        </article>
      </div>
    </>
  )
}
