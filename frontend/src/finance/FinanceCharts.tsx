import { calculateMonthSummary } from './calculations'
import { formatPln, moneyRatio, parseMoney, sumMoney } from './money'
import type { FinanceBudgetLine, FinanceMoney, FinanceMonthSummary } from './types'

const percent = (value: number) => new Intl.NumberFormat('pl-PL', { style: 'percent', maximumFractionDigits: 1 }).format(value)

export function FinanceKpis({ values, className = '' }: { values: Array<{ label: string; value: string; hint?: string }>; className?: string }) {
  return <div className={`finance-kpi-grid ${className}`.trim()}>{values.map(item => <div className="finance-summary-card" key={item.label}>
    <span>{item.label}</span><strong>{item.value}</strong>{item.hint && <small>{item.hint}</small>}
  </div>)}</div>
}

export function MonthKpis({ summary, dashboard = false }: { summary: FinanceMonthSummary; dashboard?: boolean }) {
  return <FinanceKpis values={dashboard ? [
    { label: 'Przychody', value: formatPln(summary.income) },
    { label: 'Wydatki', value: formatPln(summary.total_expenses) },
    { label: 'Oszczędności + inwestycje', value: formatPln(summary.savings_and_investments) },
    { label: 'Saldo', value: formatPln(summary.cashflow), hint: parseMoney(summary.cashflow) < 0n ? 'Miesiąc na minusie' : 'Nadwyżka miesiąca' },
    { label: 'Stopa oszczędzania', value: percent(summary.savings_rate) },
  ] : [
    { label: 'Przychody', value: formatPln(summary.income_after_personal_allowances), hint: `Przed: ${formatPln(summary.income)} · indywidualne: ${formatPln(summary.personal_allowances)}` },
    { label: 'Stałe', value: formatPln(summary.fixed_expenses) },
    { label: 'Zmienne', value: formatPln(summary.variable_expenses) },
    { label: 'Odkładanie + inwestycje', value: formatPln(summary.savings_and_investments) },
    { label: 'Odkładanie + inwestycje + zostało', value: formatPln(summary.savings_investments_and_leftover), hint: `Zostało: ${formatPln(summary.cashflow)}` },
    { label: 'Stopa oszczędzania', value: `${percent(summary.savings_rate)} / ${percent(summary.savings_rate_with_leftover)}`, hint: 'Bez zostało / ze zostało' },
  ]} />
}

export function FinanceDashboard({ lines, monthName }: { lines: FinanceBudgetLine[]; monthName: string }) {
  const summary = calculateMonthSummary(lines)
  const slices = [
    { label: 'Wydatki stałe', amount: summary.fixed_expenses },
    { label: 'Wydatki zmienne', amount: summary.variable_expenses },
    { label: 'Oszczędności', amount: summary.savings },
    { label: 'Inwestycje', amount: summary.investments },
  ].filter(item => parseMoney(item.amount) > 0n)
  const total = sumMoney(slices.map(item => item.amount))
  let offset = 0
  return <div className="finance-page-stack">
    <div className="finance-section-title"><h2>{monthName}</h2><p>Najważniejsze liczby dla wybranego miesiąca.</p></div>
    <MonthKpis summary={summary} dashboard />
    <section className="panel finance-chart-panel"><h2 className="panel-title">Struktura miesiąca</h2>
      {slices.length ? <div className="finance-pie-layout">
        <svg viewBox="0 0 240 240" className="finance-pie" role="img" aria-label={`Struktura miesiąca. ${slices.map(item => `${item.label}: ${formatPln(item.amount)}`).join('. ')}`}>
          {slices.map((item, index) => {
            const share = moneyRatio(item.amount, total) * 100
            const start = offset
            offset += share
            return <circle key={item.label} cx="120" cy="120" r="75" fill="none" stroke={`var(--finance-chart-${index + 1})`} strokeWidth="65" pathLength="100" strokeDasharray={`${share} ${100 - share}`} strokeDashoffset={-start} transform="rotate(-90 120 120)" />
          })}
        </svg>
        <ul className="finance-chart-legend">{slices.map((item, index) => <li key={item.label}><i style={{ background: `var(--finance-chart-${index + 1})` }} /><span>{item.label}</span><strong>{formatPln(item.amount)}</strong></li>)}</ul>
      </div> : <p className="panel-message">Dodaj wydatki, oszczędności lub inwestycje do budżetu, aby zobaczyć strukturę miesiąca.</p>}
    </section>
  </div>
}

export function ScenarioComparison({ rows }: { rows: Array<{ id: string; name: string; summary: FinanceMonthSummary }> }) {
  const series: Array<{ key: 'income' | 'total_expenses' | 'savings_and_investments' | 'cashflow'; label: string }> = [
    { key: 'income', label: 'Przychody' }, { key: 'total_expenses', label: 'Wydatki' },
    { key: 'savings_and_investments', label: 'Odkładanie + inwestycje' }, { key: 'cashflow', label: 'Saldo' },
  ]
  const amounts = rows.flatMap(row => series.map(item => parseMoney(row.summary[item.key])))
  const positiveMax = amounts.reduce((max, value) => value > max ? value : max, 0n)
  const negativeMax = amounts.reduce((max, value) => -value > max ? -value : max, 0n)
  const range = positiveMax + negativeMax || 1n
  const ratio = (value: bigint) => Number(value * 10000n / range) / 100
  return <section className="panel finance-chart-panel"><h2 className="panel-title">Porównanie scenariuszy</h2><p className="panel-kicker">Prognozy są oddzielone od realnych miesięcy.</p>
    {rows.length ? <div className="finance-comparison-chart">{rows.map(row => <div className="finance-comparison-group" key={row.id}><h3>{row.name}</h3>
      {series.map((item, index) => {
        const amount = row.summary[item.key] as FinanceMoney
        const value = parseMoney(amount)
        return <div className="finance-comparison-row" key={item.key}><span>{item.label}</span><div className="finance-comparison-track">
          <i className="finance-chart-zero" style={{ left: `${ratio(negativeMax)}%` }} />
          <i className="finance-chart-bar" style={{ left: `${ratio(negativeMax + (value < 0n ? value : 0n))}%`, width: `${ratio(value < 0n ? -value : value)}%`, background: `var(--finance-chart-${index + 1})` }} />
        </div><strong>{formatPln(amount)}</strong></div>
      })}
    </div>)}</div> : <p className="panel-message">Dodaj scenariusz, aby porównać prognozowane przychody, wydatki i oszczędności.</p>}
  </section>
}
