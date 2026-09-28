import { localDate } from '../tasks/tasks'
import type { CalendarEvent, DateRange } from './types'

export { localDate }

export function dateOnly(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  const result = new Date(0)
  result.setFullYear(year, month - 1, day)
  result.setHours(0, 0, 0, 0)
  return result
}

export function addDays(value: string, days: number): string {
  // Calendar arithmetic stays independent of timezone/DST transitions.
  let [year, month, day] = value.split('-').map(Number)
  const direction = Math.sign(days)
  for (let remaining = Math.abs(days); remaining > 0; remaining--) {
    day += direction
    if (day > daysInMonth(month, year)) {
      day = 1
      month++
      if (month > 12) { month = 1; year++ }
    } else if (day < 1) {
      month--
      if (month < 1) { month = 12; year-- }
      day = daysInMonth(month, year)
    }
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function validDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number)
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && year >= 1 && year <= 9999
    && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(month, year)
}

export function rangeInstants(range: DateRange) {
  return { start: dateOnly(range.start).toISOString(), end: dateOnly(range.end).toISOString() }
}

export function eventOverlaps(event: CalendarEvent, range: DateRange): boolean {
  if (event.allDay) return event.startDate < range.end && event.endDate > range.start
  const instants = rangeInstants(range)
  return Date.parse(event.startsAt) < Date.parse(instants.end) && Date.parse(event.endsAt) > Date.parse(instants.start)
}

export function formatDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number)
  const monthLabel = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long' })
    .formatToParts(new Date(2000, month - 1, 1)).find(part => part.type === 'month')!.value
  return `${day} ${monthLabel} ${year}`
}

export function daysInMonth(month: number, year = 2000): number {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0
}

export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

export function canonicalTimeZone(value: string): string {
  try {
    return new Intl.DateTimeFormat('en', { timeZone: value.trim() }).resolvedOptions().timeZone
  } catch {
    throw new Error('Podaj poprawną strefę czasową, np. Europe/Warsaw.')
  }
}

export function zonedInput(instant: string, timeZone: string, includeSeconds = false): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: includeSeconds ? '2-digit' : undefined, hourCycle: 'h23',
  }).formatToParts(new Date(instant))
  const part = (name: string) => parts.find(value => value.type === name)!.value
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}${includeSeconds ? `:${part('second')}` : ''}`
}

// Convert wall-clock input in an IANA zone without silently shifting a time
// during a DST gap. Reject repeated times too, so the intended instant is clear.
export function zonedInstant(value: string, timeZone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || !validDate(value.slice(0, 10))) {
    throw new Error('Podaj poprawną datę i godzinę.')
  }
  timeZone = canonicalTimeZone(timeZone)
  const wall = new Date(`${value}:00Z`).getTime()
  if (!Number.isFinite(wall)) throw new Error('Podaj poprawną godzinę.')
  const candidates = new Set<number>()
  for (let hours = -36; hours <= 36; hours += 12) {
    const probe = wall + hours * 60 * 60 * 1000
    const offset = new Date(`${zonedInput(new Date(probe).toISOString(), timeZone, true)}Z`).getTime() - probe
    const candidate = wall - offset
    if (zonedInput(new Date(candidate).toISOString(), timeZone, true) === `${value}:00`) candidates.add(candidate)
  }
  if (!candidates.size) throw new Error('Ta godzina nie istnieje w wybranej strefie z powodu zmiany czasu. Wybierz inną godzinę.')
  if (candidates.size > 1) throw new Error('Ta godzina występuje dwukrotnie podczas zmiany czasu. Wybierz godzinę poza tym przedziałem.')
  return new Date([...candidates][0]).toISOString()
}
