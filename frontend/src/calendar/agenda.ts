export type AgendaDay = 'today' | 'tomorrow' | 'weekend'

export interface AgendaEvent {
  time: string
  title: string
  detail: string
}

export const agenda: Record<AgendaDay, { label: string; title: string; events: AgendaEvent[] }> = {
  today: {
    label: 'Dziś',
    title: 'Plany na dziś',
    events: [
      { time: '09:00', title: 'Przegląd planu', detail: 'Krótka chwila na ustalenia' },
      { time: '13:30', title: 'Odbiór przesyłki', detail: 'Sprawa do załatwienia' },
      { time: '18:00', title: 'Przygotować kolację', detail: 'Wspólny czas w domu' },
    ],
  },
  tomorrow: {
    label: 'Jutro',
    title: 'Plany na jutro',
    events: [
      { time: '10:00', title: 'Zakupy spożywcze', detail: 'Lista jest w zakładce Zakupy' },
      { time: '15:30', title: 'Porządek w planach', detail: 'Sprawdź, co zostało na tydzień' },
    ],
  },
  weekend: {
    label: 'Weekend',
    title: 'Pomysły na weekend',
    events: [
      { time: '10:30', title: 'Poranny spacer', detail: 'Czas na świeżym powietrzu' },
      { time: '14:00', title: 'Domowe sprawy', detail: 'Bez pośpiechu, według potrzeb' },
    ],
  },
}

export const agendaDays: AgendaDay[] = ['today', 'tomorrow', 'weekend']

export const agendaDayLabels: Record<AgendaDay, string> = {
  today: 'Dziś',
  tomorrow: 'Jutro',
  weekend: 'Weekend',
}
