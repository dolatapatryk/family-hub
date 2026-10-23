import { useState, type FormEvent } from 'react'
import type { FinanceTransactionKind, FinanceTransactionScope } from './types'
import { transactionKindLabels } from './filters'
import { TransactionDialog } from './Dialog'
import { TransactionMultiSelect, type TransactionMultiSelectOption } from './TransactionMultiSelect'

export interface TransactionFilterDraft {
  month: string
  scope: FinanceTransactionScope
  walletIds: string[]
  categoryIds: string[]
  kinds: FinanceTransactionKind[]
}

export function TransactionsFilterDialog({
  initial,
  maxMonth,
  walletOptionsByScope,
  walletOptionsLoading,
  walletOptionsError,
  onRetryWalletOptions,
  categoryOptions,
  onApply,
  onClose,
}: {
  initial: TransactionFilterDraft
  maxMonth: string
  walletOptionsByScope: Record<FinanceTransactionScope, TransactionMultiSelectOption[]>
  walletOptionsLoading: boolean
  walletOptionsError: boolean
  onRetryWalletOptions: () => void
  categoryOptions: TransactionMultiSelectOption[]
  onApply: (filters: TransactionFilterDraft) => void
  onClose: () => void
}) {
  const [month, setMonth] = useState(initial.month)
  const [scope, setScope] = useState(initial.scope)
  const [walletIds, setWalletIds] = useState(initial.walletIds)
  const [categoryIds, setCategoryIds] = useState(initial.categoryIds)
  const [kinds, setKinds] = useState<FinanceTransactionKind[]>(initial.kinds)
  const kindOptions: TransactionMultiSelectOption[] = Object.entries(transactionKindLabels).map(([value, label]) => ({ value, label }))

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onApply({ month, scope, walletIds, categoryIds, kinds })
  }

  return <TransactionDialog title="Filtry transakcji" busy={false} dirty={false} onClose={onClose} className="transaction-filter-dialog">
    <form onSubmit={submit}>
      <div className="transaction-dialog-body">
        <label className="transaction-filter-month">Miesiąc
          <input type="month" value={month} max={maxMonth} onChange={event => setMonth(event.target.value)} />
        </label>
        <label>Zakres
          <select value={scope} onChange={event => { setScope(event.target.value as FinanceTransactionScope); setWalletIds([]) }}>
            <option value="household">Domowe</option>
            <option value="personal">Moje</option>
            <option value="all_accessible">Wszystkie dostępne</option>
          </select>
        </label>
        {walletOptionsLoading && <p role="status" className="transaction-filter-help">Wczytuję portfele dla dostępnych zakresów…</p>}
        {walletOptionsError && <p role="alert" className="transaction-filter-help">Nie udało się wczytać portfeli dla zakresów. <button className="button-quiet" type="button" onClick={onRetryWalletOptions}>Spróbuj ponownie</button></p>}
        <TransactionMultiSelect label="Portfele" placeholder="Wszystkie portfele" options={walletOptionsByScope[scope]} value={walletIds} onChange={setWalletIds} />
        <TransactionMultiSelect label="Kategorie" placeholder="Wszystkie kategorie" options={categoryOptions} value={categoryIds} onChange={setCategoryIds} />
        <TransactionMultiSelect label="Rodzaje transakcji" placeholder="Wszystkie rodzaje" options={kindOptions} value={kinds} onChange={values => setKinds(values as FinanceTransactionKind[])} />
        <p className="transaction-filter-help">Puste pole oznacza brak ograniczenia dla danego filtra.</p>
      </div>
      <footer>
        <button className="button-quiet" type="button" onClick={() => { setWalletIds([]); setCategoryIds([]); setKinds([]) }}>Wyczyść filtry</button>
        <button className="primary-button" type="submit">Pokaż wyniki</button>
      </footer>
    </form>
  </TransactionDialog>
}
