import { financeMinorUnitsToMoney, formatPln } from '../money'
import type { FinanceWalletWithBalance } from './types'
import { walletTypeLabels, type WalletAction } from './WalletForm'

export function WalletsPanel({ wallets, onAction, onHistory, online }: {
  wallets: FinanceWalletWithBalance[]; onAction: (mode: WalletAction, wallet?: FinanceWalletWithBalance) => void
  onHistory: (walletId: string) => void; online: boolean
}) {
  return <section className="panel finance-panel">
    <div className="panel-head"><h2 className="panel-title">Portfele</h2><button className="primary-button" disabled={!online} onClick={() => onAction('create')}>Dodaj portfel</button></div>
    <p className="panel-kicker">Fizyczne konta i gotówka w PLN. Salda obejmują całą historię do dziś, niezależnie od wybranego miesiąca.</p>
    {wallets.length === 0 && <p>Brak portfeli w tym zakresie. Dodaj pierwszy portfel, aby rozpocząć zapisywanie transakcji.</p>}
    {[false, true].map(archived => {
      const list = wallets.filter(wallet => wallet.is_archived === archived)
      return list.length > 0 && <section key={String(archived)} aria-label={archived ? 'Portfele archiwalne' : 'Aktywne portfele'}>
        <h3>{archived ? 'Archiwalne' : 'Aktywne'}</h3>
        <div className="transaction-wallet-grid">{list.map(wallet => <article key={wallet.id} className="transaction-wallet" style={{ borderTopColor: wallet.color ?? undefined }}>
          <h4><span aria-hidden="true">{wallet.icon === 'cash' ? '▤' : wallet.icon === 'savings' ? '◇' : '▥'} </span>{wallet.name}</h4>
          <p className="panel-kicker">{walletTypeLabels[wallet.wallet_type]} · {wallet.visibility === 'household' ? 'Domowy' : 'Prywatny'}</p>
          <p className={BigInt(wallet.balance_minor) < 0n ? 'transaction-warning' : ''}><strong>{formatPln(financeMinorUnitsToMoney(wallet.balance_minor))}</strong><br /><small>Saldo na {wallet.balance_as_of_date}</small></p>
          <div className="transaction-actions"><button className="button-quiet" onClick={() => onHistory(wallet.id)}>Historia</button>
            {archived ? <button className="button-quiet" disabled={!online} onClick={() => onAction('restore', wallet)}>Przywróć</button> : <>
              <button className="button-quiet" disabled={!online} onClick={() => onAction('edit', wallet)}>Edytuj</button>
              <button className="button-quiet" disabled={!online} onClick={() => onAction('balance', wallet)}>Uzgodnij saldo</button>
              <button className="button-quiet" disabled={!online} onClick={() => onAction('opening', wallet)}>Popraw otwarcie</button>
              <button className="button-quiet" disabled={!online || wallet.balance_minor !== '0'} title={wallet.balance_minor !== '0' ? 'Archiwizacja wymaga zerowego salda' : undefined} onClick={() => onAction('archive', wallet)}>Archiwizuj</button>
            </>}
          </div>
        </article>)}</div>
      </section>
    })}
  </section>
}
