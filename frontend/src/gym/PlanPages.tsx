import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthGate'
import { PageHeader } from '../components/PageHeader'
import { useToast } from '../components/ToastProvider'
import { createGymApi } from './api'
import { exercisePrescription, getGymPlanProgress, getGymTemplateSummary } from './gym'
import { gymKeys } from './queries'
import type { GymPlan, GymPlanProgress, GymPlanSlot } from './types'

function planStatusLabel(status: GymPlan['status']) {
  if (status === 'active') return 'Aktywny'
  if (status === 'completed') return 'Ukończony'
  return 'Zakończony wcześniej'
}

function slotStatusLabel(status: GymPlanSlot['status']) {
  if (status === 'completed') return 'Ukończony'
  if (status === 'in_progress') return 'W trakcie'
  return 'Do zrobienia'
}

function dayName(plan: GymPlan, dayNumber: number) {
  return plan.definitionSnapshot.days[dayNumber - 1]?.name.trim() || `Dzień ${dayNumber}`
}

function planDate(value: string) {
  return new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' }).format(new Date(value))
}

function progressLabel(progress: GymPlanProgress) {
  const remaining = progress.totalCount - progress.completedCount
  const remainingLabel = remaining === 1 ? 'trening do ukończenia' : remaining < 5 ? 'treningi do ukończenia' : 'treningów do ukończenia'
  return `${progress.completedCount} z ${progress.totalCount} treningów ukończonych · ${remaining} ${remainingLabel}`
}

function PlanProgressSummary({ plan, progress }: { plan: GymPlan; progress: GymPlanProgress }) {
  const percent = progress.totalCount > 0 ? Math.round(progress.completedCount / progress.totalCount * 100) : 0
  const currentDay = progress.currentSlot ? dayName(plan, progress.currentSlot.dayNumber) : null

  return <section className="panel gym-plan-summary" aria-labelledby="gym-progress-title">
    <div className="gym-plan-summary-heading">
      <div><p className="panel-kicker">Postęp planu</p><h2 className="panel-title" id="gym-progress-title">{plan.name}</h2></div>
      <span className={`gym-plan-status is-${plan.status}`}>{planStatusLabel(plan.status)}</span>
    </div>
    <p className="gym-plan-meta">{plan.weeksCount} {plan.weeksCount === 1 ? 'tydzień' : plan.weeksCount < 5 ? 'tygodnie' : 'tygodni'} · {plan.daysPerWeek} dni treningowych w tygodniu · rozpoczęty {planDate(plan.startedAt)}</p>
    <div className="gym-progress-track" role="progressbar" aria-label="Ukończone treningi" aria-valuemin={0} aria-valuemax={progress.totalCount} aria-valuenow={progress.completedCount}>
      <span style={{ width: `${percent}%` }} />
    </div>
    <div className="gym-progress-caption"><strong>{progressLabel(progress)}</strong><span>{progress.completedWeeks} z {plan.weeksCount} ukończonych tygodni</span></div>
    {progress.currentSlot && <p className="gym-next-slot"><strong>Następny trening:</strong> tydzień {progress.currentSlot.weekNumber}, dzień {progress.currentSlot.dayNumber} · {currentDay}</p>}
    {plan.status === 'completed' && <p className="gym-plan-note" role="status">Plan ukończony {plan.completedAt ? planDate(plan.completedAt) : ''}.</p>}
    {plan.status === 'abandoned' && <p className="gym-plan-note" role="status">Plan zakończony {plan.abandonedAt ? planDate(plan.abandonedAt) : ''}. Zapisane treningi pozostały w historii.</p>}
  </section>
}

