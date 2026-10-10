import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { createShoppingApi, UpdateShoppingItemInput } from './api'
import { refreshShoppingItems } from './cache'
import type { ShoppingItem } from './shopping'

type ShoppingApi = ReturnType<typeof createShoppingApi>

export function ShoppingItemRow({ item, api, queryKey }: { item: ShoppingItem; api: ShoppingApi; queryKey: readonly unknown[] }) {
  const client = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [name, setName] = useState(item.name)
  const [quantity, setQuantity] = useState(item.quantity ?? '')
  const [store, setStore] = useState(item.store ?? '')
  const update = useMutation({
    mutationFn: (input: UpdateShoppingItemInput) => api.update(item.id, input),
    onSuccess: async saved => {
      setEditing(false)
      await refreshShoppingItems(client, queryKey, saved)
    },
  })
  const toggle = useMutation({
    mutationFn: (completed: boolean) => api.setCompleted(item.id, completed),
    onSuccess: saved => refreshShoppingItems(client, queryKey, saved),
  })
  const remove = useMutation({
    mutationFn: () => api.remove(item.id),
    onSuccess: async removedId => {
      await client.cancelQueries({ queryKey })
      client.setQueryData<ShoppingItem[]>(queryKey, current => current?.filter(value => value.id !== removedId))
      await client.invalidateQueries({ queryKey })
    },
  })
  const busy = update.isPending || toggle.isPending || remove.isPending
  const details = [item.quantity, item.store].filter(Boolean).join(' · ')

  function openEditor() {
    update.reset()
    remove.reset()
    setName(item.name)
    setQuantity(item.quantity ?? '')
    setStore(item.store ?? '')
    setConfirmingDelete(false)
    setEditing(true)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!name.trim() || update.isPending) return
    update.mutate({ name: name.trim(), quantity: quantity.trim() || null, store: store.trim() || null })
  }

  return (
    <li className={`task-item shopping-item${item.completed ? ' shopping-purchased' : ''}`}>
      <div className="shopping-item-row">
        <label className="task-check shopping-check">
          <input type="checkbox" checked={item.completed} disabled={busy}
            onChange={event => toggle.mutate(event.target.checked)}
            aria-label={`${item.completed ? 'Przywróć na listę' : 'Oznacz jako kupione'}: ${item.name}`} />
          <span className="shopping-item-copy"><span className="shopping-name">{item.name}</span>{details && <span className="shopping-detail">{details}</span>}</span>
        </label>
        <div className="item-actions">
          <button className="text-button" type="button" disabled={busy} onClick={openEditor} aria-label={`Edytuj: ${item.name}`}>Edytuj</button>
          <button className="text-button item-remove-button" type="button" disabled={busy} onClick={() => { update.reset(); remove.reset(); setEditing(false); setConfirmingDelete(true) }} aria-label={`Usuń: ${item.name}`}>Usuń</button>
        </div>
      </div>
      {editing && <form className="item-edit-form shopping-item-edit" onSubmit={submit} aria-label={`Edytuj produkt: ${item.name}`}>
        <label>Produkt<input required value={name} disabled={update.isPending} onChange={event => setName(event.target.value)} /></label>
        <div className="item-edit-fields shopping-edit-fields">
          <label>Ilość <span className="optional">(opcjonalnie)</span><input value={quantity} disabled={update.isPending} onChange={event => setQuantity(event.target.value)} /></label>
          <label>Sklep <span className="optional">(opcjonalnie)</span><input value={store} disabled={update.isPending} onChange={event => setStore(event.target.value)} /></label>
        </div>
        {update.isError && <p className="error-message" role="alert">Nie udało się zapisać produktu: {update.error.message}</p>}
        <div className="form-actions">
          <button className="primary-button" type="submit" disabled={!name.trim() || update.isPending}>{update.isPending ? 'Zapisuję…' : 'Zapisz'}</button>
          <button className="text-button" type="button" disabled={update.isPending} onClick={() => setEditing(false)}>Anuluj</button>
        </div>
      </form>}
      {confirmingDelete && <div className="item-delete-confirmation" role="group" aria-label={`Potwierdź usunięcie produktu: ${item.name}`}>
        <p>Usunąć „{item.name}” z listy?</p>
        <div className="form-actions">
          <button className="button-quiet" type="button" disabled={remove.isPending} onClick={() => remove.mutate()}>{remove.isPending ? 'Usuwam…' : 'Usuń produkt'}</button>
          <button className="text-button" type="button" disabled={remove.isPending} onClick={() => setConfirmingDelete(false)}>Anuluj</button>
        </div>
        {remove.isError && <p className="error-message" role="alert">Nie udało się usunąć produktu: {remove.error.message}</p>}
      </div>}
      {toggle.isPending && <p className="task-feedback" role="status">Zapisuję…</p>}
      {toggle.isError && <p className="error-message" role="alert">{toggle.error.message} Spróbuj ponownie oznaczyć produkt.</p>}
    </li>
  )
}
