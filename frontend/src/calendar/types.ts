export type Visibility = 'household' | 'private'

export interface CalendarItem {
  id: string
  title: string
  description: string | null
  createdBy: string
  visibility: Visibility
  createdAt: string
  updatedAt: string
}

export type EventSchedule =
  | { allDay: true; startDate: string; endDate: string }
  | { allDay: false; startsAt: string; endsAt: string; timeZone: string }

export type CalendarEvent = CalendarItem & EventSchedule
export type EventInput = Pick<CalendarItem, 'title' | 'description' | 'visibility'> & EventSchedule

// Every range ends exclusively, including all-day events.
export interface DateRange { start: string; end: string }