export function GymHomePage() {
  const { profile } = useAuth()
  const api = createGymApi(profile.id)
  const activePlan = useQuery({
    queryKey: gymKeys.activePlan(profile.id),
    queryFn: ({ signal }) => api.activePlan(signal),
  })
  const workouts = useQuery({
    queryKey: gymKeys.workouts(profile.id, activePlan.data?.id ?? 'active'),
    queryFn: ({ signal }) => api.listWorkouts(activePlan.data!.id, signal),
    enabled: Boolean(activePlan.data),
  })

  return <>
    <PageHeader eyebrow="Trening osobisty" title="Siłownia" description="Twój aktywny plan, postępy i prywatne szablony treningowe." action={<Link className="primary-button" to="/gym/templates">Szablony treningowe</Link>} />
    {activePlan.isPending && <section className="panel"><p className="panel-message" role="status">Sprawdzam aktywny plan…</p></section>}
    {activePlan.isError && <div className="panel error-message" role="alert"><p>Nie udało się pobrać aktywnego planu: {activePlan.error.message}</p><button className="button-quiet" type="button" disabled={activePlan.isFetching} onClick={() => void activePlan.refetch()}>Spróbuj ponownie</button></div>}
    {activePlan.data && workouts.isPending && <section className="panel"><p className="panel-message" role="status">Ładuję postępy…</p></section>}
    {activePlan.data && workouts.isError && <div className="panel error-message" role="alert"><p>Nie udało się pobrać postępów: {workouts.error.message}</p><button className="button-quiet" type="button" disabled={workouts.isFetching} onClick={() => void workouts.refetch()}>Spróbuj ponownie</button></div>}
    {activePlan.data && workouts.data && <PlanProgressSummary plan={activePlan.data} progress={getGymPlanProgress(activePlan.data, workouts.data)} />}
    {activePlan.data && <Link className="gym-home-plan-link" to={`/gym/plans/${activePlan.data.id}`}>Otwórz plan i siatkę treningów <span aria-hidden="true">→</span></Link>}
    {activePlan.data === null && <section className="panel empty-panel gym-no-active-plan">
      <h2>Nie masz aktywnego planu.</h2>
      <p>Wybierz szablon, sprawdź układ tygodnia i rozpocznij swój plan. Możesz mieć jeden aktywny plan naraz.</p>
      <Link className="primary-button gym-empty-action" to="/gym/templates">Przeglądaj szablony</Link>
    </section>}
    <div className="gym-home-secondary-links"><Link className="text-button" to="/gym/history">Historia planów</Link><span aria-hidden="true">·</span><Link className="text-button" to="/gym/templates">Zarządzaj szablonami</Link></div>
  </>
}

export function GymPlanStartPage() {
  const { profile } = useAuth()
  const { templateId } = useParams()
  const api = createGymApi(profile.id)
  const client = useQueryClient()
  const navigate = useNavigate()
  const showToast = useToast()
  const [name, setName] = useState<string | null>(null)
  const template = useQuery({
    queryKey: gymKeys.template(profile.id, templateId ?? 'missing'),
    queryFn: ({ signal }) => api.get(templateId!, signal),
    enabled: Boolean(templateId),
  })
  const activePlan = useQuery({
    queryKey: gymKeys.activePlan(profile.id),
    queryFn: ({ signal }) => api.activePlan(signal),
  })
  const start = useMutation({
    mutationFn: () => api.startPlan(template.data!.id, name ?? template.data!.name),
    onSuccess: async planId => {
      showToast({ kind: 'success', title: 'Rozpoczęto plan treningowy' })
      await client.invalidateQueries({ queryKey: gymKeys.root(profile.id) })
      navigate(`/gym/plans/${planId}`)
    },
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!template.data || activePlan.data || start.isPending) return
    if ((name ?? template.data.name).trim().length > 120) return
    start.mutate()
  }

  if (!templateId) return <><PageHeader eyebrow="Siłownia · Plan" title="Rozpocznij plan" description="Nie podano szablonu." action={<Link className="text-button" to="/gym/templates">Wróć do szablonów</Link>} /><div className="panel error-message" role="alert">Nie znaleziono szablonu w adresie strony.</div></>

  return <>
    <PageHeader eyebrow="Siłownia · Plan" title="Rozpocznij plan" description="Plan dostanie własną kopię ćwiczeń i układu tygodnia. Późniejsze zmiany szablonu nie zmienią tego planu." action={<Link className="text-button" to="/gym/templates">Wróć do szablonów</Link>} />
    {template.isPending && <section className="panel"><p className="panel-message" role="status">Ładuję szablon…</p></section>}
    {template.isError && <div className="panel error-message" role="alert"><p>{template.error.message}</p><button className="button-quiet" type="button" disabled={template.isFetching} onClick={() => void template.refetch()}>Spróbuj ponownie</button></div>}
    {template.data && activePlan.isPending && <section className="panel"><p className="panel-message" role="status">Sprawdzam, czy masz już aktywny plan…</p></section>}
    {activePlan.isError && <div className="panel error-message" role="alert"><p>Nie udało się sprawdzić aktywnego planu: {activePlan.error.message}</p><button className="button-quiet" type="button" disabled={activePlan.isFetching} onClick={() => void activePlan.refetch()}>Spróbuj ponownie</button></div>}
    {template.data && activePlan.data && <section className="panel gym-active-plan-warning" role="status">
      <h2>Masz już aktywny plan: {activePlan.data.name}</h2>
      <p>Zakończ go albo ukończ przed rozpoczęciem kolejnego.</p>
      <Link className="primary-button" to={`/gym/plans/${activePlan.data.id}`}>Otwórz aktywny plan</Link>
    </section>}
    {template.data && activePlan.data === null && <form className="gym-plan-start-form" onSubmit={submit}>
      <section className="panel gym-plan-review">
        <div className="panel-head"><div><p className="panel-kicker">Szablon do skopiowania</p><h2 className="panel-title">{template.data.name}</h2><p className="panel-kicker">{template.data.weeksCount} {template.data.weeksCount === 1 ? 'tydzień' : template.data.weeksCount < 5 ? 'tygodnie' : 'tygodni'} · {getGymTemplateSummary(template.data.definition)}</p></div></div>
        <label className="gym-plan-name-field">Nazwa tego planu <span className="optional">(opcjonalnie; puste pole zachowa nazwę szablonu)</span><input maxLength={120} value={name ?? template.data.name} onChange={event => setName(event.target.value)} /></label>
        <div className="gym-template-days gym-plan-review-days">{template.data.definition.days.map((day, index) => <article key={day.id}>
          <strong>{day.name.trim() || `Dzień ${index + 1}`}</strong>
          {day.blocks.map((block, blockIndex) => <div className={block.type === 'superset' ? 'gym-review-block is-superset' : 'gym-review-block'} key={block.id}>
            <span>{block.type === 'superset' ? `Superseria ${blockIndex + 1}` : 'Ćwiczenie'}</span>
            <ul>{block.exercises.map(exercise => <li key={exercise.id}><strong>{exercise.name}</strong><span>{exercisePrescription(exercise)} · {exercise.load_type === 'weight' ? 'ciężar' : 'masa ciała'}</span></li>)}</ul>
          </div>)}
        </article>)}</div>
      </section>
      {start.isError && <div className="error-message gym-save-error" role="alert"><strong>Nie udało się rozpocząć planu.</strong><p>{start.error.message}</p></div>}
      <div className="gym-editor-actions"><button className="primary-button" type="submit" disabled={start.isPending || activePlan.isPending}>{start.isPending ? 'Rozpoczynam…' : 'Rozpocznij plan'}</button><Link className="button-quiet" to="/gym/templates">Anuluj</Link></div>
    </form>}
  </>
}

