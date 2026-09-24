import type { QueryClient } from '@tanstack/react-query'
import type { ShoppingItem } from './shopping'

export async function refreshShoppingItems(client: QueryClient, queryKey: readonly unknown[], saved: ShoppingItem) {
  await client.cancelQueries({ queryKey })
  // Keep a successful write visible even if the following refresh fails.
  client.setQueryData<ShoppingItem[]>(queryKey, items => items
    ? [...items.filter(item => item.id !== saved.id), saved]
    : undefined)
  await client.invalidateQueries({ queryKey })
}
