import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '../auth/supabase.ts'
import { rangeInstants } from './dates'
import { requireClient, resolveCalendarRequest } from './request'
import type { CalendarEvent, DateRange, EventInput, Visibility } from './types'

interface EventRow {
  id: string
  title: string
  description: string | null
  created_by: string
  visibility: Visibility
  all_day: boolean
  starts_at: string | null
  ends_at: string | null
  time_zone: string | null
  start_date: string | null
  end_date: string | null
  created_at: string
  updated_at: string
}

const columns = 'id, title, description, created_by, visibility, all_day, starts_at, ends_at, time_zone, start_date, end_date, created_at, updated_at'

function toEvent(row: EventRow): CalendarEvent {
  const item = {
    id: row.id, title: row.title, description: row.description, createdBy: row.created_by,
    visibility: row.visibility, createdAt: row.created_at, updatedAt: row.updated_at,
  }
  return row.all_day
    ? { ...item, allDay: true, startDate: row.start_date!, endDate: row.end_date! }
    : { ...item, allDay: false, startsAt: row.starts_at!, endsAt: row.ends_at!, timeZone: row.time_zone! }
}

function values(input: EventInput) {
  return {
    title: input.title.trim(), description: input.description?.trim() || null,
    visibility: input.visibility, all_day: input.allDay,
    starts_at: input.allDay ? null : input.startsAt,
    ends_at: input.allDay ? null : input.endsAt,
    time_zone: input.allDay ? null : input.timeZone,
    start_date: input.allDay ? input.startDate : null,
    end_date: input.allDay ? input.endDate : null,
  }
}

export function createCalendarEventsApi(householdId: string, userId: string, client: SupabaseClient | null = supabase) {
  async function list(range: DateRange, signal?: AbortSignal): Promise<CalendarEvent[]> {
    const instants = rangeInstants(range)
    const data = await resolveCalendarRequest<EventRow[]>(() => {
      let query = requireClient(client).from('calendar_events').select(columns)
        .eq('household_id', householdId)
        .or(`and(all_day.eq.true,start_date.lt.${range.end},end_date.gt.${range.start}),and(all_day.eq.false,starts_at.lt.${instants.end},ends_at.gt.${instants.start})`)
        .order('created_at').order('id')
      if (signal) query = query.abortSignal(signal)
      return query
    })
    return data.map(toEvent)
  }

  async function create(input: EventInput): Promise<CalendarEvent> {
    const data = await resolveCalendarRequest<EventRow>(() => requireClient(client).from('calendar_events')
      .insert({ ...values(input), household_id: householdId, created_by: userId }).select(columns).single())
    return toEvent(data)
  }

  async function update(id: string, input: EventInput): Promise<CalendarEvent> {
    const data = await resolveCalendarRequest<EventRow>(() => requireClient(client).from('calendar_events')
      .update(values(input)).eq('id', id).eq('household_id', householdId).select(columns).single())
    return toEvent(data)
  }

  async function remove(id: string): Promise<string> {
    const data = await resolveCalendarRequest<{ id: string }>(() => requireClient(client).from('calendar_events')
      .delete().eq('id', id).eq('household_id', householdId).select('id').single())
    return data.id
  }

  return { list, create, update, remove }
}
