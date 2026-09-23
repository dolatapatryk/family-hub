import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env?.VITE_SUPABASE_URL?.trim() ?? ''
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
