import { useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { FinanceVersionConflictError } from './api'
import { budgetItemDescription, categorySection, financeSections } from './categories'
import { financeMinorUnitsToMoney, formatPln, sumMoney } from './money'
import { financeActionError } from './useFinanceAction'
import type { FinanceCategory, FinanceSectionId } from './types'

interface BudgetItem {
  id: string
  version: number
  category_id: string
  name: string
  amount: string
  is_recurring: boolean
}

export interface BudgetItemInput {
  category_id: string
  name: string
  amount: string
  is_recurring: boolean
}

function ItemForm({ item, categories, sectionId, pending, onSave, onCancel }: {
  item?: BudgetItem
  categories: FinanceCategory[]
  sectionId: FinanceSectionId
  pending: boolean
  onSave: (input: BudgetItemInput) => Promise<unknown>
  onCancel: () => void
}) {
  const available = item ? categories : categories.filter(category => categorySection(category) === sectionId)
  const [categoryId, setCategoryId] = useState(item?.category_id ?? available[0]?.id ?? '')
  const [amount, setAmount] = useState(item ? financeMinorUnitsToMoney(item.amount) : '')
  const [description, setDescription] = useState(item ? budgetItemDescription(item.name, categories.find(category => category.id === item.category_id)) : '')
  const [isRecurring, setIsRecurring] = useState(item?.is_recurring ?? false)
  const category = available.find(candidate => candidate.id === categoryId)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!category || pending) return
    try {
      await onSave({ category_id: category.id, name: description.trim(), amount, is_recurring: isRecurring })
    } catch {
      // Mutation errors are displayed by the containing panel; retain form input.
    }
  }

  return <form className="finance-item-edit-form finance-budget-item-form" onSubmit={submit}>
    <label>Kategoria
      <select required value={categoryId} onChange={event => setCategoryId(event.target.value)} disabled={pending}>
        <option value="" disabled>Wybierz kategorię</option>
        {item ? financeSections.map(section => <optgroup label={section.label} key={section.id}>
          {available.filter(candidate => categorySection(candidate) === section.id).map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
        </optgroup>) : available.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
      </select>
    </label>
    <label>Kwota<input required inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="0,00" disabled={pending} /></label>
    <label className="finance-checkbox-label finance-budget-recurring"><input type="checkbox" checked={isRecurring} onChange={event => setIsRecurring(event.target.checked)} disabled={pending} /> Powtarzalna</label>
    <label>Opis (opcjonalnie)<input maxLength={160} value={description} onChange={event => setDescription(event.target.value)} placeholder="Np. Czynsz" disabled={pending} /></label>
    <div className="finance-edit-actions">
      <button className="primary-button" type="submit" disabled={pending || !category}>{pending ? 'Zapisuję…' : item ? 'Zapisz' : 'Dodaj pozycję'}</button>
      <button className="button-quiet" type="button" onClick={onCancel} disabled={pending}>Anuluj</button>
    </div>
  </form>
}

export function BudgetItemsPanel({ items, categories, pending, unavailable, createError, updateError, deleteError, showZeroItems = true, onCreate, onUpdate, onDelete, onResetErrors }: {
  items: BudgetItem[]
  categories: FinanceCategory[]
  pending: boolean
  unavailable: boolean
  createError: unknown
  updateError: unknown
  deleteError?: unknown
  showZeroItems?: boolean
  onCreate: (input: BudgetItemInput) => Promise<unknown>
  onUpdate: (input: Partial<BudgetItemInput> & Pick<BudgetItemInput, 'category_id' | 'name' | 'amount'> & { id: string; expected_version: number }) => Promise<unknown>
  onDelete?: (input: { id: string; expected_version: number }) => Promise<unknown>
  onResetErrors: () => void
}) {
  const [addingSection, setAddingSection] = useState<FinanceSectionId | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingAmount, setEditingAmount] = useState<{ id: string; value: string } | null>(null)
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => new Set())
  const savingAmountIds = useRef(new Set<string>())

  async function updateRecurring(item: BudgetItem, isRecurring: boolean) {
    if (pending || item.is_recurring === isRecurring) return
    onResetErrors()
    try {
      await onUpdate({
        id: item.id,
        expected_version: item.version,
        category_id: item.category_id,
        name: item.name,
        amount: financeMinorUnitsToMoney(item.amount),
        is_recurring: isRecurring,
      })
    } catch {
      // Mutation errors are displayed by the containing panel.
    }
  }

  async function deleteItem(item: BudgetItem) {
    if (pending || !onDelete) return
    onResetErrors()
    try {
      await onDelete({ id: item.id, expected_version: item.version })
    } catch {
      // Mutation errors are displayed by the containing panel.
    }
  }

  async function saveAmount(item: BudgetItem, amount: string) {
    if (savingAmountIds.current.has(item.id) || pending) return
    const currentAmount = financeMinorUnitsToMoney(item.amount)
    if (amount.trim() === currentAmount) {
      setEditingAmount(current => current?.id === item.id ? null : current)
      return
    }

    savingAmountIds.current.add(item.id)
    onResetErrors()
    try {
      await onUpdate({
        id: item.id,
        expected_version: item.version,
        category_id: item.category_id,
        name: item.name,
        amount,
      })
      setEditingAmount(current => current?.id === item.id ? null : current)
    } catch (error) {
      if (error instanceof FinanceVersionConflictError) {
        setEditingAmount(current => current?.id === item.id ? null : current)
      }
    } finally {
      savingAmountIds.current.delete(item.id)
    }
  }

  const sections = [
    ...financeSections,
    ...(items.some(item => !categories.some(category => category.id === item.category_id)) ? [{ id: 'unavailable' as const, label: 'Kategoria niedostępna' }] : []),
  ]
  return <div className="finance-budget-grid">
    {[createError, updateError, deleteError].filter(Boolean).map((error, index) => <p className="error-message" role="alert" key={index}>{financeActionError(error)}</p>)}
    {sections.map(section => {
      const sectionItems = items.filter(item => {
        const category = categories.find(candidate => candidate.id === item.category_id)
        return category ? categorySection(category) === section.id : section.id === 'unavailable'
      })
      const visibleItems = sectionItems.filter(item => showZeroItems || BigInt(item.amount) !== 0n)
      const sectionCategories = categories.filter(category => categorySection(category) === section.id)
      const isExpanded = !collapsedSections.has(section.id)
      const sectionTotal = formatPln(sumMoney(sectionItems.map(item => financeMinorUnitsToMoney(item.amount))))
      const contentId = `finance-budget-section-${section.id}`
      return <section className="panel finance-budget-section" key={section.id}>
        <div className="finance-budget-section-head">
          <button className="finance-budget-section-toggle" type="button" aria-expanded={isExpanded} aria-controls={contentId} onClick={() => setCollapsedSections(current => {
            const next = new Set(current)
            if (next.has(section.id)) next.delete(section.id)
            else next.add(section.id)
            return next
          })}>
            <span className="panel-title">{section.label}</span>
            <strong>{sectionTotal}</strong>
            <svg className={isExpanded ? 'finance-budget-chevron is-expanded' : 'finance-budget-chevron'} aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
          </button>
          {section.id !== 'unavailable' && <button className="finance-budget-add-button" type="button" disabled={pending || unavailable} aria-label={`Dodaj pozycję: ${section.label}`} title={`Dodaj pozycję: ${section.label}`} onClick={() => {
            onResetErrors()
            setCollapsedSections(current => { const next = new Set(current); next.delete(section.id); return next })
            setEditingId(null)
            setAddingSection(section.id as FinanceSectionId)
          }}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg></button>}
        </div>
        <div className="finance-budget-section-content" id={contentId} hidden={!isExpanded}>
        {addingSection === section.id && (sectionCategories.length ? <ItemForm key={`new:${section.id}`} categories={categories} sectionId={addingSection} pending={pending} onCancel={() => setAddingSection(null)} onSave={async input => {
          await onCreate(input); setAddingSection(null)
        }} /> : <p className="panel-message">Dodaj kategorię dla tej sekcji, aby utworzyć pozycję. <Link to={`/finance/categories?section=${section.id}`}>Dodaj kategorię</Link></p>)}
        {visibleItems.map(item => {
          const category = categories.find(candidate => candidate.id === item.category_id)
          const title = category?.name ?? 'Kategoria niedostępna'
          const description = budgetItemDescription(item.name, category)
          const itemLabel = description ? `${title} — ${description}` : title
          return editingId === item.id ? <ItemForm key={`${item.id}:${item.version}`} item={item} categories={categories} sectionId={category ? categorySection(category) : 'variable_expense'} pending={pending} onCancel={() => setEditingId(null)} onSave={async input => {
            try { await onUpdate({ ...input, id: item.id, expected_version: item.version }); setEditingId(null) }
            catch (error) { if (error instanceof FinanceVersionConflictError) setEditingId(null); throw error }
          }} /> : <div className="finance-item-row finance-budget-item-row" key={item.id}>
            <div className="finance-item-copy"><strong>{title}</strong>{description && <span>{description}</span>}</div>
            {editingAmount?.id === item.id ? <input
              className="finance-item-amount finance-budget-amount-input"
              type="text"
              inputMode="decimal"
              aria-label={`Kwota: ${itemLabel}`}
              autoFocus
              value={editingAmount.value}
              disabled={pending || unavailable}
              onChange={event => setEditingAmount({ id: item.id, value: event.currentTarget.value })}
              onFocus={event => event.currentTarget.select()}
              onBlur={() => void saveAmount(item, editingAmount.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void saveAmount(item, editingAmount.value)
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  setEditingAmount(null)
                }
              }}
            /> : <button
              className="finance-item-amount finance-budget-amount-button"
              type="button"
              aria-label={`Edytuj kwotę: ${itemLabel}`}
              title={`Kliknij, aby edytować kwotę: ${itemLabel}`}
              disabled={pending || unavailable}
              onClick={() => {
                onResetErrors()
                setEditingAmount({ id: item.id, value: financeMinorUnitsToMoney(item.amount) })
              }}
            >{formatPln(financeMinorUnitsToMoney(item.amount))}</button>}
            <label className="finance-checkbox-label finance-budget-recurring" title="Powtarzalna"><input type="checkbox" aria-label={`Powtarzalna: ${itemLabel}`} checked={item.is_recurring} onChange={event => void updateRecurring(item, event.target.checked)} disabled={pending || unavailable} /> <span className="finance-budget-recurring-full">Powtarzalna</span><span className="finance-budget-recurring-short" aria-hidden="true">Powt.</span></label>
            <button className="button-quiet finance-edit-button finance-budget-edit-button" type="button" aria-label={`Edytuj: ${itemLabel}`} title={`Edytuj: ${itemLabel}`} disabled={pending || unavailable} onClick={() => {
              onResetErrors(); setAddingSection(null); setEditingAmount(null); setEditingId(item.id)
            }}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L8 18l-4 1 1-4Z" /></svg></button>
            {onDelete && <button className="button-quiet finance-edit-button finance-budget-edit-button finance-budget-delete-button" type="button" aria-label={`Usuń pozycję: ${itemLabel}`} title={`Usuń pozycję: ${itemLabel}`} disabled={pending || unavailable} onClick={() => void deleteItem(item)}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="m19 6-1 14H6L5 6" /><path d="M10 11v5M14 11v5" /></svg></button>}
          </div>
        })}
        {!visibleItems.length && <p className="panel-message">Brak pozycji.</p>}
        </div>
      </section>
    })}
  </div>
}
