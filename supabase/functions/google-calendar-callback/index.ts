import { frontendResultRedirect, exchangeAuthorizationCode, grantedScopes, hasRequiredScopes, requiredScopes } from '../_shared/google-calendar/oauth.ts'
import { requiredEnv, utf8Hex } from '../_shared/google-calendar/http.ts'
import { encryptRefreshToken } from '../_shared/google-calendar/token-crypto.ts'
import { rpc, serviceClient } from '../_shared/google-calendar/supabase.ts'

interface ConsumedState {
  connectionId: string
  ownerUserId: string
  status: string
  hasRefreshToken: boolean
}

function decodeState(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return null
  try {
    const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
    const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
    return bytes.length === 32 ? bytes : null
  } catch {
    return null
  }
}

function resultRedirect(result: string): Response {
  try {
    requiredEnv('GOOGLE_CALENDAR_FRONTEND_URL')
    return frontendResultRedirect(result)
  } catch {
    return new Response('Google Calendar is not configured.', { status: 503 })
  }
}

async function handleCallback(request: Request): Promise<Response> {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 })
  const params = new URL(request.url).searchParams
  const stateValue = params.get('state') ?? ''
  const stateBytes = decodeState(stateValue)
  if (!stateBytes) return resultRedirect('expired')

  const stateHash = new Uint8Array(await crypto.subtle.digest('SHA-256', stateBytes))
  const client = serviceClient()
  const consumed = await rpc<ConsumedState | null>(client, 'google_calendar_oauth_consume_state', {
    p_state_hash: `\\x${utf8Hex(stateHash)}`,
  })
  if (!consumed) return resultRedirect('expired')

  const googleError = params.get('error')
  if (googleError === 'access_denied') return resultRedirect('denied')
  if (googleError || !params.get('code')) return resultRedirect('error')

  try {
    const token = await exchangeAuthorizationCode(params.get('code')!)
    const granted = grantedScopes(token)
    if (!hasRequiredScopes(granted)) return resultRedirect('missing-scopes')
    const scopes = requiredScopes.filter(scope => granted.includes(scope))

    let encryptedToken: string | null = null
    let keyVersion: string | null = null
    if (token.refresh_token) {
      const encrypted = await encryptRefreshToken(token.refresh_token, consumed.connectionId)
      encryptedToken = `\\x${encrypted.ciphertextHex}`
      keyVersion = encrypted.keyVersion
    } else if (!consumed.hasRefreshToken) {
      return resultRedirect('missing-refresh-token')
    }

    await rpc<void>(client, 'google_calendar_oauth_complete', {
      p_owner_user_id: consumed.ownerUserId,
      p_connection_id: consumed.connectionId,
      p_encrypted_refresh_token: encryptedToken,
      p_token_key_version: keyVersion,
      p_granted_scopes: scopes,
    })
    return resultRedirect('connected')
  } catch {
    return resultRedirect('error')
  }
}

Deno.serve(request => handleCallback(request).catch(() => resultRedirect('error')))
