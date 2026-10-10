import { useQuery } from '@tanstack/react-query'
import { createFinanceApi } from './api'
import { calculateSavingsAudienceSummary } from './calculations'
import { formatPln } from './money'
import { financeActionError } from './useFinanceAction'
import type { FinanceMonth, FinanceSavingsAccountType, FinanceVisibility } from './types'

const typeNames: Record<FinanceSavingsAccountType, string> = { cash: 'Gotówka', goal: 'Cele', investment: 'Inwestycje', retirement: 'Emerytura' }

export function FinanceSummariesPanel({ api, householdId, userId, months, selectedMonthId, onSelectMonth }: {
  api: ReturnType<typeof createFinanceApi>; householdId: string; userId: string; months: FinanceMonth[]; selectedMonthId: string; onSelectMonth: (id: string) => void
}) {
  const accounts = useQuery({ queryKey: ['financeSavingsAccounts', householdId, userId], queryFn: ({ signal }) => api.listSavingsAccounts(signal) })
  const transactions = useQuery({ queryKey: ['financeSavingsTransactions', householdId, userId], queryFn: ({ signal }) => api.listSavingsTransactions(signal) })
  const month = months.find(m => m.id === selectedMonthId)
  if (accounts.isPending || transactions.isPending) return <p className="panel-message" role="status">Ładuję podsumowanie oszczędności…</p>
  if (accounts.isError || transactions.isError) return <p className="error-message" role="alert">{financeActionError(accounts.error ?? transactions.error)}</p>
  let summaries
  try {
    summaries = (['household', 'private'] as FinanceVisibility[]).map(visibility => ({ visibility,
      summary: calculateSavingsAudienceSummary(accounts.data, transactions.data, { household_id: householdId, user_id: userId }, visibility, month?.month_start ?? null),
    }))
  } catch (error) { return <p className="error-message" role="alert">{financeActionError(error)}</p> }
  return <div className="finance-management-stack">
    <label className="finance-month-select">Miesiąc rzeczywistych oszczędności<select value={selectedMonthId} onChange={e => onSelectMonth(e.target.value)}>{months.map(m => <option key={m.id} value={m.id}>{m.display_name ?? m.month_start.slice(0, 7)}</option>)}</select></label>
    {summaries.map(({ visibility, summary }) => <section className="panel finance-management-panel" key={visibility}>
      <div className="panel-head"><div><h2 className="panel-title">{visibility === 'household' ? 'Oszczędności domowe' : 'Moje prywatne oszczędności'}</h2><p className="panel-kicker">{visibility === 'household' ? 'Wyłącznie konta udostępnione domownikom.' : 'Wyłącznie Twoje prywatne konta.'}</p></div></div>
      <div className="finance-summary-grid">
        <div className="finance-summary-card"><span>Saldo aktywnych kont</span><strong>{formatPln(summary.active_balance)}</strong></div>
        <div className="finance-summary-card"><span>Rzeczywiste wpłaty · {month?.display_name ?? month?.month_start.slice(0, 7) ?? 'wybierz miesiąc'}</span><strong>{formatPln(summary.actual_monthly_savings)}</strong></div>
        {Object.entries(summary.balances_by_type).map(([type, value]) => <div className="finance-summary-card" key={type}><span>{typeNames[type as FinanceSavingsAccountType]}</span><strong>{formatPln(value)}</strong></div>)}
      </div>
      <p>Saldo liczy każde aktywne konto raz, bez zarchiwizowanych drzew. Rzeczywiste oszczędności liczą dodatnie, niewyłączone wpłaty według daty ruchu, także z kont archiwalnych. Przelewy, korekty salda i szkice nie zwiększają wpłat; wypłaty nie odejmują się od tej miary.</p>
      <h3>Historia miesięcznych wpłat</h3>
      {summary.history.length === 0 && <p>Brak wpłat w tym zakresie.</p>}
      {summary.history.map(row => <div className="finance-management-row" key={row.month_start}><span>{row.month_start.slice(0, 7)}</span><strong>{formatPln(row.amount)}</strong></div>)}
    </section>)}
  </div>
}
