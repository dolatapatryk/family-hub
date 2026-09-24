import { useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { AgendaSwitcher, EventList } from './AgendaComponents'
import { agenda, type AgendaDay } from './agenda'

export function CalendarPage() {
  const [selectedDay, setSelectedDay] = useState<AgendaDay>('today')
  const selected = agenda[selectedDay]

  return (
    <>
      <PageHeader eyebrow="Wspólny plan" title="Kalendarz domowy" description="Przejrzyj najbliższe plany w jednym miejscu." />
      <section className="panel page-panel" aria-labelledby="calendar-panel-title">
        <div className="panel-head">
          <div><h2 className="panel-title" id="calendar-panel-title">Najbliższe plany</h2><p className="panel-kicker">Przykładowy kalendarz</p></div>
          <AgendaSwitcher selectedDay={selectedDay} onSelect={setSelectedDay} label="Wybierz dzień kalendarza" />
        </div>
        <div className="calendar-summary"><strong>{selected.title}</strong><span aria-hidden="true"> · </span>{selected.events.length} {selected.events.length === 1 ? 'wydarzenie' : 'wydarzenia'}</div>
        <EventList events={selected.events} wide label={selected.title} />
        <div className="panel-foot"><span>To przykładowe wydarzenia. Podłączenie kalendarza jest w przygotowaniu.</span></div>
      </section>
    </>
  )
}