export function GymPlanPage() {
  const { profile } = useAuth()
  const { planId } = useParams()
  const api = createGymApi(profile.id)
  const client = useQueryClient()
  const showToast = useToast()
  const [confirmAbandon, setConfirmAbandon] = useState(false)
  const plan = useQuery({
    queryKey: gymKeys.plan(profile.id, planId ?? 'missing'),
    queryFn: ({ signal }) => api.getPlan(planId!, signal),
    enabled: Boolean(planId),
  })
  const workouts = useQuery({
    queryKey: gymKeys.workouts(profile.id, planId ?? 'missing'),
    queryFn: ({ signal }) => api.listWorkouts(planId!, signal),
    enabled: Boolean(planId && plan.data),
  })
  const abandon = useMutation({
    mutationFn: () => api.abandonPlan(plan.data!.id),
    onSuccess: async () => {
      setConfirmAbandon(false)
      showToast({ kind: 'success', title: 'Plan zakończony wcześniej' })
      await client.invalidateQueries({ queryKey: gymKeys.root(profile.id) })
    },
  })

  if (!planId) return <><PageHeader eyebrow="Siłownia" title="Plan treningowy" description="Nie podano identyfikatora planu." /><div className="panel error-message" role="alert">Nie znaleziono planu w adresie strony.</div></>
  if (plan.isPending) return <><PageHeader eyebrow="Siłownia" title="Plan treningowy" description="Ładuję plan…" /><section className="panel"><p className="panel-message" role="status">Ładuję plan…</p></section></>
  if (plan.isError) return <><PageHeader eyebrow="Siłownia" title="Plan treningowy" description="Nie udało się otworzyć planu." action={<Link className="text-button" to="/gym">Wróć do Siłowni</Link>} /><div className="panel error-message" role="alert"><p>{plan.error.message}</p><button className="button-quiet" type="button" disabled={plan.isFetching} onClick={() => void plan.refetch()}>Spróbuj ponownie</button></div></>

  const currentPlan = plan.data
  const progress = getGymPlanProgress(currentPlan, workouts.data ?? [])
  return <>
    <PageHeader eyebrow="Siłownia · Mój plan" title={currentPlan.name} description="Ten plan korzysta z kopii szablonu zapisanej w dniu rozpoczęcia." action={<Link className="text-button" to="/gym">Wróć do Siłowni</Link>} />
    {workouts.isError && <div className="error-message gym-save-error" role="alert"><p>Nie udało się pobrać treningów: {workouts.error.message}</p><button className="button-quiet" type="button" disabled={workouts.isFetching} onClick={() => void workouts.refetch()}>Spróbuj ponownie</button></div>}
    {workouts.isPending && <section className="panel"><p className="panel-message" role="status">Ładuję postępy…</p></section>}
    {workouts.data && <>
      <PlanProgressSummary plan={currentPlan} progress={progress} />
      <section className="gym-weeks" aria-label="Postęp w poszczególnych tygodniach">
        {Array.from({ length: currentPlan.weeksCount }, (_, weekIndex) => {
          const weekNumber = weekIndex + 1
          return <section className="panel gym-week-card" key={weekNumber} aria-labelledby={`gym-week-${weekNumber}`}>
            <div className="gym-week-heading"><h2 id={`gym-week-${weekNumber}`}>Tydzień {weekNumber}</h2><span>{progress.slots.filter(slot => slot.weekNumber === weekNumber && slot.status === 'completed').length} / {currentPlan.daysPerWeek} ukończonych</span></div>
            <div className="gym-week-grid">{progress.slots.filter(slot => slot.weekNumber === weekNumber).map(slot => {
              const isCurrent = progress.currentSlot?.weekNumber === slot.weekNumber && progress.currentSlot.dayNumber === slot.dayNumber
              return <div className={`gym-slot is-${slot.status}${isCurrent ? ' is-next' : ''}`} key={`${slot.weekNumber}-${slot.dayNumber}`} aria-current={isCurrent ? 'step' : undefined}>
                <span className="gym-slot-day">Dzień {slot.dayNumber}</span>
                <strong>{dayName(currentPlan, slot.dayNumber)}</strong>
                <span className="gym-slot-status">{slotStatusLabel(slot.status)}</span>
              </div>
            })}</div>
          </section>
        })}
      </section>
    </>}
    {currentPlan.status === 'active' && <section className="gym-plan-end-section">
      {!confirmAbandon && <button className="text-button item-remove-button" type="button" onClick={() => setConfirmAbandon(true)}>Zakończ plan wcześniej</button>}
      {confirmAbandon && <div className="gym-archive-confirm" role="group" aria-label="Potwierdź zakończenie planu">
        <p>Zakończyć ten plan? Zachowamy ukończone treningi, a niedokończony trening zostanie usunięty.</p>
        <div className="form-actions"><button className="button-quiet" type="button" disabled={abandon.isPending} onClick={() => setConfirmAbandon(false)}>Wróć</button><button className="gym-remove-button" type="button" disabled={abandon.isPending} onClick={() => abandon.mutate()}>{abandon.isPending ? 'Kończę…' : 'Zakończ plan'}</button></div>
        {abandon.isError && <p className="error-message" role="alert">{abandon.error.message}</p>}
      </div>}
    </section>}
  </>
}

