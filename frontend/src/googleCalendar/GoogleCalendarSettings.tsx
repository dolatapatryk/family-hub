import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthGate'
import { createGoogleCalendarApi } from './api'
import type { GoogleCalendarChoice, GoogleCalendarChoiceDraft, GoogleCalendarSharingMode } from './types'

const resultMessages: Record<string, string> = {
  connected: 'Konto Google połączone. Wybierz teraz kalendarze dostępne w Family Hub.',
  denied: 'Autoryzacja została anulowana. Konto nie zostało połączone.',
  expired: 'Prośba o połączenie wygasła. Rozpocznij ją ponownie.',
  'missing-scopes': 'Google nie przyznał wymaganych uprawnień tylko do odczytu. Spróbuj ponownie i zaakceptuj oba uprawnienia.',
  'missing-refresh-token': 'Google nie zwrócił tokenu do odnowienia połączenia. Spróbuj połączyć konto ponownie.',
  error: 'Nie udało się połączyć konta Google. Spróbuj ponownie.',
}

function draftFor(calendar: GoogleCalendarChoice): GoogleCalendarChoiceDraft {
  return { selected: calendar.selected, sharingMode: calendar.sharingMode }
}

export function googleCalendarSettingsKey(householdId: string, userId: string) {
  return ['googleCalendarSettings', householdId, userId] as const
}

