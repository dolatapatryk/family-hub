import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '../auth/supabase.ts'
import { requireClient, resolveCalendarRequest } from '../calendar/request'
import type { Visibility } from '../calendar/types'
import type { AnnualDate, AnnualDateInput } from './annualDates'

interface AnnualDateRow {
  id: string
  title: string
  description: string | null
  created_by: string
  visibility: Visibility
  kind: AnnualDate['kind']
  initial_date: string | null
  month: number | null
  day: number | null
  created_at: string
  updated_at: string
}
const columns = 'id, title, description, created_by, visibility, kind, initial_date, month, day, created_at, updated_at'

function toAnnualDate(row: AnnualDateRow): AnnualDate {
  const item = {
    id: row.id, title: row.title, description: row.description, createdBy: row.created_by,
    visibility: row.visibility, createdAt: row.created_at, updatedAt: row.updated_at,
  }
  return row.kind === 'other'
    ? { ...item, kind: 'other', month: row.month!, day: row.day! }
    : { ...item, kind: row.kind, initialDate: row.initial_date! }
}

function values(input: AnnualDateInput) {
  return {
    title: input.title.trim(), description: input.description?.trim() || null,
    visibility: input.visibility, kind: input.kind,
    initial_date: input.kind === 'other' ? null : input.initialDate,
    month: input.kind === 'other' ? input.month : null,
    day: input.kind === 'other' ? input.day : null,
  }
}

export function createAnnualDatesApi(householdId: string, userId: string, client: SupabaseClient | null = supabase) {
  async function list(signal?: AbortSignal): Promise<AnnualDate[]> {
    const data = await resolveCalendarRequest<AnnualDateRow[]>(() => {
      let query = requireClient(client).from('annual_dates').select(columns)
        .eq('household_id', householdId).order('created_at').order('id')
      if (signal) query = query.abortSignal(signal)
      return query
    })
    return data.map(toAnnualDate)
  }
  async function create(input: AnnualDateInput): Promise<AnnualDate> {
    const data = await resolveCalendarRequest<AnnualDateRow>(() => requireClient(client).from('annual_dates')
      .insert({ ...values(input), household_id: householdId, created_by: userId }).select(columns).single())
    return toAnnualDate(data)
  }
  async function update(id: string, input: AnnualDateInput): Promise<AnnualDate> {
    const data = await resolveCalendarRequest<AnnualDateRow>(() => requireClient(client).from('annual_dates')
      .update(values(input)).eq('id', id).eq('household_id', householdId).select(columns).single())
    return toAnnualDate(data)
  }
  async function remove(id: string): Promise<string> {
    const data = await resolveCalendarRequest<{ id: string }>(() => requireClient(client).from('annual_dates')
      .delete().eq('id', id).eq('household_id', householdId).select('id').single())
    return data.id
  }
  return { list, create, update, remove }
}
