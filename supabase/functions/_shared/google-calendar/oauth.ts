import { HttpError, requiredEnv } from './http.ts'

export const requiredScopes = [
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
] as const

export interface GoogleTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope?: string
  token_type: string
}

function safeFrontendBase(): URL {
  const raw = requiredEnv('GOOGLE_CALENDAR_FRONTEND_URL')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new HttpError(503, 'integration_not_configured', 'Google Calendar nie ma poprawnego adresu strony powrotu.')
  }
  const allowed = new Set((Deno.env.get('GOOGLE_CALENDAR_ALLOWED_ORIGINS') ?? '')
    .split(',').map(origin => origin.trim()).filter(Boolean))
  if (!allowed.has(url.origin) || !['https:', 'http:'].includes(url.protocol)
      || (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new HttpError(503, 'integration_not_configured', 'Adres strony powrotu Google Calendar nie znajduje się na liście dozwolonych stron.')
  }
  return url
}

function callbackUri(): URL {
  let url: URL
  try {
    url = new URL(requiredEnv('GOOGLE_CALENDAR_CALLBACK_URL'))
  } catch {
    throw new HttpError(503, 'integration_not_configured', 'Google Calendar nie ma poprawnego adresu callback.')
  }
  if (!['https:', 'http:'].includes(url.protocol)
      || (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new HttpError(503, 'integration_not_configured', 'Adres callback Google Calendar musi używać HTTPS poza lokalnym środowiskiem.')
  }
  return url
}

export function validateOAuthRedirectConfiguration(): void {
  safeFrontendBase()
  callbackUri()
}

export function frontendResultRedirect(result: string): Response {
  const target = safeFrontendBase()
  target.searchParams.set('googleCalendar', result)
  return new Response(null, {
    status: 303,
    headers: {
      location: target.toString(),
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    },
  })
}

export function authorizationUrl(state: string): string {
  validateOAuthRedirectConfiguration()
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', requiredEnv('GOOGLE_CALENDAR_CLIENT_ID'))
  url.searchParams.set('redirect_uri', callbackUri().toString())
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', requiredScopes.join(' '))
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('include_granted_scopes', 'true')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('state', state)
  return url.toString()
}

async function parseTokenResponse(response: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await response.json()
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

export async function exchangeAuthorizationCode(code: string): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    code,
    client_id: requiredEnv('GOOGLE_CALENDAR_CLIENT_ID'),
    client_secret: requiredEnv('GOOGLE_CALENDAR_CLIENT_SECRET'),
    redirect_uri: callbackUri().toString(),
    grant_type: 'authorization_code',
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
    throw new HttpError(502, 'google_token_exchange_failed', 'Google nie odpowiedział. Spróbuj ponownie.')
  }
  const payload = await parseTokenResponse(response)
  if (!response.ok || typeof payload.access_token !== 'string'
      || typeof payload.token_type !== 'string' || typeof payload.expires_in !== 'number') {
    throw new HttpError(502, 'google_token_exchange_failed', 'Google nie ukończył połączenia. Spróbuj ponownie.')
  }
  return payload as unknown as GoogleTokenResponse
}

export function grantedScopes(token: GoogleTokenResponse): string[] {
  return (token.scope ?? requiredScopes.join(' ')).split(/\s+/).filter(Boolean)
}

export function hasRequiredScopes(scopes: string[]): boolean {
  return requiredScopes.every(scope => scopes.includes(scope))
}
