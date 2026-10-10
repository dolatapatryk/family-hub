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
