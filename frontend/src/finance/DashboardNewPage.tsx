import { useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthGate'
import { PageHeader } from '../components/PageHeader'
import { createFinanceApi } from './api'
import { createFinanceTransactionsApi } from './transactions/api'
import { TransactionPeriodControl } from './transactions/TransactionPeriodControl'
import { TransactionDialog } from './transactions/Dialog'
import { readTransactionFilters, todayDate } from './transactions/filters'
import { formatFinanceAggregatePln } from './money'
import type { FinanceBudgetItem, FinanceBudgetType, FinanceCategory } from './types'
import type { FinanceTransactionCategoryTotal } from './transactions/types'
import './transactions/transactions.css'
import './dashboard-new.css'

type ComparisonKind = 'income' | 'expense'

interface CategoryComparisonRow {
  categoryId: string
  name: string
  planned: bigint
  actual: bigint
  hasPlan: boolean
}

function categoryPath(category: FinanceCategory, categoriesById: Map<string, FinanceCategory>): string {
  const names = [category.name]
  const seen = new Set([category.id])
  let parentId = category.parent_id

  while (parentId && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = categoriesById.get(parentId)
    if (!parent) break
    names.unshift(parent.name)
    parentId = parent.parent_id
  }

  return names.join(' → ')
}

function categoryRows(
  kind: ComparisonKind,
  budgetItems: FinanceBudgetItem[],
  categories: FinanceCategory[],
  actualTotals: FinanceTransactionCategoryTotal[],
): CategoryComparisonRow[] {
  const categoriesById = new Map(categories.map(category => [category.id, category]))
  const amounts = new Map<string, { planned: bigint; actual: bigint; hasPlan: boolean }>()
  const isIncludedType = (type: FinanceBudgetType) => kind === 'income'
    ? type === 'income'
    : type === 'fixed_expense' || type === 'variable_expense'

  for (const item of budgetItems) {
    const category = categoriesById.get(item.category_id)
    if (!category || !isIncludedType(category.budget_type)) continue
    const amount = amounts.get(category.id) ?? { planned: 0n, actual: 0n, hasPlan: false }
    amount.planned += BigInt(item.amount)
    amount.hasPlan = true
    amounts.set(category.id, amount)
  }

  for (const total of actualTotals) {
    if (!isIncludedType(total.budget_type)) continue
    const amount = amounts.get(total.category_id) ?? { planned: 0n, actual: 0n, hasPlan: false }
    amount.actual += BigInt(total.amount_minor)
    amounts.set(total.category_id, amount)
  }

  return [...amounts.entries()].map(([categoryId, amount]) => {
    const category = categoriesById.get(categoryId)
    const total = actualTotals.find(candidate => candidate.category_id === categoryId)
    return {
      categoryId,
      name: category ? categoryPath(category, categoriesById) : total?.category_name ?? 'Kategoria niedostępna',
      planned: amount.planned,
      actual: amount.actual,
      hasPlan: amount.hasPlan,
    }
  }).sort((left, right) => left.name.localeCompare(right.name, 'pl-PL'))
}

function signedAmount(value: bigint): string {
  const formatted = formatFinanceAggregatePln(value)
  return value > 0n ? `+${formatted}` : formatted
}

function percentLabel(value: number): string {
  return `${new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 }).format(value)}%`
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Nie udało się wczytać danych finansowych.'
}

function DashboardMonthDialog({ month, maxMonth, onApply, onClose }: {
  month: string
  maxMonth: string
  onApply: (month: string) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(month)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (value) onApply(value)
  }

  return <TransactionDialog title="Wybierz miesiąc" busy={false} dirty={false} onClose={onClose} className="transaction-filter-dialog dashboard-new-month-dialog">
    <form onSubmit={submit}>
      <div className="transaction-dialog-body">
        <label className="transaction-filter-month">Miesiąc
          <input type="month" required value={value} max={maxMonth} onChange={event => setValue(event.target.value)} />
        </label>
        <p className="transaction-filter-help">Wybierz okres, dla którego chcesz porównać budżet z transakcjami.</p>
      </div>
      <footer><button className="primary-button" type="submit">Pokaż miesiąc</button></footer>
    </form>
  </TransactionDialog>
}

function ComparisonCard({ kind, planned, actual }: { kind: ComparisonKind; planned: bigint; actual: bigint }) {
  const difference = actual - planned
  const completion = planned > 0n
    ? Number((actual > 0n ? actual : 0n) * 10_000n / planned) / 100
    : null
  const progressWidth = completion === null ? actual > 0n ? 100 : 0 : Math.min(100, completion)
  const unfavorable = kind === 'income' ? difference < 0n : difference > 0n
  const title = kind === 'income' ? 'Przychody' : 'Wydatki bieżące'
  const actualLabel = kind === 'income' ? 'Otrzymano' : 'Wydano'
  const status = planned === 0n
    ? actual > 0n ? 'Powyżej planu' : 'Brak planu'
    : difference === 0n ? 'Zgodnie z planem' : difference > 0n ? 'Powyżej planu' : 'Poniżej planu'

  return <article className={`dashboard-new-metric${unfavorable ? ' is-unfavorable' : ''}`}>
    <div className="dashboard-new-metric-heading"><h2>{title}</h2><span>{status}</span></div>
    <div className="dashboard-new-metric-values">
      <div><span>Plan</span><strong>{formatFinanceAggregatePln(planned)}</strong></div>
      <div><span>{actualLabel}</span><strong>{formatFinanceAggregatePln(actual)}</strong></div>
    </div>
    <div className="dashboard-new-progress" role="img" aria-label={`${actualLabel}: ${completion === null ? 'brak planu' : `${percentLabel(completion)} planu`}`}>
      <i style={{ width: `${progressWidth}%` }} />
    </div>
    <div className={`dashboard-new-difference${unfavorable ? ' is-unfavorable' : ''}`}>
      <span>Różnica względem planu</span><strong>{signedAmount(difference)}</strong>
    </div>
    <p className="dashboard-new-progress-label">{completion !== null ? `${percentLabel(completion)} planu` : actual > 0n ? 'Brak planu dla tej kwoty' : 'Brak planu'}</p>
  </article>
}

function CategoryComparison({ kind, rows, month }: { kind: ComparisonKind; rows: CategoryComparisonRow[]; month: string }) {
  const title = kind === 'income' ? 'Przychody według kategorii' : 'Wydatki według kategorii'
  const firstColumn = kind === 'income' ? 'Kategoria przychodu' : 'Kategoria wydatku'
  const actualLabel = kind === 'income' ? 'Otrzymano' : 'Wydano'

  return <section className="panel finance-chart-panel dashboard-new-table-panel">
    <div className="panel-head">
      <div><h2 className="panel-title">{title}</h2><p className="panel-kicker">Kwoty rzeczywiste minus plan; dodatnia różnica oznacza wykonanie powyżej planu.</p></div>
      <Link className="dashboard-new-history-link" to={`/finance/transactions/overview?month=${month}&scope=household`}>Transakcje <span aria-hidden="true">↗</span></Link>
    </div>
    <div className="dashboard-new-table-wrap">
      <table className="dashboard-new-table">
        <thead><tr><th scope="col">{firstColumn}</th><th scope="col">Plan</th><th scope="col">{actualLabel}</th><th scope="col">Różnica</th></tr></thead>
        <tbody>
          {rows.map(row => {
            const difference = row.actual - row.planned
            const unfavorable = kind === 'income' ? difference < 0n : difference > 0n
            const query = new URLSearchParams({ month, scope: 'household', category: row.categoryId })
            return <tr key={row.categoryId}>
              <th scope="row"><Link className="dashboard-new-category-link" to={`/finance/transactions/history?${query.toString()}`}>{row.name}</Link>
                {!row.hasPlan && <small>Poza planem</small>}
              </th>
              <td>{formatFinanceAggregatePln(row.planned)}</td>
              <td>{formatFinanceAggregatePln(row.actual)}</td>
              <td className={`dashboard-new-variance${unfavorable ? ' is-unfavorable' : ''}`}>{signedAmount(difference)}</td>
            </tr>
          })}
          {!rows.length && <tr><td colSpan={4} className="dashboard-new-empty">Brak pozycji budżetu i transakcji w tym zestawieniu.</td></tr>}
        </tbody>
      </table>
    </div>
  </section>
}

function DashboardNewWorkspace({ householdId, userId }: { householdId: string; userId: string }) {
  const financeApi = useMemo(() => createFinanceApi(householdId, userId), [householdId, userId])
  const transactionsApi = useMemo(() => createFinanceTransactionsApi(householdId), [householdId])
  const [params, setParams] = useSearchParams()
  const [monthPickerOpen, setMonthPickerOpen] = useState(false)
  const today = todayDate()
  const filters = readTransactionFilters(params, today)
  const monthStart = filters.month_start
  const month = monthStart.slice(0, 7)

  const months = useQuery({
    queryKey: ['financeMonths', householdId],
    queryFn: ({ signal }) => financeApi.listMonths(signal),
  })
  const categories = useQuery({
    queryKey: ['financeCategories', householdId],
    queryFn: ({ signal }) => financeApi.listCategories(signal),
  })
  const budgetMonth = (months.data ?? []).find(candidate => candidate.month_start === monthStart)
  const budgetItems = useQuery({
    queryKey: ['financeBudgetItems', householdId, budgetMonth?.id ?? null],
    queryFn: ({ signal }) => financeApi.listBudgetItems(budgetMonth!.id, signal),
    enabled: Boolean(budgetMonth),
  })
  const summary = useQuery({
    queryKey: ['financeTransactions', householdId, userId, 'summary', monthStart, 'household', [], [], undefined],
    queryFn: ({ signal }) => transactionsApi.getTransactionMonthSummary({ month_start: monthStart, scope: 'household' }, signal),
  })

  const categoryList = categories.data ?? []
  const budgetItemList = budgetItems.data ?? []
  const incomeRows = useMemo(() => categoryRows('income', budgetItemList, categoryList, summary.data?.income_category_totals ?? []), [budgetItemList, categoryList, summary.data?.income_category_totals])
  const expenseRows = useMemo(() => categoryRows('expense', budgetItemList, categoryList, summary.data?.regular_category_totals ?? []), [budgetItemList, categoryList, summary.data?.regular_category_totals])
  const incomePlan = incomeRows.reduce((total, row) => total + row.planned, 0n)
  const expensePlan = expenseRows.reduce((total, row) => total + row.planned, 0n)
  const loading = months.isPending || categories.isPending || summary.isPending || (Boolean(budgetMonth) && budgetItems.isPending)
  const ready = months.isSuccess && categories.isSuccess && summary.isSuccess && (!budgetMonth || budgetItems.isSuccess)

  function changeMonth(nextMonth: string) {
    setParams({ month: nextMonth, scope: 'household' }, { replace: true })
  }

  return <div className="finance-workspace dashboard-new-workspace">
    <PageHeader eyebrow="Finanse" title="Dashboard nowy" description="Porównaj plan z rzeczywistymi przychodami i wydatkami w wybranym miesiącu." />

    <TransactionPeriodControl
      monthStart={monthStart}
      today={today}
      transactionCount={summary.data?.transaction_count}
      loading={summary.isPending}
      filtered={false}
      onOpenFilters={() => setMonthPickerOpen(true)}
      onMonthChange={changeMonth}
    />

    {months.isError && <p className="error-message" role="alert">{errorText(months.error)}</p>}
    {categories.isError && <p className="error-message" role="alert">{errorText(categories.error)}</p>}
    {budgetMonth && budgetItems.isError && <p className="error-message" role="alert">{errorText(budgetItems.error)}</p>}
    {summary.isError && <p className="error-message" role="alert">{errorText(summary.error)}</p>}
    {loading && <p className="panel-message" role="status">Ładuję plan i transakcje…</p>}

    {ready && summary.data && <>
      {!budgetMonth && <p className="dashboard-new-budget-notice">Nie ma budżetu na ten miesiąc. Transakcje są nadal widoczne; planowane kwoty wynoszą 0 zł. <Link to="/finance/budget">Otwórz Budżet</Link></p>}
      <div className="dashboard-new-metrics">
        <ComparisonCard kind="income" planned={incomePlan} actual={BigInt(summary.data.income_minor)} />
        <ComparisonCard kind="expense" planned={expensePlan} actual={BigInt(summary.data.regular_expenses_minor)} />
      </div>
      <div className="dashboard-new-explanation">Wydatki bieżące są liczone po odjęciu zwrotów. Oszczędności i inwestycje pozostają osobno w zakładkach Budżet i Transakcje.</div>
      <CategoryComparison kind="income" rows={incomeRows} month={month} />
      <CategoryComparison kind="expense" rows={expenseRows} month={month} />
    </>}

    {monthPickerOpen && <DashboardMonthDialog month={month} maxMonth={today.slice(0, 7)} onApply={nextMonth => { changeMonth(nextMonth); setMonthPickerOpen(false) }} onClose={() => setMonthPickerOpen(false)} />}
  </div>
}

export function DashboardNewPage() {
  const { profile } = useAuth()
  return <DashboardNewWorkspace key={`${profile.household_id}:${profile.id}`} householdId={profile.household_id} userId={profile.id} />
}
