import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '../auth/supabase.ts'
import type {
  GymPlan,
  GymTemplate,
  GymTemplateDefinition,
  GymWorkout,
  GymWorkoutCompletion,
  GymWorkoutDetails,
  GymWorkoutExerciseInput,
  SaveGymTemplateInput,
} from './types'

interface GymTemplateRow {
  id: string
  owner_user_id: string
  name: string
  weeks_count: number
  days_per_week: number
  definition: GymTemplateDefinition
  definition_version: number
  revision: number
  archived_at: string | null
  created_at: string
  updated_at: string
}

interface GymPlanRow {
  id: string
  owner_user_id: string
  source_template_id: string | null
  name: string
  weeks_count: number
  days_per_week: number
  definition_snapshot: GymTemplateDefinition
  definition_version: number
  status: GymPlan['status']
  started_at: string
  completed_at: string | null
  abandoned_at: string | null
}

interface GymWorkoutRow {
  id: string
  plan_id: string
  owner_user_id: string
  week_number: number
  day_number: number
  status: GymWorkout['status']
  revision: number
  performed_on: string | null
  started_at: string
  completed_at: string | null
  created_at: string
  updated_at: string
}

interface GymWorkoutExerciseRow {
  workout_id: string
  owner_user_id: string
  exercise_id: string
  default_weight_grams: number | null
}

interface GymWorkoutSetRow {
  workout_id: string
  owner_user_id: string
  exercise_id: string
  set_number: number
  actual_reps: number | null
  actual_seconds: number | null
  weight_override_grams: number | null
}

const templateColumns = 'id, owner_user_id, name, weeks_count, days_per_week, definition, definition_version, revision, archived_at, created_at, updated_at'
const planColumns = 'id, owner_user_id, source_template_id, name, weeks_count, days_per_week, definition_snapshot, definition_version, status, started_at, completed_at, abandoned_at'
const workoutColumns = 'id, plan_id, owner_user_id, week_number, day_number, status, revision, performed_on, started_at, completed_at, created_at, updated_at'

function requireSupabase(client: SupabaseClient | null): SupabaseClient {
  if (!client) throw new Error('Supabase is not configured. Check the Family Hub environment settings.')
  return client
}

async function resolve<T>(request: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await request
  if (error) throw new Error(error.message)
  if (data === null) throw new Error('Family Hub returned an empty response. Please try again.')
  return data
}

