import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '../auth/supabase'
import type { ShoppingItem } from './shopping'

interface ShoppingItemRow {
  id: string
  name: string
  quantity: string | null
  store: string | null
  completed: boolean
  created_at: string
}

const shoppingItemColumns = 'id, name, quantity, store, completed, created_at'

function toShoppingItem(row: ShoppingItemRow): ShoppingItem {
  return {
    id: row.id,
    name: row.name,
    quantity: row.quantity,
    store: row.store,
    completed: row.completed,
    createdAt: row.created_at,
  }
}

function requireSupabase(): SupabaseClient {
  if (!supabase) throw new Error('Supabase is not configured. Check the Family Hub environment settings.')
  return supabase
}

function throwIfError(error: { message: string } | null): asserts error is null {
  if (error) throw new Error(error.message)
}

export function createShoppingApi(householdId: string, userId: string) {
  const client = requireSupabase()

  return {
    async list(signal?: AbortSignal): Promise<ShoppingItem[]> {
      let query = client
        .from('shopping_items')
        .select(shoppingItemColumns)
        .eq('household_id', householdId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
      if (signal) query = query.abortSignal(signal)

      const { data, error } = await query
      throwIfError(error)
      return (data as ShoppingItemRow[]).map(toShoppingItem)
    },

    async create(input: { name: string; quantity: string | null; store?: string | null }): Promise<ShoppingItem> {
      const { data, error } = await client
        .from('shopping_items')
        .insert({
          household_id: householdId,
          name: input.name,
          quantity: input.quantity,
          store: input.store ?? null,
          added_by: userId,
        })
        .select(shoppingItemColumns)
        .single()
      throwIfError(error)
      return toShoppingItem(data as ShoppingItemRow)
    },

    async setCompleted(id: string, completed: boolean): Promise<ShoppingItem> {
      const { data, error } = await client
        .from('shopping_items')
        .update({ completed })
        .eq('id', id)
        .eq('household_id', householdId)
        .select(shoppingItemColumns)
        .single()
      throwIfError(error)
      return toShoppingItem(data as ShoppingItemRow)
    },
  }
}
