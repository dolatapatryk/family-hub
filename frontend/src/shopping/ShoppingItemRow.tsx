import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { createShoppingApi } from './api'
import { refreshShoppingItems } from './cache'
import type { ShoppingItem } from './shopping'

type ShoppingApi = ReturnType<typeof createShoppingApi>

export function ShoppingItemRow({ item, api, queryKey }: { item: ShoppingItem; api: ShoppingApi; queryKey: readonly unknown[] }) {
  const client = useQueryClient()
  const update = useMutation({
    mutationFn: (completed: boolean) => api.setCompleted(item.id, completed),
    onSuccess: saved => refreshShoppingItems(client, queryKey, saved),
  })
  const details = [item.quantity, item.store].filter(Boolean).join(' · ')

  return (
    <li className={`task-item shopping-item${item.completed ? ' shopping-purchased' : ''}`}>
      <label className="task-check shopping-check">
        <input type="checkbox" checked={item.completed} disabled={update.isPending}
          onChange={event => update.mutate(event.target.checked)}
          aria-label={`${item.completed ? 'Przywróć na listę' : 'Oznacz jako kupione'}: ${item.name}`} />
        <span className="shopping-item-copy"><span className="shopping-name">{item.name}</span>{details && <span className="shopping-detail">{details}</span>}</span>
      </label>
      {update.isPending && <p className="task-feedback" role="status">Zapisuję…</p>}
      {update.isError && <p className="error-message" role="alert">{update.error.message} Spróbuj ponownie oznaczyć produkt.</p>}
    </li>
  )
}
