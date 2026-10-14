import { useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { FinanceCategory } from '../types'
import { formatMoneyDecimal, formatPln, parseMoney } from '../money'
import type { createFinanceTransactionsApi } from './api'
import type { FinanceTransaction, FinanceWalletWithBalance } from './types'
import { FieldError, TransactionDialog } from './Dialog'
import { compatibleCategory, draftKind, initialDraft, sameWalletAudience, switchTab, transactionInput, validateDraft, walletEffect, type EntryTab } from './form'
import { todayDate } from './filters'
import { useOnline, useTransactionAction } from './useTransactionAction'

export function TransactionForm({ api, queryKey, wallets, categories, month, userId, entry, saving, onClose, onSaved }: {
  api: ReturnType<typeof createFinanceTransactionsApi>; queryKey: string[]; wallets: FinanceWalletWithBalance[]
  categories: FinanceCategory[]; month: string; userId: string; entry?: FinanceTransaction; saving?: boolean
  onClose: () => void; onSaved: () => void
}) {
  const today = todayDate()
  const preferenceKey = `family-hub:transactions:wallet:${userId}`
  const [initial] = useState(() => {
    let preferred = ''
    try { preferred = localStorage.getItem(preferenceKey) ?? '' } catch { /* Storage is optional. */ }
    const active = wallets.filter(wallet => !wallet.is_archived)
    return initialDraft(today, month, active.find(wallet => wallet.id === preferred)?.id ?? active[0]?.id ?? '', entry, saving)
  })
  const [draft, setDraft] = useState(initial)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [categorySearch, setCategorySearch] = useState('')
  const form = useRef<HTMLFormElement>(null)
  const action = useTransactionAction(queryKey)
  const online = useOnline()
  const disabled = action.busy || action.conflict
  const kind = draftKind(draft)
  const sourceNeeded = draft.tab === 'transfer' || (draft.tab === 'expense' && !draft.refund)
  const destinationNeeded = !sourceNeeded || draft.tab === 'transfer'
  const activeWallets = wallets.filter(wallet => !wallet.is_archived)
  const source = activeWallets.find(wallet => wallet.id === draft.source)
  const destinations = draft.tab === 'transfer' ? activeWallets.filter(wallet => source && sameWalletAudience(source, wallet)) : activeWallets
  const compatible = categories.filter(category => compatibleCategory(category, draft.tab, draft.contribution))
  const categoryName = (category: FinanceCategory) => {
    const parent = categories.find(item => item.id === category.parent_id)
    return parent ? `${parent.name} → ${category.name}` : category.name
  }
  const filteredCategories = compatible.filter(category => category.id === draft.category || categoryName(category).toLocaleLowerCase('pl-PL').includes(categorySearch.toLocaleLowerCase('pl-PL')))
  let amount = 0n
  try { amount = parseMoney(draft.amount) } catch { /* No preview for invalid input. */ }
  const validAmount = amount > 0n
  const monthlyEffect = kind === 'income' || kind === 'refund' ? amount : kind === 'expense' ? -amount : 0n
  function update(values: Partial<typeof draft>) { setDraft(current => ({ ...current, ...values })); setErrors({}) }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (disabled) return
    const validation = validateDraft(draft, wallets, categories, today, !entry && month !== today.slice(0, 7) ? month : undefined)
    setErrors(validation)
    if (Object.keys(validation).length) {
      requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    await action.run(draft, requestId => api.saveTransaction(transactionInput(draft, requestId, entry)), () => {
      try { localStorage.setItem(preferenceKey, sourceNeeded ? draft.source : draft.destination) } catch { /* Optional preference. */ }
      onSaved()
    })
  }
  const errorProps = (field: string) => ({ 'aria-invalid': Boolean(errors[field]), 'aria-describedby': errors[field] ? `transaction-${field}-error` : undefined })
  const submitLabel = entry ? 'Zapisz zmiany' : kind.includes('refund') ? 'Dodaj zwrot' : draft.tab === 'transfer' ? 'Dodaj przelew' : draft.tab === 'income' ? 'Dodaj przychód' : 'Dodaj wydatek'
  return <TransactionDialog title={entry ? 'Edytuj transakcję' : 'Dodaj transakcję'} busy={action.busy} dirty={JSON.stringify(draft) !== JSON.stringify(initial)} onClose={onClose}>
    <form ref={form} noValidate onSubmit={event => void submit(event)}>
      <div className="transaction-dialog-body">
        <div className="transaction-tabs" role="group" aria-label="Rodzaj transakcji">
          {([['expense', 'Wydatek'], ['income', 'Przychód'], ['transfer', 'Przelew']] as const).map(([tab, label]) => <button key={tab} type="button" aria-pressed={draft.tab === tab} disabled={disabled} onClick={() => { setDraft(switchTab(draft, tab as EntryTab, categories)); setErrors({}); setCategorySearch('') }}>{label}</button>)}
        </div>
        <label>Kwota (PLN)<input autoFocus inputMode="decimal" className="transaction-amount-input" value={draft.amount} onChange={event => update({ amount: event.target.value })} disabled={disabled} {...errorProps('amount')} /><FieldError message={errors.amount} id="transaction-amount-error" /></label>
        {draft.tab === 'expense' && <>
          <fieldset disabled={disabled}><legend>{draft.refund ? 'Finansowanie pierwotnego wydatku' : 'Finansowanie'}</legend>
            <label><input type="radio" name="funding" checked={!draft.savings} onChange={() => update({ savings: false })} /> Bieżące</label>
            <label><input type="radio" name="funding" checked={draft.savings} onChange={() => update({ savings: true })} /> Z oszczędności</label>
          </fieldset>
          {draft.savings && <p className="panel-kicker">{draft.refund ? 'Przywraca środki w portfelu i zmniejsza wykorzystanie oszczędności. Nie zwiększa bilansu miesiąca.' : 'Zmniejsza saldo portfela, nie pomniejsza bilansu miesiąca. Zakup finansowany częściowo z oszczędności wprowadź jako dwie transakcje.'}</p>}
          <label className="transaction-checkbox"><input type="checkbox" checked={draft.refund} disabled={disabled} onChange={event => update({ refund: event.target.checked, ...(event.target.checked ? { destination: draft.source } : { source: draft.destination }) })} /> To zwrot wydatku</label>
        </>}
        <div className="transaction-fields">
          {sourceNeeded && <label>Z portfela<select value={draft.source} disabled={disabled} {...errorProps('source')} onChange={event => {
            const wallet = activeWallets.find(item => item.id === event.target.value)
            const destination = activeWallets.find(item => item.id === draft.destination)
            update({ source: event.target.value, ...(draft.tab === 'transfer' && (!wallet || !destination || !sameWalletAudience(wallet, destination)) ? { destination: '' } : {}) })
          }}><option value="">Wybierz portfel</option>{activeWallets.map(wallet => <option key={wallet.id} value={wallet.id}>{wallet.name}</option>)}</select><FieldError message={errors.source} id="transaction-source-error" /></label>}
          {destinationNeeded && <label>Do portfela<select value={draft.destination} disabled={disabled} {...errorProps('destination')} onChange={event => update({ destination: event.target.value })}><option value="">Wybierz portfel</option>{destinations.map(wallet => <option key={wallet.id} value={wallet.id}>{wallet.name}</option>)}</select><FieldError message={errors.destination} id="transaction-destination-error" /></label>}
          <label>Data<input type="date" max={today} value={draft.date} disabled={disabled} {...errorProps('date')} onChange={event => update({ date: event.target.value })} /><FieldError message={errors.date} id="transaction-date-error" /></label>
        </div>
        {!entry && month !== today.slice(0, 7) && <p className="panel-kicker">Wprowadzasz transakcję w miesiącu {month}. Wybierz datę w tym miesiącu.</p>}
        {draft.tab === 'transfer' && <fieldset disabled={disabled}><legend>Znaczenie przelewu</legend>
          <label><input type="radio" name="effect" checked={!draft.contribution} onChange={() => update({ contribution: false, effectExplicit: true })} /> Przenoszę pieniądze</label>
          <p className="panel-kicker">Także przelew już odłożonych oszczędności. Portfele muszą mieć tę samą widoczność; prywatne — tego samego właściciela.</p>
          <label><input type="radio" name="effect" checked={draft.contribution} onChange={() => update({ contribution: true, effectExplicit: true, category: categories.some(category => category.id === draft.category && compatibleCategory(category, 'transfer', true)) ? draft.category : '' })} /> Odkładam nowe oszczędności</label>
        </fieldset>}
        <label>Szukaj kategorii<input type="search" value={categorySearch} disabled={disabled} onChange={event => setCategorySearch(event.target.value)} /></label>
        <label>Kategoria{draft.tab === 'transfer' && !draft.contribution ? ' (opcjonalnie)' : ''}<select value={draft.category} disabled={disabled} {...errorProps('category')} onChange={event => {
          const category = categories.find(item => item.id === event.target.value)
          update({ category: event.target.value, ...(draft.tab === 'transfer' && !draft.effectExplicit ? { contribution: category?.budget_type === 'saving' && category.allocation_role === 'standard' } : {}) })
        }}><option value="">{draft.tab === 'transfer' && !draft.contribution ? 'Bez kategorii' : 'Wybierz kategorię'}</option>{filteredCategories.map(category => <option key={category.id} value={category.id}>{categoryName(category)}</option>)}</select><FieldError message={errors.category} id="transaction-category-error" /></label>
        {compatible.length === 0 && <p role="status">Brak odpowiednich kategorii. Dodaj je w <Link to="/finance/categories" onClick={event => { if (!window.confirm('Opuścić formularz i przejść do kategorii?')) event.preventDefault() }}>Kategoriach transakcji</Link>.</p>}
        {draft.contribution && <p className="panel-kicker">Odłożona kwota jest aktywnością miesiąca. Cele oszczędnościowe są prowadzone niezależnie.</p>}
        <label>Opis (opcjonalnie)<textarea maxLength={2000} value={draft.description} disabled={disabled} {...errorProps('description')} onChange={event => update({ description: event.target.value })} /><FieldError message={errors.description} id="transaction-description-error" /></label>
        {validAmount && <aside className="transaction-preview" aria-label="Podgląd wpływu transakcji" aria-live="polite">
          <p>Wpływ transakcji na bilans miesiąca {draft.date.slice(0, 7)}: <strong>{formatPln(formatMoneyDecimal(monthlyEffect))}</strong></p>
          {draft.tab === 'transfer' && <p>Odłożono: {formatPln(formatMoneyDecimal(draft.contribution ? amount : 0n))}</p>}
          {draft.savings && draft.tab === 'expense' && <p>Wydatki z oszczędności: {formatPln(formatMoneyDecimal(draft.refund ? -amount : amount))}</p>}
          {wallets.filter(wallet => (sourceNeeded && wallet.id === draft.source) || (destinationNeeded && wallet.id === draft.destination) || wallet.id === entry?.source_wallet_id || wallet.id === entry?.destination_wallet_id).map(wallet => {
            const effect = (destinationNeeded && wallet.id === draft.destination ? amount : 0n) - (sourceNeeded && wallet.id === draft.source ? amount : 0n)
            const projected = BigInt(wallet.balance_minor) - (entry ? walletEffect(entry, wallet.id) : 0n) + effect
            // Formatting the projected balance can exceed the persisted single-amount domain.
            const negative = projected < 0n
            const absolute = negative ? -projected : projected
            const text = `${negative ? '−' : ''}${(absolute / 100n).toLocaleString('pl-PL')},${String(absolute % 100n).padStart(2, '0')} zł`
            return <p key={wallet.id}>{wallet.name} — saldo na dziś po zapisie: <strong>{text}</strong>{negative && <span className="transaction-warning"> Saldo będzie ujemne. Możesz zapisać transakcję.</span>}</p>
          })}
        </aside>}
        {!online && <p role="status">Brak połączenia. Formularz zachowuje wpisane dane.</p>}
        {action.error && <p ref={action.errorRef} tabIndex={-1} role="alert" className="error-message">{action.error}</p>}
      </div>
      <footer><button type="submit" className="primary-button" disabled={disabled || !online}>{action.busy ? 'Zapisuję…' : submitLabel}</button></footer>
    </form>
  </TransactionDialog>
}
