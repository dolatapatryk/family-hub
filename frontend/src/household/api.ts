import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '../auth/supabase'

export interface HouseholdMember {
  id: string
  household_id: string
  name: string
}

const householdMemberColumns = 'id, household_id, name'

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
      return (data as HouseholdMember[]).map(member => ({
        id: member.id,
        household_id: member.household_id,
        name: member.name,
      }))
    },
  }
}
