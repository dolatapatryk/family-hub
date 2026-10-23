function monthLabel(monthStart: string): string {
  return new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric' })
    .format(new Date(`${monthStart}T12:00:00`))
}

function moveMonth(monthStart: string, offset: number): string {
  const [year, month] = monthStart.slice(0, 7).split('-').map(Number)
  return new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 7)
}

export function TransactionPeriodControl({ monthStart, today, transactionCount, loading = false, filtered, onOpenFilters, onMonthChange }: {
  monthStart: string
  today: string
  transactionCount?: number
  loading?: boolean
  filtered: boolean
  onOpenFilters: () => void
  onMonthChange: (month: string) => void
}) {
  const countLabel = transactionCount === undefined
    ? loading ? 'Wczytuję transakcje…' : 'Podsumowanie niedostępne'
    : `${transactionCount} ${transactionCount === 1 ? 'transakcja' : 'transakcji'}${filtered ? ' · aktywne filtry' : ''}`

  return <div className="transaction-period-control" aria-label="Wybór miesiąca">
    <button className="transaction-period-arrow" type="button" aria-label="Poprzedni miesiąc" onClick={() => onMonthChange(moveMonth(monthStart, -1))}>‹</button>
    <button className="transaction-period-title" type="button" aria-haspopup="dialog" onClick={onOpenFilters}>
      <strong>{monthLabel(monthStart)}</strong>
      <span>{countLabel}
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="16" rx="2" /><path d="M7.5 3v4M16.5 3v4M4 9h16" /></svg>
      </span>
    </button>
    <button className="transaction-period-arrow" type="button" aria-label="Następny miesiąc" disabled={monthStart.slice(0, 7) >= today.slice(0, 7)} onClick={() => onMonthChange(moveMonth(monthStart, 1))}>›</button>
  </div>
}