function toGymTemplate(row: GymTemplateRow): GymTemplate {
  return {
    id: row.id,
    name: row.name,
    weeksCount: row.weeks_count,
    daysPerWeek: row.days_per_week,
    definition: row.definition,
    definitionVersion: row.definition_version,
    revision: row.revision,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toGymPlan(row: GymPlanRow): GymPlan {
  return {
    id: row.id,
    sourceTemplateId: row.source_template_id,
    name: row.name,
    weeksCount: row.weeks_count,
    daysPerWeek: row.days_per_week,
    definitionSnapshot: row.definition_snapshot,
    definitionVersion: row.definition_version,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    abandonedAt: row.abandoned_at,
  }
}

function toGymWorkout(row: GymWorkoutRow): GymWorkout {
  return {
    id: row.id,
    planId: row.plan_id,
    weekNumber: row.week_number,
    dayNumber: row.day_number,
    status: row.status,
    revision: row.revision,
    performedOn: row.performed_on,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function createGymApi(userId: string, client: SupabaseClient | null = supabase) {
  async function list(includeArchived = false, signal?: AbortSignal): Promise<GymTemplate[]> {
    const supabaseClient = requireSupabase(client)
    let query = supabaseClient
      .from('gym_templates')
      .select(templateColumns)
      .eq('owner_user_id', userId)
      .order('archived_at', { ascending: true, nullsFirst: true })
      .order('updated_at', { ascending: false })
    if (!includeArchived) query = query.is('archived_at', null)
    if (signal) query = query.abortSignal(signal)
    const rows = await resolve<GymTemplateRow[]>(query)
    return rows.map(toGymTemplate)
  }

  async function get(templateId: string, signal?: AbortSignal): Promise<GymTemplate> {
    const supabaseClient = requireSupabase(client)
    let query = supabaseClient
      .from('gym_templates')
      .select(templateColumns)
      .eq('owner_user_id', userId)
      .eq('id', templateId)
      .is('archived_at', null)
    if (signal) query = query.abortSignal(signal)
    const { data: row, error } = await query.maybeSingle<GymTemplateRow>()
    if (error) throw new Error(error.message)
    if (!row) throw new Error('Nie znaleziono aktywnego szablonu treningowego.')
    return toGymTemplate(row)
  }

  async function save(input: SaveGymTemplateInput): Promise<string> {
    const supabaseClient = requireSupabase(client)
    return resolve<string>(supabaseClient.rpc('save_gym_template', {
      p_template_id: input.id,
      p_expected_revision: input.expectedRevision,
      p_name: input.name,
      p_weeks_count: input.weeksCount,
      p_days_per_week: input.daysPerWeek,
      p_definition: input.definition,
      p_definition_version: 1,
    }))
  }

  async function archive(templateId: string): Promise<string> {
    const supabaseClient = requireSupabase(client)
    return resolve<string>(supabaseClient.rpc('archive_gym_template', { p_template_id: templateId }))
  }

  async function listPlans(signal?: AbortSignal): Promise<GymPlan[]> {
    const supabaseClient = requireSupabase(client)
    let query = supabaseClient
      .from('gym_plans')
      .select(planColumns)
      .eq('owner_user_id', userId)
      .order('started_at', { ascending: false })
    if (signal) query = query.abortSignal(signal)
    const rows = await resolve<GymPlanRow[]>(query)
    return rows.map(toGymPlan)
  }

  async function activePlan(signal?: AbortSignal): Promise<GymPlan | null> {
    const supabaseClient = requireSupabase(client)
    let query = supabaseClient
      .from('gym_plans')
      .select(planColumns)
      .eq('owner_user_id', userId)
      .eq('status', 'active')
    if (signal) query = query.abortSignal(signal)
    const { data: row, error } = await query.maybeSingle<GymPlanRow>()
    if (error) throw new Error(error.message)
    return row ? toGymPlan(row) : null
  }

  async function getPlan(planId: string, signal?: AbortSignal): Promise<GymPlan> {
    const supabaseClient = requireSupabase(client)
    let query = supabaseClient
      .from('gym_plans')
      .select(planColumns)
      .eq('owner_user_id', userId)
      .eq('id', planId)
    if (signal) query = query.abortSignal(signal)
    const { data: row, error } = await query.maybeSingle<GymPlanRow>()
    if (error) throw new Error(error.message)
    if (!row) throw new Error('Nie znaleziono tego planu treningowego.')
    return toGymPlan(row)
  }

  async function listWorkouts(planId: string, signal?: AbortSignal): Promise<GymWorkout[]> {
    const supabaseClient = requireSupabase(client)
    let query = supabaseClient
      .from('gym_workouts')
      .select(workoutColumns)
      .eq('owner_user_id', userId)
      .eq('plan_id', planId)
      .order('week_number', { ascending: true })
      .order('day_number', { ascending: true })
    if (signal) query = query.abortSignal(signal)
    const rows = await resolve<GymWorkoutRow[]>(query)
    return rows.map(toGymWorkout)
  }

  async function getWorkoutDetails(workoutId: string, signal?: AbortSignal): Promise<GymWorkoutDetails> {
    const supabaseClient = requireSupabase(client)
    let workoutQuery = supabaseClient
      .from('gym_workouts')
      .select(workoutColumns)
      .eq('owner_user_id', userId)
      .eq('id', workoutId)
    if (signal) workoutQuery = workoutQuery.abortSignal(signal)
    const { data: workoutRow, error: workoutError } = await workoutQuery.maybeSingle<GymWorkoutRow>()
    if (workoutError) throw new Error(workoutError.message)
    if (!workoutRow) throw new Error('Nie znaleziono tego treningu.')

    let exercisesQuery = supabaseClient
      .from('gym_workout_exercises')
      .select('workout_id, owner_user_id, exercise_id, default_weight_grams')
      .eq('owner_user_id', userId)
      .eq('workout_id', workoutId)
      .order('exercise_id', { ascending: true })
    let setsQuery = supabaseClient
      .from('gym_workout_sets')
      .select('workout_id, owner_user_id, exercise_id, set_number, actual_reps, actual_seconds, weight_override_grams')
      .eq('owner_user_id', userId)
      .eq('workout_id', workoutId)
      .order('exercise_id', { ascending: true })
      .order('set_number', { ascending: true })
    if (signal) {
      exercisesQuery = exercisesQuery.abortSignal(signal)
      setsQuery = setsQuery.abortSignal(signal)
    }
    const [exerciseRows, setRows] = await Promise.all([
      resolve<GymWorkoutExerciseRow[]>(exercisesQuery),
      resolve<GymWorkoutSetRow[]>(setsQuery),
    ])

    return {
      workout: toGymWorkout(workoutRow),
      exercises: exerciseRows.map(row => ({ exerciseId: row.exercise_id, defaultWeightGrams: row.default_weight_grams })),
      sets: setRows.map(row => ({
        exerciseId: row.exercise_id,
        setNumber: row.set_number,
        actualReps: row.actual_reps,
        actualSeconds: row.actual_seconds,
        weightOverrideGrams: row.weight_override_grams,
      })),
    }
  }

  async function startPlan(templateId: string, name: string): Promise<string> {
    const supabaseClient = requireSupabase(client)
    return resolve<string>(supabaseClient.rpc('start_gym_plan', {
      p_template_id: templateId,
      p_name: name,
    }))
  }

  async function abandonPlan(planId: string): Promise<string> {
    const supabaseClient = requireSupabase(client)
    return resolve<string>(supabaseClient.rpc('abandon_gym_plan', { p_plan_id: planId }))
  }

  async function startWorkout(planId: string, weekNumber: number, dayNumber: number): Promise<string> {
    const supabaseClient = requireSupabase(client)
    return resolve<string>(supabaseClient.rpc('start_gym_workout', {
      p_plan_id: planId,
      p_week_number: weekNumber,
      p_day_number: dayNumber,
    }))
  }

  async function saveWorkoutDraft(workoutId: string, expectedRevision: number, results: GymWorkoutExerciseInput[]): Promise<number> {
    const supabaseClient = requireSupabase(client)
    return resolve<number>(supabaseClient.rpc('save_gym_workout_draft', {
      p_workout_id: workoutId,
      p_expected_revision: expectedRevision,
      p_results: results,
    }))
  }

  async function completeWorkout(
    workoutId: string,
    expectedRevision: number,
    results: GymWorkoutExerciseInput[],
    performedOn: string,
  ): Promise<GymWorkoutCompletion> {
    const supabaseClient = requireSupabase(client)
    return resolve<GymWorkoutCompletion>(supabaseClient.rpc('complete_gym_workout', {
      p_workout_id: workoutId,
      p_expected_revision: expectedRevision,
      p_results: results,
      p_performed_on: performedOn,
    }))
  }

  async function correctWorkoutResults(workoutId: string, expectedRevision: number, results: GymWorkoutExerciseInput[]): Promise<number> {
    const supabaseClient = requireSupabase(client)
    return resolve<number>(supabaseClient.rpc('correct_gym_workout_results', {
      p_workout_id: workoutId,
      p_expected_revision: expectedRevision,
      p_results: results,
    }))
  }

  return {
    list,
    get,
    save,
    archive,
    listPlans,
    activePlan,
    getPlan,
    listWorkouts,
    getWorkoutDetails,
    startPlan,
    abandonPlan,
    startWorkout,
    saveWorkoutDraft,
    completeWorkout,
    correctWorkoutResults,
  }
}
