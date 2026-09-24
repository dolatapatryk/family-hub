import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const configuredUrl = import.meta.env?.VITE_SUPABASE_URL?.trim() ?? ''
const configuredHost = (() => {
  try {
    return new URL(configuredUrl).hostname
  } catch {
    return ''
  }
})()
const usesLocalSupabase = ['localhost', '127.0.0.1', '[::1]'].includes(configuredHost)
const url = configuredUrl && (import.meta.env?.DEV || usesLocalSupabase) && typeof window !== 'undefined'
  ? new URL('/supabase', window.location.origin).toString()
  : configuredUrl
const publishableKey = import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? ''

export const supabaseConfig = { url, publishableKey }

export const supabase: SupabaseClient | null = url && publishableKey
  ? createClient(url, publishableKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    })
  : null
