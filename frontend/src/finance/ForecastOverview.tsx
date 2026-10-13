import { useQueries } from '@tanstack/react-query'
import { createFinanceApi } from './api'
import { calculateMonthSummary } from './calculations'
import { MonthKpis, ScenarioComparison } from './FinanceCharts'
import { financeMinorUnitsToMoney, formatPln } from './money'
import { financeActionError } from './useFinanceAction'
import { budgetItemTitle, categorySection, financeSections } from './categories'
import type { FinanceCategory, FinanceScenario } from './types'

export function ForecastOverview({ api, householdId, scenarios, categories, pending, onEdit, onCreateMonth }: {
  api: ReturnType<typeof createFinanceApi>; householdId: string; scenarios: FinanceScenario[]; categories: FinanceCategory[]
  pending: boolean; onEdit: (id: string) => void; onCreateMonth: (id: string) => void
}) {
  const queries = useQueries({ queries: scenarios.map(scenario => ({
    queryKey: ['financeScenarioItems', householdId, scenario.id],
    queryFn: ({ signal }: { signal: AbortSignal }) => api.listScenarioItems(scenario.id, signal),
  })) })
  const rows = scenarios.flatMap((scenario, index) => {
    const query = queries[index]
    if (!query.data) return []
    const lines = query.data.flatMap(item => {
      const category = categories.find(candidate => candidate.id === item.category_id)
      return category ? [{ ...item, amount: financeMinorUnitsToMoney(item.amount),
        budget_type: category.budget_type, allocation_role: category.allocation_role }] : []
    })
    return [{ ...scenario, items: query.data, summary: calculateMonthSummary(lines) }]
  })
  return <div className="finance-page-stack">
    {queries.some(query => query.isPending) && <p role="status">Ładuję porównanie scenariuszy…</p>}
    {queries.filter(query => query.isError).map((query, index) => <p className="error-message" role="alert" key={index}>{financeActionError(query.error)}</p>)}
    <ScenarioComparison rows={rows} />
    {rows.map(row => <section className="panel finance-scenario-card" key={row.id}>
      <div className="panel-head"><div><h2 className="panel-title">{row.name}</h2>{row.description && <p className="panel-kicker">{row.description}</p>}</div>
        <div className="finance-edit-actions"><button className="button-quiet" onClick={() => onEdit(row.id)}>Edytuj scenariusz</button><button className="primary-button" disabled={pending} onClick={() => onCreateMonth(row.id)}>Utwórz miesiąc</button></div>
      </div>
      <MonthKpis summary={row.summary} dashboard />
      {row.items.map(item => {
        const category = categories.find(candidate => candidate.id === item.category_id)
        const section = category ? financeSections.find(candidate => candidate.id === categorySection(category)) : undefined
        return <div className="finance-scenario-line" key={item.id}><span>{budgetItemTitle(item.name, category)}</span><span>{section?.label ?? 'Kategoria niedostępna'}</span><strong>{formatPln(financeMinorUnitsToMoney(item.amount))}</strong></div>
      })}
      {!row.items.length && <p className="panel-message">Ten scenariusz nie ma jeszcze pozycji.</p>}
    </section>)}
  </div>
}
