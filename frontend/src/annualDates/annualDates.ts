import { daysInMonth } from '../calendar/dates'
import type { CalendarItem, DateRange } from '../calendar/types'

export const kindLabels = { birthday: 'Urodziny', anniversary: 'Rocznica', other: 'Inne' } as const
export type AnnualDefinition =
  | { kind: 'birthday' | 'anniversary'; initialDate: string }
  | { kind: 'other'; month: number; day: number }
export type AnnualDate = CalendarItem & AnnualDefinition
export type AnnualDateInput = Pick<CalendarItem, 'title' | 'description' | 'visibility'> & AnnualDefinition

export interface AnnualOccurrence {
  id: string
  date: string
  title: string
  count: number | null
  definition: AnnualDate
}

export function annualOccurrences(definitions: AnnualDate[], range: DateRange): AnnualOccurrence[] {
  const occurrences: AnnualOccurrence[] = []
  for (const definition of definitions) {
    const [initialYear, month, day] = definition.kind === 'other'
      ? [null, definition.month, definition.day]
      : definition.initialDate.split('-').map(Number)
    for (let year = Number(range.start.slice(0, 4)); year <= Number(range.end.slice(0, 4)); year++) {
      if (initialYear !== null && year <= initialYear) continue
      const occurrenceDay = Math.min(day!, daysInMonth(month!, year))
      const date = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(occurrenceDay).padStart(2, '0')}`
      if (date < range.start || date >= range.end) continue
      const count = initialYear === null ? null : year - initialYear
      const suffix = definition.kind === 'birthday' ? `${count}. urodziny` : `${count}. rocznica`
      occurrences.push({
        id: `${definition.id}:${date}`, date, count, definition,
        title: definition.kind === 'other' ? definition.title : `${definition.title} · ${suffix}`,
      })
    }
  }
  return occurrences.sort((a, b) => a.date.localeCompare(b.date)
    || a.definition.createdAt.localeCompare(b.definition.createdAt) || a.id.localeCompare(b.id))
}
