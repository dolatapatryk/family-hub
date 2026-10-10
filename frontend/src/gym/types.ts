export type GymExerciseMode = 'reps' | 'time'
export type GymLoadType = 'weight' | 'bodyweight'

export interface GymExercise {
  id: string
  name: string
  sets: number
  mode: GymExerciseMode
  target_min: number
  target_max: number
  unilateral: boolean
  load_type: GymLoadType
}

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
