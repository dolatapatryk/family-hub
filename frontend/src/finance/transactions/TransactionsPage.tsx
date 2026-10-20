import { useMemo, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useAuth } from '../../auth/AuthGate'
import { PageHeader } from '../../components/PageHeader'
import { createFinanceApi } from '../api'
import { transactionsNavigation } from '../navigation'
import { createFinanceTransactionsApi } from './api'
import { readTransactionFilters, todayDate, transactionKindLabels } from './filters'
import { transactionBalanceDate, transactionBalanceMinor } from './reporting'
import { useOnline } from './useTransactionAction'
import { TransactionForm } from './TransactionForm'
import { WalletForm, type WalletAction } from './WalletForm'
import { WalletsPanel } from './WalletsPanel'
import { TransactionHistory } from './TransactionHistory'
import { DeleteTransactionDialog } from './DeleteTransactionDialog'
import { TransactionsOverview } from './TransactionsOverview'
import type { FinanceTransaction, FinanceTransactionCursor, FinanceWalletWithBalance } from './types'
import './transactions.css'

type Dialog = { type: 'transaction'; entry?: FinanceTransaction; saving?: boolean }
  | { type: 'wallet'; mode: WalletAction; wallet?: FinanceWalletWithBalance }
  | { type: 'delete'; entry: FinanceTransaction }

