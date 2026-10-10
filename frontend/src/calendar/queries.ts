import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthGate'
import { createAnnualDatesApi } from '../annualDates/api'
import { createTasksApi } from '../tasks/api'
import { createCalendarEventsApi } from './api'
import { browserTimeZone } from './dates'
import { createImportedGoogleEventsApi } from '../googleCalendar/events'
import type { DateRange } from './types'

export const calendarKey = (householdId: string) => ['calendarEvents', householdId] as const
export const annualDatesKey = (householdId: string, userId: string) => ['annualDates', householdId, userId] as const
export const importedGoogleEventsKey = (householdId: string, userId: string, range: DateRange, timeZone: string) =>
  ['importedGoogleCalendarEvents', householdId, userId, range.start, range.end, timeZone] as const

export function useCalendarSources(range: DateRange) {
  const { profile } = useAuth()
  const eventsApi = createCalendarEventsApi(profile.household_id, profile.id)
  const annualApi = createAnnualDatesApi(profile.household_id, profile.id)
  const tasksApi = createTasksApi(profile.household_id, profile.id)
  const importedApi = createImportedGoogleEventsApi(profile.household_id)
  // User identity prevents another member's private data appearing from cache
  // after an account switch. Timed range boundaries also depend on the viewer's zone.
  const events = useQuery({
    queryKey: [...calendarKey(profile.household_id), range.start, range.end, profile.id, browserTimeZone()],
    queryFn: ({ signal }) => eventsApi.list(range, signal),
  })
  const annualDates = useQuery({
    queryKey: annualDatesKey(profile.household_id, profile.id),
    queryFn: ({ signal }) => annualApi.list(signal),
  })
  const importedEvents = useQuery({
    queryKey: importedGoogleEventsKey(profile.household_id, profile.id, range, browserTimeZone()),
    queryFn: ({ signal }) => importedApi.list(range, signal),
  })
  const tasks = useQuery({
    queryKey: ['tasks', profile.household_id],
    queryFn: ({ signal }) => tasksApi.list(signal),
  })
  return { events, importedEvents, annualDates, tasks }
}
