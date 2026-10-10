import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthGate, useAuth } from './auth/AuthGate'
import { AnnualDatesPage } from './annualDates/AnnualDatesPage'
import { CalendarPage } from './calendar/CalendarPage'
import { DashboardPage } from './dashboard/DashboardPage'
import { GoogleCalendarSettingsPage } from './googleCalendar/GoogleCalendarSettingsPage'
import { HouseholdPage } from './household/HouseholdPage'
import { AppShell } from './layout/AppShell'
import { ShoppingPage } from './shopping/ShoppingPage'
import { TasksPage } from './tasks/TasksPage'

function CalendarRoute() {
  const location = useLocation()
  const searchParams = new URLSearchParams(location.search)

  if (searchParams.has('googleCalendar')) {
    return <Navigate to={{ pathname: '/calendar/settings', search: location.search }} replace />
  }

  return <CalendarPage />
}

function AuthenticatedApp() {
  const { profile, signOut } = useAuth()

  return (
    <AppShell householdId={profile.household_id} userId={profile.id} profileName={profile.name} onSignOut={() => void signOut()}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/shopping" element={<ShoppingPage />} />
        <Route path="/household" element={<HouseholdPage />} />
        <Route path="/calendar" element={<CalendarRoute />} />
        <Route path="/calendar/settings" element={<GoogleCalendarSettingsPage />} />
        <Route path="/annual-dates" element={<AnnualDatesPage />} />
        <Route path="*" element={<section className="panel empty-panel"><h1>Nie znaleziono strony</h1><Link to="/">Wróć do dziś</Link></section>} />
      </Routes>
    </AppShell>
  )
}

export function App() {
  return <AuthGate><AuthenticatedApp /></AuthGate>
}
