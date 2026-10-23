import type { FinanceCategory } from '../types'
import { financeMinorUnitsToMoney, formatPln } from '../money'
import type { FinanceTransaction, FinanceWalletWithBalance } from './types'
import { transactionKindLabels } from './filters'

function dayHeading(day: string, today: string): string {
  if (day === today) return 'Dzisiaj'
  const yesterdayDate = new Date(`${today}T12:00:00Z`)
  yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1)
  if (day === yesterdayDate.toISOString().slice(0, 10)) return 'Wczoraj'
  const label = new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'short' })
    .format(new Date(`${day}T12:00:00`))
  return label.charAt(0).toLocaleUpperCase('pl-PL') + label.slice(1)
}

function walletMovement(entry: FinanceTransaction): bigint {
  const amount = BigInt(entry.amount_minor)
  switch (entry.kind) {
    case 'income': case 'refund': case 'savings_refund': return amount
    case 'expense': case 'savings_expense': return -amount
    case 'opening': case 'adjustment': return amount
    case 'transfer': return 0n
  }
}

function dayTotalLabel(amount: bigint): string {
  if (amount === 0n) return formatPln(financeMinorUnitsToMoney(0n))
  return `${amount < 0n ? '−' : '+'}${formatPln(financeMinorUnitsToMoney(amount < 0n ? -amount : amount))}`
}

function transactionAmountLabel(entry: FinanceTransaction): string {
  const amount = BigInt(entry.amount_minor)
  if (entry.kind === 'expense' || entry.kind === 'savings_expense') return formatPln(financeMinorUnitsToMoney(amount))
  if (entry.kind === 'transfer') return formatPln(financeMinorUnitsToMoney(amount))
  if (amount < 0n) return `−${formatPln(financeMinorUnitsToMoney(-amount))}`
  return `+${formatPln(financeMinorUnitsToMoney(amount))}`
}

export function TransactionHistory({ items, wallets, categories, filtered, online, today, onEdit, onOpening }: {
  items: FinanceTransaction[]; wallets: FinanceWalletWithBalance[]; categories: FinanceCategory[]; filtered: boolean; online: boolean; today: string
  onEdit: (entry: FinanceTransaction) => void; onOpening: (wallet: FinanceWalletWithBalance) => void
}) {
  const days = new Map<string, FinanceTransaction[]>()
  for (const entry of items) days.set(entry.transaction_date, [...(days.get(entry.transaction_date) ?? []), entry])
  const walletName = (id: string | null) => wallets.find(wallet => wallet.id === id)?.name ?? 'Portfel niedostępny'

  return <div className="transaction-history">
    {items.length === 0 && <p role="status" className="transaction-history-empty">{filtered ? 'Brak transakcji pasujących do filtrów. Zmień filtry lub je wyczyść.' : 'Brak transakcji w tym miesiącu. Dodaj pierwszą transakcję.'}</p>}
    {[...days].map(([day, entries]) => {
      const total = entries.reduce((sum, entry) => sum + walletMovement(entry), 0n)
      return <section key={day} className="transaction-history-day" aria-label={dayHeading(day, today)}>
        <h3 className="transaction-history-day-heading"><span>{dayHeading(day, today)}</span><i aria-hidden="true" /><strong>{dayTotalLabel(total)}</strong></h3>
        <ul>{entries.map(entry => {
          const category = categories.find(item => item.id === entry.category_id)
          const archived = wallets.some(wallet => wallet.is_archived && (wallet.id === entry.source_wallet_id || wallet.id === entry.destination_wallet_id))
          const editable = entry.kind !== 'opening' && entry.kind !== 'adjustment'
          const name = category?.name ?? transactionKindLabels[entry.kind]
          const walletLabel = entry.kind === 'transfer'
            ? `${walletName(entry.source_wallet_id)} → ${walletName(entry.destination_wallet_id)}`
            : walletName(entry.source_wallet_id ?? entry.destination_wallet_id)
          const iconColor = category?.color ?? (entry.kind === 'income' || entry.kind === 'refund' || entry.kind === 'savings_refund' ? 'var(--color-blue)' : 'var(--color-sidebar-soft)')
          const content = <>
            <span className="transaction-history-icon" style={{ backgroundColor: iconColor }} aria-hidden="true">{name.slice(0, 1).toLocaleUpperCase('pl-PL')}</span>
            <span className="transaction-history-copy"><strong>{name}</strong>
              {entry.description && <small>{entry.description}</small>}
              {entry.kind === 'transfer' || entry.kind === 'opening' || entry.kind === 'adjustment'
                ? <small className="transaction-history-wallet">{entry.kind === 'opening' ? `Saldo początkowe · ${walletName(entry.destination_wallet_id)}` : entry.kind === 'adjustment' ? `Korekta salda · ${walletName(entry.destination_wallet_id)}` : walletLabel}</small>
                : <small className="transaction-history-wallet">{walletLabel}{entry.kind.startsWith('savings_') ? ' · z oszczędności' : ''}</small>}
            </span>
            <strong className={`transaction-history-amount${entry.kind === 'transfer' ? ' is-transfer' : ''}`}>{transactionAmountLabel(entry)}</strong>
          </>

          return <li key={entry.id} className="transaction-history-item">
            {editable || entry.kind === 'opening'
              ? <button className="transaction-history-entry" type="button" disabled={!online || archived} aria-label={`${entry.kind === 'opening' ? 'Popraw saldo początkowe' : 'Edytuj transakcję'}: ${name}, ${transactionAmountLabel(entry)}`} onClick={() => {
                if (entry.kind === 'opening') {
                  const wallet = wallets.find(item => item.id === entry.destination_wallet_id)
                  if (wallet) onOpening(wallet)
                } else onEdit(entry)
              }}>{content}</button>
              : <div className="transaction-history-entry is-static">{content}</div>}
            {archived && (editable || entry.kind === 'opening') && <small className="transaction-history-note">Przywróć portfel, aby zmienić historię.</small>}
            {entry.kind === 'adjustment' && <small className="transaction-history-note">Korekta salda — uzgodnij w Portfelach.</small>}
          </li>
        })}</ul>
      </section>
    })}
  </div>
}
