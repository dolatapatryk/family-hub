export type GymExerciseMode = 'reps' | 'time'
export type GymLoadType = 'weight' | 'bodyweight'

interface GymExerciseFields {
  id: string
  name: string
  sets: number
  target_min: number
  target_max: number
  unilateral: boolean
  load_type: GymLoadType
}

export interface GymRepetitionExercise extends GymExerciseFields {
  mode: 'reps'
}

export interface GymTimedExercise extends GymExerciseFields {
  mode: 'time'
}

export type GymExercise = GymRepetitionExercise | GymTimedExercise

export interface GymSingleBlock {
  id: string
  type: 'single'
  exercises: [GymExercise]
}

export interface GymSupersetBlock {
  id: string
  type: 'superset'
  exercises: [GymExercise, GymExercise, ...GymExercise[]]
}

export type GymBlock = GymSingleBlock | GymSupersetBlock

export interface GymDay {
  id: string
  name: string
  blocks: GymBlock[]
}

export interface GymTemplateDefinition {
  days: GymDay[]
}

export interface GymTemplate {
  id: string
  name: string
  weeksCount: number
  daysPerWeek: number
  definition: GymTemplateDefinition
  definitionVersion: number
  revision: number
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export type GymPlanStatus = 'active' | 'completed' | 'abandoned'
export type GymWorkoutStatus = 'draft' | 'completed'

export interface GymPlan {
  id: string
  sourceTemplateId: string | null
  name: string
  weeksCount: number
  daysPerWeek: number
  definitionSnapshot: GymTemplateDefinition
  definitionVersion: number
  status: GymPlanStatus
  startedAt: string
  completedAt: string | null
  abandonedAt: string | null
}

export interface GymWorkout {
  id: string
  planId: string
  weekNumber: number
  dayNumber: number
  status: GymWorkoutStatus
  revision: number
  performedOn: string | null
  startedAt: string
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface GymWorkoutExerciseResult {
  exerciseId: string
  defaultWeightGrams: number | null
}

export interface GymWorkoutSetResult {
  exerciseId: string
  setNumber: number
  actualReps: number | null
  actualSeconds: number | null
  weightOverrideGrams: number | null
}

export interface GymWorkoutDetails {
  workout: GymWorkout
  exercises: GymWorkoutExerciseResult[]
  sets: GymWorkoutSetResult[]
}

export interface GymWorkoutSetInput {
  set_number: number
  actual_reps: number | null
  actual_seconds: number | null
  weight_override_grams: number | null
}

export interface GymWorkoutExerciseInput {
  exercise_id: string
  default_weight_grams: number | null
  sets: GymWorkoutSetInput[]
}

export interface GymWorkoutCompletion {
  workout_id: string
  revision: number
  status: 'completed'
  performed_on: string
  completed_at: string
  plan_id: string
  plan_status: GymPlanStatus
  completed_count: number
  total_count: number
  completed_weeks: number
}

export type GymSlotStatus = 'todo' | 'in_progress' | 'completed'

export interface GymPlanSlot {
  weekNumber: number
  dayNumber: number
  status: GymSlotStatus
}

export interface GymPlanProgress {
  completedCount: number
  totalCount: number
  completedWeeks: number
  currentSlot: { weekNumber: number; dayNumber: number } | null
  slots: GymPlanSlot[]
}

export interface SaveGymTemplateInput {
  id: string | null
  expectedRevision: number | null
  name: string
  weeksCount: number
  daysPerWeek: number
  definition: GymTemplateDefinition
}

export interface GymTemplateValidationIssue {
  path: string
  message: string
}
