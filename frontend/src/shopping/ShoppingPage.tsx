import { useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { members } from '../tasks/tasks'
import { createShoppingApi } from './api'
import type { ShoppingItem } from './shopping'

const userId = import.meta.env.VITE_USER_ID || members[0].id
const api = createShoppingApi(import.meta.env.VITE_API_URL || '/api', userId)
const queryKey = ['shoppingItems', userId]

async function refreshItems(client: QueryClient, saved: ShoppingItem) {
  await client.cancelQueries({ queryKey })
  // Keep a successful write visible even if the subsequent refresh fails.
  client.setQueryData<ShoppingItem[]>(queryKey, items => items
    ? [...items.filter(item => item.id !== saved.id), saved]
    : undefined)
  await client.invalidateQueries({ queryKey })
}

function ShoppingItemRow({ item }: { item: ShoppingItem }) {
  const client = useQueryClient()
  const update = useMutation({
    mutationFn: (completed: boolean) => api.setCompleted(item.id, completed),
    onSuccess: saved => refreshItems(client, saved),
  })

  return (
    <li className={`task-item${item.completed ? ' shopping-purchased' : ''}`}>
      <label className="task-check shopping-check">
        <input type="checkbox" checked={item.completed} disabled={update.isPending}
          onChange={event => update.mutate(event.target.checked)}
          aria-label={`${item.completed ? 'Mark as needed' : 'Mark as purchased'}: ${item.name}`} />
        <span className="shopping-name">{item.name}</span>
        {item.quantity && <span className="shopping-quantity">{item.quantity}</span>}
      </label>
      {update.isPending && <p className="task-feedback" role="status">Saving…</p>}
      {update.isError && <p className="error-message" role="alert">{update.error.message} Try checking the item again.</p>}
    </li>
  )
}

export function ShoppingPage() {
  const client = useQueryClient()
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState('')
  const [notice, setNotice] = useState('')
  const nameInput = useRef<HTMLInputElement>(null)
  const items = useQuery({ queryKey, queryFn: ({ signal }) => api.list(signal) })
  const create = useMutation({
    mutationFn: (input: { name: string; quantity: string | null }) => api.create(input),
    onSuccess: async saved => {
      setName('')
      setQuantity('')
      setNotice(`${saved.name} added.`)
      nameInput.current?.focus()
      await refreshItems(client, saved)
    },
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!name.trim() || create.isPending) return
    setNotice('')
    create.mutate({ name: name.trim(), quantity: quantity.trim() || null })
  }

  const sorted = [...(items.data ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  const active = sorted.filter(item => !item.completed)
  const purchased = sorted.filter(item => item.completed)

  return (
    <>
      <p className="eyebrow">Shopping</p>
      <h1>The next grocery run, sorted.</h1>
      <p className="intro">One shopping list for the whole family.</p>
      <form className="card shopping-form" onSubmit={submit} aria-label="Add a shopping item">
        <div className="shopping-form-fields">
          <label className="shopping-name-field" htmlFor="shopping-name">Item
            <input id="shopping-name" ref={nameInput} required value={name} readOnly={create.isPending}
              onChange={event => setName(event.target.value)} placeholder="Add item…" autoComplete="off" />
          </label>
          <label className="shopping-quantity-field" htmlFor="shopping-quantity">Quantity <span className="optional">(optional)</span>
            <input id="shopping-quantity" value={quantity} readOnly={create.isPending}
              onChange={event => setQuantity(event.target.value)} placeholder="e.g. 2 or 1 kg" autoComplete="off" />
          </label>
          <button className="button-primary shopping-add" type="submit" disabled={!name.trim() || create.isPending}
            aria-label={create.isPending ? 'Adding item' : 'Add item'}>{create.isPending ? 'Adding…' : '+ Add'}</button>
        </div>
        <p className="task-meta">Adding as {members.find(member => member.id === userId)?.name ?? 'configured user'}</p>
        {create.isError && <div className="error-message" role="alert">{create.error.message}</div>}
      </form>
      <p className="shopping-notice" role="status">{notice}</p>
      {items.isPending && <p role="status">Loading shopping list…</p>}
      {items.isError && <div className="error-message" role="alert">
        <p>{items.error.message}</p>
        {items.data && <p>The list below may be out of date.</p>}
        <button className="button-quiet" disabled={items.isFetching} onClick={() => void items.refetch()}>
          {items.isFetching ? 'Retrying…' : 'Try again'}
        </button>
      </div>}
      {items.data && <div className="task-sections">
        <section className="task-section" aria-labelledby="shopping-needed-heading">
          <h2 id="shopping-needed-heading">To buy<span className="task-count">{active.length}</span></h2>
          {active.length > 0
            ? <ul className="task-list">{active.map(item => <ShoppingItemRow key={item.id} item={item} />)}</ul>
            : <div className="card"><h2>{purchased.length ? 'All stocked up.' : 'Start your shopping list.'}</h2>
              <p>{purchased.length ? 'Everything is checked off. Add anything else you need above.' : 'Add your first item above. Include a quantity if you need one.'}</p>
            </div>}
        </section>
        {purchased.length > 0 && <section className="task-section" aria-labelledby="shopping-purchased-heading">
          <h2 id="shopping-purchased-heading">Purchased<span className="task-count">{purchased.length}</span></h2>
          <ul className="task-list">{purchased.map(item => <ShoppingItemRow key={item.id} item={item} />)}</ul>
        </section>}
      </div>}
    </>
  )
}
