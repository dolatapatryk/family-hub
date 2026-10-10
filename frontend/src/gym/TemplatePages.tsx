import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthGate'
import { PageHeader } from '../components/PageHeader'
import { useToast } from '../components/ToastProvider'
import { createGymApi } from './api'
import { gymKeys } from './queries'
import { createGymDay, createGymExercise, getGymTemplateSummary, newGymId, validateGymTemplate } from './gym'
import type { GymExercise, GymExerciseMode, GymLoadType, GymTemplate, GymTemplateDefinition, SaveGymTemplateInput } from './types'

interface ExerciseDraft {
  id: string
  name: string
  sets: string
  mode: GymExerciseMode
  targetMin: string
  targetMax: string
  range: boolean
  unilateral: boolean
  loadType: GymLoadType
}

interface BlockDraft {
  id: string
  type: 'single' | 'superset'
  exercises: ExerciseDraft[]
}

interface DayDraft {
  id: string
  name: string
  blocks: BlockDraft[]
}

interface TemplateDraft {
  name: string
  weeksCount: string
  daysPerWeek: string
  days: DayDraft[]
}

function draftExercise(exercise: GymExercise): ExerciseDraft {
  return {
    id: exercise.id,
    name: exercise.name,
    sets: String(exercise.sets),
    mode: exercise.mode,
    targetMin: String(exercise.target_min),
    targetMax: String(exercise.target_max),
    range: exercise.target_min !== exercise.target_max,
    unilateral: exercise.unilateral,
    loadType: exercise.load_type,
  }
}

function emptyDraft(): TemplateDraft {
  const days = Array.from({ length: 3 }, () => {
    const day = createGymDay()
    return { ...day, blocks: day.blocks.map(block => ({ ...block, exercises: block.exercises.map(draftExercise) })) }
  })
  return { name: '', weeksCount: '4', daysPerWeek: '3', days }
}

function templateDraft(template: GymTemplate): TemplateDraft {
  return {
    name: template.name,
    weeksCount: String(template.weeksCount),
    daysPerWeek: String(template.daysPerWeek),
    days: template.definition.days.map(day => ({
      id: day.id,
      name: day.name,
      blocks: day.blocks.map(block => ({
        id: block.id,
        type: block.type,
        exercises: block.exercises.map(draftExercise),
      })),
    })),
  }
}

function numericField(value: string) {
  return /^\d+$/.test(value) ? Number(value) : Number.NaN
}

function toDefinition(days: DayDraft[]): GymTemplateDefinition {
  return {
    days: days.map(day => ({
      id: day.id,
      name: day.name.trim(),
      blocks: day.blocks.map(block => {
        const exercises = block.exercises.map((exercise): GymExercise => {
          const fields = {
            id: exercise.id,
            name: exercise.name.trim(),
            sets: numericField(exercise.sets),
            target_min: numericField(exercise.targetMin),
            target_max: numericField(exercise.range ? exercise.targetMax : exercise.targetMin),
            unilateral: exercise.unilateral,
            load_type: exercise.loadType,
          }
          return exercise.mode === 'reps' ? { ...fields, mode: 'reps' } : { ...fields, mode: 'time' }
        })
        if (block.type === 'single') return { id: block.id, type: 'single', exercises: [exercises[0]] }
        return { id: block.id, type: 'superset', exercises: exercises as [GymExercise, GymExercise, ...GymExercise[]] }
      }),
    })),
  }
}

function labelForIssue(path: string) {
  const match = /^days\.(\d+)\.blocks\.(\d+)\.exercises\.(\d+)\.(.+)$/.exec(path)
  if (match) return `Dzień ${Number(match[1]) + 1}, blok ${Number(match[2]) + 1}, ćwiczenie ${Number(match[3]) + 1}`
  const dayMatch = /^days\.(\d+)\.(.+)$/.exec(path)
  if (dayMatch) return `Dzień ${Number(dayMatch[1]) + 1}`
  if (path === 'weeksCount') return 'Czas trwania'
  if (path === 'daysPerWeek' || path === 'days') return 'Liczba dni'
  if (path === 'name') return 'Nazwa'
  return 'Szablon'
}

function PlusIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
}

function MoveButtons({ label, index, count, onMove }: { label: string; index: number; count: number; onMove: (direction: -1 | 1) => void }) {
  return <span className="gym-move-actions">
    <button className="gym-icon-button" type="button" disabled={index === 0} aria-label={`Przenieś ${label} w górę`} onClick={() => onMove(-1)}>↑</button>
    <button className="gym-icon-button" type="button" disabled={index === count - 1} aria-label={`Przenieś ${label} w dół`} onClick={() => onMove(1)}>↓</button>
  </span>
}

