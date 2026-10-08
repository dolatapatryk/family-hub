export type SyncRunKind = 'initial' | 'incremental' | 'rebuild'
export type SyncErrorCode = 'network_error' | 'rate_limited' | 'google_error' | 'invalid_response' | 'reconnect_required' | 'sync_error'

export interface GoogleEventsRequest {
  googleCalendarId: string
  pageToken: string | null
  runKind: SyncRunKind
  syncToken: string | null
  initialSyncTimeMin: string | null
}

export interface GoogleEventContext {
  timeZone: string | null
}

export interface GoogleEventTime {
  date?: string
  dateTime?: string
  timeZone?: string
}

export interface GoogleEvent {
  id?: string
  status?: string
  summary?: string
  description?: string
  location?: string
  htmlLink?: string
  start?: GoogleEventTime
  end?: GoogleEventTime
  updated?: string
  recurrence?: string[]
  recurringEventId?: string
}

export interface GoogleEventPage {
  items?: unknown[]
  nextPageToken?: string
  nextSyncToken?: string
}

export interface NormalizedGoogleEvent {
  google_event_id: string
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
}

export class SyncFailure extends Error {
  readonly code: SyncErrorCode

  constructor(code: SyncErrorCode) {
    super(code)
    this.code = code
  }
}

export function buildGoogleEventsListUrl(request: GoogleEventsRequest): URL {
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(request.googleCalendarId)}/events`)
  url.searchParams.set('maxResults', '250')
  url.searchParams.set('singleEvents', 'false')
  url.searchParams.set('showDeleted', 'true')
  url.searchParams.set('fields', 'nextPageToken,nextSyncToken,items(id,status,summary,description,location,htmlLink,start(date,dateTime,timeZone),end(date,dateTime,timeZone),updated,recurrence,recurringEventId)')
  if (request.pageToken) url.searchParams.set('pageToken', request.pageToken)
  if (request.runKind === 'incremental') {
    if (!request.syncToken) throw new SyncFailure('invalid_response')
    url.searchParams.set('syncToken', request.syncToken)
  } else {
    if (!request.initialSyncTimeMin) throw new SyncFailure('invalid_response')
    url.searchParams.set('timeMin', request.initialSyncTimeMin)
  }
  return url
}

export function parseGoogleEventPage(payload: unknown): GoogleEventPage {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new SyncFailure('invalid_response')
  }
  const page = payload as GoogleEventPage
  if (page.items !== undefined && !Array.isArray(page.items)) throw new SyncFailure('invalid_response')
  if ((page.nextPageToken !== undefined && typeof page.nextPageToken !== 'string')
      || (page.nextSyncToken !== undefined && typeof page.nextSyncToken !== 'string')) {
    throw new SyncFailure('invalid_response')
  }
  if (page.nextPageToken && page.nextSyncToken) throw new SyncFailure('invalid_response')
  if (!page.nextPageToken && !page.nextSyncToken) throw new SyncFailure('invalid_response')
  return page
}

function validTimeZone(value: string | null | undefined): value is string {
  if (!value?.trim()) return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format(0)
    return true
  } catch {
    return false
  }
}

function wallClockInZoneToIso(value: string, timeZone: string): string | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?$/)
  if (!match) return null
  const [, yearText, monthText, dayText, hourText, minuteText, secondText = '0', fraction = ''] = match
  const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number)
  const utcMilliseconds = (utcYear: number, utcMonth: number, utcDay: number, utcHour: number, utcMinute: number, utcSecond: number) => {
    const date = new Date(0)
    date.setUTCFullYear(utcYear, utcMonth - 1, utcDay)
    date.setUTCHours(utcHour, utcMinute, utcSecond, 0)
    return date.getTime()
  }
  const wallUtc = utcMilliseconds(year, month, day, hour, minute, second)
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  })
  const candidates = new Set<number>()
  for (let offsetHours = -36; offsetHours <= 36; offsetHours += 12) {
    const probe = wallUtc + offsetHours * 60 * 60 * 1000
    const formatted = Object.fromEntries(formatter.formatToParts(new Date(probe)).map(part => [part.type, part.value]))
    const represented = utcMilliseconds(Number(formatted.year), Number(formatted.month), Number(formatted.day),
      Number(formatted.hour), Number(formatted.minute), Number(formatted.second))
    const candidate = wallUtc - (represented - probe)
    const check = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map(part => [part.type, part.value]))
    if (Number(check.year) === year && Number(check.month) === month && Number(check.day) === day
        && Number(check.hour) === hour && Number(check.minute) === minute && Number(check.second) === second) {
      candidates.add(candidate)
    }
  }
  // An offset-less repeated wall time is ambiguous. Never guess which instant
  // Google intended; its normal API representation includes the UTC offset.
  if (candidates.size !== 1) return null
  const fractionalMilliseconds = Number(`0.${fraction}`) * 1000
  return new Date([...candidates][0] + fractionalMilliseconds).toISOString()
}

function timedValue(value: string, timeZone: string): string | null {
  const hasOffset = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
  if (hasOffset) {
    const instant = new Date(value)
    return Number.isFinite(instant.getTime()) ? instant.toISOString() : null
  }
  return wallClockInZoneToIso(value, timeZone)
}

function isDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && !value.startsWith('0000-')
}

export function normalizeGoogleEvent(event: GoogleEvent, context: GoogleEventContext): NormalizedGoogleEvent | null {
  if (typeof event.id !== 'string' || !event.id.trim() || event.id.length > 1024) {
    throw new SyncFailure('invalid_response')
  }
  const id = event.id.trim()
  if (event.status === 'cancelled' || event.recurrence?.length || event.recurringEventId) return null

  const start = event.start
  const end = event.end
  if (!start || !end) throw new SyncFailure('invalid_response')
  const title = (event.summary?.trim() || 'Wydarzenie bez tytułu').slice(0, 500)
  const description = event.description?.trim().slice(0, 20_000) || null
  const location = event.location?.trim().slice(0, 2_000) || null
  const htmlLink = typeof event.htmlLink === 'string' && event.htmlLink.length <= 2048
    && /^https:\/\/(?:calendar|www)\.google\.com\//i.test(event.htmlLink)
    ? event.htmlLink
    : null
  const googleUpdatedAt = typeof event.updated === 'string' && Number.isFinite(Date.parse(event.updated))
    ? new Date(event.updated).toISOString()
    : null

  if (typeof start.date === 'string' || typeof end.date === 'string') {
    if (!start.date || !end.date || !isDateOnly(start.date)
        || !isDateOnly(end.date) || end.date <= start.date) {
      throw new SyncFailure('invalid_response')
    }
    return {
      google_event_id: id, title, description, location, html_link: htmlLink,
      all_day: true, starts_at: null, ends_at: null, time_zone: null,
      start_date: start.date, end_date: end.date, google_updated_at: googleUpdatedAt,
    }
  }

  if (!start.dateTime || !end.dateTime) throw new SyncFailure('invalid_response')
  const timeZone = validTimeZone(start.timeZone) ? start.timeZone
    : validTimeZone(context.timeZone) ? context.timeZone : 'UTC'
  const startsAt = timedValue(start.dateTime, timeZone)
  const endsAt = timedValue(end.dateTime, timeZone)
  if (!startsAt || !endsAt || Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new SyncFailure('invalid_response')
  }
  return {
    google_event_id: id, title, description, location, html_link: htmlLink,
    all_day: false, starts_at: startsAt, ends_at: endsAt, time_zone: timeZone,
    start_date: null, end_date: null, google_updated_at: googleUpdatedAt,
  }
}

export function normalizeGoogleEventItems(items: unknown[], context: GoogleEventContext): {
  events: NormalizedGoogleEvent[]
  removedEventIds: string[]
} {
  const events: NormalizedGoogleEvent[] = []
  const removedEventIds = new Set<string>()
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new SyncFailure('invalid_response')
    }
    const event = item as GoogleEvent
    if (event.status === 'cancelled') {
      if (typeof event.id !== 'string' || !event.id.trim()) throw new SyncFailure('invalid_response')
      removedEventIds.add(event.id.trim())
      continue
    }
    const normalized = normalizeGoogleEvent(event, context)
    if (normalized) events.push(normalized)
    else if (typeof event.id === 'string' && event.id.trim()) removedEventIds.add(event.id.trim())
  }
  return { events, removedEventIds: [...removedEventIds] }
}
