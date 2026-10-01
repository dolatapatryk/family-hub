import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '../auth/supabase'
import { rangeInstants } from '../calendar/dates'
import type { DateRange } from '../calendar/types'
import { requireClient, resolveCalendarRequest } from '../calendar/request'
import type { ImportedGoogleCalendarEvent } from './types'

interface ImportedEventRow {
  id: string
  title: string
  description: string | null
  location: string | null
  html_link: string | null
  all_day: boolean
  starts_at: string | null
  ends_at: string | null
  time_zone: string | null
  start_date: string | null
  end_date: string | null
  google_updated_at: string | null
  imported_at: string
}

const columns = 'id,title,description,location,html_link,all_day,starts_at,ends_at,time_zone,start_date,end_date,google_updated_at,imported_at'
const pageSize = 1000

function toEvent(row: ImportedEventRow): ImportedGoogleCalendarEvent {
  const details = {
    id: row.id,
    title: row.title,
    description: row.description,
    location: row.location,
    htmlLink: row.html_link,
    googleUpdatedAt: row.google_updated_at,
    importedAt: row.imported_at,
  }
  return row.all_day
    ? { ...details, allDay: true, startDate: row.start_date!, endDate: row.end_date! }
    : { ...details, allDay: false, startsAt: row.starts_at!, endsAt: row.ends_at!, timeZone: row.time_zone! }
}

export function createImportedGoogleEventsApi(
  householdId: string,
  client: SupabaseClient | null = supabase,
) {
  async function list(range: DateRange, signal?: AbortSignal): Promise<ImportedGoogleCalendarEvent[]> {
    const instants = rangeInstants(range)
    const events: ImportedGoogleCalendarEvent[] = []
    for (let offset = 0; ; offset += pageSize) {
      if (signal?.aborted) throw new DOMException('Request was aborted.', 'AbortError')
      const page = await resolveCalendarRequest<ImportedEventRow[]>(() => {
        let query = requireClient(client).from('imported_calendar_events').select(columns)
          .eq('household_id', householdId)
          .or(`and(all_day.eq.true,start_date.lt.${range.end},end_date.gt.${range.start}),and(all_day.eq.false,starts_at.lt.${instants.end},ends_at.gt.${instants.start})`)
          .order('imported_at').order('id')
          .range(offset, offset + pageSize - 1)
        if (signal) query = query.abortSignal(signal)
        return query
      })
      events.push(...page.map(toEvent))
      if (page.length < pageSize) return events
    }
  }

  return { list }
}