export function GymHistoryPage() {
  const { profile } = useAuth()
  const api = createGymApi(profile.id)
  const plans = useQuery({
    queryKey: gymKeys.plans(profile.id),
    queryFn: ({ signal }) => api.listPlans(signal),
  })
  const history = plans.data?.filter(plan => plan.status !== 'active') ?? []

  return <>
    <PageHeader eyebrow="Siłownia" title="Historia planów" description="Ukończone i wcześniej zakończone plany pozostają dostępne razem z zapisanym postępem." action={<Link className="text-button" to="/gym">Wróć do Siłowni</Link>} />
    {plans.isPending && <section className="panel"><p className="panel-message" role="status">Ładuję historię…</p></section>}
    {plans.isError && <div className="panel error-message" role="alert"><p>Nie udało się pobrać historii: {plans.error.message}</p><button className="button-quiet" type="button" disabled={plans.isFetching} onClick={() => void plans.refetch()}>Spróbuj ponownie</button></div>}
    {plans.data && history.length === 0 && <section className="panel empty-panel"><h2>Nie ma jeszcze zakończonych planów.</h2><p>Po ukończeniu planu albo zakończeniu go wcześniej pojawi się tutaj.</p></section>}
    {plans.data && history.length > 0 && <ul className="gym-template-list gym-plan-history-list">{history.map(item => {
      const completedDates = [item.completedAt, item.abandonedAt].filter(Boolean) as string[]
      return <li className="gym-template-card" key={item.id}><div className="gym-template-card-main">
        <div className="gym-template-card-copy"><div className="gym-template-title-row"><h2>{item.name}</h2><span className={`gym-plan-status is-${item.status}`}>{planStatusLabel(item.status)}</span></div>
          <p className="gym-template-meta">{item.weeksCount} {item.weeksCount === 1 ? 'tydzień' : item.weeksCount < 5 ? 'tygodnie' : 'tygodni'} · rozpoczęty {planDate(item.startedAt)}{completedDates[0] ? ` · zakończony ${planDate(completedDates[0])}` : ''}</p>
          <div className="gym-template-days">{item.definitionSnapshot.days.map((day, index) => <span key={day.id}><strong>{day.name.trim() || `Dzień ${index + 1}`}</strong><span>{day.blocks.reduce((count, block) => count + block.exercises.length, 0)} ćwiczeń</span></span>)}</div>
        </div><Link className="text-button" to={`/gym/plans/${item.id}`}>Zobacz plan</Link>
      </div></li>
    })}</ul>}
  </>
}
