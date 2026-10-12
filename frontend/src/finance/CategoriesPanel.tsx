import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { createFinanceApi, FinanceVersionConflictError } from './api'
import { categorySection, financeSections } from './categories'
import { financeActionError } from './useFinanceAction'
import type { FinanceCategory, FinanceSectionId } from './types'

export function CategoriesPanel({ api, householdId, categories, loading, loadFailed }: {
  api: ReturnType<typeof createFinanceApi>
  householdId: string
  categories: FinanceCategory[]
  loading: boolean
  loadFailed: boolean
}) {
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const [name, setName] = useState('')
  const [sectionId, setSectionId] = useState<FinanceSectionId>(() => financeSections.find(section => section.id === searchParams.get('section'))?.id ?? 'variable_expense')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editedName, setEditedName] = useState('')
  const [status, setStatus] = useState('')
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['financeCategories', householdId] })
  const onError = async (error: Error) => {
    setStatus('')
    if (error instanceof FinanceVersionConflictError) {
      setEditingId(null)
      await refresh()
    }
  }
  const create = useMutation({
    mutationFn: api.createCategory,
    onSuccess: async () => { setName(''); setStatus('Dodano kategorię. Możesz wybrać ją w budżecie i prognozach.'); await refresh() },
    onError,
  })
  const rename = useMutation({
    mutationFn: api.renameCategory,
    onSuccess: async () => { setEditingId(null); setStatus('Zapisano nazwę kategorii.'); await refresh() },
    onError,
  })
  const remove = useMutation({
    mutationFn: api.deleteCategory,
    onSuccess: async () => { setStatus('Usunięto kategorię.'); await refresh() },
    onError,
  })
  const pending = create.isPending || rename.isPending || remove.isPending
  const errors = [create.error, rename.error, remove.error].filter(Boolean)

  function resetMessages() {
    create.reset()
    rename.reset()
    remove.reset()
    setStatus('')
  }

  function submitCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    resetMessages()
    create.mutate({ name, section: sectionId,
      sort_order: categories.reduce((max, category) => Math.max(max, category.sort_order), -1) + 1 })
  }

  return <div className="finance-page-stack">
    {errors.map((error, index) => <p className="error-message" role="alert" key={index}>{financeActionError(error)}</p>)}
    {status && <p className="panel-message" role="status">{status}</p>}
    <section className="panel finance-management-panel">
      <div className="panel-head">
        <div><h2 className="panel-title">Nowa kategoria</h2><p className="panel-kicker">Kategorie są wspólne dla domowników i dostępne we wszystkich miesiącach oraz prognozach.</p></div>
        <Link className="button-quiet" to="/finance/budget">Przejdź do budżetu</Link>
      </div>
      <form className="finance-management-form" onSubmit={submitCategory}>
        <label>Nazwa kategorii
          <input required maxLength={160} value={name} onChange={event => setName(event.target.value)} placeholder="Np. Zakupy spożywcze" disabled={pending} />
        </label>
        <label>Sekcja budżetu
          <select value={sectionId} onChange={event => setSectionId(event.target.value as FinanceSectionId)} disabled={pending}>
            {financeSections.map(section => <option key={section.id} value={section.id}>{section.label}</option>)}
          </select>
        </label>
        <button className="primary-button" type="submit" disabled={pending || loading || loadFailed || !name.trim()}>{create.isPending ? 'Dodaję…' : 'Dodaj kategorię'}</button>
      </form>
    </section>
    {loading && <p className="panel-message" role="status">Ładuję kategorie…</p>}
    {!loading && !loadFailed && categories.length === 0 && <p className="panel-message">Nie masz jeszcze kategorii transakcji. Dodaj pierwszą kategorię, aby tworzyć pozycje budżetu.</p>}
    {financeSections.map(({ id, label }) => {
      const group = categories.filter(category => categorySection(category) === id)
      if (!group.length) return null
      return <section className="panel finance-management-panel" key={id}>
        <div className="panel-head"><h2 className="panel-title">{label}</h2><span className="panel-kicker">{group.length}</span></div>
        {group.map(category => <div key={category.id}>
          {editingId === category.id ? <form className="finance-management-form" onSubmit={event => {
            event.preventDefault()
            resetMessages()
            rename.mutate({ id: category.id, expected_version: category.version, name: editedName })
          }}>
            <label>Nazwa kategorii<input required maxLength={160} value={editedName} onChange={event => setEditedName(event.target.value)} disabled={pending} /></label>
            <p className="panel-kicker">Sekcja budżetu: {label}. Zmiana nazwy będzie widoczna także w dotychczasowych pozycjach.</p>
            <div className="finance-edit-actions">
              <button className="primary-button" type="submit" disabled={pending || !editedName.trim()}>{rename.isPending ? 'Zapisuję…' : 'Zapisz nazwę'}</button>
              <button className="button-quiet" type="button" disabled={pending} onClick={() => setEditingId(null)}>Anuluj</button>
            </div>
          </form> : <div className="finance-management-row finance-category-row">
            <div><strong>{category.name}</strong>{category.parent_id && <p>Podkategoria: {categories.find(parent => parent.id === category.parent_id)?.name ?? 'Kategoria niedostępna'}</p>}</div>
            <div className="finance-edit-actions">
              <button className="button-quiet" type="button" disabled={pending} aria-label={`Edytuj kategorię ${category.name}`} onClick={() => { resetMessages(); setEditedName(category.name); setEditingId(category.id) }}>Edytuj</button>
              <button className="button-quiet" type="button" disabled={pending || categories.some(child => child.parent_id === category.id)} aria-label={`Usuń kategorię ${category.name}`} onClick={() => { resetMessages(); remove.mutate({ id: category.id, expected_version: category.version }) }}>Usuń</button>
            </div>
          </div>}
        </div>)}
        <p className="panel-kicker">Możesz usunąć kategorię, która nie ma podkategorii i nie jest używana w budżecie ani prognozach.</p>
      </section>
    })}
  </div>
}
