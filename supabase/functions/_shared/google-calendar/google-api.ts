import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import { HttpError, requiredEnv } from './http.ts'
import { decryptRefreshToken } from './token-crypto.ts'
import { rpc } from './supabase.ts'

interface ConnectionCredential {
  id: string
  status: string
  connectedAt: string | null
  encryptedRefreshTokenHex: string | null
  tokenKeyVersion: string | null
  grantedScopes: string[]
}

interface GoogleCalendarListItem {
  id?: string
  summary?: string
  timeZone?: string
  deleted?: boolean
}

interface GoogleCalendarListResponse {
  items?: GoogleCalendarListItem[]
  nextPageToken?: string
}

function randomUuid(): string {
  return crypto.randomUUID()
}

async function getCredential(client: SupabaseClient, ownerUserId: string, connectionId: string) {
  const credential = await rpc<ConnectionCredential | null>(client, 'google_calendar_connection_credentials', {
    p_owner_user_id: ownerUserId,
    p_connection_id: connectionId,
  })
  if (!credential?.encryptedRefreshTokenHex || !credential.tokenKeyVersion) {
    throw new HttpError(409, 'reconnect_required', 'Połącz ponownie konto Google, aby pobrać kalendarze.')
  }
  return credential
}

async function markReconnectRequired(client: SupabaseClient, ownerUserId: string, connectionId: string, connectedAt: string | null) {
  await rpc<void>(client, 'google_calendar_mark_reconnect_required', {
    p_owner_user_id: ownerUserId,
    p_connection_id: connectionId,
    p_connection_connected_at: connectedAt,
  })
}

async function acquireRefreshLease(client: SupabaseClient, ownerUserId: string, connectionId: string, leaseId: string) {
  const expiresAt = new Date(Date.now() + 30_000).toISOString()
  return rpc<boolean>(client, 'google_calendar_acquire_refresh_lease', {
    p_owner_user_id: ownerUserId,
    p_connection_id: connectionId,
    p_lease_id: leaseId,
    p_lease_expires_at: expiresAt,
  })
}

async function accessToken(client: SupabaseClient, ownerUserId: string, connectionId: string): Promise<{ value: string; connectedAt: string | null }> {
  const leaseId = randomUuid()
  let acquired = false
  const acquireDeadline = Date.now() + 8_000
  while (!acquired && Date.now() < acquireDeadline) {
    acquired = await acquireRefreshLease(client, ownerUserId, connectionId, leaseId)
    if (!acquired) await new Promise(resolve => setTimeout(resolve, 200))
  }
  if (!acquired) {
    await getCredential(client, ownerUserId, connectionId)
    throw new HttpError(409, 'refresh_in_progress', 'Konto Google jest właśnie odnawiane. Spróbuj ponownie za chwilę.')
  }

  try {
    const credential = await getCredential(client, ownerUserId, connectionId)
    const refreshToken = await decryptRefreshToken(
      credential.encryptedRefreshTokenHex,
      credential.tokenKeyVersion!,
      connectionId,
    )
    const body = new URLSearchParams({
      client_id: requiredEnv('GOOGLE_CALENDAR_CLIENT_ID'),
      client_secret: requiredEnv('GOOGLE_CALENDAR_CLIENT_SECRET'),
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    })
    let response: Response
    try {
      response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(15_000),
      })
    } catch {
      throw new HttpError(502, 'google_refresh_failed', 'Google nie odpowiedział. Spróbuj ponownie.')
    }

    let payload: Record<string, unknown> = {}
    try {
      const parsed: unknown = await response.json()
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>
    } catch { /* handled as a generic token refresh failure */ }

    if (!response.ok) {
      if (payload.error === 'invalid_grant') {
        await markReconnectRequired(client, ownerUserId, connectionId, credential.connectedAt)
        throw new HttpError(409, 'reconnect_required', 'Google wymaga ponownego połączenia konta.')
      }
      throw new HttpError(502, 'google_refresh_failed', 'Google nie odnowił połączenia. Spróbuj ponownie.')
    }
    if (typeof payload.access_token !== 'string') {
      throw new HttpError(502, 'google_refresh_failed', 'Google nie odnowił połączenia. Spróbuj ponownie.')
    }
    return { value: payload.access_token, connectedAt: credential.connectedAt }
  } finally {
    try {
      await rpc<void>(client, 'google_calendar_release_refresh_lease', {
        p_connection_id: connectionId,
        p_lease_id: leaseId,
      })
    } catch { /* the lease expires automatically if release fails */ }
  }
}

