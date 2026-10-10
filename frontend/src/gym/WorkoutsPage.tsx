import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthGate'
import { PageHeader } from '../components/PageHeader'
import { useToast } from '../components/ToastProvider'
import { createGymApi } from './api'
import { formatGymWeight, getGymPlanProgress, gymWeightInputValue, parseGymIntegerInput, parseGymWeightInput } from './gym'
import { gymKeys } from './queries'
import type {
  GymDay,
  GymExercise,
  GymPlan,
  GymWorkoutDetails,
  GymWorkoutExerciseInput,
  GymWorkoutSetInput,
} from './types'

interface WorkoutFormState {
  defaults: Record<string, string>
  actuals: Record<string, string>
  overrides: Record<string, string>
}

interface WorkoutValidation {
  input: GymWorkoutExerciseInput[]
  issues: string[]
}

function parseSlot(value: string | undefined) {
  if (!value || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function setKey(exerciseId: string, setNumber: number) {
  return `${exerciseId}:${setNumber}`
}

function exercisesForDay(day: GymDay): GymExercise[] {
  return day.blocks.flatMap(block => block.exercises)
}

function blankForm(day: GymDay, details: GymWorkoutDetails): WorkoutFormState {
  const exercises = new Map(details.exercises.map(result => [result.exerciseId, result]))
  const sets = new Map(details.sets.map(result => [setKey(result.exerciseId, result.setNumber), result]))
  const form: WorkoutFormState = { defaults: {}, actuals: {}, overrides: {} }
  for (const exercise of exercisesForDay(day)) {
    form.defaults[exercise.id] = gymWeightInputValue(exercises.get(exercise.id)?.defaultWeightGrams ?? null)
    for (let setNumber = 1; setNumber <= exercise.sets; setNumber += 1) {
      const key = setKey(exercise.id, setNumber)
      const result = sets.get(key)
      const actual = exercise.mode === 'reps' ? result?.actualReps : result?.actualSeconds
      form.actuals[key] = actual === null || actual === undefined ? '' : String(actual)
      form.overrides[key] = gymWeightInputValue(result?.weightOverrideGrams ?? null)
    }
  }
  return form
}

function targetLabel(exercise: GymExercise) {
  const target = exercise.target_min === exercise.target_max
    ? String(exercise.target_min)
    : `${exercise.target_min}–${exercise.target_max}`
  return exercise.mode === 'reps' ? `${target} powt.` : `${target} s`
}

function actualLabel(exercise: GymExercise) {
  const result = exercise.mode === 'reps' ? 'Powtórzenia' : 'Czas (sekundy)'
  return `${result}${exercise.unilateral ? ' na stronę' : ''}`
}

function localDateNow() {
  const date = new Date()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function formatSavedTime(value: string | null) {
  if (!value) return null
  return new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function makeWorkoutInput(day: GymDay, form: WorkoutFormState, requireComplete: boolean): WorkoutValidation {
  const input: GymWorkoutExerciseInput[] = []
  const issues: string[] = []

  for (const exercise of exercisesForDay(day)) {
    const defaultWeight = exercise.load_type === 'weight'
      ? parseGymWeightInput(form.defaults[exercise.id] ?? '')
      : null
    if (typeof defaultWeight === 'number' && Number.isNaN(defaultWeight)) {
      issues.push(`${exercise.name}: wpisz ciężar bazowy jako kg z maksymalnie trzema miejscami po przecinku.`)
    }

    const sets: GymWorkoutSetInput[] = []
    for (let setNumber = 1; setNumber <= exercise.sets; setNumber += 1) {
      const key = setKey(exercise.id, setNumber)
      const actual = parseGymIntegerInput(form.actuals[key] ?? '')
      if (typeof actual === 'number' && Number.isNaN(actual)) {
        issues.push(`${exercise.name}, seria ${setNumber}: wynik musi być nieujemną liczbą całkowitą.`)
      } else if (actual === null && requireComplete) {
        issues.push(`${exercise.name}, seria ${setNumber}: wpisz wykonane ${exercise.mode === 'reps' ? 'powtórzenia' : 'sekundy'}.`)
      }

      const weightOverride = exercise.load_type === 'weight'
        ? parseGymWeightInput(form.overrides[key] ?? '')
        : null
      if (typeof weightOverride === 'number' && Number.isNaN(weightOverride)) {
        issues.push(`${exercise.name}, seria ${setNumber}: wpisz ciężar jako kg z maksymalnie trzema miejscami po przecinku.`)
      }

      sets.push({
        set_number: setNumber,
        actual_reps: exercise.mode === 'reps' && !Number.isNaN(actual) ? actual : null,
        actual_seconds: exercise.mode === 'time' && !Number.isNaN(actual) ? actual : null,
        weight_override_grams: !Number.isNaN(weightOverride) ? weightOverride : null,
      })
    }
    input.push({
      exercise_id: exercise.id,
      default_weight_grams: !Number.isNaN(defaultWeight) ? defaultWeight : null,
      sets,
    })
  }

  return { input, issues: [...new Set(issues)] }
}

function planDayName(plan: GymPlan, dayNumber: number) {
  return plan.definitionSnapshot.days[dayNumber - 1]?.name.trim() || `Dzień ${dayNumber}`
}

export function GymWorkoutPage() {
  const { profile } = useAuth()
  const { planId, week: weekParam, day: dayParam } = useParams()
  const weekNumber = parseSlot(weekParam)
  const dayNumber = parseSlot(dayParam)
  const api = createGymApi(profile.id)
  const client = useQueryClient()
  const navigate = useNavigate()
  const showToast = useToast()
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
  const workout = workouts.data?.find(item => item.weekNumber === weekNumber && item.dayNumber === dayNumber)
  const details = useQuery({
    queryKey: gymKeys.workout(profile.id, workout?.id ?? 'missing'),
    queryFn: ({ signal }) => api.getWorkoutDetails(workout!.id, signal),
    enabled: Boolean(workout?.id),
  })
  const day = plan.data && dayNumber ? plan.data.definitionSnapshot.days[dayNumber - 1] : undefined
  const progress = plan.data && workouts.data ? getGymPlanProgress(plan.data, workouts.data) : null
  const isCurrentSlot = progress?.currentSlot?.weekNumber === weekNumber && progress?.currentSlot?.dayNumber === dayNumber
  const isCompleted = workout?.status === 'completed'
  const canEditDraft = workout?.status === 'draft' && plan.data?.status === 'active' && isCurrentSlot
  const canCorrect = isCompleted
  const [form, setForm] = useState<WorkoutFormState | null>(null)
  const [revision, setRevision] = useState<number | null>(null)
  const [initializedId, setInitializedId] = useState<string | null>(null)
  const [editVersion, setEditVersion] = useState(0)
  const [savedVersion, setSavedVersion] = useState(0)
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)
  const [validationIssues, setValidationIssues] = useState<string[]>([])
  const [expandedOverrides, setExpandedOverrides] = useState<Record<string, boolean>>({})
  const [completionDate, setCompletionDate] = useState<string | null>(null)
  const stateRef = useRef({ dirty: false })
  const dirty = editVersion > savedVersion
  stateRef.current.dirty = dirty

  useEffect(() => {
    if (!details.data || !day || initializedId === details.data.workout.id) return
    setForm(blankForm(day, details.data))
    setExpandedOverrides(Object.fromEntries(exercisesForDay(day).map(exercise => [exercise.id, false])))
    setRevision(details.data.workout.revision)
    setInitializedId(details.data.workout.id)
    setEditVersion(0)
    setSavedVersion(0)
    setLastSavedAt(details.data.workout.updatedAt)
    setValidationIssues([])
    setCompletionDate(null)
  }, [details.data, day, initializedId])

  useEffect(() => {
    const confirmNavigation = (event: MouseEvent) => {
      if (!stateRef.current.dirty || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const target = event.target
      if (!(target instanceof Element)) return
      const link = target.closest('a[href]') as HTMLAnchorElement | null
      if (!link || link.target || link.hasAttribute('download')) return
      const next = new URL(link.href, window.location.href)
      if (next.origin !== window.location.origin || `${next.pathname}${next.search}${next.hash}` === `${window.location.pathname}${window.location.search}${window.location.hash}`) return
      if (!window.confirm('Masz niezapisane zmiany w treningu. Opuścić stronę bez zapisu?')) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
      }
    }
    const confirmBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!stateRef.current.dirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    const confirmBrowserBack = () => {
      if (!stateRef.current.dirty) return
      if (!window.confirm('Masz niezapisane zmiany w treningu. Opuścić stronę bez zapisu?')) window.history.forward()
    }
    document.addEventListener('click', confirmNavigation, true)
    window.addEventListener('beforeunload', confirmBeforeUnload)
    window.addEventListener('popstate', confirmBrowserBack)
    return () => {
      document.removeEventListener('click', confirmNavigation, true)
      window.removeEventListener('beforeunload', confirmBeforeUnload)
      window.removeEventListener('popstate', confirmBrowserBack)
    }
  }, [])

  const start = useMutation({
    mutationFn: () => api.startWorkout(plan.data!.id, weekNumber!, dayNumber!),
    onSuccess: async () => {
      showToast({ kind: 'success', title: 'Trening gotowy do zapisania' })
      await client.invalidateQueries({ queryKey: gymKeys.workouts(profile.id, planId!) })
    },
  })

  const saveDraft = useMutation({
    mutationFn: (variables: { expectedRevision: number; input: GymWorkoutExerciseInput[]; editVersion: number }) =>
      api.saveWorkoutDraft(workout!.id, variables.expectedRevision, variables.input),
    onSuccess: async (nextRevision, variables) => {
      setRevision(nextRevision)
      setSavedVersion(variables.editVersion)
      setLastSavedAt(new Date().toISOString())
      setValidationIssues([])
      showToast({ kind: 'success', title: 'Zapisano trening' })
      await Promise.all([
        client.invalidateQueries({ queryKey: gymKeys.workouts(profile.id, planId!) }),
        client.invalidateQueries({ queryKey: gymKeys.workout(profile.id, workout!.id) }),
      ])
    },
  })

  const complete = useMutation({
    mutationFn: (variables: { expectedRevision: number; input: GymWorkoutExerciseInput[]; editVersion: number; performedOn: string }) =>
      api.completeWorkout(workout!.id, variables.expectedRevision, variables.input, variables.performedOn),
    onSuccess: async () => {
      showToast({ kind: 'success', title: 'Trening ukończony' })
      await client.invalidateQueries({ queryKey: gymKeys.root(profile.id) })
      navigate(`/gym/plans/${planId}`)
    },
  })

  const correct = useMutation({
    mutationFn: (variables: { expectedRevision: number; input: GymWorkoutExerciseInput[]; editVersion: number }) =>
      api.correctWorkoutResults(workout!.id, variables.expectedRevision, variables.input),
    onSuccess: async (nextRevision, variables) => {
      setRevision(nextRevision)
      setSavedVersion(variables.editVersion)
      setLastSavedAt(new Date().toISOString())
      setValidationIssues([])
      showToast({ kind: 'success', title: 'Poprawiono wyniki treningu' })
      await Promise.all([
        client.invalidateQueries({ queryKey: gymKeys.workouts(profile.id, planId!) }),
        client.invalidateQueries({ queryKey: gymKeys.workout(profile.id, workout!.id) }),
      ])
    },
  })

  function updateForm(update: (current: WorkoutFormState) => WorkoutFormState) {
    setForm(current => current ? update(current) : current)
    setEditVersion(current => current + 1)
    setValidationIssues([])
    if (!saveDraft.isPending) saveDraft.reset()
    if (!complete.isPending) complete.reset()
    if (!correct.isPending) correct.reset()
  }

  function changeActual(exercise: GymExercise, setNumber: number, event: ChangeEvent<HTMLInputElement>) {
    const key = setKey(exercise.id, setNumber)
    updateForm(current => ({ ...current, actuals: { ...current.actuals, [key]: event.target.value } }))
  }

  async function reloadServerVersion() {
    if (!details.data) return
    if (dirty && !window.confirm('Wczytać zapisane wyniki? Niezapisane zmiany zostaną odrzucone.')) return
    const result = await details.refetch()
    if (!result.data || !day) return
    setForm(blankForm(day, result.data))
    setExpandedOverrides(Object.fromEntries(exercisesForDay(day).map(exercise => [exercise.id, false])))
    setRevision(result.data.workout.revision)
    setEditVersion(0)
    setSavedVersion(0)
    setLastSavedAt(result.data.workout.updatedAt)
    setValidationIssues([])
    setCompletionDate(null)
    saveDraft.reset()
    complete.reset()
    correct.reset()
  }

  function submitResults(action: 'save' | 'complete' | 'correct') {
    if (!form || !day || !workout || revision === null) return
    const result = makeWorkoutInput(day, form, action !== 'save')
    setValidationIssues(result.issues)
    if (result.issues.length) return
    if (action === 'save') saveDraft.mutate({ expectedRevision: revision, input: result.input, editVersion })
    else if (action === 'complete') {
      const performedOn = completionDate ?? localDateNow()
      setCompletionDate(performedOn)
      complete.mutate({ expectedRevision: revision, input: result.input, editVersion, performedOn })
    }
    else correct.mutate({ expectedRevision: revision, input: result.input, editVersion })
  }

  if (!planId || !weekNumber || !dayNumber) {
    return <><PageHeader eyebrow="Siłownia · Trening" title="Trening" description="Nieprawidłowy adres treningu." action={<Link className="text-button" to="/gym">Wróć do Siłowni</Link>} /><div className="panel error-message" role="alert">Podaj prawidłowy plan, tydzień i dzień treningowy.</div></>
  }
  if (plan.isPending) return <><PageHeader eyebrow="Siłownia · Trening" title="Trening" description="Ładuję plan treningowy." /><section className="panel"><p className="panel-message" role="status">Ładuję plan…</p></section></>
  if (plan.isError) return <><PageHeader eyebrow="Siłownia · Trening" title="Trening" description="Nie udało się otworzyć planu." action={<Link className="text-button" to="/gym">Wróć do Siłowni</Link>} /><div className="panel error-message" role="alert"><p>{plan.error.message}</p><button className="button-quiet" type="button" disabled={plan.isFetching} onClick={() => void plan.refetch()}>Spróbuj ponownie</button></div></>

  const currentPlan = plan.data
  if (weekNumber > currentPlan.weeksCount || dayNumber > currentPlan.daysPerWeek || !day) {
    return <><PageHeader eyebrow="Siłownia · Trening" title="Trening" description="Tego dnia nie ma w zapisanym planie." action={<Link className="text-button" to={`/gym/plans/${currentPlan.id}`}>Wróć do planu</Link>} /><div className="panel error-message" role="alert">Sprawdź tydzień i dzień w planie.</div></>
  }

  const pageTitle = `${planDayName(currentPlan, dayNumber)} · tydzień ${weekNumber}`
  const isStartingSlot = currentPlan.status === 'active' && isCurrentSlot && !workout
  const canEdit = Boolean(canEditDraft || canCorrect)
  const operationPending = saveDraft.isPending || complete.isPending || correct.isPending
  const historyTimestamp = workout?.completedAt ? formatSavedTime(workout.completedAt) : null

  return <>
    <PageHeader
      eyebrow={`Siłownia · Tydzień ${weekNumber} · Dzień ${dayNumber}`}
      title={pageTitle}
      description={isCompleted ? `Ukończono ${historyTimestamp ?? ''}. Możesz poprawić zapisane wyniki.` : 'Wpisz wykonane powtórzenia lub sekundy. Ciężary są opcjonalne.'}
      action={<Link className="text-button" to={`/gym/plans/${currentPlan.id}`}>Wróć do planu</Link>}
    />

    {workouts.isPending && <section className="panel"><p className="panel-message" role="status">Sprawdzam zapis treningu…</p></section>}
    {workouts.isError && <div className="panel error-message" role="alert"><p>Nie udało się pobrać treningów: {workouts.error.message}</p><button className="button-quiet" type="button" disabled={workouts.isFetching} onClick={() => void workouts.refetch()}>Spróbuj ponownie</button></div>}

    {isStartingSlot && <section className="panel gym-workout-start-card">
      <p className="panel-kicker">Następny trening</p>
      <h2>{pageTitle}</h2>
      <p>Przygotujemy puste wyniki i skopiujemy ostatnie zapisane ciężary dla ćwiczeń z tego planu.</p>
      {start.isError && <div className="error-message" role="alert">{start.error.message}</div>}
      <button className="primary-button" type="button" disabled={start.isPending} onClick={() => start.mutate()}>{start.isPending ? 'Przygotowuję…' : 'Rozpocznij trening'}</button>
    </section>}

    {workouts.data && !workout && !isStartingSlot && <section className="panel empty-panel">
      <h2>Ten trening nie jest jeszcze dostępny.</h2>
      <p>{currentPlan.status === 'active' && progress?.currentSlot
        ? `Najpierw ukończ tydzień ${progress.currentSlot.weekNumber}, dzień ${progress.currentSlot.dayNumber}.`
        : 'Ten slot nie ma zapisanego treningu.'}</p>
      <Link className="primary-button" to={`/gym/plans/${currentPlan.id}`}>Otwórz plan</Link>
    </section>}

    {workout && details.isPending && <section className="panel"><p className="panel-message" role="status">Wczytuję serie i zapisane ciężary…</p></section>}
    {workout && details.isError && <div className="panel error-message" role="alert"><p>Nie udało się pobrać szczegółów treningu: {details.error.message}</p><button className="button-quiet" type="button" disabled={details.isFetching} onClick={() => void details.refetch()}>Spróbuj ponownie</button></div>}

    {workout && details.data && form && initializedId === details.data.workout.id && <>
      {workout.status === 'draft' && !canEditDraft && <section className="panel gym-workout-notice" role="status"><strong>Ten szkic nie jest teraz edytowalny.</strong><span>Edytować można tylko następny trening aktywnego planu.</span></section>}
      <form className={`gym-workout-form${isCompleted ? ' is-completed' : ''}`} onSubmit={event => event.preventDefault()}>
        <section className="panel gym-workout-info">
          <div><p className="panel-kicker">{isCompleted ? 'Zapisany trening' : 'Trening w toku'}</p><h2>{day.name.trim() || `Dzień ${dayNumber}`}</h2></div>
          <div className="gym-workout-save-state" role="status">
            {dirty ? <strong>Niezapisane zmiany</strong> : <span>{lastSavedAt ? `Ostatni zapis: ${formatSavedTime(lastSavedAt)}` : 'Zapisz po wprowadzeniu wyników.'}</span>}
            {operationPending && <span>Trwa zapisywanie…</span>}
          </div>
        </section>

        {day.blocks.map((block, blockIndex) => {
          const renderExerciseHeading = (exercise: GymExercise) => {
            const defaultValue = form.defaults[exercise.id] ?? ''
            const defaultWeight = parseGymWeightInput(defaultValue)
            const effectiveWeights = Array.from({ length: exercise.sets }, (_, index) => {
              const override = parseGymWeightInput(form.overrides[setKey(exercise.id, index + 1)] ?? '')
              return override === null ? defaultWeight : override
            })
            const weightsMatch = effectiveWeights.every(weight => Object.is(weight, effectiveWeights[0]))
            return <div className="gym-workout-exercise-heading" key={exercise.id}>
              <div className="gym-workout-exercise-title">
                <h3>{exercise.name}</h3>
                <span>{exercise.sets} serii · cel {targetLabel(exercise)}{exercise.unilateral ? ' · na stronę' : ''} · {exercise.load_type === 'weight' ? 'ciężar' : 'masa ciała'}</span>
              </div>
              {exercise.load_type === 'weight' ? <div className="gym-workout-weight-summary">
                <details className="gym-weight-baseline">
                  <summary>{defaultWeight === null ? 'Dodaj ciężar bazowy' : `Ciężar bazowy: ${formatGymWeight(defaultWeight)} · Zmień ciężar`}</summary>
                  <label>Ciężar dla serii (kg)
                    <input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={defaultValue}
                      disabled={!canEdit || operationPending}
                      onChange={event => updateForm(current => ({ ...current, defaults: { ...current.defaults, [exercise.id]: event.target.value } }))}
                      aria-label={`${exercise.name}: ciężar bazowy w kilogramach`}
                    />
                  </label>
                  <span>Puste pole oznacza brak zapisanego ciężaru. Poprzedni trening jest kopiowany przy rozpoczęciu tego dnia.</span>
                </details>
                <p className="gym-effective-weights"><strong>Ciężar:</strong> {weightsMatch
                  ? <span>{Number.isNaN(effectiveWeights[0]) ? 'nieprawidłowy' : effectiveWeights[0] === null ? 'niepodany' : formatGymWeight(effectiveWeights[0])}</span>
                  : effectiveWeights.map((weight, index) => <span key={index}>Seria {index + 1}: {Number.isNaN(weight) ? 'nieprawidłowy' : weight === null ? 'niepodany' : formatGymWeight(weight)}</span>)}</p>
                <button
                  className="text-button gym-set-weight-toggle"
                  type="button"
                  aria-expanded={Boolean(expandedOverrides[exercise.id])}
                  disabled={operationPending}
                  onClick={() => setExpandedOverrides(current => ({ ...current, [exercise.id]: !current[exercise.id] }))}
                >{expandedOverrides[exercise.id] ? 'Ukryj osobne ciężary dla serii' : 'Osobne ciężary dla serii'}</button>
              </div> : <span className="gym-bodyweight-label">Masa ciała</span>}
            </div>
          }

          const renderSet = (exercise: GymExercise, setNumber: number) => {
            const key = setKey(exercise.id, setNumber)
            return <div className="gym-workout-set" key={key}>
              <div className="gym-workout-set-prescription"><strong>Seria {setNumber}</strong><span>Cel: {targetLabel(exercise)}{exercise.unilateral ? ' na stronę' : ''}</span></div>
              <label className="gym-workout-actual-field">{actualLabel(exercise)}
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={form.actuals[key] ?? ''}
                  placeholder="—"
                  disabled={!canEdit || operationPending}
                  onChange={event => changeActual(exercise, setNumber, event)}
                  aria-label={`${exercise.name}, seria ${setNumber}: ${actualLabel(exercise).toLowerCase()}`}
                />
              </label>
              {exercise.load_type === 'weight' && expandedOverrides[exercise.id] && <label className="gym-workout-override-field">Ciężar tej serii (kg)
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={form.overrides[key] ?? ''}
                  placeholder="Dziedzicz bazowy"
                  disabled={!canEdit || operationPending}
                  onChange={event => updateForm(current => ({ ...current, overrides: { ...current.overrides, [key]: event.target.value } }))}
                  aria-label={`${exercise.name}, seria ${setNumber}: osobny ciężar w kilogramach`}
                />
              </label>}
            </div>
          }

          if (block.type === 'single') {
            const exercise = block.exercises[0]
            return <section className="panel gym-workout-block" key={block.id} aria-labelledby={`gym-workout-block-${block.id}`}>
              <div className="gym-workout-block-heading"><span>Pojedyncze ćwiczenie · blok {blockIndex + 1}</span><h2 id={`gym-workout-block-${block.id}`}>{exercise.name}</h2></div>
              {renderExerciseHeading(exercise)}
              <div className="gym-workout-set-list">{Array.from({ length: exercise.sets }, (_, index) => renderSet(exercise, index + 1))}</div>
            </section>
          }

          const roundCount = Math.max(...block.exercises.map(exercise => exercise.sets))
          return <section className="panel gym-workout-block is-superset" key={block.id} aria-labelledby={`gym-workout-block-${block.id}`}>
            <div className="gym-workout-block-heading"><span>Superseria · blok {blockIndex + 1}</span><h2 id={`gym-workout-block-${block.id}`}>Ćwiczenia w kolejności z planu</h2><p>Każda runda zawiera ćwiczenia, które mają jeszcze zaplanowaną serię.</p></div>
            <div className="gym-workout-superset-exercises">{block.exercises.map(renderExerciseHeading)}</div>
            <div className="gym-workout-round-list">{Array.from({ length: roundCount }, (_, roundIndex) => {
              const setNumber = roundIndex + 1
              return <section className="gym-workout-round" key={setNumber} aria-labelledby={`gym-round-${block.id}-${setNumber}`}>
                <h3 id={`gym-round-${block.id}-${setNumber}`}>Runda {setNumber}</h3>
                {block.exercises.filter(exercise => exercise.sets >= setNumber).map(exercise => renderSet(exercise, setNumber))}
              </section>
            })}</div>
          </section>
        })}

        {validationIssues.length > 0 && <div className="error-message gym-workout-validation" role="alert" aria-live="polite">
          <strong>Popraw te wyniki:</strong><ul>{validationIssues.map((issue, index) => <li key={`${issue}-${index}`}>{issue}</li>)}</ul>
        </div>}
        {(saveDraft.isError || complete.isError || correct.isError) && <div className="error-message gym-workout-error" role="alert">
          <strong>Nie udało się zapisać treningu.</strong>
          <p>{saveDraft.error?.message ?? complete.error?.message ?? correct.error?.message}</p>
          <button className="button-quiet" type="button" disabled={details.isFetching} onClick={() => void reloadServerVersion()}>Wczytaj zapisane wyniki</button>
        </div>}

        {canEditDraft && <div className="gym-workout-actions">
          <button className="button-quiet" type="button" disabled={operationPending} onClick={() => submitResults('save')}>{saveDraft.isPending ? 'Zapisuję…' : 'Zapisz'}</button>
          <button className="primary-button" type="button" disabled={operationPending} onClick={() => submitResults('complete')}>{complete.isPending ? 'Kończę trening…' : 'Zapisz i zakończ trening'}</button>
        </div>}
        {canCorrect && <div className="gym-workout-actions">
          <button className="primary-button" type="button" disabled={operationPending || !dirty} onClick={() => submitResults('correct')}>{correct.isPending ? 'Zapisuję poprawki…' : 'Zapisz poprawki'}</button>
          <span>Poprawki nie zmieniają czasu ukończenia ani postępu planu.</span>
        </div>}
        {!canEdit && !isCompleted && <div className="gym-workout-notice" role="status">Wyniki tego treningu są tylko do odczytu.</div>}
      </form>
    </>}
  </>
}