export function TransactionsPage() {
  const { profile } = useAuth()
  // Remount forms and state on account/household changes; private queries also include both IDs.
  return <TransactionsWorkspace key={`${profile.household_id}:${profile.id}`} householdId={profile.household_id} userId={profile.id} />
}
function TransactionsWorkspace({ householdId, userId }: { householdId: string; userId: string }) {
  const api = useMemo(() => createFinanceTransactionsApi(householdId), [householdId])
  const categoryApi = useMemo(() => createFinanceApi(householdId, userId), [householdId, userId])
  const queryKey = useMemo(() => ['financeTransactions', householdId, userId], [householdId, userId])
  const location = useLocation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const filters = readTransactionFilters(params)
  const tab = transactionsNavigation.find(item => item.to === location.pathname.replace(/\/$/, ''))?.id ?? 'overview'
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [notice, setNotice] = useState('')
  const online = useOnline()
  const today = todayDate()
  const balanceDate = transactionBalanceDate(filters.month_start, today)
  const wallets = useQuery({ queryKey: [...queryKey, 'wallets', filters.scope, today], queryFn: ({ signal }) => api.listWallets(filters.scope, today, signal) })
  const historicalBalances = useQuery({ queryKey: [...queryKey, 'walletBalances', filters.scope, balanceDate], queryFn: ({ signal }) => api.listWallets(filters.scope, balanceDate, signal), enabled: tab === 'overview' && balanceDate !== today })
  const categories = useQuery({ queryKey: ['financeCategories', householdId], queryFn: ({ signal }) => categoryApi.listCategories(signal) })
  const summary = useQuery({
    queryKey: [...queryKey, 'summary', filters.month_start, filters.scope, filters.wallet_id, filters.category_id],
    queryFn: ({ signal }) => api.getTransactionMonthSummary(filters, signal),
    enabled: tab === 'overview',
  })
  const history = useInfiniteQuery({
    queryKey: [...queryKey, 'history', filters],
    initialPageParam: null as FinanceTransactionCursor | null,
    queryFn: ({ pageParam, signal }) => api.listTransactions(filters, pageParam, 50, signal),
    getNextPageParam: page => page.next_cursor ?? undefined,
    enabled: tab !== 'wallets',
  })
  function changeFilter(key: string, value: string) {
    setParams(current => {
      const next = new URLSearchParams(current)
      if (value) next.set(key, value); else next.delete(key)
      if (key === 'scope') next.delete('wallet')
      return next
    }, { replace: true })
  }
  function resetFilters() {
    setParams({ month: filters.month_start.slice(0, 7), scope: filters.scope }, { replace: true })
  }
  function open(next: Dialog) { setNotice(''); setDialog(next) }
  function saved(message: string) { setDialog(null); setNotice(message) }
  const walletList = wallets.data ?? []
  const categoryList = categories.data ?? []
  const filtered = Boolean(filters.wallet_id || filters.category_id || filters.kinds || filters.search)
  const ready = wallets.isSuccess && categories.isSuccess && !wallets.isError && !categories.isError
  const items = history.data?.pages.flatMap(page => page.items) ?? []
  const balanceMinor = transactionBalanceMinor(balanceDate === today ? wallets.data : historicalBalances.data, filters.wallet_id)
  const balancePending = balanceDate === today ? wallets.isPending : historicalBalances.isPending
  const balanceError = balanceDate === today ? wallets.isError : historicalBalances.isError
  const navSearch = new URLSearchParams(params)
  navSearch.set('month', filters.month_start.slice(0, 7)); navSearch.set('scope', filters.scope)
  if (/^\/finance\/transactions\/?$/.test(location.pathname)) return <Navigate to={`/finance/transactions/overview?${navSearch}`} replace />
  return <div className="finance-workspace transactions-workspace">
    <PageHeader eyebrow="Finanse" title="Transakcje" description="Zapisuj rzeczywiste wpływy, wydatki i przelewy między portfelami." action={<div className="transaction-actions">
      <button className="button-quiet" disabled={!online || !ready || walletList.filter(wallet => !wallet.is_archived).length < 2} onClick={() => open({ type: 'transaction', saving: true })}>Odłóż środki</button>
      <button className="primary-button" disabled={!online || !ready || !walletList.some(wallet => !wallet.is_archived)} onClick={() => open({ type: 'transaction' })}>+ Dodaj transakcję</button>
    </div>} />
    <nav className="finance-tabs" aria-label="Zakładki transakcji">{transactionsNavigation.map(item => <Link key={item.id} className={`finance-tab${tab === item.id ? ' active' : ''}`} aria-current={tab === item.id ? 'page' : undefined} to={`${item.to}?${navSearch}`}>{item.label}</Link>)}</nav>
    <div className="transaction-filters">
      <label>Miesiąc<input type="month" value={filters.month_start.slice(0, 7)} max={today.slice(0, 7)} onChange={event => changeFilter('month', event.target.value)} /></label>
      <label>Zakres<select value={filters.scope} onChange={event => changeFilter('scope', event.target.value)}><option value="household">Domowe</option><option value="personal">Moje</option><option value="all_accessible">Wszystkie dostępne</option></select></label>
      {tab !== 'wallets' && <>
        <label>Portfel<select value={filters.wallet_id ?? ''} onChange={event => changeFilter('wallet', event.target.value)}><option value="">Wszystkie portfele</option>{filters.wallet_id && !walletList.some(wallet => wallet.id === filters.wallet_id) && <option value={filters.wallet_id}>Portfel niedostępny — wyczyść filtr</option>}{walletList.map(wallet => <option value={wallet.id} key={wallet.id}>{wallet.name}{wallet.is_archived ? ' (archiwalny)' : ''}</option>)}</select></label>
        <label>Kategoria<select value={filters.category_id ?? ''} onChange={event => changeFilter('category', event.target.value)}><option value="">Wszystkie kategorie</option>{filters.category_id && !categoryList.some(category => category.id === filters.category_id) && <option value={filters.category_id}>Kategoria niedostępna — wyczyść filtr</option>}{categoryList.map(category => <option key={category.id} value={category.id}>{categoryList.find(parent => parent.id === category.parent_id)?.name ? `${categoryList.find(parent => parent.id === category.parent_id)!.name} → ` : ''}{category.name}</option>)}</select></label>
        <label>Rodzaj<select value={filters.kinds?.[0] ?? ''} onChange={event => changeFilter('kind', event.target.value)}><option value="">Wszystkie rodzaje</option>{Object.entries(transactionKindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Szukaj w opisie<input type="search" maxLength={200} value={filters.search} onChange={event => changeFilter('search', event.target.value)} /></label>
      </>}
    </div>
    {filtered && tab !== 'wallets' && <p className="transaction-filter-status">Historia z aktywnymi filtrami <button className="button-quiet" onClick={resetFilters}>Wyczyść filtry</button></p>}
    {!online && <p role="status" className="transaction-preview">Brak połączenia. Zapis i usuwanie są niedostępne. Dane mogą być nieaktualne; po połączeniu możesz ponowić próbę.</p>}
    {notice && <p role="status" className="transaction-preview">{notice}</p>}
    {(wallets.isPending || categories.isPending) && <p role="status">{online ? 'Wczytuję portfele i kategorie…' : 'Połącz się z internetem, aby wczytać dane.'}</p>}
    {([wallets, categories] as const).map((query, index) => query.isError && <p role="alert" className="error-message" key={index}>Nie udało się wczytać {index === 0 ? 'portfeli' : 'kategorii'}. <button className="button-quiet" disabled={!online} onClick={() => void query.refetch()}>Spróbuj ponownie</button></p>)}
    {wallets.isSuccess && (tab === 'wallets' || walletList.length === 0) && <WalletsPanel wallets={walletList} online={online} onAction={(mode, wallet) => open({ type: 'wallet', mode, wallet })} onHistory={walletId => { const next = new URLSearchParams(navSearch); next.set('wallet', walletId); next.delete('category'); next.delete('kind'); next.delete('search'); navigate(`/finance/transactions/history?${next}`) }} />}
    {tab === 'overview' && summary.isPending && <p role="status">Wczytuję podsumowanie miesiąca…</p>}
    {tab === 'overview' && summary.isError && <p role="alert" className="error-message">Nie udało się wczytać podsumowania miesiąca. <button className="button-quiet" disabled={!online || summary.isFetching} onClick={() => void summary.refetch()}>Spróbuj ponownie</button></p>}
    {tab === 'overview' && ready && summary.isSuccess && <TransactionsOverview
      monthStart={filters.month_start}
      balanceDate={balanceDate}
      today={today}
      summary={summary.data}
      categories={categoryList}
      recent={items}
      wallets={walletList}
      walletSelected={Boolean(filters.wallet_id)}
      balanceMinor={balanceMinor}
      balancePending={balancePending}
      balanceError={balanceError}
      recentPending={history.isPending}
      recentError={history.isError}
      filtered={filtered}
      online={online}
      onRetryBalance={() => void (balanceDate === today ? wallets.refetch() : historicalBalances.refetch())}
      onRetryRecent={() => void history.refetch()}
      onCategoryClick={categoryId => { const next = new URLSearchParams(params); next.set('category', categoryId); navigate(`/finance/transactions/history?${next}`) }}
      onHistoryClick={() => navigate(`/finance/transactions/history?${navSearch}`)}
      onEdit={entry => open({ type: 'transaction', entry })}
      onDelete={entry => open({ type: 'delete', entry })}
      onOpening={wallet => open({ type: 'wallet', mode: 'opening', wallet })}
    />}
    {tab === 'history' && <section className="panel finance-panel">
      <div className="panel-head"><div><h2 className="panel-title">Historia transakcji</h2><p className="panel-kicker">{filtered ? 'Wyniki dla wybranych filtrów.' : 'Wszystkie rodzaje transakcji w wybranym miesiącu.'} Przelew jest jednym wpisem z dwoma portfelami.</p></div></div>
      {history.isPending && <p role="status">{online ? 'Wczytuję historię…' : 'Historia będzie dostępna po połączeniu.'}</p>}
      {history.isError && <p role="alert" className="error-message">Nie udało się wczytać {history.isFetchNextPageError ? 'kolejnej strony' : 'historii'}. <button className="button-quiet" disabled={!online || history.isFetching} onClick={() => void (history.isFetchNextPageError ? history.fetchNextPage() : history.refetch())}>Spróbuj ponownie</button></p>}
      {ready && history.data && <TransactionHistory items={items} wallets={walletList} categories={categoryList} filtered={filtered} online={online} onEdit={entry => open({ type: 'transaction', entry })} onDelete={entry => open({ type: 'delete', entry })} onOpening={wallet => open({ type: 'wallet', mode: 'opening', wallet })} />}
      {history.hasNextPage && <button className="button-quiet transaction-load-more" disabled={!online || history.isFetching} onClick={() => void history.fetchNextPage()}>{history.isFetchingNextPage ? 'Wczytuję…' : 'Pokaż kolejne 50'}</button>}
    </section>}
    {dialog?.type === 'transaction' && <TransactionForm api={api} queryKey={queryKey} wallets={walletList} categories={categoryList} month={filters.month_start.slice(0, 7)} userId={userId} entry={dialog.entry} saving={dialog.saving} onClose={() => setDialog(null)} onSaved={() => saved(dialog.entry ? 'Zapisano zmiany transakcji.' : 'Dodano transakcję.')} />}
    {dialog?.type === 'wallet' && <WalletForm api={api} queryKey={queryKey} wallet={dialog.wallet} mode={dialog.mode} defaultVisibility={filters.scope === 'personal' ? 'private' : 'household'} onClose={() => setDialog(null)} onSaved={() => saved('Zapisano portfel. Jeśli nie jest widoczny, sprawdź wybrany zakres.')} />}
    {dialog?.type === 'delete' && <DeleteTransactionDialog entry={dialog.entry} wallets={walletList} api={api} queryKey={queryKey} onClose={() => setDialog(null)} onSaved={() => saved('Usunięto transakcję.')} />}
  </div>
}