export function GoogleCalendarSettings() {
  const { profile } = useAuth()
  const client = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [notice, setNotice] = useState('')
  const [drafts, setDrafts] = useState<Record<string, GoogleCalendarChoiceDraft>>({})
  const api = useMemo(() => createGoogleCalendarApi(), [])
  const queryKey = useMemo(
    () => googleCalendarSettingsKey(profile.household_id, profile.id),
    [profile.household_id, profile.id],
  )
  const settings = useQuery({
    queryKey,
    queryFn: () => api.status(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })

  useEffect(() => {
    const result = searchParams.get('googleCalendar')
    if (!result) return
    setNotice(resultMessages[result] ?? resultMessages.error)
    const next = new URLSearchParams(searchParams)
    next.delete('googleCalendar')
    setSearchParams(next, { replace: true })
    void client.invalidateQueries({ queryKey })
  }, [client, queryKey, searchParams, setSearchParams])

  useEffect(() => {
    if (!settings.data) return
    setDrafts(Object.fromEntries(settings.data.calendars.map(calendar => [calendar.calendarId, draftFor(calendar)])))
  }, [settings.data])

  const connect = useMutation({
    mutationFn: () => api.connect(),
    onSuccess: result => window.location.assign(result.consentUrl),
  })
  const refresh = useMutation({
    mutationFn: () => api.refreshCalendars(),
    onSuccess: async () => {
      setNotice('Lista kalendarzy Google została odświeżona. Nie zaimportowano wydarzeń.')
      await client.invalidateQueries({ queryKey })
    },
    onError: () => client.invalidateQueries({ queryKey }),
  })
  const save = useMutation({
    mutationFn: () => api.saveCalendars(availableCalendars.map(calendar => ({
      calendarId: calendar.calendarId,
      ...(drafts[calendar.calendarId] ?? draftFor(calendar)),
    }))),
    onSuccess: async () => {
      setNotice('Zapisano wybór i ustawienia prywatności kalendarzy.')
      await client.invalidateQueries({ queryKey })
    },
  })

  const calendars = settings.data?.calendars ?? []
  const availableCalendars = calendars.filter(calendar => calendar.accessStatus === 'available')
  const hasChanges = availableCalendars.some(calendar => {
    const draft = drafts[calendar.calendarId] ?? draftFor(calendar)
    return draft.selected !== calendar.selected || draft.sharingMode !== calendar.sharingMode
  })
  const busy = connect.isPending || refresh.isPending || save.isPending

  function updateChoice(calendar: GoogleCalendarChoice, update: Partial<GoogleCalendarChoiceDraft>) {
    const current = drafts[calendar.calendarId] ?? draftFor(calendar)
    const next = { ...current, ...update }
    if (!next.selected) next.sharingMode = 'private'
    setDrafts(previous => ({ ...previous, [calendar.calendarId]: next }))
  }

  return (
    <section className="panel google-calendar-settings" aria-labelledby="google-calendar-heading">
      <div className="panel-head">
        <div>
          <h2 className="panel-title" id="google-calendar-heading">Google Calendar</h2>
          <p className="panel-kicker">Połącz konto i zdecyduj, które kalendarze będą dostępne w domu.</p>
        </div>
        {settings.data?.connection?.status === 'connected' && <span className="google-calendar-status">Połączono</span>}
      </div>

      <div className="google-calendar-content">
        {notice && <p className="task-notice" role="status">{notice}</p>}
        {settings.isPending && <p className="panel-message" role="status">Sprawdzam połączenie Google…</p>}
        {settings.isError && <div className="google-calendar-error"><p className="error-message" role="alert">{settings.error.message}</p><button className="button-quiet" type="button" disabled={settings.isFetching} onClick={() => void settings.refetch()}>{settings.isFetching ? 'Ładuję…' : 'Spróbuj ponownie'}</button></div>}

        {settings.data && !settings.data.connection && <div className="google-calendar-empty">
          <p>Połącz własne konto Google. Family Hub poprosi wyłącznie o odczyt wydarzeń i listy kalendarzy.</p>
          <button className="primary-button" type="button" disabled={busy} onClick={() => connect.mutate()}>{connect.isPending ? 'Przekierowuję do Google…' : 'Połącz konto Google'}</button>
        </div>}

        {settings.data?.connection && settings.data.connection.status !== 'connected' && <div className="google-calendar-empty">
          <p>{settings.data.connection.status === 'reconnect_required'
            ? 'Google wymaga ponownego połączenia konta, zanim będzie można zarządzać jego kalendarzami.'
            : 'Połączenie nie zostało ukończone. Możesz rozpocząć je ponownie.'}</p>
          <button className="primary-button" type="button" disabled={busy} onClick={() => connect.mutate()}>{connect.isPending ? 'Przekierowuję do Google…' : 'Połącz ponownie konto'}</button>
        </div>}

        {settings.data?.connection?.status === 'connected' && <>
          <div className="google-calendar-toolbar">
            <p className="small-muted">Lista zawiera kalendarze dostępne na połączonym koncie Google.</p>
            <button className="button-quiet" type="button" disabled={busy || hasChanges} onClick={() => refresh.mutate()}>{refresh.isPending ? 'Pobieram listę…' : calendars.length ? 'Odśwież listę kalendarzy' : 'Pobierz listę kalendarzy'}</button>
          </div>
          {refresh.isError && <p className="error-message" role="alert">{refresh.error.message}</p>}
          {save.isError && <p className="error-message" role="alert">{save.error.message}</p>}
          {calendars.length === 0
            ? <p className="panel-message">Pobierz listę, aby wybrać kalendarze.</p>
            : <ul className="google-calendar-list">
              {calendars.map(calendar => <GoogleCalendarRow
                key={calendar.calendarId}
                calendar={calendar}
                draft={drafts[calendar.calendarId] ?? draftFor(calendar)}
                disabled={busy || calendar.accessStatus !== 'available'}
                onChange={update => updateChoice(calendar, update)}
              />)}
            </ul>}
          {calendars.length > 0 && <p className="google-calendar-sharing-note">Kalendarze są prywatne domyślnie. Ustawienie „Dla domowników” pokaże wszystkim domownikom wszystkie importowane szczegóły z tego kalendarza, także zachowane wydarzenia historyczne i przyszłe aktualizacje.</p>}
          {hasChanges && <div className="google-calendar-save-row">
            <p className="small-muted">Kalendarze ustawione jako prywatne są widoczne tylko dla Ciebie.</p>
            <button className="primary-button" type="button" disabled={busy} onClick={() => save.mutate()}>{save.isPending ? 'Zapisuję…' : 'Zapisz wybór'}</button>
          </div>}
          <p className="google-calendar-sync-note">Połączenie, pobranie listy i wybór kalendarzy nie importują wydarzeń. Import będzie uruchamiany osobnym działaniem.</p>
        </>}
        {connect.isError && <p className="error-message" role="alert">{connect.error.message}</p>}
      </div>
    </section>
  )
}

function GoogleCalendarRow({
  calendar,
  draft,
  disabled,
  onChange,
}: {
  calendar: GoogleCalendarChoice
  draft: GoogleCalendarChoiceDraft
  disabled: boolean
  onChange: (update: Partial<GoogleCalendarChoiceDraft>) => void
}) {
  return <li className="google-calendar-row">
    <label className="google-calendar-select">
      <input type="checkbox" checked={draft.selected} disabled={disabled} onChange={event => onChange({ selected: event.target.checked })} />
      <span className="google-calendar-name">{calendar.name || calendar.calendarId}</span>
      {calendar.timeZone && <span className="google-calendar-timezone">{calendar.timeZone}</span>}
    </label>
    {calendar.accessStatus === 'lost'
      ? <span className="google-calendar-lost">Brak dostępu w Google</span>
      : draft.selected && <label className="google-calendar-sharing">
        <span>Dostęp</span>
        <select value={draft.sharingMode} disabled={disabled} onChange={event => onChange({ sharingMode: event.target.value as GoogleCalendarSharingMode })}>
          <option value="private">Prywatny</option>
          <option value="household">Dla domowników</option>
        </select>
      </label>}
  </li>
}
