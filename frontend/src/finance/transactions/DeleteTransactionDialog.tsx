import { TransactionDialog } from './Dialog'
import { useOnline, useTransactionAction } from './useTransactionAction'
import type { createFinanceTransactionsApi } from './api'
import type { FinanceTransaction, FinanceWalletWithBalance } from './types'
import { transactionKindLabels } from './filters'
import { financeMinorUnitsToMoney, formatPln } from '../money'

export function DeleteTransactionDialog({ entry, wallets, api, queryKey, onClose, onSaved }: {
  entry: FinanceTransaction; wallets: FinanceWalletWithBalance[]; api: ReturnType<typeof createFinanceTransactionsApi>; queryKey: string[]; onClose: () => void; onSaved: () => void
}) {
  const action = useTransactionAction(queryKey)
  const online = useOnline()
  const amount = formatPln(financeMinorUnitsToMoney(entry.amount_minor))
  const walletName = (id: string | null) => wallets.find(wallet => wallet.id === id)?.name ?? 'Portfel'
  return <TransactionDialog title="Usuń transakcję" busy={action.busy} dirty={false} onClose={onClose}>
    <div className="transaction-dialog-body">
      <p>Usunąć „{entry.description || transactionKindLabels[entry.kind]}”, {amount}, z dnia {entry.transaction_date}?</p>
      {entry.kind === 'transfer' ? <p>Saldo portfela „{walletName(entry.source_wallet_id)}” wzrośnie o {amount}, a saldo „{walletName(entry.destination_wallet_id)}” zmaleje o {amount}. Oba skutki przelewu zostaną usunięte razem.</p> : <p>Saldo portfela i historia miesiąca zostaną przeliczone.</p>}
      {action.error && <p className="error-message" role="alert" ref={action.errorRef} tabIndex={-1}>{action.error}</p>}
      {!online && <p role="status">Brak połączenia. Usuwanie jest niedostępne.</p>}
    </div>
    <footer><button className="primary-button" disabled={action.busy || action.conflict || !online} onClick={() => void action.run({ id: entry.id, version: entry.version }, request_id => api.deleteTransaction({ request_id, transaction_id: entry.id, expected_version: entry.version }), onSaved)}>{action.busy ? 'Usuwam…' : 'Usuń transakcję'}</button></footer>
  </TransactionDialog>
}
