import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '../auth/supabase'
import type { GoogleCalendarSettingsState, GoogleCalendarChoiceDraft } from './types'

function requireClient(): SupabaseClient {
  if (!supabase) throw new Error('Supabase is not configured. Check the Family Hub environment settings.')
  return supabase
}

async function invoke<T>(body: Record<string, unknown>, functionName = 'google-calendar-management'): Promise<T> {
  const { data, error } = await requireClient().functions.invoke(functionName, { body })
  if (error) {
    const response = 'context' in error ? error.context : undefined
    if (response instanceof Response) {
      try {
        const payload = await response.clone().json() as { error?: { message?: string } }
        if (payload.error?.message) throw new Error(payload.error.message)
      } catch (parseError) {
        if (parseError instanceof Error && parseError.name !== 'SyntaxError') throw parseError
      }
    }
    throw new Error(error.message || 'Nie udało się połączyć z Google Calendar.')
  }
  return data as T
}

export function createGoogleCalendarApi() {
  return {
    status(): Promise<GoogleCalendarSettingsState> {
      return invoke({ action: 'status' })
    },

    connect(): Promise<{ consentUrl: string }> {
      return invoke({ action: 'connect' })
    },

    refreshCalendars(): Promise<GoogleCalendarSettingsState & { calendarCount: number }> {
      return invoke({ action: 'refresh-calendars' })
    },

    saveCalendars(choices: Array<{ calendarId: string } & GoogleCalendarChoiceDraft>): Promise<GoogleCalendarSettingsState> {
      return invoke({ action: 'save-calendars', choices })
    },

    startSync(): Promise<GoogleCalendarSettingsState> {
      return invoke({ action: 'start' }, 'google-calendar-sync')
    },

    continueSync(): Promise<GoogleCalendarSettingsState> {
      return invoke({ action: 'continue' }, 'google-calendar-sync')
    },
  }
}
