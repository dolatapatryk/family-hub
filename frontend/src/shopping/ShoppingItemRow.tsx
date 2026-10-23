import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useToast } from '../components/ToastProvider'
import { dismissMobileDialog, useMobileDialogSwipeDismiss } from '../components/useMobileDialogSwipeDismiss'
import type { createShoppingApi, UpdateShoppingItemInput } from './api'
import { refreshShoppingItems } from './cache'
import type { ShoppingItem } from './shopping'

type ShoppingApi = ReturnType<typeof createShoppingApi>

export function ShoppingItemRow({ item, api, queryKey, showStore = false }: { item: ShoppingItem; api: ShoppingApi; queryKey: readonly unknown[]; showStore?: boolean }) {
  const client = useQueryClient()
  const showToast = useToast()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(item.name)
  const [quantity, setQuantity] = useState(item.quantity ?? '')
  const [store, setStore] = useState(item.store ?? '')
  const dialog = useRef<HTMLDialogElement>(null)
  const editNameInput = useRef<HTMLInputElement>(null)
  const dialogTitleId = useId()
  const update = useMutation({
    mutationFn: (input: UpdateShoppingItemInput) => api.update(item.id, input),
    onSuccess: async saved => {
      dismissDialog()
      showToast({ kind: 'success', title: 'Zapisano produkt', description: saved.name })
      await refreshShoppingItems(client, queryKey, saved)
    },
    onError: (error, input) => showToast({ kind: 'error', title: 'Nie udało się zapisać produktu', description: error.message, action: { label: 'Spróbuj ponownie', onClick: () => update.mutate(input) } }),
  })
  const toggle = useMutation({
    mutationFn: (completed: boolean) => api.setCompleted(item.id, completed),
    onSuccess: saved => {
      showToast({ kind: 'success', title: saved.completed ? 'Odhaczono jako kupione' : 'Przywrócono na listę', description: saved.name })
      return refreshShoppingItems(client, queryKey, saved)
    },
    onError: (error, completed) => showToast({ kind: 'error', title: 'Nie udało się zmienić produktu', description: error.message, action: { label: 'Spróbuj ponownie', onClick: () => toggle.mutate(completed) } }),
  })
  const remove = useMutation({
    mutationFn: () => api.remove(item.id),
    onSuccess: async removedId => {
      showToast({ kind: 'success', title: 'Usunięto produkt', description: item.name })
      await client.cancelQueries({ queryKey })
      client.setQueryData<ShoppingItem[]>(queryKey, current => current?.filter(value => value.id !== removedId))
      await client.invalidateQueries({ queryKey })
    },
    onError: error => showToast({ kind: 'error', title: 'Nie udało się usunąć produktu', description: error.message, action: { label: 'Spróbuj ponownie', onClick: () => remove.mutate() } }),
  })
  const busy = update.isPending || toggle.isPending || remove.isPending
  const details = [item.quantity, showStore ? item.store : null].filter(Boolean).join(' · ')
  const swipeDialogRef = useMobileDialogSwipeDismiss(dialog, () => closeDialog(true), !busy)

  function openEditor() {
    update.reset()
    remove.reset()
    setName(item.name)
    setQuantity(item.quantity ?? '')
    setStore(item.store ?? '')
    setEditing(true)
  }

  function dismissDialog(afterSwipeAnimation = false) {
    if (afterSwipeAnimation) setEditing(false)
    else dismissMobileDialog(dialog.current, () => setEditing(false))
  }

  function closeDialog(afterSwipeAnimation = false) {
    if (!busy) dismissDialog(afterSwipeAnimation)
  }

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (editing) {
      if (!element.open) {
        element.classList.remove('mobile-dialog-dragging', 'mobile-dialog-settling', 'mobile-dialog-dismissing')
        element.style.removeProperty('translate')
        element.showModal()
      }
      if (window.matchMedia('(max-width: 680px)').matches) {
        element.focus({ preventScroll: true })
      } else {
        editNameInput.current?.focus()
      }
    } else if (element.open) {
      element.close()
    }
  }, [editing])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!name.trim() || update.isPending) return
    update.mutate({ name: name.trim(), quantity: quantity.trim() || null, store: store.trim() || null })
  }

  return (
    <li className={`task-item shopping-item${item.completed ? ' shopping-purchased' : ''}`}>
      <div className="shopping-item-row">
        <label className="task-check">
          <input type="checkbox" checked={item.completed} disabled={busy}
            onChange={event => toggle.mutate(event.target.checked)}
            aria-label={`${item.completed ? 'Przywróć na listę' : 'Oznacz jako kupione'}: ${item.name}`} />
        </label>
        <button className="task-open-button shopping-item-open" type="button" disabled={busy} onClick={openEditor} aria-label={`Edytuj produkt: ${item.name}`}>
          <span className="shopping-item-copy"><span className="shopping-name">{item.name}</span>{details && <span className="shopping-detail">{details}</span>}</span>
        </button>
        <div className="item-actions">
          <button className="button-quiet task-action-icon task-action-delete" type="button" disabled={busy} onClick={() => remove.mutate()} aria-label={`Usuń: ${item.name}`} title="Usuń">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="m19 6-1 14H6L5 6" /><path d="M10 11v5M14 11v5" /></svg>
          </button>
        </div>
      </div>
      <dialog ref={swipeDialogRef} className="task-dialog shopping-edit-dialog" tabIndex={-1} aria-labelledby={dialogTitleId}
        onCancel={event => { event.preventDefault(); closeDialog() }}
        onClick={event => { if (event.target === event.currentTarget) closeDialog() }}>
        {editing && <form className="task-dialog-form task-form shopping-edit-dialog-form" onSubmit={submit}>
          <div className="task-dialog-header">
            <div>
              <h2 className="panel-title" id={dialogTitleId}>Edytuj produkt</h2>
              <p className="panel-kicker">Zmień nazwę, ilość lub sklep.</p>
            </div>
            <button className="button-quiet task-dialog-close" type="button" aria-label="Zamknij okno" disabled={busy} onClick={() => closeDialog()}>×</button>
          </div>
          <fieldset disabled={update.isPending}>
            <label>Produkt<input ref={editNameInput} required value={name} onChange={event => setName(event.target.value)} /></label>
            <div className="task-form-options shopping-edit-fields">
              <label>Ilość <span className="optional">(opcjonalnie)</span><input value={quantity} onChange={event => setQuantity(event.target.value)} /></label>
              <label>Sklep <span className="optional">(opcjonalnie)</span><input value={store} onChange={event => setStore(event.target.value)} /></label>
            </div>
          </fieldset>
          <div className="task-dialog-actions">
            <button className="primary-button" type="submit" disabled={!name.trim() || update.isPending}>{update.isPending ? 'Zapisuję…' : 'Zapisz'}</button>
            <button className="button-quiet" type="button" disabled={busy} onClick={() => closeDialog()}>Anuluj</button>
          </div>
        </form>}
      </dialog>
      {toggle.isPending && <p className="task-feedback" role="status">Zapisuję…</p>}
    </li>
  )
}
