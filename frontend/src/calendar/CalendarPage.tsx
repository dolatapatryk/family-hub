import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthGate'
import { PageHeader } from '../components/PageHeader'
import { CalendarAgenda, CalendarQueryState } from './AgendaComponents'
import { buildAgenda } from './agenda'
import { createCalendarEventsApi } from './api'
import { refreshEventCaches } from './cache'
import { addDays, browserTimeZone, formatDate, localDate, validDate } from './dates'
import { EventForm } from './EventForm'
import { AddItemButton } from './ItemFields'
import { useCalendarSources } from './queries'
import type { CalendarEvent, EventInput } from './types'

export function CalendarPage() {
  const { profile } = useAuth()
  const client = useQueryClient()
  const api = createCalendarEventsApi(profile.household_id, profile.id)
  const [start, setStart] = useState(() => localDate())
  const range = { start, end: addDays(start, 14) }
  const { events, annualDates, tasks } = useCalendarSources(range)
  const [form, setForm] = useState<{ item: CalendarEvent | null } | null>(null)
  const [deleting, setDeleting] = useState<CalendarEvent | null>(null)
  const [notice, setNotice] = useState('')
  const save = useMutation({
    mutationFn: (input: EventInput) => form?.item ? api.update(form.item.id, input) : api.create(input),
    onSuccess: async saved => {
      setForm(null)
      setNotice('Wydarzenie zapisane.')
      await refreshEventCaches(client, profile.household_id, profile.id, saved)
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.remove(id),
    onSuccess: async id => {
      setDeleting(null)
      setNotice('Wydarzenie usunięte.')
      await refreshEventCaches(client, profile.household_id, profile.id, id)
    },
  })
  const busy = save.isPending || remove.isPending
  const entries = buildAgenda(events.data ?? [], annualDates.data ?? [], tasks.data ?? [], range)
  const showAgenda = entries.length > 0 || (events.isSuccess && annualDates.isSuccess && tasks.isSuccess)

  function openForm(item: CalendarEvent | null) {
    save.reset()
    remove.reset()
    setNotice('')
    setDeleting(null)
    setForm({ item })
  }

  return <>
    <PageHeader eyebrow="Wspólny plan" title="Kalendarz domowy" description="Wydarzenia, ważne daty i terminy zadań w jednym miejscu."
      action={<AddItemButton label="Dodaj wydarzenie" expanded={!!form} disabled={busy} onClick={() => openForm(null)} />} />
    {notice && <p className="task-notice" role="status">{notice}</p>}
    {form && <EventForm key={form.item?.id ?? 'new'} item={form.item} defaultDate={start} userId={profile.id} pending={save.isPending}
      error={save.error?.message} onSave={input => save.mutate(input)} onCancel={() => setForm(null)} />}
    {deleting && <section className="panel empty-panel calendar-delete" aria-label="Potwierdź usunięcie wydarzenia">
      <p>Usunąć wydarzenie „{deleting.title}”?</p>
      <div className="form-actions"><button className="button-quiet" type="button" disabled={busy} onClick={() => remove.mutate(deleting.id)}>{remove.isPending ? 'Usuwam…' : 'Usuń wydarzenie'}</button><button className="text-button" type="button" disabled={busy} onClick={() => setDeleting(null)}>Anuluj</button></div>
      {remove.isError && <p className="error-message" role="alert">{remove.error.message}</p>}
    </section>}
    <section className="panel page-panel" aria-labelledby="calendar-panel-title">
      <div className="panel-head calendar-range-head">
        <div><h2 className="panel-title" id="calendar-panel-title">{formatDate(start)} – {formatDate(addDays(range.end, -1))}</h2><p className="panel-kicker">14 dni · godziny w {browserTimeZone()}</p></div>
        <div className="calendar-range-controls">
          <button className="button-quiet" type="button" aria-label="Poprzednie 14 dni" disabled={start < '0001-01-15'} onClick={() => setStart(addDays(start, -14))}>‹</button>
          <button className="button-quiet" type="button" onClick={() => setStart(localDate())}>Dziś</button>
          <label className="calendar-range-input">Od dnia<input type="date" aria-label="Początek zakresu" value={start} min="0001-01-01" max="9999-12-17" onChange={event => { const value = event.target.value; if (validDate(value) && value <= '9999-12-17') setStart(value) }} /></label>
          <button className="button-quiet" type="button" aria-label="Następne 14 dni" disabled={start > '9999-12-03'} onClick={() => setStart(addDays(start, 14))}>›</button>
        </div>
      </div>
      <CalendarQueryState label="wydarzenia" pending={events.isPending} error={events.error} onRetry={() => void events.refetch()} />
      <CalendarQueryState label="ważne daty" pending={annualDates.isPending} error={annualDates.error} onRetry={() => void annualDates.refetch()} />
      <CalendarQueryState label="zadania" pending={tasks.isPending} error={tasks.error} onRetry={() => void tasks.refetch()} />
      {showAgenda && <CalendarAgenda entries={entries} busy={busy} onEdit={openForm} onDelete={item => { setForm(null); remove.reset(); setNotice(''); setDeleting(item) }} />}
      <div className="panel-foot"><span>Daty coroczne wyświetlane są tylko do odczytu.</span><Link to="/annual-dates">Ważne daty</Link></div>
    </section>
  </>
}
