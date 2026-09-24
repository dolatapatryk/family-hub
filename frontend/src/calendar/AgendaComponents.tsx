import { agendaDayLabels, agendaDays, type AgendaDay, type AgendaEvent } from './agenda'

export function AgendaSwitcher({ selectedDay, onSelect, label = 'Wybierz dzień' }: {
  selectedDay: AgendaDay
  onSelect: (day: AgendaDay) => void
  label?: string
}) {
  return (
    <div className="agenda-switch" role="group" aria-label={label}>
      {agendaDays.map(day => <button key={day} type="button" aria-pressed={selectedDay === day} onClick={() => onSelect(day)}>{agendaDayLabels[day]}</button>)}
    </div>
  )
}

export function EventList({ events, wide = false, label }: { events: AgendaEvent[]; wide?: boolean; label: string }) {
  return (
    <ol className={`event-list${wide ? ' event-list-wide' : ''}`} aria-label={label}>
      {events.map(event => (
        <li className={`event-row${wide ? ' wide-event' : ''}`} key={`${event.time}-${event.title}`}>
          <time className="event-time">{event.time}</time>
          <span className="event-track" aria-hidden="true"><span className="event-dot" /></span>
          <div><div className="event-title">{event.title}</div><div className="event-detail">{event.detail}</div></div>
        </li>
      ))}
    </ol>
  )
}
