import type { EventSchedule } from '../calendar/types'

export type GoogleCalendarSharingMode = 'private' | 'household'

export interface GoogleCalendarConnection {
  id: string
  status: 'pending' | 'connected' | 'reconnect_required' | 'disabled'
  connectedAt: string | null
  grantedScopes: string[]
}

export interface GoogleCalendarChoice {
  calendarId: string
  name: string | null
  timeZone: string | null
  selected: boolean
  sharingMode: GoogleCalendarSharingMode
  accessStatus: 'available' | 'lost'
  syncStatus: 'idle' | 'running' | 'failed'
  syncRunKind: 'initial' | 'incremental' | 'rebuild' | null
  syncStartedAt: string | null
  syncLeaseExpiresAt: string | null
  lastSuccessfulSyncAt: string | null
  syncErrorCode: string | null
  syncErrorAt: string | null
}

export interface GoogleCalendarSettingsState {
  connection: GoogleCalendarConnection | null
  calendars: GoogleCalendarChoice[]
}

export type ImportedGoogleCalendarEvent = {
  id: string
  title: string
  description: string | null
  location: string | null
  htmlLink: string | null
  googleUpdatedAt: string | null
  importedAt: string
} & EventSchedule

export interface GoogleCalendarChoiceDraft {
  selected: boolean
  sharingMode: GoogleCalendarSharingMode
}
