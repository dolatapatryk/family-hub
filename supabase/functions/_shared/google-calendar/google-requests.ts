import {
  buildGoogleEventsListUrl,
  parseGoogleEventPage,
  SyncFailure,
} from './google-events.ts'
import type { GoogleEventPage, GoogleEventsRequest } from './google-events.ts'

export class GoogleSyncTokenExpired extends Error {}
export class GoogleCalendarAccessLost extends Error {}

export interface GoogleRequestDependencies {
  fetch: typeof fetch
  wait: (milliseconds: number) => Promise<void>
  now: () => number
}

const defaultDependencies: GoogleRequestDependencies = {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
  wait: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  now: () => Date.now(),
}

function retryAfterMilliseconds(value: string | null, now: number): number | null {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, Math.min(2_500, seconds * 1000))
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, Math.min(2_500, date - now)) : null
}

async function googleErrorReason(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json()
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return ''
    const error = (payload as Record<string, unknown>).error
    if (!error || typeof error !== 'object' || Array.isArray(error)) return ''
    const errors = (error as Record<string, unknown>).errors
    if (!Array.isArray(errors) || !errors[0] || typeof errors[0] !== 'object') return ''
    return String((errors[0] as Record<string, unknown>).reason ?? '')
  } catch {
    return ''
  }
}

export async function requestGoogleEventPage(
  accessToken: string,
  request: GoogleEventsRequest,
  dependencies: GoogleRequestDependencies = defaultDependencies,
): Promise<GoogleEventPage> {
  const url = buildGoogleEventsListUrl(request)

  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response
    try {
      response = await dependencies.fetch(url, {
        headers: { authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(8_000),
      })
    } catch {
      if (attempt < 2) {
        await dependencies.wait(attempt === 0 ? 300 : 900)
        continue
      }
      throw new SyncFailure('network_error')
    }

    if (response.status === 410) throw new GoogleSyncTokenExpired()
    if (response.status === 401) throw new SyncFailure('reconnect_required')

    if (response.ok) {
      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        throw new SyncFailure('invalid_response')
      }
      return parseGoogleEventPage(payload)
    }

    const reason = await googleErrorReason(response)
    if (response.status === 404 || (response.status === 403 && ['forbidden', 'calendarNotFound', 'notFound'].includes(reason))) {
      throw new GoogleCalendarAccessLost()
    }
    if (response.status === 408) {
      if (attempt < 2) {
        await dependencies.wait(attempt === 0 ? 300 : 900)
        continue
      }
      throw new SyncFailure('network_error')
    }
    if (response.status === 429 || ['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'dailyLimitExceeded'].includes(reason)) {
      if (attempt < 2) {
        await dependencies.wait(retryAfterMilliseconds(response.headers.get('retry-after'), dependencies.now()) ?? (attempt === 0 ? 300 : 900))
        continue
      }
      throw new SyncFailure('rate_limited')
    }
    if (response.status >= 500 && attempt < 2) {
      await dependencies.wait(attempt === 0 ? 300 : 900)
      continue
    }
    throw new SyncFailure('google_error')
  }
  throw new SyncFailure('network_error')
}
