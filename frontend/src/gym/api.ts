import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '../auth/supabase.ts'
import type { GymTemplate, GymTemplateDefinition, SaveGymTemplateInput } from './types'

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

const templateColumns = 'id, owner_user_id, name, weeks_count, days_per_week, definition, definition_version, revision, archived_at, created_at, updated_at'

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
      .maybeSingle<GymTemplateRow>()
    if (signal) query = query.abortSignal(signal)
    const { data: row, error } = await query
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

  return { list, get, save, archive }
}
