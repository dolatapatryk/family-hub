import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { NavLink, Link } from 'react-router-dom'
import { createShoppingApi } from '../shopping/api'
import { createTasksApi } from '../tasks/api'

interface AppShellProps {
  householdId: string
  userId: string
  profileName: string
  onSignOut: () => void
  children: ReactNode
}

const navigation = [
  { to: '/', label: 'Dziś', icon: 'today', end: true },
  { to: '/tasks', label: 'Zadania', icon: 'tasks', end: false },
  { to: '/shopping', label: 'Zakupy', icon: 'shopping', end: false },
  { to: '/calendar', label: 'Kalendarz', icon: 'calendar', end: false },
] as const

function NavigationIcon({ name }: { name: (typeof navigation)[number]['icon'] }) {
  const paths = {
    today: <><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M16 2v4M8 2v4M3 10h18M8 14h2m4 0h2m-8 4h2" /></>,
    tasks: <><path d="m5 6 2 2 4-4M5 13l2 2 4-4M5 20l2 2 4-4" /><path d="M15 7h5m-5 7h5m-5 7h5" /></>,
    shopping: <><path d="M3 4h2l2.1 11.1a2 2 0 0 0 2 1.6h8.7a2 2 0 0 0 2-1.6L21 8H6" /><circle cx="10" cy="20" r="1" /><circle cx="18" cy="20" r="1" /></>,
    calendar: <><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01" /></>,
  }

  return <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function SignOutIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 17l5-5-5-5M15 12H3" /><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" /></svg>
}

export function AppShell({ householdId, userId, profileName, onSignOut, children }: AppShellProps) {
  const tasksApi = createTasksApi(householdId, userId)
  const shoppingApi = createShoppingApi(householdId, userId)
  const tasks = useQuery({
    queryKey: ['tasks', householdId],
    queryFn: ({ signal }) => tasksApi.list(signal),
  })
  const shopping = useQuery({
    queryKey: ['shoppingItems', householdId],
    queryFn: ({ signal }) => shoppingApi.list(signal),
  })

  const openTaskCount = tasks.data?.filter(task => !task.completed).length
  const openShoppingCount = shopping.data?.filter(item => !item.completed).length
  const initials = profileName.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toLocaleUpperCase()).join('')

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">Przejdź do treści</a>
      <aside className="sidebar" aria-label="Nawigacja aplikacji">
        <div className="sidebar-brand-row">
          <Link className="brand" to="/">
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="m3.5 10 8.5-7 8.5 7v10a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1z" /><path d="M9 21v-7h6v7" /></svg>
            </span>
            <span><span className="brand-name">Family Hub</span><span className="brand-sub">Wspólny plan dnia</span></span>
          </Link>
          <span className="mobile-profile-name">{profileName}</span>
          <button className="signout-button mobile-signout" type="button" onClick={onSignOut} aria-label="Wyloguj się" title="Wyloguj się"><SignOutIcon /></button>
        </div>

        <p className="nav-label">Przestrzeń domowa</p>
        <nav className="navigation" aria-label="Główna nawigacja">
          {navigation.map(item => {
            const count = item.icon === 'tasks' ? openTaskCount : item.icon === 'shopping' ? openShoppingCount : undefined
            return (
              <NavLink className="nav-link" key={item.to} to={item.to} end={item.end}>
                <NavigationIcon name={item.icon} />
                <span>{item.label}</span>
                {count !== undefined && count > 0 && <span className="nav-badge">{count}</span>}
              </NavLink>
            )
          })}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="status-dot" aria-hidden="true" />
            <div><strong>Wspólny dom</strong><p>Zadania i zakupy są dostępne dla wszystkich domowników.</p></div>
          </div>
          <div className="sidebar-account">
            <span className="account-avatar" aria-hidden="true">{initials || 'FH'}</span>
            <span className="account-name">{profileName}</span>
            <button className="signout-button" type="button" onClick={onSignOut} aria-label="Wyloguj się" title="Wyloguj się">
              <SignOutIcon />
            </button>
          </div>
        </div>
      </aside>

      <main className="main" id="main" tabIndex={-1}>
        <div className="main-content">{children}</div>
      </main>
    </div>
  )
}