export function GymTemplatesPage() {
  const { profile } = useAuth()
  const showToast = useToast()
  const client = useQueryClient()
  const api = createGymApi(profile.id)
  const [includeArchived, setIncludeArchived] = useState(false)
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null)
  const templatesKey = gymKeys.templates(profile.id, includeArchived)
  const templates = useQuery({ queryKey: templatesKey, queryFn: ({ signal }) => api.list(includeArchived, signal) })
  const archive = useMutation({
    mutationFn: (templateId: string) => api.archive(templateId),
    onSuccess: async (_saved, templateId) => {
      setConfirmArchiveId(null)
      showToast({ kind: 'success', title: 'Zarchiwizowano szablon' })
      await client.invalidateQueries({ queryKey: gymKeys.root(profile.id) })
      await client.invalidateQueries({ queryKey: gymKeys.template(profile.id, templateId) })
    },
    onError: error => showToast({ kind: 'error', title: 'Nie udało się zarchiwizować szablonu', description: error.message }),
  })

  return <>
    <PageHeader eyebrow="Trening osobisty" title="Szablony treningowe" description="Układaj tygodniowy plan z pojedynczych ćwiczeń i superserii. Szablony są prywatne." action={<Link className="primary-button" to="/gym/templates/new"><PlusIcon /><span>Nowy szablon</span></Link>} />
    <div className="gym-toolbar">
      <span className="small-muted">{includeArchived ? 'Aktywne i zarchiwizowane szablony' : 'Aktywne szablony'}</span>
      <label className="gym-archived-toggle"><input type="checkbox" checked={includeArchived} onChange={event => setIncludeArchived(event.target.checked)} /> Pokaż archiwalne</label>
    </div>
    {templates.isPending && <section className="panel"><p className="panel-message" role="status">Ładuję szablony…</p></section>}
    {templates.isError && <div className="panel error-message" role="alert"><p>Nie udało się pobrać szablonów: {templates.error.message}</p><button className="button-quiet" type="button" disabled={templates.isFetching} onClick={() => void templates.refetch()}>Spróbuj ponownie</button></div>}
    {templates.data && templates.data.length === 0 && <section className="panel empty-panel">
      <h2>{includeArchived ? 'Nie ma jeszcze szablonów.' : 'Zacznij od własnego szablonu.'}</h2>
      <p>Dodaj nazwę, liczbę tygodni i dni treningowych, a potem ułóż ćwiczenia w kolejności wykonywania.</p>
      <Link className="primary-button gym-empty-action" to="/gym/templates/new"><PlusIcon /><span>Utwórz szablon</span></Link>
    </section>}
    {templates.data && templates.data.length > 0 && <ul className="gym-template-list">
      {templates.data.map(template => <li className={`gym-template-card${template.archivedAt ? ' is-archived' : ''}`} key={template.id}>
        <div className="gym-template-card-main">
          <div className="gym-template-card-copy">
            <div className="gym-template-title-row"><h2>{template.name}</h2>{template.archivedAt && <span className="gym-status-label">Archiwalny</span>}</div>
            <p className="gym-template-meta">{template.weeksCount} {template.weeksCount === 1 ? 'tydzień' : template.weeksCount < 5 ? 'tygodnie' : 'tygodni'} · {template.daysPerWeek} {template.daysPerWeek === 1 ? 'dzień treningowy' : template.daysPerWeek < 5 ? 'dni treningowe' : 'dni treningowych'} w tygodniu · {getGymTemplateSummary(template.definition).split(' · ').slice(1).join(' · ')}</p>
            <div className="gym-template-days">{template.definition.days.map((day, index) => <span key={day.id}><strong>{day.name.trim() || `Dzień ${index + 1}`}</strong><span>{day.blocks.length} {day.blocks.length === 1 ? 'blok' : 'bloki'} · {day.blocks.reduce((count, block) => count + block.exercises.length, 0)} ćw.</span></span>)}</div>
          </div>
          <div className="gym-template-actions">
            {!template.archivedAt && <Link className="text-button" to={`/gym/templates/${template.id}/start`}>Rozpocznij plan</Link>}
            {!template.archivedAt && <Link className="text-button" to={`/gym/templates/${template.id}/edit`}>Edytuj</Link>}
            {!template.archivedAt && <button className="text-button item-remove-button" type="button" disabled={archive.isPending} onClick={() => setConfirmArchiveId(confirmArchiveId === template.id ? null : template.id)} aria-expanded={confirmArchiveId === template.id}>Archiwizuj</button>}
          </div>
        </div>
        {confirmArchiveId === template.id && <div className="gym-archive-confirm" role="group" aria-label={`Potwierdź archiwizację szablonu ${template.name}`}>
          <p>Szablon zniknie z aktywnej listy. Możesz zachować jego definicję w archiwum.</p>
          <div className="form-actions"><button className="button-quiet" type="button" disabled={archive.isPending} onClick={() => archive.mutate(template.id)}>{archive.isPending ? 'Archiwizuję…' : 'Archiwizuj szablon'}</button><button className="text-button" type="button" disabled={archive.isPending} onClick={() => setConfirmArchiveId(null)}>Anuluj</button></div>
        </div>}
      </li>)}
    </ul>}
  </>
}

