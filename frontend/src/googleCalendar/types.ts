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
  lastSuccessfulSyncAt: string | null
}

export interface GoogleCalendarSettingsState {
  connection: GoogleCalendarConnection | null
  calendars: GoogleCalendarChoice[]
}

export interface GoogleCalendarChoiceDraft {
  selected: boolean
  sharingMode: GoogleCalendarSharingMode
}
