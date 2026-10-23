import { Fragment, useMemo, useState } from 'react'
import { FinanceKpis } from '../FinanceCharts'
import type { FinanceCategory } from '../types'
import { formatFinanceAggregatePln } from '../money'
import { buildTransactionCategoryRows, type TransactionCategoryView } from './reporting'
import type { FinanceTransactionMonthSummary, FinanceTransactionScope } from './types'

type ReportKind = 'regular' | 'savings' | 'income'

const reportOptions: Array<{ id: ReportKind; label: string }> = [
  { id: 'regular', label: 'Bieżące' },
  { id: 'savings', label: 'Z oszczędności' },
  { id: 'income', label: 'Przychody' },
]

function monthLabel(monthStart: string): string {
  return new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric' })
    .format(new Date(`${monthStart}T12:00:00`))
}

function moveMonth(monthStart: string, offset: number): string {
  const [year, month] = monthStart.slice(0, 7).split('-').map(Number)
  return new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 7)
}

export function TransactionsOverview({
  monthStart,
  balanceDate,
  today,
  summary,
  categories,
  scope,
  walletIds,
  walletSelected,
  balanceMinor,
  balancePending,
  balanceError,
  filtered,
  online,
  onRetryBalance,
  onCategoryClick,
  onOpenFilters,
  onMonthChange,
  onScopeChange,
}: {
  monthStart: string
  balanceDate: string
  today: string
  summary: FinanceTransactionMonthSummary
  categories: FinanceCategory[]
  scope: FinanceTransactionScope
  walletIds: string[]
  walletSelected: boolean
  balanceMinor: bigint | null
  balancePending: boolean
  balanceError: boolean
  filtered: boolean
  online: boolean
  onRetryBalance: () => void
  onCategoryClick: (categoryId: string) => void
  onOpenFilters: () => void
  onMonthChange: (month: string) => void
  onScopeChange: (scope: FinanceTransactionScope) => void
}) {
  const [kind, setKind] = useState<ReportKind>('regular')
  const [categoryView, setCategoryView] = useState<TransactionCategoryView>('main')
  const [expandedRoot, setExpandedRoot] = useState<string | null>(null)
  const totals = kind === 'regular' ? summary.regular_category_totals
    : kind === 'savings' ? summary.savings_category_totals
      : summary.income_category_totals
  const rows = useMemo(() => buildTransactionCategoryRows(categories, totals, categoryView), [categories, totals, categoryView])
  const detailRows = useMemo(() => buildTransactionCategoryRows(categories, totals, 'detailed'), [categories, totals])
  const positiveRows = rows.filter(row => row.amount_minor > 0n)
  const positiveTotal = positiveRows.reduce((sum, row) => sum + row.amount_minor, 0n)
  const refundMinor = BigInt(kind === 'regular' ? summary.regular_refunds_minor : kind === 'savings' ? summary.savings_refunds_minor : '0')
  const currentMonth = monthStart.slice(0, 7) === today.slice(0, 7)
  const negativeBalance = balanceMinor !== null && balanceMinor < 0n
  const displayAmount = (amount: bigint) => formatFinanceAggregatePln(amount)
  const remainingMinor = BigInt(summary.monthly_balance_minor)
  let chartOffset = 0
  const chartSegments = positiveRows.map((row, index) => {
    const percent = index === positiveRows.length - 1
      ? 100 - chartOffset
      : Number(row.amount_minor * 1_000_000n / positiveTotal) / 10_000
    const segment = { ...row, percent, offset: chartOffset }
    chartOffset += percent
    return segment
  })

  function categoryHasChildren(categoryId: string) {
    return categories.some(category => category.parent_id === categoryId)
  }

  function categoryAction(row: (typeof rows)[number]) {
    if (categoryView === 'main' && categoryHasChildren(row.id)) {
      const isExpanded = expandedRoot === row.id
      return <button className="transaction-category-name" type="button" aria-expanded={isExpanded} onClick={() => setExpandedRoot(isExpanded ? null : row.id)}>
        <span>{row.name}</span><small>{isExpanded ? 'Ukryj szczegóły' : 'Pokaż szczegóły'}</small>
      </button>
    }
    return <button className="transaction-category-name" type="button" onClick={() => onCategoryClick(row.id)}>
      <span>{categoryView === 'detailed' ? row.path : row.name}</span><small>Otwórz historię</small>
    </button>
  }

  function categoryTableRow(row: (typeof detailRows)[number], index: number, nested = false) {
    return <tr key={`${row.id}-${index}`} className={nested ? 'is-nested' : undefined}>
      <th scope="row"><button className="transaction-category-name" type="button" onClick={() => onCategoryClick(row.id)}>
        <span>{categoryView === 'detailed' ? row.path : row.name}</span><small>Otwórz historię</small>
      </button></th>
      <td className={row.amount_minor < 0n ? 'transaction-category-negative' : undefined}>{displayAmount(row.amount_minor)}</td>
      <td>{row.transaction_count}</td>
    </tr>
  }

  return <div className="transaction-overview">
    <div className="transaction-period-control" aria-label="Wybór miesiąca">
      <button className="transaction-period-arrow" type="button" aria-label="Poprzedni miesiąc" onClick={() => onMonthChange(moveMonth(monthStart, -1))}>‹</button>
      <button className="transaction-period-title" type="button" aria-haspopup="dialog" onClick={onOpenFilters}>
        <strong>{monthLabel(monthStart)}</strong>
        <span>{summary.transaction_count} {summary.transaction_count === 1 ? 'transakcja' : 'transakcji'}{filtered ? ' · aktywne filtry' : ''}
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="16" rx="2" /><path d="M7.5 3v4M16.5 3v4M4 9h16" /></svg>
        </span>
      </button>
      <button className="transaction-period-arrow" type="button" aria-label="Następny miesiąc" disabled={monthStart.slice(0, 7) >= today.slice(0, 7)} onClick={() => onMonthChange(moveMonth(monthStart, 1))}>›</button>
    </div>
    <label className="transaction-overview-scope">Zakres
      <select value={scope} onChange={event => onScopeChange(event.target.value as FinanceTransactionScope)}>
        <option value="household">Domowe</option><option value="personal">Moje</option><option value="all_accessible">Wszystkie dostępne</option>
      </select>
    </label>

    <FinanceKpis className="transaction-kpi-grid" values={[
      { label: 'Przychody', value: formatFinanceAggregatePln(summary.income_minor) },
      { label: 'Wydatki', value: formatFinanceAggregatePln(summary.regular_expenses_minor) },
      { label: 'Pozostało', value: formatFinanceAggregatePln(remainingMinor) },
      { label: 'Odłożono', value: formatFinanceAggregatePln(summary.savings_contributions_minor) },
    ]} />

    <div className="transaction-overview-main">
      <section className="panel finance-chart-panel transaction-category-panel" aria-labelledby="transaction-category-title">
        <div className="panel-head"><div><h2 className="panel-title" id="transaction-category-title">Kategorie</h2>
          <p className="panel-kicker">Kwoty netto według aktualnych kategorii.</p></div></div>
        <div className="transaction-report-controls">
          <div className="transaction-tabs" role="group" aria-label="Rodzaj zestawienia kategorii">
            {reportOptions.map(option => <button type="button" key={option.id} aria-pressed={kind === option.id} onClick={() => { setKind(option.id); setExpandedRoot(null) }}>{option.label}</button>)}
          </div>
          <div className="transaction-tabs transaction-category-view" role="group" aria-label="Poziom kategorii">
            <button type="button" aria-pressed={categoryView === 'main'} onClick={() => { setCategoryView('main'); setExpandedRoot(null) }}>Główne</button>
            <button type="button" aria-pressed={categoryView === 'detailed'} onClick={() => setCategoryView('detailed')}>Szczegółowe</button>
          </div>
        </div>
        {positiveRows.length > 0 && <div className="transaction-category-chart" aria-label="Wykres kategorii">
          <svg viewBox="0 0 220 220" className="transaction-category-donut" aria-hidden="true" focusable="false">
            <circle cx="110" cy="110" r="72" className="transaction-donut-track" />
            {chartSegments.map((segment, index) => <circle key={segment.id} cx="110" cy="110" r="72" fill="none" stroke={`var(--finance-chart-${index % 4 + 1})`} strokeWidth="42" pathLength="100" strokeDasharray={`${segment.percent} ${100 - segment.percent}`} strokeDashoffset={-segment.offset} transform="rotate(-90 110 110)" />)}
          </svg>
          <p className="transaction-chart-total"><strong>{displayAmount(positiveTotal)}</strong><span>{kind === 'regular' ? 'Dodatnie wydatki netto' : kind === 'savings' ? 'Dodatnie wydatki netto z oszczędności' : 'Przychody według kategorii'}</span></p>
        </div>}
        {rows.length === 0 && <p className="panel-message">Brak kategorii z aktywnością w tym miesiącu.</p>}
        {rows.length > 0 && <div className="transaction-category-table-wrap"><table className="transaction-category-table">
          <caption className="sr-only">Zestawienie kwot i liczby transakcji w kategoriach</caption>
          <thead><tr><th scope="col">Kategoria</th><th scope="col">Kwota netto</th><th scope="col">Wpisy</th></tr></thead>
          <tbody>{rows.map((row, index) => {
            if (categoryView === 'detailed') return categoryTableRow(row, index)
            const expandable = categoryHasChildren(row.id)
            const expanded = expandedRoot === row.id
            const nestedRows = expanded ? detailRows.filter(detail => row.category_ids.includes(detail.id)) : []
            return <Fragment key={row.id}>
              <tr>
                <th scope="row">{categoryAction(row)}</th>
                <td className={row.amount_minor < 0n ? 'transaction-category-negative' : undefined}>{displayAmount(row.amount_minor)}</td>
                <td>{row.transaction_count}</td>
              </tr>
              {expandable && nestedRows.map((detail, detailIndex) => categoryTableRow(detail, detailIndex, true))}
            </Fragment>
          })}</tbody>
        </table></div>}
        {refundMinor > 0n && <p className="transaction-refund-note">{kind === 'regular' ? 'Zwroty bieżących wydatków' : 'Zwroty wydatków z oszczędności'}: {displayAmount(refundMinor)}. Są już odjęte od kwot netto kategorii.</p>}
      </section>

    </div>

    <section className="transaction-secondary-metrics" aria-label="Pozostałe podsumowanie miesiąca">
      <div className="transaction-secondary-card"><span>{currentMonth ? 'Saldo na dziś' : 'Saldo na koniec miesiąca'}</span>
        {balancePending ? <strong>Wczytuję…</strong> : balanceError ? <><strong>—</strong><button className="button-quiet" type="button" disabled={!online} onClick={onRetryBalance}>Spróbuj ponownie</button></> : <strong className={negativeBalance ? 'transaction-warning' : undefined}>{balanceMinor === null ? '—' : formatFinanceAggregatePln(balanceMinor)}</strong>}
        <small>{balanceError ? 'Nie udało się wczytać sald portfeli.' : `${walletSelected ? `Saldo ${walletIds.length > 1 ? 'wybranych portfeli' : 'wybranego portfela'}` : 'Saldo fizycznych portfeli'} na ${balanceDate}; nie jest bilansem miesiąca.`}</small>
      </div>
      <div className="transaction-secondary-card"><span>Wydatki z oszczędności</span><strong>{formatFinanceAggregatePln(summary.savings_spending_minor)}</strong><small>Po odjęciu zwrotów; poza bilansem miesiąca.</small></div>
      <div className="transaction-secondary-card"><span>Wydatki łącznie</span><strong>{formatFinanceAggregatePln(summary.total_spending_minor)}</strong><small>Wydatki bieżące i netto wydatków z oszczędności.</small></div>
      <div className="transaction-secondary-card"><span>Zmiana oszczędności</span><strong>{formatFinanceAggregatePln(summary.savings_change_minor)}</strong><small>Odłożono minus wydatki netto z oszczędności.</small></div>
    </section>
  </div>
}
