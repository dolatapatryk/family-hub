import type { QueryClient } from '@tanstack/react-query'
import type { AnnualDate } from '../annualDates/annualDates'
import { eventOverlaps } from './dates'
import { annualDatesKey, calendarKey } from './queries'
import type { CalendarEvent } from './types'

export async function refreshEventCaches(client: QueryClient, householdId: string, userId: string, changed: CalendarEvent | string) {
  const key = calendarKey(householdId)
  await client.cancelQueries({ queryKey: key })
  for (const [queryKey, items] of client.getQueriesData<CalendarEvent[]>({ queryKey: key })) {
    if (queryKey[4] !== userId) continue
    const id = typeof changed === 'string' ? changed : changed.id
    const remaining = (items ?? []).filter(item => item.id !== id)
    const range = { start: String(queryKey[2]), end: String(queryKey[3]) }
    client.setQueryData(queryKey, typeof changed !== 'string' && eventOverlaps(changed, range)
      ? [...remaining, changed] : remaining)
  }
  // Cache the acknowledged write before refreshing, so a connection failure
  // during refresh does not make a successful edit or deletion disappear.
  await client.invalidateQueries({ queryKey: key })
}

export async function refreshAnnualDateCaches(client: QueryClient, householdId: string, userId: string, changed: AnnualDate | string) {
  const queryKey = annualDatesKey(householdId, userId)
  await client.cancelQueries({ queryKey })
  client.setQueryData<AnnualDate[]>(queryKey, items => {
    const id = typeof changed === 'string' ? changed : changed.id
    const remaining = (items ?? []).filter(item => item.id !== id)
    return typeof changed === 'string' ? remaining : [...remaining, changed]
  })
  await client.invalidateQueries({ queryKey })
}
