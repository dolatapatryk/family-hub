import type {
  GymBlock,
  GymDay,
  GymExercise,
  GymTemplateDefinition,
  GymTemplateValidationIssue,
} from './types'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function newGymId() {
  return crypto.randomUUID()
}

export function createGymExercise(): GymExercise {
  return {
    id: newGymId(),
    name: '',
    sets: 3,
    mode: 'reps',
    target_min: 8,
    target_max: 8,
    unilateral: false,
    load_type: 'weight',
  }
}

export function createGymDay(): GymDay {
  return {
    id: newGymId(),
    name: '',
    blocks: [{ id: newGymId(), type: 'single', exercises: [createGymExercise()] }],
  }
}

export function exercisePrescription(exercise: GymExercise) {
  const target = exercise.target_min === exercise.target_max
    ? String(exercise.target_min)
    : `${exercise.target_min}–${exercise.target_max}`
  const unit = exercise.mode === 'reps' ? '' : 's'
  return `${exercise.sets}×${target}${unit}${exercise.unilateral ? '/stronę' : ''}`
}

export function validateGymTemplate(
  name: string,
  weeksCount: number,
  daysPerWeek: number,
  definition: GymTemplateDefinition,
): GymTemplateValidationIssue[] {
  const issues: GymTemplateValidationIssue[] = []
  const ids = new Set<string>()
  const add = (path: string, message: string) => issues.push({ path, message })

  if (!name.trim()) add('name', 'Podaj nazwę szablonu.')
  else if (name.trim().length > 120) add('name', 'Nazwa może mieć maksymalnie 120 znaków.')
  if (!Number.isInteger(weeksCount) || weeksCount < 1 || weeksCount > 52) {
    add('weeksCount', 'Czas trwania musi wynosić od 1 do 52 tygodni.')
  }
  if (!Number.isInteger(daysPerWeek) || daysPerWeek < 1 || daysPerWeek > 7) {
    add('daysPerWeek', 'Liczba dni treningowych musi wynosić od 1 do 7.')
  }
  if (!Array.isArray(definition.days)) {
    add('days', 'Dodaj dni treningowe do szablonu.')
    return issues
  }
  if (definition.days.length !== daysPerWeek) {
    add('days', 'Liczba dni nie zgadza się z ustawieniem „Dni treningowe w tygodniu”.')
  }

  function checkId(id: string, path: string) {
    if (!uuidPattern.test(id)) {
      add(path, 'Nieprawidłowy identyfikator elementu. Odśwież formularz i spróbuj ponownie.')
      return
    }
    const normalized = id.toLowerCase()
    if (ids.has(normalized)) add(path, 'Każdy dzień, blok i ćwiczenie musi mieć osobny identyfikator.')
    ids.add(normalized)
  }

  function checkExercise(exercise: GymExercise, label: string) {
    checkId(exercise.id, `${label}.id`)
    if (!exercise.name.trim()) add(`${label}.name`, 'Podaj nazwę ćwiczenia.')
    else if (exercise.name.trim().length > 100) add(`${label}.name`, 'Nazwa ćwiczenia może mieć maksymalnie 100 znaków.')
    if (!Number.isInteger(exercise.sets) || exercise.sets < 1) add(`${label}.sets`, 'Liczba serii musi być dodatnią liczbą całkowitą.')
    if (exercise.mode !== 'reps' && exercise.mode !== 'time') add(`${label}.mode`, 'Wybierz powtórzenia albo czas.')
    if (!Number.isInteger(exercise.target_min) || exercise.target_min < 1) add(`${label}.target_min`, 'Cel musi być dodatnią liczbą całkowitą.')
    if (!Number.isInteger(exercise.target_max) || exercise.target_max < 1) add(`${label}.target_max`, 'Cel musi być dodatnią liczbą całkowitą.')
    if (Number.isInteger(exercise.target_min) && Number.isInteger(exercise.target_max) && exercise.target_min > exercise.target_max) {
      add(`${label}.target_max`, 'Maksimum zakresu nie może być mniejsze od minimum.')
    }
    if (typeof exercise.unilateral !== 'boolean') add(`${label}.unilateral`, 'Wybierz, czy ćwiczenie jest jednostronne.')
    if (exercise.load_type !== 'weight' && exercise.load_type !== 'bodyweight') add(`${label}.load_type`, 'Wybierz rodzaj obciążenia.')
  }

  definition.days.forEach((day, dayIndex) => {
    const dayNumber = dayIndex + 1
    const dayPath = `days.${dayIndex}`
    checkId(day.id, `${dayPath}.id`)
    if (day.name.length > 80) add(`${dayPath}.name`, `Nazwa dnia ${dayNumber} może mieć maksymalnie 80 znaków.`)
    if (!Array.isArray(day.blocks) || day.blocks.length === 0) {
      add(`${dayPath}.blocks`, `Dodaj co najmniej jeden blok ćwiczeń do dnia ${dayNumber}.`)
      return
    }
    day.blocks.forEach((block: GymBlock, blockIndex) => {
      const blockNumber = blockIndex + 1
      const blockPath = `${dayPath}.blocks.${blockIndex}`
      checkId(block.id, `${blockPath}.id`)
      if (block.type !== 'single' && block.type !== 'superset') {
        add(`${blockPath}.type`, `Wybierz rodzaj bloku w dniu ${dayNumber}, blok ${blockNumber}.`)
        return
      }
      if (!Array.isArray(block.exercises)) {
        add(`${blockPath}.exercises`, `Uzupełnij ćwiczenia w dniu ${dayNumber}, blok ${blockNumber}.`)
        return
      }
      if (block.type === 'single' && block.exercises.length !== 1) {
        add(`${blockPath}.exercises`, `Pojedynczy blok w dniu ${dayNumber} musi zawierać dokładnie jedno ćwiczenie.`)
      }
      if (block.type === 'superset' && block.exercises.length < 2) {
        add(`${blockPath}.exercises`, `Superseria w dniu ${dayNumber} musi zawierać co najmniej dwa ćwiczenia.`)
      }
      block.exercises.forEach((exercise, exerciseIndex) => {
        checkExercise(exercise, `${blockPath}.exercises.${exerciseIndex}`)
      })
    })
  })
  return issues
}

export function countGymExercises(definition: GymTemplateDefinition) {
  return definition.days.reduce((total, day) => total + day.blocks.reduce((dayTotal, block) => dayTotal + block.exercises.length, 0), 0)
}

export function getGymTemplateSummary(definition: GymTemplateDefinition) {
  const exerciseCount = countGymExercises(definition)
  const supersetCount = definition.days.reduce((total, day) => total + day.blocks.filter(block => block.type === 'superset').length, 0)
  const dayLabel = definition.days.length === 1 ? 'dzień' : 'dni'
  const exerciseLabel = exerciseCount === 1 ? 'ćwiczenie' : exerciseCount < 5 ? 'ćwiczenia' : 'ćwiczeń'
  return `${definition.days.length} ${dayLabel} · ${exerciseCount} ${exerciseLabel}${supersetCount ? ` · ${supersetCount} superserii` : ''}`
}
