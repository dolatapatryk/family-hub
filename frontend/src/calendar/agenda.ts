import { annualOccurrences, type AnnualDate, type AnnualOccurrence } from '../annualDates/annualDates'
import type { Task } from '../tasks/tasks'
import { addDays, eventOverlaps, localDate } from './dates'
import type { CalendarEvent, DateRange } from './types'
import type { ImportedGoogleCalendarEvent } from '../googleCalendar/types'

export type AgendaSource =
  | { kind: 'event'; event: CalendarEvent }
  | { kind: 'google'; event: ImportedGoogleCalendarEvent }
  | { kind: 'annual'; occurrence: AnnualOccurrence }
  | { kind: 'task'; task: Task }

export interface AgendaEntry {
  id: string
  date: string
  title: string
  time: string
  order: string
  createdAt: string
  source: AgendaSource
}

export function buildAgenda(events: CalendarEvent[], importedEvents: ImportedGoogleCalendarEvent[], annualDates: AnnualDate[], tasks: Task[], range: DateRange): AgendaEntry[] {
  const entries: AgendaEntry[] = []
  const timeFormat = new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' })
  for (let date = range.start; date < range.end; date = addDays(date, 1)) {
    for (const event of events) {
      if (!eventOverlaps(event, { start: date, end: addDays(date, 1) })) continue
      const ongoing = !event.allDay && localDate(new Date(event.startsAt)) < date
      entries.push({
        id: `event:${event.id}:${date}`, date, title: event.title,
        time: event.allDay ? 'Cały dzień' : ongoing ? 'W trakcie' : timeFormat.format(new Date(event.startsAt)),
        order: event.allDay || ongoing ? '' : new Date(event.startsAt).toISOString(),
        createdAt: event.createdAt, source: { kind: 'event', event },
      })
    }
    for (const event of importedEvents) {
      if (!eventOverlaps(event, { start: date, end: addDays(date, 1) })) continue
      const ongoing = !event.allDay && localDate(new Date(event.startsAt)) < date
      entries.push({
        id: `google:${event.id}:${date}`, date, title: event.title,
        time: event.allDay ? 'Cały dzień' : ongoing ? 'W trakcie' : timeFormat.format(new Date(event.startsAt)),
        order: event.allDay || ongoing ? '' : new Date(event.startsAt).toISOString(),
        createdAt: event.importedAt, source: { kind: 'google', event },
      })
    }
  }
  for (const occurrence of annualOccurrences(annualDates, range)) {
    entries.push({
      id: `annual:${occurrence.id}`, date: occurrence.date, title: occurrence.title, time: 'Cały dzień',
      order: '', createdAt: occurrence.definition.createdAt, source: { kind: 'annual', occurrence },
    })
  }
  for (const task of tasks) {
    if (task.completed || !task.dueDate || task.dueDate < range.start || task.dueDate >= range.end) continue
    entries.push({
      id: `task:${task.id}`, date: task.dueDate, title: task.title, time: 'Termin',
      order: '', createdAt: task.createdAt, source: { kind: 'task', task },
    })
  }
  return entries.sort((a, b) => a.date.localeCompare(b.date) || a.order.localeCompare(b.order)
    || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
}
