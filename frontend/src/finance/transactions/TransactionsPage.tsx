import { useMemo, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useAuth } from '../../auth/AuthGate'
import { PageHeader } from '../../components/PageHeader'
import { createFinanceApi } from '../api'
import { FinanceKpis } from '../FinanceCharts'
import { formatFinanceAggregatePln } from '../money'
import { transactionsNavigation } from '../navigation'
import { createFinanceTransactionsApi } from './api'
import { readTransactionFilters, todayDate } from './filters'
import { transactionBalanceDate, transactionBalanceMinor } from './reporting'
import { useOnline } from './useTransactionAction'
import { TransactionForm } from './TransactionForm'
import { WalletForm, type WalletAction } from './WalletForm'
import { WalletsPanel } from './WalletsPanel'
import { TransactionHistory } from './TransactionHistory'
import { DeleteTransactionDialog } from './DeleteTransactionDialog'
import { TransactionsOverview } from './TransactionsOverview'
import { TransactionPeriodControl } from './TransactionPeriodControl'
import { TransactionHistorySkeleton, TransactionHistorySummarySkeleton, TransactionOverviewSkeleton } from './TransactionLoadingSkeletons'
import { TransactionsFilterDialog, type TransactionFilterDraft } from './TransactionsFilterDialog'
import type { TransactionMultiSelectOption } from './TransactionMultiSelect'
import type { FinanceTransaction, FinanceTransactionCursor, FinanceTransactionScope, FinanceWalletWithBalance } from './types'
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
  const [filterDialogOpen, setFilterDialogOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const online = useOnline()
  const today = todayDate()
  const walletIds = filters.wallet_ids ?? (filters.wallet_id ? [filters.wallet_id] : [])
  const categoryIds = filters.category_ids ?? (filters.category_id ? [filters.category_id] : [])
  const balanceDate = transactionBalanceDate(filters.month_start, today)
  const wallets = useQuery({ queryKey: [...queryKey, 'wallets', filters.scope, today], queryFn: ({ signal }) => api.listWallets(filters.scope, today, signal) })
  const filterWallets = useQuery({
    queryKey: [...queryKey, 'filterWallets', today],
    queryFn: ({ signal }) => api.listWallets('all_accessible', today, signal),
    enabled: filterDialogOpen && (tab === 'overview' || tab === 'history'),
    staleTime: 60_000,
  })
  const historicalBalances = useQuery({ queryKey: [...queryKey, 'walletBalances', filters.scope, balanceDate], queryFn: ({ signal }) => api.listWallets(filters.scope, balanceDate, signal), enabled: tab === 'overview' && balanceDate !== today })
  const categories = useQuery({ queryKey: ['financeCategories', householdId], queryFn: ({ signal }) => categoryApi.listCategories(signal) })
  const summary = useQuery({
    queryKey: [...queryKey, 'summary', filters.month_start, filters.scope, walletIds, categoryIds, filters.kinds],
    queryFn: ({ signal }) => api.getTransactionMonthSummary(filters, signal),
    enabled: tab === 'overview' || tab === 'history',
  })
  const history = useInfiniteQuery({
    queryKey: [...queryKey, 'history', filters],
    initialPageParam: null as FinanceTransactionCursor | null,
    queryFn: ({ pageParam, signal }) => api.listTransactions(filters, pageParam, 50, signal),
    getNextPageParam: page => page.next_cursor ?? undefined,
    enabled: tab === 'history',
  })
  function changeFilter(key: string, value: string) {
    setParams(current => {
      const next = new URLSearchParams(current)
      if (value) next.set(key, value); else next.delete(key)
      if (key === 'scope') next.delete('wallet')
      return next
    }, { replace: true })
  }
  function applyTransactionFilters(nextFilters: TransactionFilterDraft) {
    setParams(current => {
      const next = new URLSearchParams(current)
      next.set('month', nextFilters.month)
      next.set('scope', nextFilters.scope)
      next.delete('search')
      for (const [key, values] of [['wallet', nextFilters.walletIds], ['category', nextFilters.categoryIds], ['kind', nextFilters.kinds]] as const) {
        next.delete(key)
        values.forEach(value => next.append(key, value))
      }
      return next
    }, { replace: true })
    setFilterDialogOpen(false)
  }
  function resetFilters() {
    setParams({ month: filters.month_start.slice(0, 7), scope: filters.scope }, { replace: true })
  }
  function open(next: Dialog) { setNotice(''); setDialog(next) }
  function saved(message: string) { setDialog(null); setNotice(message) }
  function openWalletHistory(walletId: string) {
    const next = new URLSearchParams(navSearch)
    next.delete('wallet'); next.append('wallet', walletId); next.delete('category'); next.delete('kind'); next.delete('search')
    setDialog(null)
    navigate(`/finance/transactions/history?${next}`)
  }
  const walletList = wallets.data ?? []
  const categoryList = categories.data ?? []
  const walletFilterList = filterWallets.data ?? []
  const walletOptionsFor = (scopeWallets: FinanceWalletWithBalance[]) => scopeWallets.map(wallet => ({ value: wallet.id, label: `${wallet.name}${wallet.is_archived ? ' (archiwalny)' : ''}` }))
  const currentScopeWalletOptions = walletOptionsFor(walletList)
  const walletOptionsByScope: Record<FinanceTransactionScope, TransactionMultiSelectOption[]> = {
    household: walletOptionsFor(walletFilterList.filter(wallet => wallet.visibility === 'household')),
    personal: walletOptionsFor(walletFilterList.filter(wallet => wallet.visibility === 'private' && wallet.owner_user_id === userId)),
    all_accessible: walletOptionsFor(walletFilterList),
  }
  if (!filterWallets.data) walletOptionsByScope[filters.scope] = currentScopeWalletOptions
  for (const walletId of walletIds) {
    if (!walletOptionsByScope[filters.scope].some(option => option.value === walletId)) walletOptionsByScope[filters.scope].push({ value: walletId, label: 'Portfel niedostępny' })
  }
  const categoryOptions: TransactionMultiSelectOption[] = categoryList.map(category => {
    const parentName = categoryList.find(parent => parent.id === category.parent_id)?.name
    return { value: category.id, label: parentName ? `${parentName} → ${category.name}` : category.name }
  })
  for (const categoryId of categoryIds) if (!categoryOptions.some(option => option.value === categoryId)) categoryOptions.push({ value: categoryId, label: 'Kategoria niedostępna' })
  const reportFiltered = Boolean(walletIds.length || categoryIds.length || filters.kinds?.length)
  const filtered = reportFiltered || Boolean(filters.search)
  const ready = wallets.isSuccess && categories.isSuccess && !wallets.isError && !categories.isError
  const items = history.data?.pages.flatMap(page => page.items) ?? []
  const balanceMinor = transactionBalanceMinor(balanceDate === today ? wallets.data : historicalBalances.data, walletIds)
  const balancePending = balanceDate === today ? wallets.isPending : historicalBalances.isPending
  const balanceError = balanceDate === today ? wallets.isError : historicalBalances.isError
  const navSearch = new URLSearchParams(params)
  navSearch.delete('search')
  navSearch.set('month', filters.month_start.slice(0, 7)); navSearch.set('scope', filters.scope)
  if (/^\/finance\/transactions\/?$/.test(location.pathname)) return <Navigate to={`/finance/transactions/overview?${navSearch}`} replace />
  return <div className="finance-workspace transactions-workspace">
    <PageHeader eyebrow="Finanse" title="Transakcje" description="Zapisuj rzeczywiste wpływy, wydatki i przelewy między portfelami." action={<div className="transaction-actions">
      <button className="button-quiet" disabled={!online || !ready || walletList.filter(wallet => !wallet.is_archived).length < 2} onClick={() => open({ type: 'transaction', saving: true })}>Odłóż środki</button>
      <button className="primary-button" disabled={!online || !ready || !walletList.some(wallet => !wallet.is_archived)} onClick={() => open({ type: 'transaction' })}>+ Dodaj transakcję</button>
    </div>} />
    <nav className="finance-tabs" aria-label="Zakładki transakcji">{transactionsNavigation.map(item => <Link key={item.id} className={`finance-tab${tab === item.id ? ' active' : ''}`} aria-current={tab === item.id ? 'page' : undefined} to={`${item.to}?${navSearch}`}>{item.label}</Link>)}</nav>
    {tab === 'wallets' && <div className="transaction-filters">
      <label>Zakres<select value={filters.scope} onChange={event => changeFilter('scope', event.target.value)}><option value="household">Domowe</option><option value="personal">Moje</option><option value="all_accessible">Wszystkie dostępne</option></select></label>
    </div>}
    {!online && <p role="status" className="transaction-preview">Brak połączenia. Zapis i usuwanie są niedostępne. Dane mogą być nieaktualne; po połączeniu możesz ponowić próbę.</p>}
    {notice && <p role="status" className="transaction-preview">{notice}</p>}
    {tab !== 'overview' && tab !== 'history' && (wallets.isPending || categories.isPending) && <p role="status">{online ? 'Wczytuję portfele i kategorie…' : 'Połącz się z internetem, aby wczytać dane.'}</p>}
    {([wallets, categories] as const).map((query, index) => query.isError && <p role="alert" className="error-message" key={index}>Nie udało się wczytać {index === 0 ? 'portfeli' : 'kategorii'}. <button className="button-quiet" disabled={!online} onClick={() => void query.refetch()}>Spróbuj ponownie</button></p>)}
    {tab === 'wallets' && wallets.isSuccess && <WalletsPanel wallets={walletList} online={online} onAction={(mode, wallet) => open({ type: 'wallet', mode, wallet })} />}
    {tab === 'overview' && <div className="transaction-overview-page">
      <TransactionPeriodControl monthStart={filters.month_start} today={today} transactionCount={summary.data?.transaction_count} loading={summary.isPending} filtered={filtered} onOpenFilters={() => setFilterDialogOpen(true)} onMonthChange={month => changeFilter('month', month)} />
      {(summary.isPending || wallets.isPending || categories.isPending) && <TransactionOverviewSkeleton />}
      {summary.isError && <p role="alert" className="error-message">Nie udało się wczytać podsumowania miesiąca. <button className="button-quiet" disabled={!online || summary.isFetching} onClick={() => void summary.refetch()}>Spróbuj ponownie</button></p>}
      {ready && summary.isSuccess && <div key={filters.month_start} className="transaction-month-loaded"><TransactionsOverview
        monthStart={filters.month_start}
        balanceDate={balanceDate}
        today={today}
        summary={summary.data}
        categories={categoryList}
        walletIds={walletIds}
        walletSelected={walletIds.length > 0}
        balanceMinor={balanceMinor}
        balancePending={balancePending}
        balanceError={balanceError}
        online={online}
        onRetryBalance={() => void (balanceDate === today ? wallets.refetch() : historicalBalances.refetch())}
        onCategoryClick={categoryId => { const next = new URLSearchParams(params); next.delete('category'); next.append('category', categoryId); navigate(`/finance/transactions/history?${next}`) }}
      /></div>}
    </div>}
    {tab === 'history' && <div className="transaction-history-page">
      <TransactionPeriodControl monthStart={filters.month_start} today={today} transactionCount={summary.data?.transaction_count} loading={summary.isPending} filtered={filtered} onOpenFilters={() => setFilterDialogOpen(true)} onMonthChange={month => changeFilter('month', month)} />
      {filtered && <p className="transaction-filter-status">Historia z aktywnymi filtrami <button className="button-quiet" onClick={resetFilters}>Wyczyść filtry</button></p>}
      <section key={filters.month_start} className="panel finance-panel transaction-history-panel">
        {summary.isPending ? <TransactionHistorySummarySkeleton /> : summary.data && <FinanceKpis className="transaction-history-kpi-grid transaction-month-loaded" values={[
          { label: 'Przychody', value: summary.data ? formatFinanceAggregatePln(BigInt(summary.data.income_minor)) : '—' },
          { label: 'Wydatki', value: summary.data ? formatFinanceAggregatePln(BigInt(summary.data.regular_expenses_minor)) : '—' },
          { label: 'Saldo', value: summary.data ? formatFinanceAggregatePln(BigInt(summary.data.monthly_balance_minor)) : '—' },
        ]} />}
        {summary.isError && <p role="alert" className="error-message">Nie udało się wczytać podsumowania miesiąca. <button className="button-quiet" disabled={!online || summary.isFetching} onClick={() => void summary.refetch()}>Spróbuj ponownie</button></p>}
        <div className="panel-head"><div><h2 className="panel-title">Historia transakcji</h2><p className="panel-kicker">{filtered ? 'Wyniki dla wybranych filtrów.' : 'Transakcje w wybranym miesiącu.'} Dotknij wpisu, aby go edytować.</p></div></div>
      {(history.isPending || (!ready && !wallets.isError && !categories.isError)) && <TransactionHistorySkeleton />}
      {history.isError && <p role="alert" className="error-message">Nie udało się wczytać {history.isFetchNextPageError ? 'kolejnej strony' : 'historii'}. <button className="button-quiet" disabled={!online || history.isFetching} onClick={() => void (history.isFetchNextPageError ? history.fetchNextPage() : history.refetch())}>Spróbuj ponownie</button></p>}
      {ready && history.data && <TransactionHistory items={items} wallets={walletList} categories={categoryList} filtered={filtered} online={online} today={today} onEdit={entry => open({ type: 'transaction', entry })} onOpening={wallet => open({ type: 'wallet', mode: 'opening', wallet })} />}
      {history.hasNextPage && <button className="button-quiet transaction-load-more" disabled={!online || history.isFetching} onClick={() => void history.fetchNextPage()}>{history.isFetchingNextPage ? 'Wczytuję…' : 'Pokaż kolejne 50'}</button>}
      </section>
    </div>}
    {dialog?.type === 'transaction' && <TransactionForm api={api} queryKey={queryKey} wallets={walletList} categories={categoryList} month={filters.month_start.slice(0, 7)} userId={userId} entry={dialog.entry} saving={dialog.saving} onClose={() => setDialog(null)} onDelete={dialog.entry ? () => open({ type: 'delete', entry: dialog.entry! }) : undefined} onSaved={() => saved(dialog.entry ? 'Zapisano zmiany transakcji.' : 'Dodano transakcję.')} />}
    {dialog?.type === 'wallet' && <WalletForm api={api} queryKey={queryKey} wallet={dialog.wallet} mode={dialog.mode} defaultVisibility={filters.scope === 'personal' ? 'private' : 'household'} scope={filters.scope} monthStart={`${today.slice(0, 7)}-01`} categories={categoryList} userId={userId} onTransition={(mode, wallet) => open({ type: 'wallet', mode, wallet })} onHistory={openWalletHistory} onClose={() => setDialog(null)} onSaved={() => saved('Zapisano portfel. Jeśli nie jest widoczny, sprawdź wybrany zakres.')} />}
    {dialog?.type === 'delete' && <DeleteTransactionDialog entry={dialog.entry} wallets={walletList} api={api} queryKey={queryKey} onClose={() => setDialog(null)} onSaved={() => saved('Usunięto transakcję.')} />}
    {filterDialogOpen && (tab === 'overview' || tab === 'history') && <TransactionsFilterDialog
      initial={{ month: filters.month_start.slice(0, 7), scope: filters.scope, walletIds, categoryIds, kinds: filters.kinds ?? [] }}
      maxMonth={today.slice(0, 7)}
      walletOptionsByScope={walletOptionsByScope}
      walletOptionsLoading={filterWallets.isPending}
      walletOptionsError={filterWallets.isError}
      onRetryWalletOptions={() => void filterWallets.refetch()}
      categoryOptions={categoryOptions}
      onApply={applyTransactionFilters}
      onClose={() => setFilterDialogOpen(false)}
    />}
  </div>
}
