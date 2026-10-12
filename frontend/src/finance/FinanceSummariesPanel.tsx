import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createFinanceApi } from './api'
import { calculateSavingsAudienceSummary } from './calculations'
import { FinanceKpis } from './FinanceCharts'
import { addMoney, financeMinorUnitsToMoney, formatPln, sumMoney } from './money'
import { financeActionError } from './useFinanceAction'
import type { FinanceMonth } from './types'

export function FinanceSummariesPanel({ api, householdId, userId, months, selectedMonthId, actions, children }: {
  api: ReturnType<typeof createFinanceApi>; householdId: string; userId: string; months: FinanceMonth[]; selectedMonthId: string
  actions: ReactNode; children: ReactNode
}) {
  const accounts = useQuery({ queryKey: ['financeSavingsAccounts', householdId, userId], queryFn: ({ signal }) => api.listSavingsAccounts(signal) })
  const transactions = useQuery({ queryKey: ['financeSavingsTransactions', householdId, userId], queryFn: ({ signal }) => api.listSavingsTransactions(signal) })
  if (accounts.isPending || transactions.isPending) return <p className="panel-message" role="status">Ładuję podsumowanie oszczędności…</p>
  if (accounts.isError || transactions.isError) return <p className="error-message" role="alert">{financeActionError(accounts.error ?? transactions.error)}</p>
  try {
    const month = months.find(m => m.id === selectedMonthId)
    const viewer = { household_id: householdId, user_id: userId }
    const domestic = calculateSavingsAudienceSummary(accounts.data, transactions.data, viewer, 'household', month?.month_start ?? null)
    const personal = calculateSavingsAudienceSummary(accounts.data, transactions.data, viewer, 'private', month?.month_start ?? null)
    const cash = sumMoney([domestic.balances_by_type.cash, domestic.balances_by_type.goal, personal.balances_by_type.cash, personal.balances_by_type.goal])
    const invested = sumMoney([domestic.balances_by_type.investment, domestic.balances_by_type.retirement, personal.balances_by_type.investment, personal.balances_by_type.retirement])
    const history = new Map<string, string>()
    for (const row of [...domestic.history, ...personal.history]) history.set(row.month_start, addMoney(history.get(row.month_start) ?? '0.00', row.amount))
    const visibleAccountIds = new Set(accounts.data.filter(a => a.household_id === householdId && (a.visibility === 'household' || a.owner_user_id === userId)).map(a => a.id))
    return <div className="finance-page-stack">
      <FinanceKpis values={[
        { label: 'Stan kont', value: formatPln(cash) },
        { label: 'Inwestycje + emerytura', value: formatPln(invested) },
        { label: 'Suma', value: formatPln(addMoney(cash, invested)), hint: `Domowe: ${formatPln(domestic.active_balance)} · prywatne: ${formatPln(personal.active_balance)}` },
      ]} />
      {actions}
      <div className="finance-savings-layout">
        {children}
        <section className="panel finance-panel"><div className="panel-head"><h2 className="panel-title">Oszczędności miesięcznie</h2></div>
          <div className="finance-monthly-list">
            {[...history.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([monthStart, amount]) => {
              const label = months.find(m => m.month_start === monthStart)?.display_name ?? new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric' }).format(new Date(`${monthStart}T12:00:00`))
              const movements = transactions.data.filter(t => t.household_id === householdId && visibleAccountIds.has(t.account_id) && t.transaction_date.startsWith(monthStart.slice(0, 7)) && !t.transfer_id && !t.excluded_from_monthly_savings && BigInt(t.amount) > 0n)
              return <details className="finance-monthly-item" key={monthStart}><summary><span><strong>{label}</strong><small>Suma wpłat</small></span><strong>{formatPln(amount)}</strong></summary>
                {movements.map(t => <div className="finance-savings-transaction-row" key={t.id}><div className="finance-transfer-copy"><strong>{accounts.data.find(a => a.id === t.account_id)?.name ?? 'Konto'}</strong><span>{t.transaction_date}{t.description ? ` · ${t.description}` : ''}</span></div><strong>{formatPln(financeMinorUnitsToMoney(t.amount))}</strong></div>)}
              </details>
            })}
            {!history.size && <p className="panel-message">Brak transakcji oszczędnościowych.</p>}
          </div>
        </section>
      </div>
    </div>
  } catch (error) {
    return <p className="error-message" role="alert">{financeActionError(error)}</p>
  }
}
