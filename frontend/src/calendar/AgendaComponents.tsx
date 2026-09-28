import { Link } from 'react-router-dom'
import { kindLabels } from '../annualDates/annualDates'
import { addDays, formatDate } from './dates'
import type { AgendaEntry } from './agenda'
import type { CalendarEvent } from './types'

function eventDates(event: CalendarEvent): string {
  if (event.allDay) {
    const lastDate = addDays(event.endDate, -1)
    return event.startDate === lastDate ? formatDate(event.startDate) : `${formatDate(event.startDate)} – ${formatDate(lastDate)}`
  }
  const format = new Intl.DateTimeFormat('pl-PL', {
    timeZone: event.timeZone, day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  return `${format.format(new Date(event.startsAt))} – ${format.format(new Date(event.endsAt))} (${event.timeZone})`
}

export function CalendarAgenda({ entries, onEdit, onDelete, busy = false, empty = 'Brak planów w tym zakresie.' }: {
  entries: AgendaEntry[]; onEdit?: (event: CalendarEvent) => void
  onDelete?: (event: CalendarEvent) => void; busy?: boolean; empty?: string
}) {
  const dates = [...new Set(entries.map(entry => entry.date))]
  if (!entries.length) return <p className="panel-message">{empty}</p>
  return <div className="calendar-agenda">
    {dates.map(date => <section className="agenda-day" key={date} aria-label={formatDate(date)}>
      <h3><time dateTime={date}>{formatDate(date)}</time></h3>
      <ol className="event-list">
        {entries.filter(entry => entry.date === date).map(entry => {
          const { source } = entry
          const definition = source.kind === 'annual' ? source.occurrence.definition : null
          const visibility = source.kind === 'event' ? source.event.visibility : definition?.visibility
          const description = source.kind === 'event' ? source.event.description : definition?.description
          return <li className="event-row wide-event" key={entry.id}>
            <span className="event-time">{entry.time}</span>
            <span className="event-track" aria-hidden="true"><span className="event-dot" /></span>
            <div className="agenda-entry">
              <details>
                <summary className="event-title">{entry.title}</summary>
                <div className="agenda-details">
                  {description && <p className="event-description">{description}</p>}
                  {source.kind === 'event' && <p>{eventDates(source.event)}</p>}
                  {source.kind === 'annual' && <>
                    <p>{kindLabels[source.occurrence.definition.kind]}{source.occurrence.count !== null ? ` · ${source.occurrence.count}. ${source.occurrence.definition.kind === 'birthday' ? 'urodziny' : 'rocznica'}` : ''}</p>
                    {source.occurrence.definition.kind !== 'other' && <p>Data początkowa: {formatDate(source.occurrence.definition.initialDate)}</p>}
                    <Link to="/annual-dates">Zarządzaj w Ważne daty</Link>
                  </>}
                  {source.kind === 'task' && <Link to="/tasks">Otwórz zadania</Link>}
                </div>
              </details>
              <p className="event-detail">{source.kind === 'task' ? 'Zadanie' : `${visibility === 'private' ? 'Prywatne' : 'Wspólne'} · ${source.kind === 'annual' ? `${kindLabels[source.occurrence.definition.kind]} · tylko odczyt` : 'Wydarzenie'}`}</p>
              {source.kind === 'event' && (onEdit || onDelete) && <div className="agenda-actions">
                {onEdit && <button type="button" className="text-button" disabled={busy} onClick={() => onEdit(source.event)} aria-label={`Edytuj: ${entry.title}`}>Edytuj</button>}
                {onDelete && <button type="button" className="text-button" disabled={busy} onClick={() => onDelete(source.event)} aria-label={`Usuń: ${entry.title}`}>Usuń</button>}
              </div>}
            </div>
          </li>
        })}
      </ol>
    </section>)}
  </div>
}

export function CalendarQueryState({ label, pending, error, onRetry }: {
  label: string; pending: boolean; error: Error | null; onRetry: () => void
}) {
  if (pending) return <p className="panel-message" role="status">Ładuję {label}…</p>
  if (error) return <div className="panel-message error-message" role="alert">Nie udało się pobrać: {label}. {error.message} <button className="link-button" type="button" onClick={onRetry}>Spróbuj ponownie</button></div>
  return null
}
