const historyKpiLabels = ['Przychody', 'Wydatki', 'Saldo']

function SkeletonBar({ className = '' }: { className?: string }) {
  return <span className={`transaction-skeleton-bar ${className}`.trim()} />
}

export function TransactionOverviewSkeleton() {
  return <div className="transaction-overview transaction-overview-skeleton" aria-busy="true">
    <p className="sr-only" role="status">Wczytuję podsumowanie miesiąca…</p>
    <div className="finance-kpi-grid transaction-kpi-grid transaction-overview-kpi-skeleton" aria-hidden="true">
      {['Przychody', 'Wydatki', 'Pozostało', 'Odłożono'].map(label => <div className="finance-summary-card" key={label}>
        <span>{label}</span><SkeletonBar className="is-value" />
      </div>)}
    </div>

    <div className="transaction-overview-main" aria-hidden="true">
      <section className="panel finance-chart-panel transaction-category-panel">
        <div className="panel-head"><div><h2 className="panel-title">Kategorie</h2><p className="panel-kicker">Kwoty netto według aktualnych kategorii.</p></div></div>
        <div className="transaction-report-controls">
          <div className="transaction-tabs transaction-skeleton-tabs"><SkeletonBar /><SkeletonBar /><SkeletonBar /></div>
          <div className="transaction-tabs transaction-skeleton-tabs transaction-skeleton-view-tabs"><SkeletonBar /><SkeletonBar /></div>
        </div>
        <div className="transaction-category-chart transaction-skeleton-chart"><span className="transaction-skeleton-donut" /><SkeletonBar className="is-total" /><SkeletonBar className="is-caption" /></div>
        <div className="transaction-skeleton-table">
          <div className="transaction-skeleton-table-head"><SkeletonBar /><SkeletonBar /><SkeletonBar /></div>
          {Array.from({ length: 5 }, (_, index) => <div className="transaction-skeleton-table-row" key={index}>
            <SkeletonBar /><SkeletonBar /><SkeletonBar />
          </div>)}
        </div>
      </section>
    </div>

    <section className="transaction-secondary-metrics" aria-hidden="true">
      {['Saldo na koniec miesiąca', 'Wydatki z oszczędności', 'Wydatki łącznie', 'Zmiana oszczędności'].map(label => <div className="transaction-secondary-card" key={label}>
        <span>{label}</span><SkeletonBar className="is-value" /><SkeletonBar className="is-caption" />
      </div>)}
    </section>
  </div>
}

export function TransactionHistorySummarySkeleton() {
  return <div className="finance-kpi-grid transaction-history-kpi-grid transaction-history-kpi-skeleton" aria-busy="true">
    <p className="sr-only" role="status">Wczytuję podsumowanie miesiąca…</p>
    {historyKpiLabels.map(label => <div className="finance-summary-card" key={label} aria-hidden="true">
      <span>{label}</span><SkeletonBar className="is-value" />
    </div>)}
  </div>
}

export function TransactionHistorySkeleton() {
  return <div className="transaction-history transaction-history-skeleton" aria-busy="true">
    <p className="sr-only" role="status">Wczytuję historię transakcji…</p>
    <section className="transaction-history-day" aria-hidden="true">
      <h3 className="transaction-history-day-heading"><SkeletonBar className="is-day" /><i /><SkeletonBar className="is-day-total" /></h3>
      <ul>{Array.from({ length: 6 }, (_, index) => <li className="transaction-history-item" key={index}>
        <div className="transaction-history-entry transaction-history-skeleton-entry">
          <SkeletonBar className="is-icon" />
          <span className="transaction-history-copy"><SkeletonBar className="is-name" /><SkeletonBar className="is-description" /><SkeletonBar className="is-wallet" /></span>
          <SkeletonBar className="is-amount" />
        </div>
      </li>)}</ul>
    </section>
  </div>
}
