import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { createFinanceTransactionsApi } from './api'
import type { FinanceTransactionFilters, FinanceWalletWithBalance, FinanceWalletType } from './types'
import type { FinanceCategory, FinanceVisibility } from '../types'
import { financeMinorUnitsToMoney, formatPln, parseMoney } from '../money'
import { TransactionDialog } from './Dialog'
import { todayDate, transactionKindLabels, validDate } from './filters'
import { useOnline, useTransactionAction } from './useTransactionAction'

export type WalletAction = 'create' | 'edit' | 'opening' | 'balance' | 'archive' | 'restore'
const titles: Record<WalletAction, string> = { create: 'Dodaj portfel', edit: 'Edytuj portfel', opening: 'Popraw saldo początkowe', balance: 'Uzgodnij saldo', archive: 'Archiwizuj portfel', restore: 'Przywróć portfel' }
export const walletTypeLabels: Record<FinanceWalletType, string> = { bank: 'Konto bankowe', cash: 'Gotówka', savings_bank: 'Konto oszczędnościowe' }

export function WalletForm({ api, queryKey, wallet, mode, defaultVisibility, onClose, onSaved, scope, monthStart, categories, userId, onTransition, onHistory }: {
  api: ReturnType<typeof createFinanceTransactionsApi>; queryKey: string[]; wallet?: FinanceWalletWithBalance; mode: WalletAction
  defaultVisibility: FinanceVisibility; onClose: () => void; onSaved: () => void
  scope: FinanceTransactionFilters['scope']; monthStart: string; categories: FinanceCategory[]
  userId: string
  onTransition: (mode: WalletAction, wallet: FinanceWalletWithBalance) => void; onHistory: (walletId: string) => void
}) {
  const today = todayDate()
  const [name, setName] = useState(wallet?.name ?? '')
  const [type, setType] = useState<FinanceWalletType>(wallet?.wallet_type ?? 'bank')
  const [visibility, setVisibility] = useState<FinanceVisibility>(defaultVisibility)
  const [date, setDate] = useState(mode === 'opening' ? wallet?.opened_on ?? today : today)
  const [balance, setBalance] = useState(mode === 'create' ? '0' : '')
  const [color, setColor] = useState(wallet?.color ?? '')
  const [icon, setIcon] = useState(wallet?.icon ?? '')
  const [reason, setReason] = useState('')
  const [dirty, setDirty] = useState(false)
  const [validation, setValidation] = useState('')
  const preferenceKey = `family-hub:transactions:wallet:${userId}`
  const [initialDefaultWallet] = useState(() => {
    try { return Boolean(wallet && !wallet.is_archived && localStorage.getItem(preferenceKey) === wallet.id) } catch { return false }
  })
  const [defaultWallet, setDefaultWallet] = useState(initialDefaultWallet)
  const validationRef = useRef<HTMLParagraphElement>(null)
  const action = useTransactionAction(queryKey)
  const online = useOnline()
  const opening = useQuery({ queryKey: [...queryKey, 'openingPreview', wallet?.id], queryFn: ({ signal }) => api.previewWalletOpeningCorrection(wallet!.id, signal), enabled: mode === 'opening' && Boolean(wallet), staleTime: 0 })
  const correction = useQuery({ queryKey: [...queryKey, 'balancePreview', wallet?.id, date], queryFn: ({ signal }) => api.previewWalletBalanceCorrection(wallet!.id, date, signal), enabled: mode === 'balance' && Boolean(wallet) && validDate(date) && date <= today && date >= wallet!.opened_on, staleTime: 0 })
  const recentTransactions = useQuery({
    queryKey: [...queryKey, 'walletRecent', wallet?.id, monthStart, scope],
    queryFn: ({ signal }) => api.listTransactions({ month_start: monthStart, scope, wallet_id: wallet!.id }, null, 3, signal),
    enabled: mode === 'edit' && Boolean(wallet),
  })
  const initialized = useRef(false)
  useEffect(() => {
    if (mode === 'opening' && opening.data && !opening.isFetching && !initialized.current) {
      initialized.current = true
      setDate(opening.data.opened_on); setBalance(financeMinorUnitsToMoney(opening.data.opening_balance_minor))
    }
  }, [mode, opening.data, opening.isFetching])
  useEffect(() => { if (validation) validationRef.current?.focus() }, [validation])
  const disabled = action.busy || action.conflict
  const isDetails = mode === 'create' || mode === 'edit'
  const isBalance = mode === 'create' || mode === 'opening' || mode === 'balance'
  const preview = mode === 'opening' ? opening : correction
  const needsPreview = mode === 'opening' || mode === 'balance'
  const walletDetailsChanged = Boolean(mode === 'edit' && wallet && (
    name.trim() !== wallet.name || type !== wallet.wallet_type || color !== (wallet.color ?? '') || icon !== (wallet.icon ?? '')
  ))
  function saveDefaultWalletPreference() {
    if (!wallet) return
    try {
      if (defaultWallet) localStorage.setItem(preferenceKey, wallet.id)
      else if (localStorage.getItem(preferenceKey) === wallet.id) localStorage.removeItem(preferenceKey)
    } catch { /* The preferred wallet is an optional browser setting. */ }
  }
  function clearArchivedDefaultWalletPreference() {
    if (!wallet) return
    try { if (localStorage.getItem(preferenceKey) === wallet.id) localStorage.removeItem(preferenceKey) } catch { /* The preferred wallet is an optional browser setting. */ }
  }
  function transition(nextMode: WalletAction) {
    if (!wallet || dirty && !window.confirm('Odrzucić niezapisane zmiany?')) return
    onTransition(nextMode, wallet)
  }
  function openHistory() {
    if (!wallet || dirty && !window.confirm('Odrzucić niezapisane zmiany?')) return
    onHistory(wallet.id)
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setValidation('')
    if (disabled) return
    if (isDetails && !name.trim()) { setValidation('Wpisz nazwę portfela.'); return }
    if (isBalance) {
      try { parseMoney(balance) } catch { setValidation('Podaj saldo z maksymalnie dwoma miejscami po przecinku, bez separatorów tysięcy.'); return }
      if (!validDate(date) || date > today || mode === 'balance' && wallet && date < wallet.opened_on) { setValidation('Podaj prawidłową datę, nie późniejszą niż dziś i nie wcześniejszą niż otwarcie portfela.'); return }
    }
    if (mode === 'balance' && !reason.trim()) { setValidation('Podaj powód korekty salda.'); return }
    if (needsPreview && (!preview.data || preview.isFetching || preview.isError)) return
    if (mode === 'edit' && wallet && !walletDetailsChanged) {
      saveDefaultWalletPreference()
      onSaved()
      return
    }
    const payload = { mode, wallet: wallet?.id, version: wallet?.version, name, type, visibility, date, balance, color, icon, reason, snapshot: mode === 'opening' ? opening.data?.snapshot_token : correction.data?.snapshot_token }
    await action.run(payload, async request_id => {
      if (mode === 'create') await api.saveWallet({ request_id, name, wallet_type: type, visibility, opened_on: date, opening_balance: balance, color: color || null, icon: icon || null })
      else if (mode === 'edit') {
        await api.saveWallet({ request_id, wallet_id: wallet!.id, expected_version: wallet!.version, name, wallet_type: type, color: color || null, icon: icon || null })
        saveDefaultWalletPreference()
      }
      else if (mode === 'opening') await api.correctWalletOpening({ request_id, wallet_id: wallet!.id, expected_version: opening.data!.wallet_version, snapshot_token: opening.data!.snapshot_token, opened_on: date, opening_balance: balance })
      else if (mode === 'balance') await api.correctWalletBalance({ request_id, wallet_id: wallet!.id, expected_version: correction.data!.wallet_version, snapshot_token: correction.data!.snapshot_token, effective_date: date, observed_balance: balance, reason })
      else {
        await api.setWalletArchived({ request_id, wallet_id: wallet!.id, expected_version: wallet!.version, is_archived: mode === 'archive' })
        if (mode === 'archive') clearArchivedDefaultWalletPreference()
      }
    }, onSaved)
  }
  let difference = ''
  if (mode === 'balance' && correction.data) {
    try {
      const delta = parseMoney(balance) - BigInt(correction.data.current_balance_minor)
      const absolute = delta < 0n ? -delta : delta
      difference = `${delta < 0n ? '−' : '+'}${(absolute / 100n).toLocaleString('pl-PL')},${String(absolute % 100n).padStart(2, '0')} zł`
    } catch { /* Await a valid observed balance. */ }
  }
  const selectedColor = color || '#f3a329'
  return <TransactionDialog title={mode === 'edit' ? 'Edytowanie portfela' : titles[mode]} busy={action.busy} dirty={dirty} onClose={onClose} className={mode === 'edit' ? 'wallet-edit-dialog' : undefined}>
    <form onSubmit={event => void submit(event)} onChange={() => setDirty(true)}>
      <div className={`transaction-dialog-body${mode === 'edit' ? ' wallet-edit-body' : ''}`}>
        {mode === 'edit' && wallet ? <>
          <section className="wallet-edit-section wallet-edit-recent" aria-labelledby="wallet-recent-heading">
            <h3 className="wallet-edit-kicker" id="wallet-recent-heading">Ostatnie transakcje</h3>
            {recentTransactions.isPending && <p className="wallet-edit-muted" role="status">Wczytuję historię…</p>}
            {recentTransactions.isError && <p className="wallet-edit-muted" role="alert">Nie udało się wczytać transakcji. <button type="button" className="wallet-inline-action" onClick={() => void recentTransactions.refetch()}>Spróbuj ponownie</button></p>}
            {recentTransactions.data?.items.length === 0 && <p className="wallet-edit-muted">Brak transakcji w tym miesiącu.</p>}
            {recentTransactions.data && recentTransactions.data.items.length > 0 && <ul className="wallet-edit-recent-list">
              {recentTransactions.data.items.map(entry => {
                const category = categories.find(item => item.id === entry.category_id)
                const effect = (entry.destination_wallet_id === wallet.id ? BigInt(entry.amount_minor) : 0n) - (entry.source_wallet_id === wallet.id ? BigInt(entry.amount_minor) : 0n)
                const amount = effect < 0n ? -effect : effect
                const amountText = `${effect > 0n ? '+' : effect < 0n ? '−' : ''}${formatPln(financeMinorUnitsToMoney(amount.toString()))}`
                return <li key={entry.id}>
                  <span className="wallet-edit-transaction-icon" style={{ backgroundColor: wallet.color ?? '#3e7d79' }} aria-hidden="true">{entry.kind === 'income' || entry.kind === 'refund' ? '↙' : entry.kind === 'transfer' ? '⇄' : '▣'}</span>
                  <span className="wallet-edit-transaction-copy"><strong>{entry.description || category?.name || transactionKindLabels[entry.kind]}</strong><small>{new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' }).format(new Date(`${entry.transaction_date}T12:00:00`))}</small></span>
                  <span className="wallet-edit-transaction-amount">{amountText}</span>
                </li>
              })}
            </ul>}
            <button type="button" className="wallet-edit-history-button" onClick={openHistory}>Zobacz całą historię <span aria-hidden="true">›</span></button>
          </section>

          <section className="wallet-edit-section wallet-edit-identity" aria-label="Dane portfela">
            <div className="wallet-edit-identity-row">
              <span className="wallet-edit-wallet-icon" style={{ backgroundColor: selectedColor }} aria-hidden="true">{icon === 'cash' ? '▤' : icon === 'savings' ? '◇' : '▥'}</span>
              <label className="wallet-edit-name">Nazwa<input autoFocus required maxLength={120} value={name} disabled={disabled} onChange={event => setName(event.target.value)} /></label>
            </div>
            <div className="wallet-edit-colors" role="group" aria-label="Kolor portfela">
              {['#dd4b54', '#ef6275', '#e77cbd', '#a43fe5', '#5361ed', '#73a9e4', '#33c1d2', '#25cf9f', '#abc83d'].map(value => <button key={value} type="button" className={`wallet-color-swatch${selectedColor.toLowerCase() === value ? ' is-selected' : ''}`} style={{ backgroundColor: value }} aria-label={`Wybierz kolor ${value}`} aria-pressed={selectedColor.toLowerCase() === value} disabled={disabled} onClick={() => { setColor(value); setDirty(true) }} />)}
              <label className="wallet-custom-color" title="Wybierz własny kolor"><input type="color" aria-label="Wybierz własny kolor" value={selectedColor} disabled={disabled} onChange={event => setColor(event.target.value)} /></label>
            </div>
            <div className="wallet-edit-select-row">
              <label>Rodzaj<select value={type} disabled={disabled} onChange={event => setType(event.target.value as FinanceWalletType)}>{Object.entries(walletTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>Symbol<select value={icon} disabled={disabled} onChange={event => setIcon(event.target.value)}><option value="">Domyślny</option><option value="bank">Bank</option><option value="cash">Gotówka</option><option value="savings">Oszczędności</option>{icon && !['bank', 'cash', 'savings'].includes(icon) && <option value={icon}>Obecny symbol</option>}</select></label>
            </div>
          </section>

          <section className="wallet-edit-section wallet-edit-balance" aria-labelledby="wallet-balance-heading">
            <h3 className="wallet-edit-kicker" id="wallet-balance-heading">Saldo</h3>
            <div className="wallet-edit-balance-row"><span>Bieżące saldo</span><strong className={BigInt(wallet.balance_minor) < 0n ? 'is-negative' : ''}>{formatPln(financeMinorUnitsToMoney(wallet.balance_minor))}</strong></div>
            <button type="button" className="wallet-edit-setting-link" disabled={!online} onClick={() => transition('balance')}>Uzgodnij saldo <span aria-hidden="true">›</span></button>
            <button type="button" className="wallet-edit-setting-link" disabled={!online} onClick={() => transition('opening')}>Popraw saldo początkowe <span aria-hidden="true">›</span></button>
          </section>

          <section className="wallet-edit-section wallet-edit-settings" aria-label="Ustawienia portfela">
            <h3 className="wallet-edit-kicker">Ustawienia</h3>
            <div className="wallet-edit-setting-row">
              <div className="wallet-edit-setting-copy"><strong>Wartość netto</strong><span>Saldo jest wliczane do sumy portfeli powyżej.</span></div>
              <span className="wallet-edit-fixed-setting">Wliczany</span>
            </div>
            <label className="wallet-edit-setting-row wallet-edit-default-toggle">
              <span className="wallet-edit-setting-copy"><strong>Domyślny portfel</strong><span>{wallet.is_archived ? 'Przywróć portfel, aby wybrać go przy tworzeniu transakcji.' : 'Wybierany wstępnie podczas tworzenia transakcji.'}</span></span>
              <span className={`wallet-edit-switch${defaultWallet ? ' is-on' : ''}`}><input type="checkbox" checked={defaultWallet} disabled={disabled || wallet.is_archived} onChange={event => setDefaultWallet(event.target.checked)} /><span aria-hidden="true" /></span>
            </label>
            <div className="wallet-edit-setting-row">
              <div className="wallet-edit-setting-copy"><strong>Widoczność</strong><span>{wallet.visibility === 'household' ? 'Portfel domowy · widoczny dla domowników' : 'Portfel prywatny · widoczny tylko dla właściciela'}</span></div>
            </div>
          </section>

          <section className="wallet-edit-destructive" aria-label="Archiwizacja portfela">
            {wallet.is_archived ? <button type="button" className="wallet-edit-destructive-button" disabled={!online} onClick={() => transition('restore')}>Przywróć portfel</button> : <>
              <button type="button" className="wallet-edit-destructive-button" disabled={!online || wallet.balance_minor !== '0'} title={wallet.balance_minor !== '0' ? 'Archiwizacja wymaga zerowego salda' : undefined} onClick={() => transition('archive')}>Archiwizuj portfel</button>
              <p>Archiwalne portfele są ukryte na liście, a ich historia pozostaje dostępna.</p>
            </>}
          </section>
        </> : <>
          {wallet && <p><strong>{wallet.name}</strong> · {wallet.visibility === 'household' ? 'Domowy' : 'Prywatny'}</p>}
          {isDetails && <>
            <label>Nazwa<input autoFocus required maxLength={120} value={name} disabled={disabled} onChange={event => setName(event.target.value)} /></label>
            <label>Rodzaj<select value={type} disabled={disabled} onChange={event => setType(event.target.value as FinanceWalletType)}>{Object.entries(walletTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            {mode === 'create' && <label>Widoczność<select value={visibility} disabled={disabled} onChange={event => setVisibility(event.target.value as FinanceVisibility)}><option value="household">Domowy — wszyscy domownicy</option><option value="private">Prywatny — tylko ja</option></select><span className="panel-kicker">Widoczność jest stała po utworzeniu portfela.</span></label>}
            <div className="transaction-fields"><label>Kolor<input type="color" value={color || '#365f55'} disabled={disabled} onChange={event => setColor(event.target.value)} /></label>
              <label>Symbol<select value={icon} disabled={disabled} onChange={event => setIcon(event.target.value)}><option value="">Domyślny</option><option value="bank">Bank</option><option value="cash">Gotówka</option><option value="savings">Oszczędności</option>{icon && !['bank', 'cash', 'savings'].includes(icon) && <option value={icon}>Obecny symbol</option>}</select></label></div>
          </>}
        </>}
        {isBalance && <>
          <label>{mode === 'balance' ? 'Data uzgodnienia' : 'Data otwarcia'}<input type="date" required max={today} min={mode === 'balance' ? wallet?.opened_on : undefined} value={date} disabled={disabled || mode === 'opening' && !initialized.current} onChange={event => setDate(event.target.value)} /></label>
          <label>{mode === 'balance' ? 'Rzeczywiste saldo na koniec wybranego dnia (PLN)' : 'Saldo początkowe (PLN)'}<input required inputMode="decimal" value={balance} disabled={disabled || mode === 'opening' && !initialized.current} onChange={event => setBalance(event.target.value)} /></label>
          <p className="panel-kicker">Saldo może być ujemne. Saldo początkowe i korekty nie są przychodem ani wydatkiem miesiąca.</p>
        </>}
        {mode === 'balance' && <label>Powód korekty<textarea required maxLength={2000} value={reason} disabled={disabled} onChange={event => setReason(event.target.value)} /></label>}
        {needsPreview && <aside className="transaction-preview">
          {preview.isFetching && <p role="status">Pobieram podgląd salda…</p>}
          {preview.isError && <p role="alert">Nie udało się pobrać podglądu. <button type="button" onClick={() => void preview.refetch()}>Spróbuj ponownie</button></p>}
          {mode === 'opening' && opening.data && <p>Obecne otwarcie: {opening.data.opened_on}, {formatPln(financeMinorUnitsToMoney(opening.data.opening_balance_minor))}. Zmiana poprawi saldo od dnia otwarcia; późniejsze transakcje pozostaną w historii.</p>}
          {mode === 'balance' && correction.data && <p>Saldo zapisane na {date}: {formatPln(financeMinorUnitsToMoney(correction.data.current_balance_minor))}.{difference && <> Nowa korekta: <strong>{difference}</strong>.</>}</p>}
          <p className="panel-kicker">Zapis sprawdzi, czy historia nie zmieniła się od pobrania podglądu.</p>
        </aside>}
        {mode === 'archive' && <p>Archiwizacja ukryje portfel w formularzach. Historia pozostanie dostępna. Wymagane jest zerowe saldo na dziś; edycja historii wymaga przywrócenia portfela.</p>}
        {mode === 'restore' && <p>Portfel ponownie pojawi się w formularzach transakcji.</p>}
        {!online && <p role="status">Brak połączenia. Wpisane dane pozostają w formularzu.</p>}
        {validation && <p role="alert" tabIndex={-1} ref={validationRef} className="error-message">{validation}</p>}
        {action.error && <p role="alert" tabIndex={-1} ref={action.errorRef} className="error-message">{action.error}</p>}
      </div>
      <footer><button className="primary-button" disabled={disabled || !online && !(mode === 'edit' && !walletDetailsChanged) || needsPreview && (!preview.data || preview.isFetching || preview.isError) || mode === 'archive' && wallet?.balance_minor !== '0'}>{action.busy ? 'Zapisuję…' : mode === 'archive' ? 'Archiwizuj' : mode === 'restore' ? 'Przywróć' : 'Zapisz'}</button></footer>
    </form>
  </TransactionDialog>
}
