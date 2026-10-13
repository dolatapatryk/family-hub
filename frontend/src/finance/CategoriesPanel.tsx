import { useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
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
  const [parentId, setParentId] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editedName, setEditedName] = useState('')
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(() => new Set())
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
    onSuccess: async () => { setName(''); setParentId(''); setStatus('Dodano kategorię. Możesz wybrać ją w budżecie i prognozach.'); await refresh() },
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
    create.mutate({ name, section: sectionId, parent_id: parentId || null })
  }

  const selectedSection = financeSections.find(section => section.id === sectionId)
  const parentCategories = categories.filter(category => category.parent_id === null && categorySection(category) === selectedSection?.id)

  function renderCategory(category: FinanceCategory, childrenByParent: Map<string, FinanceCategory[]>, sectionLabel: string): ReactNode {
    const children = childrenByParent.get(category.id) ?? []
    const hasChildren = children.length > 0
    const isExpanded = expandedCategories.has(category.id)
    const contentId = `finance-category-children-${category.id}`
    const parent = category.parent_id ? categories.find(candidate => candidate.id === category.parent_id) : undefined
    return <div className="finance-category-node" key={category.id}>
      {editingId === category.id ? <form className="finance-management-form" onSubmit={event => {
        event.preventDefault()
        resetMessages()
        rename.mutate({ id: category.id, expected_version: category.version, name: editedName })
      }}>
        <label>Nazwa kategorii<input required maxLength={160} value={editedName} onChange={event => setEditedName(event.target.value)} disabled={pending} /></label>
        <p className="panel-kicker">Sekcja budżetu: {sectionLabel}. Zmiana nazwy będzie widoczna także w dotychczasowych pozycjach.</p>
        <div className="finance-edit-actions">
          <button className="primary-button" type="submit" disabled={pending || !editedName.trim()}>{rename.isPending ? 'Zapisuję…' : 'Zapisz nazwę'}</button>
          <button className="button-quiet" type="button" disabled={pending} onClick={() => setEditingId(null)}>Anuluj</button>
        </div>
      </form> : <div className={`finance-management-row finance-category-row${category.parent_id ? ' is-child' : ''}`}>
        <div className="finance-category-name">
          {hasChildren ? <button className="finance-category-toggle" type="button" aria-expanded={isExpanded} aria-controls={contentId} onClick={() => setExpandedCategories(current => {
            const next = new Set(current)
            if (next.has(category.id)) next.delete(category.id)
            else next.add(category.id)
            return next
          })}>
            <span><strong>{category.name}</strong></span>
            <svg className={isExpanded ? 'finance-budget-chevron is-expanded' : 'finance-budget-chevron'} aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
          </button> : <div><strong>{category.name}</strong>{parent && !childrenByParent.has(parent.id) && <p>Podkategoria: {parent.name}</p>}</div>}
        </div>
        <div className="finance-edit-actions">
          <button className="button-quiet finance-edit-button finance-budget-edit-button" type="button" disabled={pending} aria-label={`Edytuj kategorię ${category.name}`} title={`Edytuj kategorię ${category.name}`} onClick={() => { resetMessages(); setEditedName(category.name); setEditingId(category.id) }}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L8 18l-4 1 1-4Z" /></svg></button>
          <button className="button-quiet finance-edit-button finance-budget-edit-button finance-budget-delete-button" type="button" disabled={pending || categories.some(child => child.parent_id === category.id)} aria-label={`Usuń kategorię ${category.name}`} title={`Usuń kategorię ${category.name}`} onClick={() => { resetMessages(); remove.mutate({ id: category.id, expected_version: category.version }) }}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="m19 6-1 14H6L5 6" /><path d="M10 11v5M14 11v5" /></svg></button>
        </div>
      </div>}
      {hasChildren && <div className="finance-category-children" id={contentId} hidden={!isExpanded}>
        {children.map(child => renderCategory(child, childrenByParent, sectionLabel))}
      </div>}
    </div>
  }

  return <div className="finance-page-stack">
    {errors.map((error, index) => <p className="error-message" role="alert" key={index}>{financeActionError(error)}</p>)}
    {status && <p className="panel-message" role="status">{status}</p>}
    <section className="panel finance-management-panel">
      <div className="panel-head">
        <div><h2 className="panel-title">Nowa kategoria</h2><p className="panel-kicker">Kategorie są wspólne dla domowników i dostępne we wszystkich miesiącach oraz prognozach.</p></div>
      </div>
      <form className="finance-management-form finance-category-create-form" onSubmit={submitCategory}>
        <label>Nazwa kategorii
          <input required maxLength={160} value={name} onChange={event => setName(event.target.value)} placeholder="Np. Zakupy spożywcze" disabled={pending} />
        </label>
        <label>Sekcja budżetu
          <select value={sectionId} onChange={event => { setSectionId(event.target.value as FinanceSectionId); setParentId('') }} disabled={pending}>
            {financeSections.map(section => <option key={section.id} value={section.id}>{section.label}</option>)}
          </select>
        </label>
        <label>Kategoria nadrzędna (opcjonalnie)
          <select value={parentId} onChange={event => setParentId(event.target.value)} disabled={pending || loading || loadFailed}>
            <option value="">Brak — utwórz kategorię nadrzędną</option>
            {parentCategories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
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
      const groupIds = new Set(group.map(category => category.id))
      const childrenByParent = new Map<string, FinanceCategory[]>()
      for (const category of group) {
        if (!category.parent_id || !groupIds.has(category.parent_id)) continue
        const siblings = childrenByParent.get(category.parent_id) ?? []
        siblings.push(category)
        childrenByParent.set(category.parent_id, siblings)
      }
      const roots = group.filter(category => !category.parent_id || !groupIds.has(category.parent_id))
      return <section className="panel finance-management-panel" key={id}>
        <div className="panel-head"><h2 className="panel-title">{label}</h2><span className="panel-kicker">{group.length}</span></div>
        {roots.map(category => renderCategory(category, childrenByParent, label))}
        <p className="panel-kicker">Możesz usunąć kategorię, która nie ma podkategorii i nie jest używana w budżecie ani prognozach.</p>
      </section>
    })}
  </div>
}
