import type { FinanceCategory } from '../types'
import { financeMinorUnitsToMoney, formatPln } from '../money'
import type { FinanceTransaction, FinanceWalletWithBalance } from './types'
import { transactionKindLabels } from './filters'

export function TransactionHistory({ items, wallets, categories, filtered, online, onEdit, onDelete, onOpening }: {
  items: FinanceTransaction[]; wallets: FinanceWalletWithBalance[]; categories: FinanceCategory[]; filtered: boolean; online: boolean
  onEdit: (entry: FinanceTransaction) => void; onDelete: (entry: FinanceTransaction) => void; onOpening: (wallet: FinanceWalletWithBalance) => void
}) {
  const days = new Map<string, FinanceTransaction[]>()
  for (const entry of items) days.set(entry.transaction_date, [...(days.get(entry.transaction_date) ?? []), entry])
  const walletName = (id: string | null) => wallets.find(wallet => wallet.id === id)?.name ?? 'Portfel niedostępny'
  return <div className="transaction-history">
    {items.length === 0 && <p role="status">{filtered ? 'Brak transakcji pasujących do filtrów. Zmień filtry lub je wyczyść.' : 'Brak transakcji w tym miesiącu. Dodaj pierwszą transakcję.'}</p>}
    {[...days].map(([day, entries]) => <section key={day} aria-label={day}>
      <h3><time dateTime={day}>{new Intl.DateTimeFormat('pl-PL', { dateStyle: 'long' }).format(new Date(`${day}T12:00:00`))}</time></h3>
      <ul>{entries.map(entry => {
        const category = categories.find(item => item.id === entry.category_id)
        const archived = wallets.some(wallet => wallet.is_archived && (wallet.id === entry.source_wallet_id || wallet.id === entry.destination_wallet_id))
        const isDebit = entry.kind === 'expense' || entry.kind === 'savings_expense'
        const signed = isDebit ? `−${formatPln(financeMinorUnitsToMoney(entry.amount_minor))}` : `${entry.kind !== 'transfer' && BigInt(entry.amount_minor) > 0n ? '+' : ''}${formatPln(financeMinorUnitsToMoney(entry.amount_minor))}`
        return <li key={entry.id} className="transaction-row">
          <div className="transaction-row-copy"><strong>{entry.description || category?.name || transactionKindLabels[entry.kind]}</strong>
            {entry.description && category && <span>{category.name}</span>}
            <span>{entry.kind === 'transfer' ? `${walletName(entry.source_wallet_id)} → ${walletName(entry.destination_wallet_id)}` : walletName(entry.source_wallet_id ?? entry.destination_wallet_id)}</span>
            <div className="transaction-badges"><span>{transactionKindLabels[entry.kind]}</span>{entry.savings_effect === 'contribution' && <span>Odłożono</span>}{entry.kind.startsWith('savings_') && <span>Z oszczędności · poza bilansem miesiąca</span>}</div>
          </div>
          <strong className={`transaction-row-amount${entry.kind === 'transfer' ? ' is-transfer' : ''}`}>{signed}</strong>
          <div className="transaction-actions">
            {entry.kind === 'opening' ? <button className="button-quiet" disabled={!online || archived} onClick={() => { const wallet = wallets.find(item => item.id === entry.destination_wallet_id); if (wallet) onOpening(wallet) }}>Popraw otwarcie</button>
              : entry.kind === 'adjustment' ? <small>Korekta salda — uzgodnij w Portfelach</small> : <>
                <button className="button-quiet" disabled={!online || archived} onClick={() => onEdit(entry)}>Edytuj</button>
                <button className="button-quiet" disabled={!online || archived} onClick={() => onDelete(entry)}>Usuń</button>
              </>}
            {archived && <small>Przywróć portfel, aby zmienić historię.</small>}
          </div>
        </li>
      })}</ul>
    </section>)}
  </div>
}