export async function googleCalendarAccessToken(
  client: SupabaseClient,
  ownerUserId: string,
  connectionId: string,
): Promise<{ value: string; connectedAt: string | null }> {
  return accessToken(client, ownerUserId, connectionId)
}

export async function markGoogleCalendarReconnectRequired(
  client: SupabaseClient,
  ownerUserId: string,
  connectionId: string,
  connectedAt: string | null,
): Promise<void> {
  await markReconnectRequired(client, ownerUserId, connectionId, connectedAt)
}

async function fetchCalendarList(accessTokenValue: string): Promise<Array<{ google_calendar_id: string; display_name: string | null; time_zone: string | null }>> {
  const calendars: Array<{ google_calendar_id: string; display_name: string | null; time_zone: string | null }> = []
  let pageToken: string | undefined
  do {
    const url = new URL('https://www.googleapis.com/calendar/v3/users/me/calendarList')
    url.searchParams.set('maxResults', '250')
    url.searchParams.set('showDeleted', 'false')
    url.searchParams.set('showHidden', 'true')
    url.searchParams.set('fields', 'nextPageToken,items(id,summary,timeZone,deleted)')
    if (pageToken) url.searchParams.set('pageToken', pageToken)

    let response: Response
    try {
      response = await fetch(url, {
        headers: { authorization: `Bearer ${accessTokenValue}` },
        signal: AbortSignal.timeout(15_000),
      })
    } catch {
      throw new HttpError(502, 'google_calendar_list_failed', 'Nie udało się pobrać listy kalendarzy z Google. Spróbuj ponownie.')
    }
    if (response.status === 401) {
      throw new HttpError(409, 'reconnect_required', 'Google wymaga ponownego połączenia konta.')
    }
    if (!response.ok) {
      throw new HttpError(502, 'google_calendar_list_failed', 'Nie udało się pobrać listy kalendarzy z Google. Spróbuj ponownie.')
    }
    let payload: GoogleCalendarListResponse
    try {
      payload = await response.json() as GoogleCalendarListResponse
    } catch {
      throw new HttpError(502, 'google_calendar_list_failed', 'Google zwrócił nieprawidłową listę kalendarzy.')
    }
    for (const calendar of payload.items ?? []) {
      if (!calendar.id || calendar.deleted) continue
      calendars.push({
        google_calendar_id: calendar.id,
        display_name: typeof calendar.summary === 'string' && calendar.summary.trim() ? calendar.summary.trim() : null,
        time_zone: typeof calendar.timeZone === 'string' && calendar.timeZone.trim() ? calendar.timeZone.trim() : null,
      })
    }
    pageToken = payload.nextPageToken || undefined
  } while (pageToken)
  return calendars
}

export async function refreshGoogleCalendarList(
  client: SupabaseClient,
  ownerUserId: string,
  connectionId: string,
): Promise<number> {
  const token = await accessToken(client, ownerUserId, connectionId)
  let calendars: Awaited<ReturnType<typeof fetchCalendarList>>
  try {
    calendars = await fetchCalendarList(token.value)
  } catch (error) {
    if (error instanceof HttpError && error.code === 'reconnect_required') {
      await markReconnectRequired(client, ownerUserId, connectionId, token.connectedAt)
    }
    throw error
  }
  await rpc<void>(client, 'google_calendar_refresh_list', {
    p_owner_user_id: ownerUserId,
    p_connection_id: connectionId,
    p_calendar_list: calendars,
  })
  return calendars.length
}
