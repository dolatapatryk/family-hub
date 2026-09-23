import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '../auth/supabase.ts'
import type { Task } from './tasks'

interface TaskRow {
  id: string
  title: string
  due_date: string | null
  completed: boolean
  assigned_to: string | null
  created_by: string
  created_at: string
  archived_at: string | null
}

export interface CreateTaskInput {
  title: string
  dueDate: string | null
  assignedTo?: string | null
}

const taskColumns = 'id, title, due_date, completed, assigned_to, created_by, created_at, archived_at'
const connectionErrorMessage = 'Could not reach Family Hub. Check your connection and try again.'

function requireSupabase(client: SupabaseClient | null): SupabaseClient {
  if (!client) throw new Error('Supabase is not configured. Check the Family Hub environment settings.')
  return client
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error
    && (error as { name?: unknown }).name === 'AbortError'
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    if (error.name === 'TypeError' || /failed to fetch|network|load failed/i.test(error.message)) {
      return new Error(connectionErrorMessage)
    }
    return error
  }

  const message = typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message: unknown }).message)
    : ''
  if (/failed to fetch|network|load failed/i.test(message)) return new Error(connectionErrorMessage)
  return new Error(message || connectionErrorMessage)
}

async function resolve<T>(
  request: PromiseLike<{ data: T | null; error: { message: string } | null }>
    | (() => PromiseLike<{ data: T | null; error: { message: string } | null }>),
): Promise<T> {
  try {
    const { data, error } = await (typeof request === 'function' ? request() : request)
    if (error) throw new Error(error.message)
    if (data === null) throw new Error('Family Hub returned an empty response. Please try again.')
    return data
  } catch (error) {
    if (isAbortError(error)) throw error
    throw normalizeError(error)
  }
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    dueDate: row.due_date,
    completed: row.completed,
    assignedTo: row.assigned_to,
    createdBy: row.created_by,
    createdAt: row.created_at,
    archivedAt: row.archived_at,
  }
}

export function createTasksApi(
  householdId: string,
  userId: string,
  client: SupabaseClient | null = supabase,
) {
  async function updateTask(
    id: string,
    values: { completed?: boolean; assigned_to?: string | null; archived_at?: string },
  ): Promise<Task> {
    const supabaseClient = requireSupabase(client)
    const data = await resolve<TaskRow>(() => supabaseClient
      .from('tasks')
      .update(values)
      .eq('id', id)
      .eq('household_id', householdId)
      .is('archived_at', null)
      .select(taskColumns)
      .single())
    return toTask(data)
  }

  async function list(signal?: AbortSignal): Promise<Task[]> {
    const supabaseClient = requireSupabase(client)
    const data = await resolve<TaskRow[]>(() => {
      let query = supabaseClient
        .from('tasks')
        .select(taskColumns)
        .eq('household_id', householdId)
        .is('archived_at', null)
        .order('due_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
      if (signal) query = query.abortSignal(signal)
      return query
    })
    return data.map(toTask)
  }

  async function create(input: CreateTaskInput): Promise<Task> {
    const supabaseClient = requireSupabase(client)
    const data = await resolve<TaskRow>(() => supabaseClient
      .from('tasks')
      .insert({
        household_id: householdId,
        title: input.title,
        due_date: input.dueDate,
        assigned_to: input.assignedTo ?? null,
        created_by: userId,
      })
      .select(taskColumns)
      .single())
    return toTask(data)
  }

  async function setCompleted(id: string, completed: boolean): Promise<Task> {
    return updateTask(id, { completed })
  }

  async function setAssignedTo(id: string, profileId: string | null): Promise<Task> {
    return updateTask(id, { assigned_to: profileId })
  }

  async function archive(id: string): Promise<Task> {
    return updateTask(id, { archived_at: new Date().toISOString() })
  }

  return {
    list,
    create,
    setCompleted,
    setAssignedTo,
    archive,

    // These aliases keep the current Tasks page type-safe until Stage 12
    // switches its mutations to the explicit Supabase operations above.
    assign: setAssignedTo,
    action: (id: string, action: 'complete' | 'reopen' | 'archive') => {
      if (action === 'archive') return archive(id)
      return setCompleted(id, action === 'complete')
    },
  }
}
