import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import { HttpError } from './http.ts'
import { googleCalendarAccessToken, markGoogleCalendarReconnectRequired } from './google-api.ts'
import { normalizeGoogleEventItems, SyncFailure } from './google-events.ts'
import type { GoogleEventPage, SyncErrorCode, SyncRunKind } from './google-events.ts'
import { GoogleCalendarAccessLost, GoogleSyncTokenExpired, requestGoogleEventPage } from './google-requests.ts'
import { rpc } from './supabase.ts'

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

async function processClaim(client: SupabaseClient, ownerUserId: string, leaseId: string, claim: SyncClaim): Promise<void> {
  try {
    const token = await googleCalendarAccessToken(client, ownerUserId, claim.connectionId)
    let page: GoogleEventPage
    try {
      page = await requestGoogleEventPage(token.value, claim)
    } catch (error) {
      if (error instanceof SyncFailure && error.code === 'reconnect_required') {
        await markGoogleCalendarReconnectRequired(client, ownerUserId, claim.connectionId, token.connectedAt)
        return
      }
      throw error
    }

    const { events, removedEventIds } = normalizeGoogleEventItems(page.items ?? [], claim)

    await rpc(client, 'google_calendar_sync_commit_page', {
      p_owner_user_id: ownerUserId,
      p_calendar_row_id: claim.calendarRowId,
      p_run_id: claim.runId,
      p_lease_id: leaseId,
      p_generation: claim.generation,
      p_events: events,
      p_removed_event_ids: removedEventIds,
      p_next_page_token: page.nextPageToken ?? null,
      p_next_sync_token: page.nextSyncToken ?? null,
    })
  } catch (error) {
    if (error instanceof GoogleSyncTokenExpired) {
      await rpc<boolean>(client, 'google_calendar_sync_reset_to_rebuild', {
        p_owner_user_id: ownerUserId,
        p_calendar_row_id: claim.calendarRowId,
        p_run_id: claim.runId,
        p_lease_id: leaseId,
        p_generation: claim.generation,
      })
      return
    }
    if (error instanceof GoogleCalendarAccessLost) {
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
