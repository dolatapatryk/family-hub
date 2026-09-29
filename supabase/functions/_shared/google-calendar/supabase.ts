import { createClient, type SupabaseClient, type User } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import { HttpError, requiredEnv } from './http.ts'

export function serviceClient(): SupabaseClient {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim()
    || Deno.env.get('SUPABASE_SECRET_KEY')?.trim()
  if (!serviceKey) throw new HttpError(503, 'integration_not_configured', 'Supabase Edge Functions nie są jeszcze skonfigurowane.')
  return createClient(requiredEnv('SUPABASE_URL'), serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function authenticatedUser(request: Request): Promise<User> {
  const authorization = request.headers.get('authorization')
  const match = authorization?.match(/^Bearer\s+(.+)$/i)
  if (!match) throw new HttpError(401, 'unauthorized', 'Zaloguj się ponownie, aby zarządzać Google Calendar.')

  const url = requiredEnv('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')?.trim()
    || Deno.env.get('SUPABASE_PUBLISHABLE_KEY')?.trim()
  if (!anonKey) throw new HttpError(503, 'integration_not_configured', 'Supabase Edge Functions nie są jeszcze skonfigurowane.')

  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await client.auth.getUser(match[1])
  if (error || !data.user) throw new HttpError(401, 'unauthorized', 'Zaloguj się ponownie, aby zarządzać Google Calendar.')
  return data.user
}

export async function rpc<T>(client: SupabaseClient, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.rpc(name, args)
  if (error) throw new Error(`Google Calendar operation failed: ${name}`)
  return data as T
}
