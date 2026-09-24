import { useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthGate'
import { PageHeader } from '../components/PageHeader'
import { createShoppingApi } from './api'
import { refreshShoppingItems } from './cache'
import { ShoppingItemRow } from './ShoppingItemRow'
import type { ShoppingItem } from './shopping'

function storeGroups(items: ShoppingItem[]) {
  const groups = new Map<string, { key: string; label: string; items: ShoppingItem[] }>()
  for (const item of items) {
    const value = item.store?.trim() || ''
    const label = value || 'Bez sklepu'
    const key = value.toLocaleLowerCase('pl-PL')
    const group = groups.get(key)
    if (group) group.items.push(item)
    else groups.set(key, { key, label, items: [item] })
  }
  return [...groups.values()].sort((a, b) => {
    if (!a.key) return 1
    if (!b.key) return -1
    return a.label.localeCompare(b.label, 'pl-PL', { sensitivity: 'base' })
  })
}

function ShoppingGroupList({ items, api, queryKey, emptyTitle, emptyMessage }: {
  items: ShoppingItem[]
  api: ReturnType<typeof createShoppingApi>
  queryKey: readonly unknown[]
  emptyTitle: string
  emptyMessage: string
}) {
  if (items.length === 0) {
    return <div className="panel empty-panel"><h3>{emptyTitle}</h3><p>{emptyMessage}</p></div>
  }

  return <div className="shopping-store-groups">
    {storeGroups(items).map(group => <section className="shopping-store-group" key={group.key || 'no-store'} aria-label={group.label}>
      <h3>{group.label}<span className="task-count">{group.items.length}</span></h3>
      <ul className="task-list">{group.items.map(item => <ShoppingItemRow key={item.id} item={item} api={api} queryKey={queryKey} />)}</ul>
    </section>)}
  </div>
}

export function ShoppingPage() {
  const { profile } = useAuth()
  const client = useQueryClient()
  const api = createShoppingApi(profile.household_id, profile.id)
  const queryKey = ['shoppingItems', profile.household_id]
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState('')
  const [store, setStore] = useState('')
  const [notice, setNotice] = useState('')
  const nameInput = useRef<HTMLInputElement>(null)
  const items = useQuery({ queryKey, queryFn: ({ signal }) => api.list(signal) })
  const create = useMutation({
    mutationFn: (input: { name: string; quantity: string | null; store?: string | null }) => api.create(input),
    onSuccess: async saved => {
      setName('')
      setQuantity('')
      setStore('')
      setNotice(`${saved.name} dodano do listy.`)
      nameInput.current?.focus()
      await refreshShoppingItems(client, queryKey, saved)
    },
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!name.trim() || create.isPending) return
    setNotice('')
    create.mutate({ name: name.trim(), quantity: quantity.trim() || null, store: store.trim() || null })
  }

  const sorted = [...(items.data ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  const active = sorted.filter(item => !item.completed)
  const purchased = sorted.filter(item => item.completed)

  return (
    <>
      <PageHeader eyebrow="Wspólny plan" title="Lista zakupów" description="Dopisz, czego brakuje, i odhaczaj po drodze." />
      <form className="panel shopping-form" onSubmit={submit} aria-label="Dodaj produkt do listy zakupów">
        <div className="panel-head"><div><h2 className="panel-title">Dodaj produkt</h2><p className="panel-kicker">Lista dla całego domu</p></div><span className="shopping-count">{items.data ? `${active.length} do kupienia` : '—'}</span></div>
        <div className="shopping-form-fields">
          <label className="shopping-name-field" htmlFor="shopping-name">Produkt
            <input id="shopping-name" ref={nameInput} required value={name} readOnly={create.isPending} onChange={event => setName(event.target.value)} placeholder="Dodaj produkt…" autoComplete="off" />
          </label>
          <label className="shopping-quantity-field" htmlFor="shopping-quantity">Ilość <span className="optional">(opcjonalnie)</span>
            <input id="shopping-quantity" value={quantity} readOnly={create.isPending} onChange={event => setQuantity(event.target.value)} placeholder="np. 2 szt. lub 1 kg" autoComplete="off" />
          </label>
          <label className="shopping-store-field" htmlFor="shopping-store">Sklep <span className="optional">(opcjonalnie)</span>
            <input id="shopping-store" value={store} readOnly={create.isPending} onChange={event => setStore(event.target.value)} placeholder="np. Lidl" autoComplete="off" />
          </label>
          <button className="primary-button shopping-add" type="submit" disabled={!name.trim() || create.isPending}>{create.isPending ? 'Dodaję…' : '+ Dodaj'}</button>
        </div>
        <div className="shopping-form-foot"><p className="task-meta">Dodajesz jako <strong>{profile.name}</strong></p>{create.isError && <p className="error-message" role="alert">{create.error.message}</p>}</div>
      </form>
      <p className="shopping-notice" role="status">{notice}</p>
      {items.isPending && <p className="panel-message" role="status">Ładuję listę zakupów…</p>}
      {items.isError && <div className="error-message" role="alert">
        <p>{items.error.message}</p>
        {items.data && <p>Lista poniżej może być nieaktualna.</p>}
        <button className="button-quiet" disabled={items.isFetching} onClick={() => void items.refetch()}>{items.isFetching ? 'Ponawiam…' : 'Spróbuj ponownie'}</button>
      </div>}
      {items.data && <div className="task-sections shopping-sections">
        <section className="task-section" aria-labelledby="shopping-needed-heading">
          <h2 id="shopping-needed-heading">Do kupienia<span className="task-count">{active.length}</span></h2>
          <ShoppingGroupList items={active} api={api} queryKey={queryKey} emptyTitle={purchased.length ? 'Wszystko na miejscu.' : 'Zacznij swoją listę.'} emptyMessage={purchased.length ? 'Wszystkie produkty są odhaczone. Dodaj coś nowego powyżej.' : 'Dodaj pierwszy produkt powyżej. W razie potrzeby podaj ilość lub sklep.'} />
        </section>
        {purchased.length > 0 && <section className="task-section" aria-labelledby="shopping-purchased-heading">
          <h2 id="shopping-purchased-heading">Kupione<span className="task-count">{purchased.length}</span></h2>
          <ShoppingGroupList items={purchased} api={api} queryKey={queryKey} emptyTitle="Brak kupionych produktów." emptyMessage="Odhaczone produkty pojawią się tutaj." />
        </section>}
      </div>}
    </>
  )
}
