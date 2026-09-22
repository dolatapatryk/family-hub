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
    return <AuthLayout><p role="status">Checking your Family Hub session…</p></AuthLayout>
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
        <span className="header-note">Our everyday, together</span>
      </header>
      <main>{children}</main>
    </div>
  )
}

function ConfigurationMessage() {
  return (
    <section className="card auth-card">
      <p className="eyebrow">Setup</p>
      <h1>Connect Family Hub</h1>
      <p className="intro">Add the Supabase URL and publishable key to <code>frontend/.env.local</code>, then restart Vite.</p>
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
      setNotice('Account created. Confirm your email, then sign in to continue.')
    }
  }

  return (
    <section className="card auth-card">
      <p className="eyebrow">Welcome</p>
      <h1>{mode === 'signIn' ? 'Sign in to Family Hub.' : 'Create your Family Hub account.'}</h1>
      <p className="intro">{mode === 'signIn' ? 'Use the account created in Supabase Auth.' : 'You can create the household after signing up.'}</p>
      <form className="auth-form" onSubmit={submit}>
        <label>Email<input type="email" required autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} /></label>
        <label>Password<input type="password" required minLength={6} autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'} value={password} onChange={event => setPassword(event.target.value)} /></label>
        {error && <p className="error-message" role="alert">{error}</p>}
        {notice && <p className="task-notice" role="status">{notice}</p>}
        <button className="button-primary" type="submit" disabled={pending}>{pending ? 'Working…' : mode === 'signIn' ? 'Sign in' : 'Create account'}</button>
      </form>
      <p className="auth-switch">
        {mode === 'signIn' ? 'Need an account?' : 'Already have an account?'}{' '}
        <button className="button-quiet" type="button" onClick={() => { setMode(mode === 'signIn' ? 'signUp' : 'signIn'); setError(''); setNotice('') }}>
          {mode === 'signIn' ? 'Create one' : 'Sign in'}
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
        ? 'This saved session belongs to a Supabase Auth user that no longer exists. This can happen after resetting the database. Sign out, then sign in again; if the account was also removed, choose “Create one” to register it again.'
        : createError.message)
    } else onCreated()
  }

  return (
    <section className="card auth-card">
      <p className="eyebrow">First steps</p>
      <h1>Create your household.</h1>
      <p className="intro">This creates the shared space and adds your profile as its first member.</p>
      <form className="auth-form" onSubmit={submit}>
        <label>Your name<input required value={profileName} onChange={event => setProfileName(event.target.value)} autoComplete="name" /></label>
        <label>Household name<input required value={householdName} onChange={event => setHouseholdName(event.target.value)} /></label>
        {error && <p className="error-message" role="alert">{error}</p>}
        <button className="button-primary" type="submit" disabled={pending || !profileName.trim() || !householdName.trim()}>{pending ? 'Creating…' : 'Create household'}</button>
      </form>
      <p className="auth-switch"><button className="button-quiet" type="button" onClick={() => void onSignOut()}>Sign out</button></p>
    </section>
  )
}

function ErrorState({ message, onRetry, onSignOut }: { message: string; onRetry: () => void; onSignOut: () => Promise<void> }) {
  return (
    <section className="card auth-card">
      <p className="eyebrow">Something went wrong</p>
      <h1>We couldn’t load your profile.</h1>
      <p className="error-message" role="alert">{message}</p>
      <div className="form-actions">
        <button className="button-primary" onClick={onRetry}>Try again</button>
        <button className="button-quiet" onClick={() => void onSignOut()}>Sign out</button>
      </div>
    </section>
  )
}
