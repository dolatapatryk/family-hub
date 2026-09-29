export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

const allowedOrigins = () => new Set(
  (Deno.env.get('GOOGLE_CALENDAR_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean),
)

export function corsHeaders(request: Request): Record<string, string> | null {
  const origin = request.headers.get('origin')
  if (!origin) return { vary: 'Origin' }
  if (!allowedOrigins().has(origin)) return null
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'authorization, apikey, x-client-info, content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-max-age': '600',
    'vary': 'Origin',
  }
}

export function jsonResponse(
  request: Request,
  body: unknown,
  status = 200,
  headers: HeadersInit = {},
): Response {
  const cors = corsHeaders(request) ?? { vary: 'Origin' }
  const responseHeaders = new Headers(cors)
  responseHeaders.set('content-type', 'application/json; charset=utf-8')
  new Headers(headers).forEach((value, key) => responseHeaders.set(key, value))
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  })
}

export function handleOptions(request: Request): Response {
  const headers = corsHeaders(request)
  if (!headers) return new Response(null, { status: 403 })
  return new Response(null, { status: 204, headers })
}

export function errorResponse(request: Request, error: unknown): Response {
  if (error instanceof HttpError) {
    return jsonResponse(request, { error: { code: error.code, message: error.message } }, error.status)
  }
  return jsonResponse(request, {
    error: { code: 'google_calendar_error', message: 'Nie udało się wykonać tej operacji Google Calendar.' },
  }, 500)
}

export function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new HttpError(503, 'integration_not_configured', 'Integracja Google Calendar nie jest jeszcze skonfigurowana.')
  return value
}

export function utf8Hex(bytes: Uint8Array): string {
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
}

export function hexBytes(value: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/i.test(value)) throw new Error('Invalid encoded bytes')
  return Uint8Array.from(value.match(/.{2}/g)!, part => Number.parseInt(part, 16))
}

export function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const value of bytes) binary += String.fromCharCode(value)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '')
}
