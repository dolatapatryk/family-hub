import { createContext, useCallback, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase, supabaseConfig } from './supabase'

interface Profile {
  id: string
  household_id: string
  name: string
}

interface AuthContextValue {
  profile: Profile
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthGate')
  return value
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [profileLoading, setProfileLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false)
      return
    }

    let active = true
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return
      if (sessionError) setError(sessionError.message)
      setSession(data.session)
      setAuthLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return
      setSession(nextSession)
      setError(null)
    })

    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [])

  const loadProfile = useCallback(async (userId: string) => {
    if (!supabase) return
    setProfileLoading(true)
    setError(null)
    const { data, error: profileError } = await supabase
      .from('profiles')
      .select('id, household_id, name')
      .eq('id', userId)
      .maybeSingle<Profile>()
    if (profileError) {
      setProfile(null)
      setError(profileError.message)
    } else {
      setProfile(data)
    }
    setProfileLoading(false)
  }, [])

  useEffect(() => {
    if (!session) {
      setProfile(null)
      setProfileLoading(false)
      return
    }
    void loadProfile(session.user.id)
  }, [loadProfile, session])

  async function signOut() {
    if (!supabase) return
    const { error: signOutError } = await supabase.auth.signOut()
    if (signOutError) setError(signOutError.message)
  }

  if (!supabase) {
    return <AuthLayout><ConfigurationMessage /></AuthLayout>
  }

  if (authLoading || profileLoading) {
    return <AuthLayout><p role="status">Sprawdzam sesję Family Hub…</p></AuthLayout>
  }

  if (!session) {
    return <AuthLayout><AuthForm /></AuthLayout>
  }

  if (error) {
    return <AuthLayout><ErrorState message={error} onRetry={() => void loadProfile(session.user.id)} onSignOut={signOut} /></AuthLayout>
  }

  if (!profile) {
    return <AuthLayout><HouseholdOnboarding user={session.user} onCreated={() => void loadProfile(session.user.id)} onSignOut={signOut} /></AuthLayout>
  }

  return (
    <AuthContext.Provider value={{ profile, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="app auth-shell">
      <header className="header">
        <span className="brand"><span className="brand-mark" aria-hidden="true">F</span>Family Hub</span>
        <span className="header-note">Wspólny plan dnia</span>
      </header>
      <main>{children}</main>
    </div>
  )
}

function ConfigurationMessage() {
  return (
    <section className="card auth-card">
      <p className="eyebrow">Konfiguracja</p>
      <h1>Połącz Family Hub</h1>
      <p className="intro">Dodaj adres Supabase i klucz publiczny do <code>frontend/.env.local</code>, a następnie uruchom ponownie Vite.</p>
      <pre className="auth-config">{`VITE_SUPABASE_URL=${supabaseConfig.url || 'http://127.0.0.1:54321'}\nVITE_SUPABASE_PUBLISHABLE_KEY=…`}</pre>
    </section>
  )
}

function AuthForm() {
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || pending) return
    setPending(true)
    setNotice('')
    setError('')
    const result = mode === 'signIn'
      ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
      : await supabase.auth.signUp({ email: email.trim(), password })
    setPending(false)
    if (result.error) {
      setError(result.error.message)
    } else if (mode === 'signUp' && !result.data.session) {
      setNotice('Konto utworzone. Potwierdź e-mail, a potem zaloguj się, aby kontynuować.')
    }
  }

  return (
    <section className="card auth-card">
      <p className="eyebrow">Witaj</p>
      <h1>{mode === 'signIn' ? 'Zaloguj się do Family Hub.' : 'Utwórz konto Family Hub.'}</h1>
      <p className="intro">{mode === 'signIn' ? 'Użyj konta utworzonego w Supabase Auth.' : 'Po rejestracji możesz utworzyć wspólny dom.'}</p>
      <form className="auth-form" onSubmit={submit}>
        <label>E-mail<input type="email" required autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} /></label>
        <label>Hasło<input type="password" required minLength={6} autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'} value={password} onChange={event => setPassword(event.target.value)} /></label>
        {error && <p className="error-message" role="alert">{error}</p>}
        {notice && <p className="task-notice" role="status">{notice}</p>}
        <button className="primary-button" type="submit" disabled={pending}>{pending ? 'Pracuję…' : mode === 'signIn' ? 'Zaloguj się' : 'Utwórz konto'}</button>
      </form>
      <p className="auth-switch">
        {mode === 'signIn' ? 'Nie masz konta?' : 'Masz już konto?'}{' '}
        <button className="text-button" type="button" onClick={() => { setMode(mode === 'signIn' ? 'signUp' : 'signIn'); setError(''); setNotice('') }}>
          {mode === 'signIn' ? 'Utwórz konto' : 'Zaloguj się'}
        </button>
      </p>
    </section>
  )
}

function HouseholdOnboarding({ user, onCreated, onSignOut }: { user: User; onCreated: () => void; onSignOut: () => Promise<void> }) {
  const defaultProfileName = String(user.user_metadata?.name ?? user.email?.split('@')[0] ?? '').trim()
  const [householdName, setHouseholdName] = useState('Family')
  const [profileName, setProfileName] = useState(defaultProfileName)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || pending || !householdName.trim() || !profileName.trim()) return
    setPending(true)
    setError('')
    const { error: createError } = await supabase.rpc('create_household', {
      household_name: householdName.trim(),
      profile_name: profileName.trim(),
    })
    setPending(false)
    if (createError) {
      const staleSession = createError.code === '23503' && createError.message.includes('profiles_id_fkey')
        setError(staleSession
        ? 'Ta zapisana sesja należy do użytkownika Supabase Auth, który już nie istnieje. Może się tak zdarzyć po zresetowaniu bazy danych. Wyloguj się i zaloguj ponownie. Jeśli konto także zostało usunięte, wybierz „Utwórz konto”, aby zarejestrować je ponownie.'
        : createError.message)
    } else onCreated()
  }

  return (
    <section className="card auth-card">
      <p className="eyebrow">Pierwsze kroki</p>
      <h1>Utwórz wspólny dom.</h1>
      <p className="intro">Utworzymy wspólną przestrzeń i dodamy Twój profil jako pierwszego domownika.</p>
      <form className="auth-form" onSubmit={submit}>
        <label>Twoje imię<input required value={profileName} onChange={event => setProfileName(event.target.value)} autoComplete="name" /></label>
        <label>Nazwa domu<input required value={householdName} onChange={event => setHouseholdName(event.target.value)} /></label>
        {error && <p className="error-message" role="alert">{error}</p>}
        <button className="primary-button" type="submit" disabled={pending || !profileName.trim() || !householdName.trim()}>{pending ? 'Tworzę…' : 'Utwórz dom'}</button>
      </form>
      <p className="auth-switch"><button className="text-button" type="button" onClick={() => void onSignOut()}>Wyloguj się</button></p>
    </section>
  )
}

function ErrorState({ message, onRetry, onSignOut }: { message: string; onRetry: () => void; onSignOut: () => Promise<void> }) {
  return (
    <section className="card auth-card">
      <p className="eyebrow">Coś poszło nie tak</p>
      <h1>Nie udało się wczytać profilu.</h1>
      <p className="error-message" role="alert">{message}</p>
      <div className="form-actions">
        <button className="primary-button" onClick={onRetry}>Spróbuj ponownie</button>
        <button className="button-quiet" onClick={() => void onSignOut()}>Wyloguj się</button>
      </div>
    </section>
  )
}
