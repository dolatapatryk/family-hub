import { Link } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { GoogleCalendarSettings } from './GoogleCalendarSettings'

export function GoogleCalendarSettingsPage() {
  return <>
    <PageHeader
      eyebrow="Kalendarz"
      title="Ustawienia kalendarza"
      description="Zarządzaj połączeniem Google Calendar, wybierz importowane kalendarze i ustaw ich dostępność dla domowników."
      action={<Link className="button-quiet calendar-settings-back" to="/calendar">Wróć do kalendarza</Link>}
    />
    <GoogleCalendarSettings />
  </>
}
