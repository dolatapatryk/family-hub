import { authorizationUrl, validateOAuthRedirectConfiguration } from '../_shared/google-calendar/oauth.ts'
import { base64Url, corsHeaders, errorResponse, handleOptions, HttpError, jsonResponse, requiredEnv, utf8Hex } from '../_shared/google-calendar/http.ts'
import { refreshGoogleCalendarList } from '../_shared/google-calendar/google-api.ts'
import { authenticatedUser, rpc, serviceClient } from '../_shared/google-calendar/supabase.ts'
import { assertTokenEncryptionConfigured, decryptRefreshToken } from '../_shared/google-calendar/token-crypto.ts'

interface ConnectionStatus {
  connection: null | { id: string; status: string; connectedAt: string | null; grantedScopes: string[] }
  calendars: unknown[]
}

interface DisconnectedCredential {
  disconnected: boolean
  connectionId?: string
  encryptedRefreshTokenHex?: string | null
  tokenKeyVersion?: string | null
}

async function connectionStatus(ownerUserId: string): Promise<ConnectionStatus> {
  return rpc<ConnectionStatus>(serviceClient(), 'google_calendar_connection_status', {
    p_owner_user_id: ownerUserId,
  })
}

async function beginAuthorization(ownerUserId: string): Promise<string> {
  const stateBytes = crypto.getRandomValues(new Uint8Array(32))
  const state = base64Url(stateBytes)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', stateBytes))
  await rpc(serviceClient(), 'google_calendar_oauth_begin', {
    p_owner_user_id: ownerUserId,
    p_state_hash: `\\x${utf8Hex(digest)}`,
    p_state_expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  })
  return authorizationUrl(state)
}

async function revokeGoogleRefreshToken(refreshToken: string): Promise<boolean> {
  try {
    const response = await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshToken }),
      signal: AbortSignal.timeout(8_000),
    })
    return response.ok
  } catch {
    return false
  }
}

async function handleManagement(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return handleOptions(request)
  if (request.method !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Użyj żądania POST.')

  const user = await authenticatedUser(request)
  let body: Record<string, unknown>
  try {
    const value: unknown = await request.json()
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid body')
    body = value as Record<string, unknown>
  } catch {
    throw new HttpError(400, 'invalid_request', 'Żądanie Google Calendar jest nieprawidłowe.')
  }

  const client = serviceClient()
  switch (body.action) {
    case 'status':
      return jsonResponse(request, await connectionStatus(user.id))
    case 'connect': {
      requiredEnv('GOOGLE_CALENDAR_CLIENT_ID')
      requiredEnv('GOOGLE_CALENDAR_CLIENT_SECRET')
      requiredEnv('GOOGLE_CALENDAR_CALLBACK_URL')
      requiredEnv('GOOGLE_CALENDAR_FRONTEND_URL')
      validateOAuthRedirectConfiguration()
      await assertTokenEncryptionConfigured()
      const consentUrl = await beginAuthorization(user.id)
      return jsonResponse(request, { consentUrl })
    }
    case 'disconnect': {
      const credential = await rpc<DisconnectedCredential>(client, 'google_calendar_disconnect', {
        p_owner_user_id: user.id,
      })
      let revocation: 'revoked' | 'failed' | 'not_available' = 'not_available'
      if (credential.disconnected && credential.connectionId
          && credential.encryptedRefreshTokenHex && credential.tokenKeyVersion) {
        try {
          const refreshToken = await decryptRefreshToken(
            credential.encryptedRefreshTokenHex,
            credential.tokenKeyVersion,
            credential.connectionId,
          )
          revocation = await revokeGoogleRefreshToken(refreshToken) ? 'revoked' : 'failed'
        } catch {
          // Local cleanup has completed; a missing historical encryption key must
          // not leave the Google connection or its imported events in Family Hub.
          revocation = 'failed'
        }
      }
      const state: ConnectionStatus = { connection: null, calendars: [] }
      return jsonResponse(request, { ...state, disconnected: credential.disconnected, revocation })
    }
    case 'refresh-calendars': {
      const status = await connectionStatus(user.id)
      if (!status.connection) throw new HttpError(409, 'not_connected', 'Najpierw połącz konto Google.')
      if (status.connection.status !== 'connected') {
        throw new HttpError(409, 'reconnect_required', 'Połącz ponownie konto Google, aby pobrać kalendarze.')
      }
      const count = await refreshGoogleCalendarList(client, user.id, status.connection.id)
      return jsonResponse(request, { calendarCount: count, ...(await connectionStatus(user.id)) })
    }
    case 'save-calendars': {
      const status = await connectionStatus(user.id)
      if (!status.connection || status.connection.status !== 'connected') {
        throw new HttpError(409, 'not_connected', 'Połącz konto Google przed wyborem kalendarzy.')
      }
      if (!Array.isArray(body.choices) || body.choices.length > 5000) {
        throw new HttpError(400, 'invalid_request', 'Wybór kalendarzy jest nieprawidłowy.')
      }
      const choices = body.choices.map(choice => {
        if (!choice || typeof choice !== 'object' || Array.isArray(choice)) {
          throw new HttpError(400, 'invalid_request', 'Wybór kalendarzy jest nieprawidłowy.')
        }
        const value = choice as Record<string, unknown>
        if (typeof value.calendarId !== 'string' || typeof value.selected !== 'boolean'
            || (value.sharingMode !== 'private' && value.sharingMode !== 'household')) {
          throw new HttpError(400, 'invalid_request', 'Wybór kalendarzy jest nieprawidłowy.')
        }
        return {
          calendar_id: value.calendarId,
          selected: value.selected,
          sharing_mode: value.sharingMode,
        }
      })
      await rpc<void>(client, 'google_calendar_save_choices', {
        p_owner_user_id: user.id,
        p_connection_id: status.connection.id,
        p_choices: choices,
      })
      return jsonResponse(request, await connectionStatus(user.id))
    }
    default:
      throw new HttpError(400, 'invalid_action', 'Nieznana operacja Google Calendar.')
  }
}

Deno.serve(async request => {
  const cors = corsHeaders(request)
  if (!cors) return new Response(null, { status: 403 })
  try {
    return await handleManagement(request)
  } catch (error) {
    return errorResponse(request, error)
  }
})
