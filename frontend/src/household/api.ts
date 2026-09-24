import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '../auth/supabase'

export interface HouseholdMember {
  id: string
  name: string
}

export interface HouseholdInvite {
  token: string
  expiresAt: string
}

const householdMemberColumns = 'id, name'

function requireSupabase(): SupabaseClient {
  if (!supabase) throw new Error('Supabase is not configured. Check the Family Hub environment settings.')
  return supabase
}

function throwIfError(error: { message: string } | null): asserts error is null {
  if (error) throw new Error(error.message)
}

export function createHouseholdMembersApi(householdId: string) {
  const client = requireSupabase()

  return {
    async list(signal?: AbortSignal): Promise<HouseholdMember[]> {
      let query = client
        .from('profiles')
        .select(householdMemberColumns)
        .eq('household_id', householdId)
        .order('name', { ascending: true })
        .order('id', { ascending: true })
      if (signal) query = query.abortSignal(signal)

      const { data, error } = await query
      throwIfError(error)
      return data as HouseholdMember[]
    },
  }
}

export function createHouseholdInvitesApi() {
  const client = requireSupabase()

  return {
    async create(): Promise<HouseholdInvite> {
      const { data, error } = await client.rpc('create_household_invite')
      throwIfError(error)

      const row = (Array.isArray(data) ? data[0] : data) as {
        invite_token?: string
        expires_at?: string
      } | null
      if (!row?.invite_token || !row.expires_at) {
        throw new Error('Family Hub did not return an invitation code.')
      }

      return { token: row.invite_token, expiresAt: row.expires_at }
    },

    async join(token: string, profileName: string): Promise<void> {
      const { error } = await client.rpc('join_household', {
        p_invite_token: token,
        p_profile_name: profileName,
      })
      throwIfError(error)
    },
  }
}
