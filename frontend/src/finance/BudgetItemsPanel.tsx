import { useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { FinanceVersionConflictError } from './api'
import { budgetItemDescription, budgetItemTitle, categorySection, financeSections } from './categories'
import { financeMinorUnitsToMoney, formatPln, sumMoney } from './money'
import { financeActionError } from './useFinanceAction'
import type { FinanceCategory, FinanceSectionId } from './types'

interface BudgetItem {
  id: string
  version: number
  category_id: string
  name: string
  amount: string
}

export interface BudgetItemInput {
  category_id: string
  name: string
  amount: string
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
  const category = available.find(candidate => candidate.id === categoryId)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!category || pending) return
    try {
      await onSave({ category_id: category.id, name: description.trim(), amount })
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
    <label>Opis (opcjonalnie)<input maxLength={160} value={description} onChange={event => setDescription(event.target.value)} placeholder="Np. Czynsz" disabled={pending} /></label>
    <div className="finance-edit-actions">
      <button className="primary-button" type="submit" disabled={pending || !category}>{pending ? 'Zapisuję…' : item ? 'Zapisz' : 'Dodaj pozycję'}</button>
      <button className="button-quiet" type="button" onClick={onCancel} disabled={pending}>Anuluj</button>
    </div>
  </form>
}

export function BudgetItemsPanel({ items, categories, pending, unavailable, createError, updateError, showZeroItems = true, onCreate, onUpdate, onResetErrors }: {
  items: BudgetItem[]
  categories: FinanceCategory[]
  pending: boolean
  unavailable: boolean
  createError: unknown
  updateError: unknown
  showZeroItems?: boolean
  onCreate: (input: BudgetItemInput) => Promise<unknown>
  onUpdate: (input: BudgetItemInput & { id: string; expected_version: number }) => Promise<unknown>
  onResetErrors: () => void
}) {
  const [addingSection, setAddingSection] = useState<FinanceSectionId | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingAmount, setEditingAmount] = useState<{ id: string; value: string } | null>(null)
  const savingAmountIds = useRef(new Set<string>())

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
    {[createError, updateError].filter(Boolean).map((error, index) => <p className="error-message" role="alert" key={index}>{financeActionError(error)}</p>)}
    {sections.map(section => {
      const sectionItems = items.filter(item => {
        const category = categories.find(candidate => candidate.id === item.category_id)
        return category ? categorySection(category) === section.id : section.id === 'unavailable'
      })
      const sectionCategories = categories.filter(category => categorySection(category) === section.id)
      return <section className="panel finance-budget-section" key={section.id}>
        <div className="panel-head">
          <h3 className="panel-title">{section.label}</h3>
          <div className="finance-section-actions">
            <strong>{formatPln(sumMoney(sectionItems.map(item => financeMinorUnitsToMoney(item.amount))))}</strong>
            {section.id !== 'unavailable' && <button className="button-quiet" type="button" disabled={pending || unavailable} aria-label={`Dodaj pozycję: ${section.label}`} onClick={() => {
              onResetErrors(); setEditingId(null); setAddingSection(section.id as FinanceSectionId)
            }}>Dodaj pozycję</button>}
          </div>
        </div>
        {addingSection === section.id && (sectionCategories.length ? <ItemForm key={`new:${section.id}`} categories={categories} sectionId={addingSection} pending={pending} onCancel={() => setAddingSection(null)} onSave={async input => {
          await onCreate(input); setAddingSection(null)
        }} /> : <p className="panel-message">Dodaj kategorię dla tej sekcji, aby utworzyć pozycję. <Link to={`/finance/categories?section=${section.id}`}>Dodaj kategorię</Link></p>)}
        {sectionItems.filter(item => showZeroItems || BigInt(item.amount) !== 0n).map(item => {
          const category = categories.find(candidate => candidate.id === item.category_id)
          const title = budgetItemTitle(item.name, category)
          return editingId === item.id ? <ItemForm key={`${item.id}:${item.version}`} item={item} categories={categories} sectionId={category ? categorySection(category) : 'variable_expense'} pending={pending} onCancel={() => setEditingId(null)} onSave={async input => {
            try { await onUpdate({ ...input, id: item.id, expected_version: item.version }); setEditingId(null) }
            catch (error) { if (error instanceof FinanceVersionConflictError) setEditingId(null); throw error }
          }} /> : <div className="finance-item-row finance-budget-item-row" key={item.id}>
            <div className="finance-item-copy"><strong>{title}</strong>{!category && <span>Kategoria niedostępna</span>}</div>
            {editingAmount?.id === item.id ? <input
              className="finance-item-amount finance-budget-amount-input"
              type="text"
              inputMode="decimal"
              aria-label={`Kwota: ${title}`}
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
              aria-label={`Edytuj kwotę: ${title}`}
              title={`Kliknij, aby edytować kwotę: ${title}`}
              disabled={pending || unavailable}
              onClick={() => {
                onResetErrors()
                setEditingAmount({ id: item.id, value: financeMinorUnitsToMoney(item.amount) })
              }}
            >{formatPln(financeMinorUnitsToMoney(item.amount))}</button>}
            <button className="button-quiet finance-edit-button finance-budget-edit-button" type="button" aria-label={`Edytuj: ${title}`} title={`Edytuj: ${title}`} disabled={pending || unavailable} onClick={() => {
              onResetErrors(); setAddingSection(null); setEditingAmount(null); setEditingId(item.id)
            }}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L8 18l-4 1 1-4Z" /></svg></button>
          </div>
        })}
        {!sectionItems.length && <p className="panel-message">Brak pozycji.</p>}
      </section>
    })}
  </div>
}