export function GymTemplateEditorPage() {
  const { templateId } = useParams()
  const isEditing = Boolean(templateId)
  const { profile } = useAuth()
  const showToast = useToast()
  const client = useQueryClient()
  const navigate = useNavigate()
  const api = createGymApi(profile.id)
  const template = useQuery({
    queryKey: gymKeys.template(profile.id, templateId ?? 'new'),
    queryFn: ({ signal }) => api.get(templateId!, signal),
    enabled: isEditing,
  })
  const [draft, setDraft] = useState<TemplateDraft>(emptyDraft)
  const [readyFor, setReadyFor] = useState<string | null>(isEditing ? null : 'new')
  const [revision, setRevision] = useState<number | null>(null)
  const [expandedDay, setExpandedDay] = useState(0)
  const [issues, setIssues] = useState<{ path: string; message: string }[]>([])

  useEffect(() => {
    if (!templateId || !template.data || readyFor === templateId) return
    setDraft(templateDraft(template.data))
    setRevision(template.data.revision)
    setExpandedDay(0)
    setIssues([])
    setReadyFor(templateId)
  }, [readyFor, template.data, templateId])

  const save = useMutation({
    mutationFn: (input: SaveGymTemplateInput) => api.save(input),
    onSuccess: async () => {
      showToast({ kind: 'success', title: isEditing ? 'Zapisano szablon' : 'Utworzono szablon' })
      await client.invalidateQueries({ queryKey: gymKeys.root(profile.id) })
      navigate('/gym/templates')
    },
    onError: error => showToast({ kind: 'error', title: 'Nie udało się zapisać szablonu', description: error.message }),
  })

  function updateDraft(update: (current: TemplateDraft) => TemplateDraft) {
    setDraft(current => update(current))
    setIssues([])
    save.reset()
  }

  function updateDay(dayIndex: number, update: (day: DayDraft) => DayDraft) {
    updateDraft(current => ({ ...current, days: current.days.map((day, index) => index === dayIndex ? update(day) : day) }))
  }

  function updateBlock(dayIndex: number, blockIndex: number, update: (block: BlockDraft) => BlockDraft) {
    updateDay(dayIndex, day => ({ ...day, blocks: day.blocks.map((block, index) => index === blockIndex ? update(block) : block) }))
  }

  function updateExercise(dayIndex: number, blockIndex: number, exerciseIndex: number, update: (exercise: ExerciseDraft) => ExerciseDraft) {
    updateBlock(dayIndex, blockIndex, block => ({ ...block, exercises: block.exercises.map((exercise, index) => index === exerciseIndex ? update(exercise) : exercise) }))
  }

  function changeDayCount(value: string) {
    setIssues([])
    save.reset()
    const nextCount = numericField(value)
    if (!Number.isInteger(nextCount) || nextCount < 1 || nextCount > 7) {
      setDraft(current => ({ ...current, daysPerWeek: value }))
      return
    }
    if (nextCount < draft.days.length && draft.days.slice(nextCount).some(isPopulatedDay)) {
      const shouldDiscard = window.confirm(`Zmniejszenie liczby dni usunie dane ${draft.days.slice(nextCount).map((_, index) => `dnia ${nextCount + index + 1}`).join(', ')}. Czy kontynuować?`)
      if (!shouldDiscard) {
        setDraft(current => ({ ...current, daysPerWeek: String(current.days.length) }))
        return
      }
    }
    setDraft(current => ({
      ...current,
      daysPerWeek: value,
      days: nextCount < current.days.length
        ? current.days.slice(0, nextCount)
        : [...current.days, ...Array.from({ length: nextCount - current.days.length }, () => {
          const day = createGymDay()
          return { ...day, blocks: day.blocks.map(block => ({ ...block, exercises: block.exercises.map(draftExercise) })) }
        })],
    }))
    setExpandedDay(current => Math.min(current, nextCount - 1))
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (save.isPending) return
    const weeksCount = numericField(draft.weeksCount)
    const daysPerWeek = numericField(draft.daysPerWeek)
    const definition = toDefinition(draft.days)
    const validationIssues = validateGymTemplate(draft.name, weeksCount, daysPerWeek, definition)
    setIssues(validationIssues)
    if (validationIssues.length) return
    save.mutate({
      id: templateId ?? null,
      expectedRevision: templateId ? revision : null,
      name: draft.name.trim(),
      weeksCount,
      daysPerWeek,
      definition,
    })
  }

  async function reloadLatestTemplate() {
    const result = await template.refetch()
    if (!result.data) return
    setDraft(templateDraft(result.data))
    setRevision(result.data.revision)
    setExpandedDay(0)
    setIssues([])
    save.reset()
  }

  if (isEditing && template.isPending) return <><PageHeader eyebrow="Siłownia" title="Edytuj szablon" description="Ładuję zapisany plan treningowy." /><section className="panel"><p className="panel-message" role="status">Ładuję szablon…</p></section></>
  if (isEditing && template.isError) return <><PageHeader eyebrow="Siłownia" title="Edytuj szablon" description="Nie udało się otworzyć szablonu." /><div className="panel error-message" role="alert"><p>{template.error.message}</p><button className="button-quiet" type="button" disabled={template.isFetching} onClick={() => void template.refetch()}>Spróbuj ponownie</button><Link className="text-button" to="/gym/templates">Wróć do szablonów</Link></div></>
  if (!readyFor || readyFor !== (templateId ?? 'new')) return <section className="panel"><p className="panel-message" role="status">Przygotowuję formularz…</p></section>

  const busy = save.isPending
  return <>
    <PageHeader eyebrow="Siłownia · Szablony" title={isEditing ? 'Edytuj szablon' : 'Nowy szablon'} description="Stała kolejność dni i ćwiczeń będzie powtarzać się w każdym tygodniu." action={<Link className="text-button" to="/gym/templates">Wróć do szablonów</Link>} />
    <form className="gym-editor" noValidate onSubmit={submit}>
      <section className="panel gym-template-settings" aria-labelledby="gym-settings-title">
        <div className="panel-head"><div><h2 className="panel-title" id="gym-settings-title">Podstawowe informacje</h2><p className="panel-kicker">Wybierz długość planu i stałą liczbę treningów w każdym tygodniu.</p></div></div>
        <fieldset disabled={busy}>
          <div className="gym-settings-grid">
            <label>Nazwa szablonu<input required maxLength={120} value={draft.name} onChange={event => updateDraft(current => ({ ...current, name: event.target.value }))} placeholder="np. Plan siłowy A/B" /></label>
            <label>Liczba tygodni<input required type="number" min="1" max="52" step="1" inputMode="numeric" value={draft.weeksCount} onChange={event => updateDraft(current => ({ ...current, weeksCount: event.target.value }))} /></label>
            <label>Dni treningowe w tygodniu<input required type="number" min="1" max="7" step="1" inputMode="numeric" value={draft.daysPerWeek} onChange={event => changeDayCount(event.target.value)} /></label>
          </div>
        </fieldset>
      </section>

      <section className="gym-days-section" aria-labelledby="gym-days-title">
        <div className="gym-section-heading"><div><h2 id="gym-days-title">Treningi w tygodniu</h2><p>Każdy dzień powtarza się w tej samej kolejności przez cały plan.</p></div><span className="gym-count-pill">{draft.days.length} {draft.days.length === 1 ? 'dzień' : 'dni'}</span></div>
        <div className="gym-day-list">
          {draft.days.map((day, dayIndex) => <section className={`gym-day-card${expandedDay === dayIndex ? ' is-expanded' : ''}`} key={day.id}>
            <button className="gym-day-toggle" type="button" aria-expanded={expandedDay === dayIndex} aria-controls={`gym-day-content-${day.id}`} onClick={() => setExpandedDay(dayIndex)}>
              <span className="gym-day-number">{dayIndex + 1}</span>
              <span className="gym-day-toggle-copy"><strong>{day.name.trim() || `Dzień ${dayIndex + 1}`}</strong><span>{day.blocks.length} {day.blocks.length === 1 ? 'blok' : 'bloki'} · {day.blocks.reduce((total, block) => total + block.exercises.length, 0)} ćwiczeń</span></span>
              <span className="gym-day-chevron" aria-hidden="true">{expandedDay === dayIndex ? '−' : '+'}</span>
            </button>
            {expandedDay === dayIndex && <div className="gym-day-content" id={`gym-day-content-${day.id}`}>
              <fieldset disabled={busy}>
                <label className="gym-day-name-field">Nazwa dnia <span className="optional">(opcjonalnie)</span><input maxLength={80} value={day.name} onChange={event => updateDay(dayIndex, current => ({ ...current, name: event.target.value }))} placeholder={`np. Góra, Dół lub Full body`} /></label>
                <div className="gym-block-list">
                  {day.blocks.map((block, blockIndex) => <section className={`gym-block-card ${block.type === 'superset' ? 'is-superset' : ''}`} key={block.id}>
                    <div className="gym-block-heading">
                      <div><span className="gym-block-kind">{block.type === 'superset' ? 'Superseria' : 'Pojedyncze ćwiczenie'}</span><span className="gym-block-position">Blok {blockIndex + 1}</span></div>
                      <div className="gym-block-actions">
                        <MoveButtons label={`bloku ${blockIndex + 1}`} index={blockIndex} count={day.blocks.length} onMove={direction => updateDay(dayIndex, current => ({ ...current, blocks: moveItem(current.blocks, blockIndex, direction) }))} />
                        <button className="gym-remove-button" type="button" aria-label={`Usuń blok ${blockIndex + 1} z dnia ${dayIndex + 1}`} onClick={() => updateDay(dayIndex, current => ({ ...current, blocks: current.blocks.filter((_, index) => index !== blockIndex) }))}>Usuń blok</button>
                      </div>
                    </div>
                    <div className="gym-exercise-list">
                      {block.exercises.map((exercise, exerciseIndex) => <article className="gym-exercise-editor" key={exercise.id}>
                        <div className="gym-exercise-heading"><strong>{block.type === 'superset' ? `Ćwiczenie ${exerciseIndex + 1}` : 'Ćwiczenie'}</strong>{block.type === 'superset' && <div className="gym-block-actions">
                          <MoveButtons label={`ćwiczenia ${exerciseIndex + 1} w superserii`} index={exerciseIndex} count={block.exercises.length} onMove={direction => updateBlock(dayIndex, blockIndex, current => ({ ...current, exercises: moveItem(current.exercises, exerciseIndex, direction) }))} />
                          <button className="gym-remove-button" type="button" disabled={block.exercises.length <= 2} aria-label={`Usuń ćwiczenie ${exerciseIndex + 1} z superserii`} onClick={() => updateBlock(dayIndex, blockIndex, current => ({ ...current, exercises: current.exercises.filter((_, index) => index !== exerciseIndex) }))}>Usuń</button>
                        </div>}</div>
                        <div className="gym-exercise-fields">
                          <label className="gym-exercise-name">Nazwa ćwiczenia<input required maxLength={100} value={exercise.name} onChange={event => updateExercise(dayIndex, blockIndex, exerciseIndex, current => ({ ...current, name: event.target.value }))} placeholder="np. Wyciskanie hantli" /></label>
                          <label>Serie<input required type="number" min="1" step="1" inputMode="numeric" value={exercise.sets} onChange={event => updateExercise(dayIndex, blockIndex, exerciseIndex, current => ({ ...current, sets: event.target.value }))} /></label>
                          <label>Rodzaj celu<select value={exercise.mode} onChange={event => updateExercise(dayIndex, blockIndex, exerciseIndex, current => ({ ...current, mode: event.target.value as GymExerciseMode, targetMin: '', targetMax: '', range: false }))}><option value="reps">Powtórzenia</option><option value="time">Czas (sekundy)</option></select></label>
                          {exercise.range ? <>
                            <label>Minimum ({exercise.mode === 'reps' ? 'powtórzenia' : 'sekundy'})<input required type="number" min="1" step="1" inputMode="numeric" value={exercise.targetMin} onChange={event => updateExercise(dayIndex, blockIndex, exerciseIndex, current => ({ ...current, targetMin: event.target.value }))} /></label>
                            <label>Maksimum ({exercise.mode === 'reps' ? 'powtórzenia' : 'sekundy'})<input required type="number" min="1" step="1" inputMode="numeric" value={exercise.targetMax} onChange={event => updateExercise(dayIndex, blockIndex, exerciseIndex, current => ({ ...current, targetMax: event.target.value }))} /></label>
                          </> : <label>Cel ({exercise.mode === 'reps' ? 'powtórzenia' : 'sekundy'})<input required type="number" min="1" step="1" inputMode="numeric" value={exercise.targetMin} onChange={event => updateExercise(dayIndex, blockIndex, exerciseIndex, current => ({ ...current, targetMin: event.target.value, targetMax: event.target.value }))} /></label>}
                          <label>Obciążenie<select value={exercise.loadType} onChange={event => updateExercise(dayIndex, blockIndex, exerciseIndex, current => ({ ...current, loadType: event.target.value as GymLoadType }))}><option value="weight">Ciężar</option><option value="bodyweight">Masa ciała</option></select></label>
                        </div>
                        <div className="gym-exercise-options">
                          <label className="gym-checkbox-label"><input type="checkbox" checked={exercise.range} onChange={event => updateExercise(dayIndex, blockIndex, exerciseIndex, current => ({ ...current, range: event.target.checked, targetMax: event.target.checked ? current.targetMax : current.targetMin }))} /><span>Zakres</span></label>
                          <label className="gym-checkbox-label"><input type="checkbox" checked={exercise.unilateral} onChange={event => updateExercise(dayIndex, blockIndex, exerciseIndex, current => ({ ...current, unilateral: event.target.checked }))} /><span>Jednostronne</span></label>
                        </div>
                      </article>)}
                    </div>
                    {block.type === 'superset' && <button className="gym-add-exercise" type="button" onClick={() => updateBlock(dayIndex, blockIndex, current => ({ ...current, exercises: [...current.exercises, draftExercise(createGymExercise())] }))}><PlusIcon /> Dodaj ćwiczenie do superserii</button>}
                  </section>)}
                </div>
                <div className="gym-add-block-actions" aria-label={`Dodaj blok do dnia ${dayIndex + 1}`}>
                  <button className="button-quiet" type="button" onClick={() => updateDay(dayIndex, current => ({ ...current, blocks: [...current.blocks, { id: newGymId(), type: 'single', exercises: [draftExercise(createGymExercise())] }] }))}><PlusIcon /> Pojedyncze ćwiczenie</button>
                  <button className="button-quiet" type="button" onClick={() => updateDay(dayIndex, current => ({ ...current, blocks: [...current.blocks, { id: newGymId(), type: 'superset', exercises: [draftExercise(createGymExercise()), draftExercise(createGymExercise())] }] }))}><PlusIcon /> Superseria</button>
                </div>
              </fieldset>
            </div>}
          </section>)}
        </div>
      </section>

      {issues.length > 0 && <div className="error-message gym-validation-errors" role="alert" aria-live="polite">
        <strong>Popraw te pola, aby zapisać szablon:</strong>
        <ul>{issues.map((issue, index) => <li key={`${issue.path}-${index}`}><strong>{labelForIssue(issue.path)}:</strong> {issue.message}</li>)}</ul>
      </div>}
      {save.isError && <div className="error-message gym-save-error" role="alert"><strong>Nie udało się zapisać szablonu.</strong><p>{save.error.message}</p>{save.error.message.includes('changed elsewhere') && <button className="button-quiet" type="button" disabled={template.isFetching} onClick={() => void reloadLatestTemplate()}>Wczytaj aktualną wersję</button>}</div>}
      <div className="gym-editor-actions"><button className="primary-button" type="submit" disabled={busy}>{busy ? 'Zapisuję…' : isEditing ? 'Zapisz zmiany' : 'Utwórz szablon'}</button><button className="button-quiet" type="button" disabled={busy} onClick={() => navigate('/gym/templates')}>Anuluj</button></div>
    </form>
  </>
}

function moveItem<T>(items: T[], index: number, direction: -1 | 1) {
  const target = index + direction
  if (target < 0 || target >= items.length) return items
  const next = [...items]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

function isPopulatedDay(day: DayDraft) {
  if (day.name.trim() || day.blocks.length !== 1) return true
  return day.blocks.some(block => block.type !== 'single' || block.exercises.length !== 1 || block.exercises.some(exercise =>
    exercise.name.trim() !== '' || exercise.sets !== '3' || exercise.mode !== 'reps' || exercise.targetMin !== '8'
    || exercise.targetMax !== '8' || exercise.range || exercise.unilateral || exercise.loadType !== 'weight'))
}
