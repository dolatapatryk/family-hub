import { beginGoogleCalendarSync, processNextGoogleCalendarSyncPage } from '../_shared/google-calendar/sync.ts'
import { corsHeaders, errorResponse, handleOptions, HttpError, jsonResponse } from '../_shared/google-calendar/http.ts'
import { authenticatedUser, rpc, serviceClient } from '../_shared/google-calendar/supabase.ts'

async function handleSync(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return handleOptions(request)
  if (request.method !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Użyj żądania POST.')

  const user = await authenticatedUser(request)
  let action: unknown
  try {
    const body: unknown = await request.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid body')
    action = (body as Record<string, unknown>).action
  } catch {
    throw new HttpError(400, 'invalid_request', 'Żądanie synchronizacji Google Calendar jest nieprawidłowe.')
  }

  const client = serviceClient()
  if (action === 'start') {
    await beginGoogleCalendarSync(client, user.id)
    await processNextGoogleCalendarSyncPage(client, user.id)
  } else if (action === 'continue') {
    await processNextGoogleCalendarSyncPage(client, user.id)
  } else {
    throw new HttpError(400, 'invalid_action', 'Nieznana operacja synchronizacji Google Calendar.')
  }

  const status = await rpc(client, 'google_calendar_connection_status', { p_owner_user_id: user.id })
  return jsonResponse(request, status)
}

Deno.serve(async request => {
  const cors = corsHeaders(request)
  if (!cors) return new Response(null, { status: 403 })
  try {
    return await handleSync(request)
  } catch (error) {
    return errorResponse(request, error)
  }
})
