import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import { HttpError } from './http.ts'
import { googleCalendarAccessToken, markGoogleCalendarReconnectRequired } from './google-api.ts'
import { rpc } from './supabase.ts'

type SyncRunKind = 'initial' | 'incremental' | 'rebuild'
type SyncErrorCode = 'network_error' | 'rate_limited' | 'google_error' | 'invalid_response' | 'reconnect_required' | 'sync_error'

interface SyncClaim {
  calendarRowId: string
  connectionId: string
  householdId: string
  googleCalendarId: string
  timeZone: string | null
  runId: string
  runKind: SyncRunKind
  generation: number
  pageToken: string | null
  syncToken: string | null
  initialSyncTimeMin: string | null
}

interface GoogleEventTime {
  date?: string
  dateTime?: string
  timeZone?: string
}

interface GoogleEvent {
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

interface GoogleEventPage {
  items?: GoogleEvent[]
  nextPageToken?: string
  nextSyncToken?: string
}

interface NormalizedGoogleEvent {
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

class SyncFailure extends Error {
  constructor(readonly code: SyncErrorCode) {
    super(code)
  }
}

class SyncTokenExpired extends Error {}
class CalendarAccessLost extends Error {}

function sleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
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
  const parts = [Number(yearText), Number(monthText), Number(dayText), Number(hourText), Number(minuteText), Number(secondText)]
  const [year, month, day, hour, minute, second] = parts
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

function normalizeGoogleEvent(event: GoogleEvent, claim: SyncClaim): NormalizedGoogleEvent | null {
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
    : validTimeZone(claim.timeZone) ? claim.timeZone : 'UTC'
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

function retryAfterMilliseconds(value: string | null): number | null {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, Math.min(2_500, seconds * 1000))
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, Math.min(2_500, date - Date.now())) : null
}

async function requestGooglePage(accessToken: string, claim: SyncClaim): Promise<GoogleEventPage> {
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(claim.googleCalendarId)}/events`)
  url.searchParams.set('maxResults', '250')
  url.searchParams.set('singleEvents', 'false')
  url.searchParams.set('showDeleted', 'true')
  url.searchParams.set('fields', 'nextPageToken,nextSyncToken,items(id,status,summary,description,location,htmlLink,start(date,dateTime,timeZone),end(date,dateTime,timeZone),updated,recurrence,recurringEventId)')
  if (claim.pageToken) url.searchParams.set('pageToken', claim.pageToken)
  if (claim.runKind === 'incremental') {
    if (!claim.syncToken) throw new SyncFailure('invalid_response')
    url.searchParams.set('syncToken', claim.syncToken)
  } else {
    if (!claim.initialSyncTimeMin) throw new SyncFailure('invalid_response')
    url.searchParams.set('timeMin', claim.initialSyncTimeMin)
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response
    try {
      response = await fetch(url, {
        headers: { authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(8_000),
      })
    } catch {
      if (attempt < 2) {
        await sleep(attempt === 0 ? 300 : 900)
        continue
      }
      throw new SyncFailure('network_error')
    }

    if (response.status === 410) throw new SyncTokenExpired()
    if (response.status === 401) throw new HttpError(409, 'reconnect_required', 'Google wymaga ponownego połączenia konta.')

    if (response.ok) {
      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        throw new SyncFailure('invalid_response')
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new SyncFailure('invalid_response')
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

    let reason = ''
    try {
      const payload: unknown = await response.json()
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        const error = (payload as Record<string, unknown>).error
        if (error && typeof error === 'object' && !Array.isArray(error)) {
          const errors = (error as Record<string, unknown>).errors
          if (Array.isArray(errors) && errors[0] && typeof errors[0] === 'object') {
            reason = String((errors[0] as Record<string, unknown>).reason ?? '')
          }
        }
      }
    } catch { /* use the generic Google response below */ }

    if (response.status === 404 || (response.status === 403 && ['forbidden', 'calendarNotFound', 'notFound'].includes(reason))) {
      throw new CalendarAccessLost()
    }
    if (response.status === 408) {
      if (attempt < 2) {
        await sleep(attempt === 0 ? 300 : 900)
        continue
      }
      throw new SyncFailure('network_error')
    }
    if (response.status === 429 || ['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'dailyLimitExceeded'].includes(reason)) {
      if (attempt < 2) {
        await sleep(retryAfterMilliseconds(response.headers.get('retry-after')) ?? (attempt === 0 ? 300 : 900))
        continue
      }
      throw new SyncFailure('rate_limited')
    }
    if (response.status >= 500 && attempt < 2) {
      await sleep(attempt === 0 ? 300 : 900)
      continue
    }
    throw new SyncFailure('google_error')
  }
  throw new SyncFailure('network_error')
}

async function processClaim(client: SupabaseClient, ownerUserId: string, leaseId: string, claim: SyncClaim): Promise<void> {
  try {
    const token = await googleCalendarAccessToken(client, ownerUserId, claim.connectionId)
    let page: GoogleEventPage
    try {
      page = await requestGooglePage(token.value, claim)
    } catch (error) {
      if (error instanceof HttpError && error.code === 'reconnect_required') {
        await markGoogleCalendarReconnectRequired(client, ownerUserId, claim.connectionId, token.connectedAt)
        return
      }
      throw error
    }

    const events: NormalizedGoogleEvent[] = []
    const removedIds = new Set<string>()
    for (const item of page.items ?? []) {
      if (!item || typeof item !== 'object') throw new SyncFailure('invalid_response')
      if (item.status === 'cancelled') {
        if (typeof item.id !== 'string' || !item.id.trim()) throw new SyncFailure('invalid_response')
        removedIds.add(item.id.trim())
        continue
      }
      const normalized = normalizeGoogleEvent(item, claim)
      if (normalized) events.push(normalized)
      else if (typeof item.id === 'string' && item.id.trim()) removedIds.add(item.id.trim())
    }

    await rpc(client, 'google_calendar_sync_commit_page', {
      p_owner_user_id: ownerUserId,
      p_calendar_row_id: claim.calendarRowId,
      p_run_id: claim.runId,
      p_lease_id: leaseId,
      p_generation: claim.generation,
      p_events: events,
      p_removed_event_ids: [...removedIds],
      p_next_page_token: page.nextPageToken ?? null,
      p_next_sync_token: page.nextSyncToken ?? null,
    })
  } catch (error) {
    if (error instanceof SyncTokenExpired) {
      await rpc<boolean>(client, 'google_calendar_sync_reset_to_rebuild', {
        p_owner_user_id: ownerUserId,
        p_calendar_row_id: claim.calendarRowId,
        p_run_id: claim.runId,
        p_lease_id: leaseId,
        p_generation: claim.generation,
      })
      return
    }
    if (error instanceof CalendarAccessLost) {
      await rpc<boolean>(client, 'google_calendar_sync_mark_lost', {
        p_owner_user_id: ownerUserId,
        p_calendar_row_id: claim.calendarRowId,
        p_run_id: claim.runId,
        p_lease_id: leaseId,
        p_generation: claim.generation,
      })
      return
    }

    const code: SyncErrorCode = error instanceof SyncFailure
      ? error.code
      : error instanceof HttpError && error.code === 'reconnect_required'
        ? 'reconnect_required'
        : error instanceof HttpError && error.code === 'google_refresh_failed'
          ? 'network_error'
        : 'sync_error'
    await rpc<boolean>(client, 'google_calendar_sync_fail', {
      p_owner_user_id: ownerUserId,
      p_calendar_row_id: claim.calendarRowId,
      p_run_id: claim.runId,
      p_lease_id: leaseId,
      p_generation: claim.generation,
      p_error_code: code,
    })
  }
}

export async function beginGoogleCalendarSync(client: SupabaseClient, ownerUserId: string): Promise<void> {
  await rpc<number>(client, 'google_calendar_sync_begin_selected', { p_owner_user_id: ownerUserId })
}

export async function processNextGoogleCalendarSyncPage(client: SupabaseClient, ownerUserId: string): Promise<boolean> {
  const leaseId = crypto.randomUUID()
  const claim = await rpc<SyncClaim | null>(client, 'google_calendar_sync_claim_next', {
    p_owner_user_id: ownerUserId,
    p_lease_id: leaseId,
    p_lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
  })
  if (!claim) return false
  await processClaim(client, ownerUserId, leaseId, claim)
  return true
}
