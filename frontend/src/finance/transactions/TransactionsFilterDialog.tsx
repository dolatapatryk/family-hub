import { useState, type FormEvent } from 'react'
import type { FinanceTransactionKind } from './types'
import { transactionKindLabels } from './filters'
import { TransactionDialog } from './Dialog'
import { TransactionMultiSelect, type TransactionMultiSelectOption } from './TransactionMultiSelect'

export interface TransactionFilterDraft {
  month: string
  walletIds: string[]
  categoryIds: string[]
  kinds: FinanceTransactionKind[]
}

export function TransactionsFilterDialog({
  initial,
  maxMonth,
  walletOptions,
  categoryOptions,
  onApply,
  onClose,
}: {
  initial: TransactionFilterDraft
  maxMonth: string
  walletOptions: TransactionMultiSelectOption[]
  categoryOptions: TransactionMultiSelectOption[]
  onApply: (filters: TransactionFilterDraft) => void
  onClose: () => void
}) {
  const [month, setMonth] = useState(initial.month)
  const [walletIds, setWalletIds] = useState(initial.walletIds)
  const [categoryIds, setCategoryIds] = useState(initial.categoryIds)
  const [kinds, setKinds] = useState<FinanceTransactionKind[]>(initial.kinds)
  const kindOptions: TransactionMultiSelectOption[] = Object.entries(transactionKindLabels).map(([value, label]) => ({ value, label }))

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onApply({ month, walletIds, categoryIds, kinds })
  }

  return <TransactionDialog title="Filtry przeglądu" busy={false} dirty={false} onClose={onClose} className="transaction-filter-dialog">
    <form onSubmit={submit}>
      <div className="transaction-dialog-body">
        <label className="transaction-filter-month">Miesiąc
          <input type="month" value={month} max={maxMonth} onChange={event => setMonth(event.target.value)} />
        </label>
        <TransactionMultiSelect label="Portfele" placeholder="Wszystkie portfele" options={walletOptions} value={walletIds} onChange={setWalletIds} />
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
