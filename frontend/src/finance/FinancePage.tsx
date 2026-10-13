import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthGate'
import { PageHeader } from '../components/PageHeader'
import { createFinanceApi, FinanceVersionConflictError } from './api'
import { calculateMonthSummary } from './calculations'
import { financeMinorUnitsToMoney, formatPln } from './money'
import { SavingsAccountsPanel } from './SavingsAccountsPanel'
import { SavingsPlansPanel } from './SavingsPlansPanel'
import { FinanceDashboard, MonthKpis } from './FinanceCharts'
import { ForecastOverview } from './ForecastOverview'
import { financeNavigation, savingsNavigation, resolveFinanceRoute } from './navigation'
import { ProjectsPanel } from './ProjectsPanel'
import { CategoriesPanel } from './CategoriesPanel'
import { budgetItemTitle } from './categories'
import { BudgetItemsPanel, type BudgetItemInput } from './BudgetItemsPanel'
import type {
  FinanceBudgetLine,
  FinanceCategory,
  FinanceCreateMonthInput,
  FinanceMonth,
  FinanceScenario,
} from './types'


function displayMonth(month: FinanceMonth) {
  if (month.display_name) return month.display_name
  return new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric' })
    .format(new Date(`${month.month_start}T12:00:00`))
}

function nextMonthStart(months: FinanceMonth[]) {
  const latest = months[0]
  const now = new Date()
  const date = latest
    ? new Date(`${latest.month_start}T12:00:00`)
    : new Date(now.getFullYear(), now.getMonth(), 1)
  const next = latest
    ? new Date(date.getFullYear(), date.getMonth() + 1, 1)
    : date
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`
}

function errorText(error: unknown) {
  if (error instanceof FinanceVersionConflictError) {
    return error.current_version === null
      ? 'Ta pozycja została usunięta lub nie jest już dostępna.'
      : 'Ktoś zmienił tę pozycję. Załadowano najnowszą wersję — sprawdź ją przed ponowną edycją.'
  }
  return error instanceof Error ? error.message : 'Nie udało się zapisać zmian.'
}

function SummaryCards({ lines }: { lines: FinanceBudgetLine[] }) {
  return <MonthKpis summary={calculateMonthSummary(lines)} />
}

function makeLines(
  items: Array<{ id: string; name: string; amount: string; is_planned: boolean; is_recurring: boolean; category_id: string }>,
  categories: FinanceCategory[],
): FinanceBudgetLine[] {
  return items.flatMap(item => {
    const category = categories.find(candidate => candidate.id === item.category_id)
    if (!category) return []
    return [{
      id: item.id,
      name: budgetItemTitle(item.name, category),
      amount: financeMinorUnitsToMoney(item.amount),
      budget_type: category.budget_type,
      allocation_role: category.allocation_role,
      is_planned: item.is_planned,
      is_recurring: item.is_recurring,
    }]
  })
}

export function FinancePage() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const api = useMemo(() => createFinanceApi(profile.household_id, profile.id), [profile.household_id, profile.id])
  const location = useLocation()
  const navigate = useNavigate()
  const selectedMonthStorageKey = `family-hub:finance:selectedMonth:${profile.id}`
  const legacySelectedMonthStorageKey = `family-hub:finance:selectedMonth:${profile.household_id}:${profile.id}`
  const route = resolveFinanceRoute(location.pathname)
  const view = route?.view ?? 'dashboard'
  const savingsView = route?.savingsView ?? 'summary'
  const [editingForecast, setEditingForecast] = useState(false)
  const forecastEditor = useRef<HTMLElement>(null)
  const [showZeroItems, setShowZeroItems] = useState(true)
  const [monthSource, setMonthSource] = useState('empty')
  const [selectedMonthId, setSelectedMonthId] = useState(() => {
    try {
      const savedMonthId = window.localStorage.getItem(selectedMonthStorageKey)
      if (savedMonthId) return savedMonthId

      const legacyMonthId = window.localStorage.getItem(legacySelectedMonthStorageKey)
      if (!legacyMonthId) return ''

      window.localStorage.setItem(selectedMonthStorageKey, legacyMonthId)
      window.localStorage.removeItem(legacySelectedMonthStorageKey)
      return legacyMonthId
    } catch {
      return ''
    }
  })
  const [selectedScenarioId, setSelectedScenarioId] = useState('')
  const [scenarioName, setScenarioName] = useState('')
  const [scenarioDescription, setScenarioDescription] = useState('')
  const createMonthRequest = useRef<{ signature: string; request_id: string } | null>(null)

  useEffect(() => {
    if (view === 'forecast' && editingForecast) {
      forecastEditor.current?.focus({ preventScroll: true })
      forecastEditor.current?.scrollIntoView({ block: 'start' })
    }
  }, [editingForecast, selectedScenarioId, view])

  const months = useQuery({
    queryKey: ['financeMonths', profile.household_id],
    queryFn: ({ signal }) => api.listMonths(signal),
  })
  const categories = useQuery({
    queryKey: ['financeCategories', profile.household_id],
    queryFn: ({ signal }) => api.listCategories(signal),
  })
  const scenarios = useQuery({
    queryKey: ['financeScenarios', profile.household_id],
    queryFn: ({ signal }) => api.listScenarios(signal),
  })

  useEffect(() => {
    if (!months.isSuccess) return
    const availableMonths = months.data
    if (availableMonths.length === 0) {
      setSelectedMonthId('')
    } else if (!availableMonths.some(month => month.id === selectedMonthId)) {
      setSelectedMonthId(availableMonths[0].id)
    }
  }, [months.data, months.isSuccess, selectedMonthId])

  useEffect(() => {
    try {
      if (selectedMonthId) {
        window.localStorage.setItem(selectedMonthStorageKey, selectedMonthId)
      } else {
        window.localStorage.removeItem(selectedMonthStorageKey)
      }
      window.localStorage.removeItem(legacySelectedMonthStorageKey)
    } catch {
      // Keep the finance view usable if browser storage is unavailable.
    }
  }, [legacySelectedMonthStorageKey, selectedMonthId, selectedMonthStorageKey])

  useEffect(() => {
    const availableScenarios = scenarios.data ?? []
    if (availableScenarios.length === 0) {
      setSelectedScenarioId('')
    } else if (!availableScenarios.some(scenario => scenario.id === selectedScenarioId)) {
      setSelectedScenarioId(availableScenarios[0].id)
    }
  }, [scenarios.data, selectedScenarioId])

  const budgetItems = useQuery({
    queryKey: ['financeBudgetItems', profile.household_id, selectedMonthId],
    queryFn: ({ signal }) => api.listBudgetItems(selectedMonthId, signal),
    enabled: Boolean(selectedMonthId),
  })
  const scenarioItems = useQuery({
    queryKey: ['financeScenarioItems', profile.household_id, selectedScenarioId],
    queryFn: ({ signal }) => api.listScenarioItems(selectedScenarioId, signal),
    enabled: view === 'forecast' && editingForecast && Boolean(selectedScenarioId),
  })

  const createMonth = useMutation({
    mutationFn: (input: FinanceCreateMonthInput) => api.createMonth(input),
    onSuccess: async (month, input) => {
      if (createMonthRequest.current?.request_id === input.request_id) createMonthRequest.current = null
      queryClient.setQueryData<FinanceMonth[]>(['financeMonths', profile.household_id], current =>
        [month, ...(current ?? []).filter(candidate => candidate.id !== month.id)]
          .sort((left, right) => right.month_start.localeCompare(left.month_start)))
      setSelectedMonthId(month.id)
      if (view === 'forecast') navigate('/finance/budget')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['financeMonths', profile.household_id] }),
        queryClient.invalidateQueries({ queryKey: ['financeBudgetItems', profile.household_id, month.id] }),
      ])
    },
  })
  const createScenario = useMutation({
    mutationFn: (input: { name: string; description: string | null; sort_order: number }) => api.createScenario(input),
    onSuccess: async scenario => {
      queryClient.setQueryData<FinanceScenario[]>(['financeScenarios', profile.household_id], current => [...(current ?? []), scenario])
      setSelectedScenarioId(scenario.id)
      setEditingForecast(true)
      setScenarioName('')
      setScenarioDescription('')
      await queryClient.invalidateQueries({ queryKey: ['financeScenarios', profile.household_id] })
    },
  })
  const createBudgetItem = useMutation({
    mutationFn: (input: Parameters<typeof api.createBudgetItem>[0]) => api.createBudgetItem(input),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({ queryKey: ['financeBudgetItems', profile.household_id, input.month_id] })
    },
  })
  const createScenarioItem = useMutation({
    mutationFn: (input: Parameters<typeof api.createScenarioItem>[0]) => api.createScenarioItem(input),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({ queryKey: ['financeScenarioItems', profile.household_id, input.scenario_id] })
    },
  })
  const updateFinanceItem = useMutation({
    mutationFn: (input: Parameters<typeof api.updateBudgetItem>[0] & { kind: 'budget' | 'scenario' }) => {
      const { kind, ...changes } = input
      return kind === 'budget' ? api.updateBudgetItem(changes) : api.updateScenarioItem(changes)
    },
    onSuccess: async (_data, input) => {
      if (input.kind === 'budget') {
        await queryClient.invalidateQueries({ queryKey: ['financeBudgetItems', profile.household_id] })
      } else {
        await queryClient.invalidateQueries({ queryKey: ['financeScenarioItems', profile.household_id] })
      }
    },
    onError: async (error, input) => {
      if (!(error instanceof FinanceVersionConflictError)) return
      const queryKey = input.kind === 'budget'
        ? ['financeBudgetItems', profile.household_id]
        : ['financeScenarioItems', profile.household_id]
      await queryClient.invalidateQueries({ queryKey })
    },
  })

  const monthList = months.data ?? []
  const categoryList = categories.data ?? []
  const scenarioList = scenarios.data ?? []
  const budgetLines = makeLines(budgetItems.data ?? [], categoryList)
  const scenarioLines = makeLines(scenarioItems.data ?? [], categoryList)
  const activeMonth = monthList.find(month => month.id === selectedMonthId)
  const activeScenario = scenarioList.find(scenario => scenario.id === selectedScenarioId)
  const latestMonth = monthList[0]
  const selectedScenarioSourceId = monthSource.startsWith('scenario:') ? monthSource.slice('scenario:'.length) : ''
  const effectiveMonthSource = selectedScenarioSourceId && scenarioList.some(scenario => scenario.id === selectedScenarioSourceId)
    ? monthSource
    : monthSource === 'recurring' && latestMonth
      ? 'recurring'
      : 'empty'

  function submitNewMonth(scenarioId?: string) {
    const source: FinanceCreateMonthInput['source'] = scenarioId ? { kind: 'scenario', scenario_id: scenarioId } : effectiveMonthSource === 'recurring' && latestMonth
      ? { kind: 'recurring', source_month_id: latestMonth.id }
      : effectiveMonthSource.startsWith('scenario:')
        ? { kind: 'scenario', scenario_id: effectiveMonthSource.slice('scenario:'.length) }
        : { kind: 'empty' }
    const inputWithoutRequest = { month_start: nextMonthStart(monthList), source }
    const signature = JSON.stringify(inputWithoutRequest)
    if (createMonthRequest.current?.signature !== signature) {
      createMonthRequest.current = { signature, request_id: globalThis.crypto.randomUUID() }
    }
    const request = createMonthRequest.current
    if (request) createMonth.mutate({ ...inputWithoutRequest, request_id: request.request_id })
  }

  function resetItemErrors() {
    createBudgetItem.reset()
    createScenarioItem.reset()
    updateFinanceItem.reset()
  }

  function addBudgetItem(input: BudgetItemInput) {
    if (!activeMonth) return Promise.reject(new Error('Wybierz miesiąc budżetu.'))
    return createBudgetItem.mutateAsync({ ...input, month_id: activeMonth.id, sort_order: budgetItems.data?.length ?? 0 })
  }

  function addScenarioItem(input: BudgetItemInput) {
    if (!activeScenario) return Promise.reject(new Error('Wybierz scenariusz.'))
    return createScenarioItem.mutateAsync({ ...input, scenario_id: activeScenario.id, sort_order: scenarioItems.data?.length ?? 0 })
  }

  function submitScenario(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    createScenario.mutate({
      name: scenarioName.trim(),
      description: scenarioDescription.trim() || null,
      sort_order: scenarioList.length,
    })
  }

  const pageErrors = [months.error, categories.error, scenarios.error].filter(Boolean)

  if (!route) return <Navigate to="/finance/dashboard" replace />
  if (location.pathname === '/finance' || location.pathname === '/finance/') return <Navigate to="/finance/dashboard" replace />

  return (
    <div className="finance-workspace">
      <PageHeader
        eyebrow="Finanse"
        title={financeNavigation.find(item => item.id === view)?.label ?? 'Dashboard'}
        description={view === 'categories' ? 'Zdefiniuj nazwy kategorii i przypisz je do sekcji budżetu.' : 'Budżet, cele i prognozy bez pracy na arkuszach miesięcznych.'}
        action={['dashboard', 'budget'].includes(view) && monthList.length > 0 ? (
          <label className="finance-month-select">Miesiąc
            <select value={selectedMonthId} onChange={event => setSelectedMonthId(event.target.value)}>
              {monthList.map(month => <option key={month.id} value={month.id}>{displayMonth(month)}</option>)}
            </select>
          </label>
        ) : undefined}
      />

      {view === 'savings' && <nav className="finance-tabs" aria-label="Zakładki oszczędności">
        {savingsNavigation.map(tab => <Link className={`finance-tab${savingsView === tab.id ? ' active' : ''}`} aria-current={savingsView === tab.id ? 'page' : undefined} key={tab.id} to={tab.to}>{tab.label}</Link>)}
      </nav>}

      {pageErrors.map((error, index) => <p className="error-message" role="alert" key={index}>{errorText(error)}</p>)}
      {view === 'dashboard' ? (
        months.isPending || (selectedMonthId && budgetItems.isPending) ? <p className="panel-message" role="status">Ładuję dashboard…</p> : budgetItems.isError ? <p className="error-message" role="alert">{errorText(budgetItems.error)}</p> : activeMonth ? <FinanceDashboard lines={budgetLines} monthName={displayMonth(activeMonth)} /> : <section className="panel finance-chart-panel"><h2 className="panel-title">Twój budżet domowy</h2><p>Utwórz pierwszy miesiąc, aby zobaczyć podsumowanie finansów.</p><Link className="primary-button" to="/finance/budget">Przejdź do budżetu</Link></section>
      ) : view === 'budget' ? (
        <section className="panel finance-panel">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">{activeMonth ? displayMonth(activeMonth) : 'Budżet miesięczny'}</h2>
              <p className="panel-kicker">Saldo po wydatkach, oszczędnościach i inwestycjach: <strong>{formatPln(calculateMonthSummary(budgetLines).cashflow)}</strong></p>
            </div>
            <div className="finance-month-actions">
              <label className="finance-month-select">Początkowe pozycje
                <select value={effectiveMonthSource} onChange={event => setMonthSource(event.target.value)} disabled={createMonth.isPending || months.isPending}>
                  <option value="empty">Pusty miesiąc</option>
                  {latestMonth && <option value="recurring">Powtarzalne z {displayMonth(latestMonth)}</option>}
                  {scenarioList.map(scenario => <option key={scenario.id} value={`scenario:${scenario.id}`}>{scenario.name}</option>)}
                </select>
              </label>
              <button className="primary-button" onClick={() => submitNewMonth()} disabled={createMonth.isPending || months.isPending}>{createMonth.isPending ? 'Tworzę miesiąc…' : monthList.length ? 'Utwórz kolejny miesiąc' : 'Utwórz bieżący miesiąc'}</button>
            </div>
          </div>

          {months.isPending && <p className="panel-message" role="status">Ładuję miesiące…</p>}
          {monthList.length === 0 && !months.isPending && (
            <p className="panel-message">Nie ma jeszcze miesięcy budżetowych. Utwórz miesiąc, aby dodać pozycje.</p>
          )}
          {activeMonth && (
            <>
              {budgetItems.isPending && <p className="panel-message" role="status">Ładuję pozycje…</p>}
              {budgetItems.isError && <p className="error-message finance-error" role="alert">{errorText(budgetItems.error)}</p>}
              {budgetItems.data && <SummaryCards lines={budgetLines} />}
              {budgetItems.data && budgetItems.data.length === 0 && <p className="panel-message">Ten miesiąc nie ma jeszcze pozycji.</p>}
              <label className="finance-zero-toggle"><input type="checkbox" checked={showZeroItems} onChange={event => setShowZeroItems(event.target.checked)} /> Pokaż pozycje zerowe</label>
              <BudgetItemsPanel key={activeMonth.id} items={budgetItems.data ?? []} categories={categoryList}
                pending={createBudgetItem.isPending || updateFinanceItem.isPending}
                unavailable={categories.isPending || categories.isError || budgetItems.isPending || budgetItems.isError}
                createError={createBudgetItem.error} updateError={updateFinanceItem.error} showZeroItems={showZeroItems}
                onCreate={addBudgetItem} onUpdate={input => updateFinanceItem.mutateAsync({ ...input, kind: 'budget' })}
                onResetErrors={resetItemErrors} />
            </>
          )}
          {createMonth.isError && <p className="error-message finance-error" role="alert">{errorText(createMonth.error)}</p>}
        </section>
      ) : view === 'forecast' ? (
        <div className="finance-scenarios-layout">
          <ForecastOverview api={api} householdId={profile.household_id} scenarios={scenarioList} categories={categoryList} pending={createMonth.isPending || months.isPending} onEdit={id => { setSelectedScenarioId(id); setEditingForecast(true) }} onCreateMonth={submitNewMonth} />
          {createMonth.isError && <p className="error-message" role="alert">{errorText(createMonth.error)}</p>}

          <section className="panel finance-panel" ref={forecastEditor} tabIndex={-1}>
            <div className="panel-head">
              <div>
                <h2 className="panel-title">{editingForecast ? 'Scenariusze — edycja i dodawanie' : 'Nowy scenariusz'}</h2>
                <p className="panel-kicker">Zaplanuj alternatywny budżet i porównaj jego wynik.</p>
              </div>
              {editingForecast && scenarioList.length > 0 && (
                <label className="finance-month-select">Scenariusz
                  <select value={selectedScenarioId} onChange={event => setSelectedScenarioId(event.target.value)}>
                    {scenarioList.map(scenario => <option key={scenario.id} value={scenario.id}>{scenario.name}</option>)}
                  </select>
                </label>
              )}
            </div>

            <form className="finance-scenario-form" onSubmit={submitScenario}>
              <label>Nazwa scenariusza
                <input required maxLength={160} value={scenarioName} onChange={event => setScenarioName(event.target.value)} placeholder="Nazwa scenariusza" />
              </label>
              <label>Opis
                <input maxLength={500} value={scenarioDescription} onChange={event => setScenarioDescription(event.target.value)} placeholder="Opcjonalny opis" />
              </label>
              <button className="primary-button" type="submit" disabled={createScenario.isPending || scenarios.isPending}>
                {createScenario.isPending ? 'Zapisuję…' : 'Dodaj scenariusz'}
              </button>
            </form>
            {createScenario.isError && <p className="error-message finance-error" role="alert">{errorText(createScenario.error)}</p>}
            {scenarios.isPending && <p className="panel-message" role="status">Ładuję scenariusze…</p>}

            {editingForecast && <button className="button-quiet finance-close-editor" onClick={() => setEditingForecast(false)}>Zamknij edycję</button>}
            {activeScenario && editingForecast && (
              <>
                <h3 className="finance-subheading">{activeScenario.name}</h3>
                {activeScenario.description && <p className="finance-description">{activeScenario.description}</p>}
                {scenarioItems.isPending && <p className="panel-message" role="status">Ładuję pozycje scenariusza…</p>}
                {scenarioItems.isError && <p className="error-message finance-error" role="alert">{errorText(scenarioItems.error)}</p>}
                {scenarioLines.length > 0 && <SummaryCards lines={scenarioLines} />}
                {scenarioItems.data && scenarioItems.data.length === 0 && <p className="panel-message">Ten scenariusz nie ma jeszcze pozycji.</p>}
                <BudgetItemsPanel key={activeScenario.id} items={scenarioItems.data ?? []} categories={categoryList}
                  pending={createScenarioItem.isPending || updateFinanceItem.isPending}
                  unavailable={categories.isPending || categories.isError || scenarioItems.isPending || scenarioItems.isError}
                  createError={createScenarioItem.error} updateError={updateFinanceItem.error}
                  onCreate={addScenarioItem} onUpdate={input => updateFinanceItem.mutateAsync({ ...input, kind: 'scenario' })}
                  onResetErrors={resetItemErrors} />
              </>
            )}
            {scenarioList.length === 0 && !scenarios.isPending && <p className="panel-message">Dodaj scenariusz, aby wprowadzać jego pozycje.</p>}
          </section>
        </div>
      ) : view === 'savings' ? (
        savingsView === 'reserves' ? <SavingsPlansPanel mode="reserves" api={api} householdId={profile.household_id} userId={profile.id} months={monthList} selectedMonthId={selectedMonthId} onSelectMonth={setSelectedMonthId} /> : <div className="finance-page-stack">
          {savingsView === 'planner' && <SavingsPlansPanel mode="planner" api={api} householdId={profile.household_id} userId={profile.id} months={monthList} selectedMonthId={selectedMonthId} onSelectMonth={setSelectedMonthId} />}
          <SavingsAccountsPanel key={`${profile.household_id}:${profile.id}`} mode={savingsView} api={api} householdId={profile.household_id} userId={profile.id} months={monthList} selectedMonthId={selectedMonthId} onSelectMonth={setSelectedMonthId} />
        </div>
      ) : view === 'categories' ? (
        <CategoriesPanel key={`${profile.household_id}:${profile.id}`} api={api} householdId={profile.household_id} categories={categoryList} loading={categories.isPending} loadFailed={categories.isError} />
      ) : (
        <ProjectsPanel key={`${profile.household_id}:${profile.id}`} api={api} householdId={profile.household_id} />
      )}
    </div>
  )
}
