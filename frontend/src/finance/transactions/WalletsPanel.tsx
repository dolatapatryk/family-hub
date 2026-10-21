import type { CSSProperties } from 'react'
import { financeMinorUnitsToMoney, formatPln } from '../money'
import type { FinanceWalletWithBalance } from './types'
import { walletTypeLabels, type WalletAction } from './WalletForm'

export function WalletsPanel({ wallets, onAction, online }: {
  wallets: FinanceWalletWithBalance[]; onAction: (mode: WalletAction, wallet?: FinanceWalletWithBalance) => void
  online: boolean
}) {
  const totalMinor = wallets.reduce((total, wallet) => total + BigInt(wallet.balance_minor), 0n)
  const activeWallets = wallets.filter(wallet => !wallet.is_archived)
  const archivedWallets = wallets.filter(wallet => wallet.is_archived)
  return <section className="panel finance-panel wallets-dashboard">
    <div className="wallets-heading">
      <div><p className="wallets-eyebrow">PORTFELE</p><h2 className="panel-title">Twoje środki</h2></div>
      <button className="wallets-add-button" disabled={!online} aria-label="Dodaj portfel" onClick={() => onAction('create')}>+</button>
    </div>
    <p className="sr-only">Fizyczne konta i gotówka w PLN. Salda obejmują całą historię do dziś.</p>
    <div className="wallets-net-total">
      <span className="wallets-net-label">Całkowita wartość netto</span>
      <strong>{formatPln(financeMinorUnitsToMoney(totalMinor.toString()))}</strong>
      <span className="wallets-net-caption">Suma sald portfeli w wybranym zakresie</span>
    </div>
    {wallets.length === 0 && <p>Brak portfeli w tym zakresie. Dodaj pierwszy portfel, aby rozpocząć zapisywanie transakcji.</p>}
    {activeWallets.length > 0 && <div className="transaction-wallet-grid" aria-label="Aktywne portfele">
      {activeWallets.map(wallet => <button key={wallet.id} type="button" className="transaction-wallet-card" onClick={() => onAction('edit', wallet)} style={{ '--wallet-accent': wallet.color ?? '#24d6a4' } as CSSProperties}>
        <span className="transaction-wallet-copy">
          <span className="transaction-wallet-name">{wallet.name}</span>
          <span className="transaction-wallet-balance">{formatPln(financeMinorUnitsToMoney(wallet.balance_minor))}</span>
          <span className="transaction-wallet-meta">{walletTypeLabels[wallet.wallet_type]} · {wallet.visibility === 'household' ? 'Domowy' : 'Prywatny'}</span>
        </span>
        <span className="transaction-wallet-icon" aria-hidden="true">{wallet.icon === 'cash' ? '▤' : wallet.icon === 'savings' ? '◇' : '▥'}</span>
        <span className="transaction-wallet-open" aria-hidden="true">›</span>
      </button>)}
    </div>}
    {archivedWallets.length > 0 && <details className="wallets-archived">
      <summary>Archiwalne portfele <span>{archivedWallets.length}</span></summary>
      <div className="transaction-wallet-grid" aria-label="Archiwalne portfele">
        {archivedWallets.map(wallet => <button key={wallet.id} type="button" className="transaction-wallet-card is-archived" onClick={() => onAction('edit', wallet)} style={{ '--wallet-accent': wallet.color ?? '#899596' } as CSSProperties}>
          <span className="transaction-wallet-copy">
            <span className="transaction-wallet-name">{wallet.name}</span>
            <span className="transaction-wallet-balance">{formatPln(financeMinorUnitsToMoney(wallet.balance_minor))}</span>
            <span className="transaction-wallet-meta">Archiwalny portfel</span>
          </span>
          <span className="transaction-wallet-icon" aria-hidden="true">{wallet.icon === 'cash' ? '▤' : wallet.icon === 'savings' ? '◇' : '▥'}</span>
          <span className="transaction-wallet-open" aria-hidden="true">›</span>
        </button>)}
      </div>
    </details>}
  </section>
}
