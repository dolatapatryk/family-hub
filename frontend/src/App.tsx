import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthGate, useAuth } from './auth/AuthGate'
import { AnnualDatesPage } from './annualDates/AnnualDatesPage'
import { BillsPage } from './bills/BillsPage'
import { CalendarPage } from './calendar/CalendarPage'
import { DashboardPage } from './dashboard/DashboardPage'
import { GoogleCalendarSettingsPage } from './googleCalendar/GoogleCalendarSettingsPage'
import { GymTemplateEditorPage, GymTemplatesPage } from './gym/TemplatePages'
import { GymHistoryPage, GymHomePage, GymPlanPage, GymPlanStartPage } from './gym/PlanPages'
import { GymWorkoutPage } from './gym/WorkoutsPage'
import { HouseholdPage } from './household/HouseholdPage'
import { AppShell } from './layout/AppShell'
import { ShoppingPage } from './shopping/ShoppingPage'
import { TasksPage } from './tasks/TasksPage'
import { ToastProvider } from './components/ToastProvider'

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
        <Route path="/bills" element={<BillsPage />} />
        <Route path="/shopping" element={<ShoppingPage />} />
        <Route path="/household" element={<HouseholdPage />} />
        <Route path="/calendar" element={<CalendarRoute />} />
        <Route path="/calendar/settings" element={<GoogleCalendarSettingsPage />} />
        <Route path="/annual-dates" element={<AnnualDatesPage />} />
        <Route path="/gym" element={<GymHomePage />} />
        <Route path="/gym/history" element={<GymHistoryPage />} />
        <Route path="/gym/plans/:planId" element={<GymPlanPage />} />
        <Route path="/gym/plans/:planId/workouts/:week/:day" element={<GymWorkoutPage />} />
        <Route path="/gym/templates/:templateId/start" element={<GymPlanStartPage />} />
        <Route path="/gym/templates" element={<GymTemplatesPage />} />
        <Route path="/gym/templates/new" element={<GymTemplateEditorPage />} />
        <Route path="/gym/templates/:templateId/edit" element={<GymTemplateEditorPage />} />
        <Route path="*" element={<section className="panel empty-panel"><h1>Nie znaleziono strony</h1><Link to="/">Wróć do dziś</Link></section>} />
      </Routes>
    </AppShell>
  )
}

export function App() {
  return <AuthGate><ToastProvider><AuthenticatedApp /></ToastProvider></AuthGate>
}
