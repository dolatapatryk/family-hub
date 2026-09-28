import { useState, type FormEvent } from 'react'
import { addDays, browserTimeZone, canonicalTimeZone, validDate, zonedInput, zonedInstant } from './dates'
import { ItemFields } from './ItemFields'
import type { CalendarEvent, EventInput, Visibility } from './types'

export function EventForm({ item, defaultDate, userId, pending, error, onSave, onCancel }: {
  item: CalendarEvent | null; defaultDate: string; userId: string; pending: boolean; error: string | undefined
  onSave: (input: EventInput) => void; onCancel: () => void
}) {
  const zone = item && !item.allDay ? item.timeZone : browserTimeZone()
  const [title, setTitle] = useState(item?.title ?? '')
  const [description, setDescription] = useState(item?.description ?? '')
  const [visibility, setVisibility] = useState<Visibility>(item?.visibility ?? 'private')
  const [allDay, setAllDay] = useState(item?.allDay ?? true)
  const [startDate, setStartDate] = useState(item?.allDay ? item.startDate : item && !item.allDay ? zonedInput(item.startsAt, zone).slice(0, 10) : defaultDate)
  const [lastDate, setLastDate] = useState(item?.allDay ? addDays(item.endDate, -1) : item && !item.allDay ? zonedInput(item.endsAt, zone).slice(0, 10) : defaultDate)
  const [startTime, setStartTime] = useState(item && !item.allDay ? zonedInput(item.startsAt, zone) : `${defaultDate}T09:00`)
  const [endTime, setEndTime] = useState(item && !item.allDay ? zonedInput(item.endsAt, zone) : `${defaultDate}T10:00`)
  const [timeZone, setTimeZone] = useState(zone)
  const [validation, setValidation] = useState('')

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    setValidation('')
    try {
      if (!title.trim()) throw new Error('Podaj tytuł wydarzenia.')
      const common = { title: title.trim(), description: description.trim() || null, visibility }
      if (allDay) {
        if (!validDate(startDate) || !validDate(lastDate) || lastDate < startDate || lastDate === '9999-12-31') {
          throw new Error('Podaj poprawny zakres dat. Ostatni dzień nie może być wcześniejszy niż początek.')
        }
        onSave({ ...common, allDay: true, startDate, endDate: addDays(lastDate, 1) })
      } else {
        const selectedZone = canonicalTimeZone(timeZone)
        // Preserve the original instant for unchanged fields, including seconds
        // and an existing event in a repeated DST hour.
        const startsAt = item && !item.allDay && canonicalTimeZone(item.timeZone) === selectedZone && zonedInput(item.startsAt, item.timeZone) === startTime
          ? item.startsAt : zonedInstant(startTime, selectedZone)
        const endsAt = item && !item.allDay && canonicalTimeZone(item.timeZone) === selectedZone && zonedInput(item.endsAt, item.timeZone) === endTime
          ? item.endsAt : zonedInstant(endTime, selectedZone)
        if (Date.parse(endsAt) <= Date.parse(startsAt)) throw new Error('Koniec wydarzenia musi być późniejszy niż początek.')
        onSave({ ...common, allDay: false, startsAt, endsAt, timeZone: selectedZone })
      }
    } catch (failure) {
      setValidation(failure instanceof Error ? failure.message : 'Sprawdź dane wydarzenia.')
    }
  }

  return <form className="panel task-form calendar-form" onSubmit={submit} aria-label={item ? 'Edytuj wydarzenie' : 'Dodaj wydarzenie'}>
    <div className="panel-head"><div><h2 className="panel-title">{item ? 'Edytuj wydarzenie' : 'Dodaj wydarzenie'}</h2><p className="panel-kicker">Jednorazowy plan. Urodziny i rocznice dodaj w zakładce Ważne daty.</p></div></div>
    <fieldset disabled={pending}>
      <ItemFields title={title} description={description} visibility={visibility} onTitle={setTitle} onDescription={setDescription} onVisibility={setVisibility} canChangeVisibility={!item || item.createdBy === userId} />
      <label className="calendar-checkbox"><input type="checkbox" checked={allDay} onChange={event => {
        setAllDay(event.target.checked)
        if (event.target.checked) {
          const first = startTime.slice(0, 10)
          const last = endTime.endsWith('T00:00') && endTime.slice(0, 10) > first
            ? addDays(endTime.slice(0, 10), -1) : endTime.slice(0, 10)
          setStartDate(first)
          setLastDate(last < first ? first : last)
        } else {
          setStartTime(`${startDate}T09:00`)
          setEndTime(`${lastDate}T10:00`)
        }
      }} />Cały dzień</label>
      {allDay ? <div className="task-form-options">
        <label>Początek<input type="date" min="0001-01-01" max="9999-12-30" required value={startDate} onChange={event => { setStartDate(event.target.value); if (lastDate < event.target.value) setLastDate(event.target.value) }} /></label>
        <label>Ostatni dzień <span className="optional">(włącznie)</span><input type="date" min={startDate || '0001-01-01'} max="9999-12-30" required value={lastDate} onChange={event => setLastDate(event.target.value)} /></label>
      </div> : <>
        <div className="task-form-options">
          <label>Początek<input type="datetime-local" min="0001-01-01T00:00" max="9999-12-31T23:59" required value={startTime} onChange={event => setStartTime(event.target.value)} /></label>
          <label>Koniec<input type="datetime-local" min="0001-01-01T00:00" max="9999-12-31T23:59" required value={endTime} onChange={event => setEndTime(event.target.value)} /></label>
        </div>
        <label>Strefa czasowa<input required value={timeZone} onChange={event => setTimeZone(event.target.value)} placeholder="Europe/Warsaw" /></label>
        <p className="task-meta">Obie godziny dotyczą wybranej strefy czasowej.</p>
      </>}
      {(validation || error) && <p className="error-message" role="alert">{validation || error}</p>}
      <div className="form-actions"><button className="primary-button" type="submit">{pending ? 'Zapisuję…' : 'Zapisz wydarzenie'}</button><button className="text-button" type="button" onClick={onCancel}>Anuluj</button></div>
    </fieldset>
  </form>
}
