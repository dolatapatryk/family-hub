import { Link, Route, Routes } from 'react-router-dom'
import { AuthGate, useAuth } from './auth/AuthGate'
import { CalendarPage } from './calendar/CalendarPage'
import { DashboardPage } from './dashboard/DashboardPage'
import { HouseholdPage } from './household/HouseholdPage'
import { AppShell } from './layout/AppShell'
import { ShoppingPage } from './shopping/ShoppingPage'
import { TasksPage } from './tasks/TasksPage'

function AuthenticatedApp() {
  const { profile, signOut } = useAuth()

  return (
    <AppShell householdId={profile.household_id} userId={profile.id} profileName={profile.name} onSignOut={() => void signOut()}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/shopping" element={<ShoppingPage />} />
        <Route path="/household" element={<HouseholdPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="*" element={<section className="panel empty-panel"><h1>Nie znaleziono strony</h1><Link to="/">Wróć do dziś</Link></section>} />
      </Routes>
    </AppShell>
  )
}

export function App() {
  return <AuthGate><AuthenticatedApp /></AuthGate>
}
