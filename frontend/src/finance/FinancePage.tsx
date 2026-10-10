import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthGate'
import { PageHeader } from '../components/PageHeader'
import { createFinanceApi, FinanceVersionConflictError } from './api'
import { calculateMonthSummary } from './calculations'
import { financeMinorUnitsToMoney, formatPln } from './money'
import type {
  FinanceAllocationRole,
  FinanceBudgetLine,
  FinanceBudgetType,
  FinanceCategory,
  FinanceCreateMonthInput,
  FinanceMonth,
  FinanceScenario,
} from './types'

type FinanceView = 'budget' | 'scenarios'

const budgetTypeNames: Record<FinanceBudgetType, string> = {
  income: 'Przychód',
  fixed_expense: 'Wydatek stały',
  variable_expense: 'Wydatek zmienny',
  saving: 'Oszczędności',
  investment: 'Inwestycje',
}

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

function AllocationRoleSelect({
  role,
  categoryType,
  disabled,
  label,
  onChange,
}: {
  role: FinanceAllocationRole
  categoryType: FinanceBudgetType | undefined
  disabled?: boolean
  label: string
  onChange: (role: FinanceAllocationRole) => void
}) {
  return (
    <select
      aria-label={label}
      value={role}
      disabled={disabled || categoryType !== 'saving'}
      onChange={event => onChange(event.target.value as FinanceAllocationRole)}
    >
      <option value="standard">Standard</option>
      {categoryType === 'saving' && <option value="personal_allowance">Osobista alokacja</option>}
    </select>
  )
}

interface EditableFinanceItem {
  id: string
  version: number
  name: string
  amount: string
  category_id: string
  allocation_role: FinanceAllocationRole
}

function FinanceItemEditForm({
  item,
  categories,
  disabled,
  onCancel,
  onSave,
}: {
  item: EditableFinanceItem
  categories: FinanceCategory[]
  disabled: boolean
  onCancel: () => void
  onSave: (input: {
    id: string
    expected_version: number
    category_id: string
    category_type: FinanceBudgetType
    name: string
    amount: string
    allocation_role: FinanceAllocationRole
  }) => void
}) {
  const [name, setName] = useState(item.name)
  const [amount, setAmount] = useState(financeMinorUnitsToMoney(item.amount))
  const [categoryId, setCategoryId] = useState(item.category_id)
  const [role, setRole] = useState(item.allocation_role)
  const category = categories.find(candidate => candidate.id === categoryId)

  function changeCategory(nextId: string) {
    setCategoryId(nextId)
    if (categories.find(candidate => candidate.id === nextId)?.budget_type !== 'saving') setRole('standard')
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!category) return
    onSave({
      id: item.id,
      expected_version: item.version,
      category_id: category.id,
      category_type: category.budget_type,
      name: name.trim(),
      amount,
      allocation_role: role,
    })
  }

  return (
    <form className="finance-item-edit-form" onSubmit={submit}>
      <label>Pozycja<input required maxLength={160} value={name} onChange={event => setName(event.target.value)} /></label>
      <label>Kwota<input required inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} /></label>
      <label>Kategoria
        <select required value={categoryId} onChange={event => changeCategory(event.target.value)}>
          {categories.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name} · {budgetTypeNames[candidate.budget_type]}</option>)}
        </select>
      </label>
      <label>Rola
        <select value={role} disabled={category?.budget_type !== 'saving'} onChange={event => setRole(event.target.value as FinanceAllocationRole)}>
          <option value="standard">Standard</option>
          {category?.budget_type === 'saving' && <option value="personal_allowance">Osobista alokacja</option>}
        </select>
      </label>
      <div className="finance-edit-actions">
        <button className="primary-button" type="submit" disabled={disabled || !category}>Zapisz</button>
        <button className="button-quiet" type="button" onClick={onCancel} disabled={disabled}>Anuluj</button>
      </div>
    </form>
  )
}

function SummaryCards({ lines }: { lines: FinanceBudgetLine[] }) {
  const summary = calculateMonthSummary(lines)
  const values = [
    { label: 'Po osobistych alokacjach', amount: summary.income_after_personal_allowances },
    { label: 'Osobiste alokacje', amount: summary.personal_allowances },
    { label: 'Oszczędności', amount: summary.savings },
    { label: 'Saldo', amount: summary.cashflow },
  ]

  return (
    <div className="finance-summary-grid">
      {values.map(value => (
        <div className="finance-summary-card" key={value.label}>
          <span>{value.label}</span>
          <strong>{formatPln(value.amount)}</strong>
        </div>
      ))}
    </div>
  )
}

function makeLines(
  items: Array<{ id: string; name: string; amount: string; allocation_role: FinanceAllocationRole; is_planned: boolean; is_recurring: boolean; category_id: string }>,
  categories: FinanceCategory[],
): FinanceBudgetLine[] {
  return items.flatMap(item => {
    const category = categories.find(candidate => candidate.id === item.category_id)
    if (!category) return []
    return [{
      id: item.id,
      name: item.name,
      amount: financeMinorUnitsToMoney(item.amount),
      budget_type: category.budget_type,
      allocation_role: item.allocation_role,
      is_planned: item.is_planned,
      is_recurring: item.is_recurring,
    }]
  })
}

export function FinancePage() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const api = useMemo(() => createFinanceApi(profile.household_id, profile.id), [profile.household_id, profile.id])
  const [view, setView] = useState<FinanceView>('budget')
  const [monthSource, setMonthSource] = useState('empty')
  const [selectedMonthId, setSelectedMonthId] = useState('')
  const [selectedScenarioId, setSelectedScenarioId] = useState('')
  const [editingBudgetItemId, setEditingBudgetItemId] = useState('')
  const [editingScenarioItemId, setEditingScenarioItemId] = useState('')
  const [budgetName, setBudgetName] = useState('')
  const [budgetAmount, setBudgetAmount] = useState('')
  const [budgetCategoryId, setBudgetCategoryId] = useState('')
  const [budgetRole, setBudgetRole] = useState<FinanceAllocationRole>('standard')
  const [scenarioName, setScenarioName] = useState('')
  const [scenarioDescription, setScenarioDescription] = useState('')
  const [scenarioItemName, setScenarioItemName] = useState('')
  const [scenarioItemAmount, setScenarioItemAmount] = useState('')
  const [scenarioCategoryId, setScenarioCategoryId] = useState('')
  const [scenarioItemRole, setScenarioItemRole] = useState<FinanceAllocationRole>('standard')
  const createMonthRequest = useRef<{ signature: string; request_id: string } | null>(null)

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
    const availableMonths = months.data ?? []
    if (availableMonths.length === 0) {
      setSelectedMonthId('')
    } else if (!availableMonths.some(month => month.id === selectedMonthId)) {
      setSelectedMonthId(availableMonths[0].id)
    }
  }, [months.data, selectedMonthId])

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
    enabled: Boolean(selectedScenarioId),
  })

  const createMonth = useMutation({
    mutationFn: (input: FinanceCreateMonthInput) => api.createMonth(input),
    onSuccess: async (month, input) => {
      if (createMonthRequest.current?.request_id === input.request_id) createMonthRequest.current = null
      queryClient.setQueryData<FinanceMonth[]>(['financeMonths', profile.household_id], current =>
        [month, ...(current ?? []).filter(candidate => candidate.id !== month.id)]
          .sort((left, right) => right.month_start.localeCompare(left.month_start)))
      setSelectedMonthId(month.id)
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
      setScenarioName('')
      setScenarioDescription('')
      await queryClient.invalidateQueries({ queryKey: ['financeScenarios', profile.household_id] })
    },
  })
  const createBudgetItem = useMutation({
    mutationFn: (input: Parameters<typeof api.createBudgetItem>[0]) => api.createBudgetItem(input),
    onSuccess: async (_data, input) => {
      setBudgetName('')
      setBudgetAmount('')
      setBudgetRole('standard')
      await queryClient.invalidateQueries({ queryKey: ['financeBudgetItems', profile.household_id, input.month_id] })
    },
  })
  const createScenarioItem = useMutation({
    mutationFn: (input: Parameters<typeof api.createScenarioItem>[0]) => api.createScenarioItem(input),
    onSuccess: async (_data, input) => {
      setScenarioItemName('')
      setScenarioItemAmount('')
      setScenarioItemRole('standard')
      await queryClient.invalidateQueries({ queryKey: ['financeScenarioItems', profile.household_id, input.scenario_id] })
    },
  })
  const updateAllocationRole = useMutation({
    mutationFn: async (input: {
      kind: 'budget' | 'scenario'
      id: string
      expectedVersion: number
      role: FinanceAllocationRole
      categoryType: FinanceBudgetType
    }) => input.kind === 'budget'
      ? api.updateBudgetItemAllocationRole(input.id, input.expectedVersion, input.role, input.categoryType)
      : api.updateScenarioItemAllocationRole(input.id, input.expectedVersion, input.role, input.categoryType),
    onSettled: async (_data, _error, input) => {
      const queryKey = input.kind === 'budget'
        ? ['financeBudgetItems', profile.household_id]
        : ['financeScenarioItems', profile.household_id]
      await queryClient.invalidateQueries({ queryKey })
    },
  })
  const updateFinanceItem = useMutation({
    mutationFn: (input: Parameters<typeof api.updateBudgetItem>[0] & { kind: 'budget' | 'scenario' }) => {
      const { kind, ...changes } = input
      return kind === 'budget' ? api.updateBudgetItem(changes) : api.updateScenarioItem(changes)
    },
    onSuccess: async (_data, input) => {
      if (input.kind === 'budget') {
        setEditingBudgetItemId('')
        await queryClient.invalidateQueries({ queryKey: ['financeBudgetItems', profile.household_id] })
      } else {
        setEditingScenarioItemId('')
        await queryClient.invalidateQueries({ queryKey: ['financeScenarioItems', profile.household_id] })
      }
    },
    onError: async (error, input) => {
      if (!(error instanceof FinanceVersionConflictError)) return
      if (input.kind === 'budget') setEditingBudgetItemId('')
      else setEditingScenarioItemId('')
      const queryKey = input.kind === 'budget'
        ? ['financeBudgetItems', profile.household_id]
        : ['financeScenarioItems', profile.household_id]
      await queryClient.invalidateQueries({ queryKey })
    },
  })

  const monthList = months.data ?? []
  const categoryList = categories.data ?? []
  const scenarioList = scenarios.data ?? []
  const selectedBudgetCategory = categoryList.find(category => category.id === budgetCategoryId)
  const selectedScenarioCategory = categoryList.find(category => category.id === scenarioCategoryId)
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

  function submitNewMonth() {
    const source: FinanceCreateMonthInput['source'] = effectiveMonthSource === 'recurring' && latestMonth
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

  function chooseBudgetCategory(categoryId: string) {
    setBudgetCategoryId(categoryId)
    if (categoryList.find(category => category.id === categoryId)?.budget_type !== 'saving') setBudgetRole('standard')
  }

  function chooseScenarioCategory(categoryId: string) {
    setScenarioCategoryId(categoryId)
    if (categoryList.find(category => category.id === categoryId)?.budget_type !== 'saving') setScenarioItemRole('standard')
  }

  function submitBudgetItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!activeMonth || !selectedBudgetCategory) return
    createBudgetItem.mutate({
      month_id: activeMonth.id,
      category_id: selectedBudgetCategory.id,
      category_type: selectedBudgetCategory.budget_type,
      name: budgetName.trim(),
      amount: budgetAmount,
      allocation_role: budgetRole,
      sort_order: budgetItems.data?.length ?? 0,
    })
  }

  function submitScenarioItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!activeScenario || !selectedScenarioCategory) return
    createScenarioItem.mutate({
      scenario_id: activeScenario.id,
      category_id: selectedScenarioCategory.id,
      category_type: selectedScenarioCategory.budget_type,
      name: scenarioItemName.trim(),
      amount: scenarioItemAmount,
      allocation_role: scenarioItemRole,
      sort_order: scenarioItems.data?.length ?? 0,
    })
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

  return (
    <>
      <PageHeader
        eyebrow="Finanse"
        title="Budżet domowy"
        description="Planuj miesięczne pozycje i porównuj scenariusze. Rola osobistej alokacji jest zapisana przy każdej pozycji."
        action={view === 'budget' ? (
          <div className="finance-month-actions">
            <label className="finance-month-select">Początkowe pozycje
              <select value={effectiveMonthSource} onChange={event => setMonthSource(event.target.value)} disabled={createMonth.isPending || months.isPending}>
                <option value="empty">Pusty miesiąc</option>
                {latestMonth && <option value="recurring">Powtarzalne z {displayMonth(latestMonth)}</option>}
                {scenarioList.map(scenario => <option key={scenario.id} value={`scenario:${scenario.id}`}>Scenariusz: {scenario.name}</option>)}
              </select>
            </label>
            <button className="primary-button" type="button" onClick={submitNewMonth} disabled={createMonth.isPending || months.isPending}>
              {createMonth.isPending ? 'Tworzę miesiąc…' : monthList.length ? 'Utwórz następny miesiąc' : 'Utwórz bieżący miesiąc'}
            </button>
          </div>
        ) : undefined}
      />

      <div className="finance-tabs" aria-label="Widoki finansów">
        <button type="button" aria-pressed={view === 'budget'} className={view === 'budget' ? 'finance-tab active' : 'finance-tab'} onClick={() => setView('budget')}>
          Budżet miesięczny
        </button>
        <button type="button" aria-pressed={view === 'scenarios'} className={view === 'scenarios' ? 'finance-tab active' : 'finance-tab'} onClick={() => setView('scenarios')}>
          Scenariusze
        </button>
      </div>

      {pageErrors.map((error, index) => <p className="error-message" role="alert" key={index}>{errorText(error)}</p>)}
      {updateFinanceItem.error instanceof FinanceVersionConflictError && (
        <p className="error-message" role="alert">{errorText(updateFinanceItem.error)}</p>
      )}

      {view === 'budget' ? (
        <section className="panel finance-panel">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">Budżet miesięczny</h2>
              <p className="panel-kicker">Rola osobistej alokacji działa tylko dla kategorii oszczędności.</p>
            </div>
            {monthList.length > 0 && (
              <label className="finance-month-select">Miesiąc
                <select value={selectedMonthId} onChange={event => setSelectedMonthId(event.target.value)}>
                  {monthList.map(month => <option value={month.id} key={month.id}>{displayMonth(month)}</option>)}
                </select>
              </label>
            )}
          </div>

          {months.isPending && <p className="panel-message" role="status">Ładuję miesiące…</p>}
          {monthList.length === 0 && !months.isPending && (
            <p className="panel-message">Nie ma jeszcze miesięcy budżetowych. Utwórz miesiąc, aby dodać pozycje.</p>
          )}
          {activeMonth && (
            <>
              {budgetItems.isPending && <p className="panel-message" role="status">Ładuję pozycje…</p>}
              {budgetItems.isError && <p className="error-message finance-error" role="alert">{errorText(budgetItems.error)}</p>}
              {budgetLines.length > 0 && <SummaryCards lines={budgetLines} />}
              {budgetItems.data && budgetItems.data.length === 0 && <p className="panel-message">Ten miesiąc nie ma jeszcze pozycji.</p>}
              {(budgetItems.data ?? []).map(item => {
                const category = categoryList.find(candidate => candidate.id === item.category_id)
                if (editingBudgetItemId === item.id) {
                  return (
                    <div key={item.id}>
                      <FinanceItemEditForm
                        item={item}
                        categories={categoryList}
                        disabled={updateFinanceItem.isPending}
                        onCancel={() => setEditingBudgetItemId('')}
                        onSave={changes => updateFinanceItem.mutate({ ...changes, kind: 'budget' })}
                      />
                      {updateFinanceItem.isError && <p className="error-message finance-error" role="alert">{errorText(updateFinanceItem.error)}</p>}
                    </div>
                  )
                }
                return (
                  <div className="finance-item-row" key={item.id}>
                    <div className="finance-item-copy">
                      <strong>{item.name}</strong>
                      <span>{category ? `${category.name} · ${budgetTypeNames[category.budget_type]}` : 'Kategoria niedostępna'}</span>
                    </div>
                    <strong className="finance-item-amount">{formatPln(financeMinorUnitsToMoney(item.amount))}</strong>
                    <AllocationRoleSelect
                      role={item.allocation_role}
                      categoryType={category?.budget_type}
                      disabled={updateAllocationRole.isPending}
                      label={`Rola alokacji: ${item.name}`}
                      onChange={role => updateAllocationRole.mutate({ kind: 'budget', id: item.id, expectedVersion: item.version, role, categoryType: category?.budget_type ?? 'variable_expense' })}
                    />
                    <button className="button-quiet finance-edit-button" type="button" onClick={() => setEditingBudgetItemId(item.id)} disabled={updateAllocationRole.isPending || updateFinanceItem.isPending}>Edytuj</button>
                  </div>
                )
              })}

              <form className="finance-item-form" onSubmit={submitBudgetItem}>
                <label>Pozycja
                  <input required maxLength={160} value={budgetName} onChange={event => setBudgetName(event.target.value)} placeholder="Nazwa pozycji" />
                </label>
                <label>Kwota
                  <input required inputMode="decimal" value={budgetAmount} onChange={event => setBudgetAmount(event.target.value)} placeholder="0,00" />
                </label>
                <label>Kategoria
                  <select required value={budgetCategoryId} onChange={event => chooseBudgetCategory(event.target.value)}>
                    <option value="" disabled>Wybierz kategorię</option>
                    {categoryList.map(category => <option key={category.id} value={category.id}>{category.name} · {budgetTypeNames[category.budget_type]}</option>)}
                  </select>
                </label>
                <label>Rola
                  <select value={budgetRole} disabled={selectedBudgetCategory?.budget_type !== 'saving'} onChange={event => setBudgetRole(event.target.value as FinanceAllocationRole)}>
                    <option value="standard">Standard</option>
                    {selectedBudgetCategory?.budget_type === 'saving' && <option value="personal_allowance">Osobista alokacja</option>}
                  </select>
                </label>
                <button className="primary-button" type="submit" disabled={!selectedBudgetCategory || createBudgetItem.isPending}>
                  {createBudgetItem.isPending ? 'Zapisuję…' : 'Dodaj pozycję'}
                </button>
              </form>
              {!categories.isPending && categoryList.length === 0 && <p className="panel-message">Najpierw zaimportuj lub dodaj kategorie, aby tworzyć pozycje budżetu.</p>}
              {createBudgetItem.isError && <p className="error-message finance-error" role="alert">{errorText(createBudgetItem.error)}</p>}
              {updateAllocationRole.isError && <p className="error-message finance-error" role="alert">{errorText(updateAllocationRole.error)}</p>}
            </>
          )}
          {createMonth.isError && <p className="error-message finance-error" role="alert">{errorText(createMonth.error)}</p>}
        </section>
      ) : (
        <div className="finance-scenarios-layout">
          <section className="panel finance-panel">
            <div className="panel-head">
              <div>
                <h2 className="panel-title">Scenariusze</h2>
                <p className="panel-kicker">Pozycje scenariusza zapisują tę samą rolę co pozycje budżetowe.</p>
              </div>
              {scenarioList.length > 0 && (
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

            {activeScenario && (
              <>
                <h3 className="finance-subheading">{activeScenario.name}</h3>
                {activeScenario.description && <p className="finance-description">{activeScenario.description}</p>}
                {scenarioItems.isPending && <p className="panel-message" role="status">Ładuję pozycje scenariusza…</p>}
                {scenarioItems.isError && <p className="error-message finance-error" role="alert">{errorText(scenarioItems.error)}</p>}
                {scenarioLines.length > 0 && <SummaryCards lines={scenarioLines} />}
                {scenarioItems.data && scenarioItems.data.length === 0 && <p className="panel-message">Ten scenariusz nie ma jeszcze pozycji.</p>}
                {(scenarioItems.data ?? []).map(item => {
                  const category = categoryList.find(candidate => candidate.id === item.category_id)
                  if (editingScenarioItemId === item.id) {
                    return (
                      <div key={item.id}>
                        <FinanceItemEditForm
                          item={item}
                          categories={categoryList}
                          disabled={updateFinanceItem.isPending}
                          onCancel={() => setEditingScenarioItemId('')}
                          onSave={changes => updateFinanceItem.mutate({ ...changes, kind: 'scenario' })}
                        />
                        {updateFinanceItem.isError && <p className="error-message finance-error" role="alert">{errorText(updateFinanceItem.error)}</p>}
                      </div>
                    )
                  }
                  return (
                    <div className="finance-item-row" key={item.id}>
                      <div className="finance-item-copy">
                        <strong>{item.name}</strong>
                        <span>{category ? `${category.name} · ${budgetTypeNames[category.budget_type]}` : 'Kategoria niedostępna'}</span>
                      </div>
                      <strong className="finance-item-amount">{formatPln(financeMinorUnitsToMoney(item.amount))}</strong>
                      <AllocationRoleSelect
                        role={item.allocation_role}
                        categoryType={category?.budget_type}
                        disabled={updateAllocationRole.isPending}
                        label={`Rola alokacji: ${item.name}`}
                        onChange={role => updateAllocationRole.mutate({ kind: 'scenario', id: item.id, expectedVersion: item.version, role, categoryType: category?.budget_type ?? 'variable_expense' })}
                      />
                      <button className="button-quiet finance-edit-button" type="button" onClick={() => setEditingScenarioItemId(item.id)} disabled={updateAllocationRole.isPending || updateFinanceItem.isPending}>Edytuj</button>
                    </div>
                  )
                })}

                <form className="finance-item-form" onSubmit={submitScenarioItem}>
                  <label>Pozycja
                    <input required maxLength={160} value={scenarioItemName} onChange={event => setScenarioItemName(event.target.value)} placeholder="Nazwa pozycji" />
                  </label>
                  <label>Kwota
                    <input required inputMode="decimal" value={scenarioItemAmount} onChange={event => setScenarioItemAmount(event.target.value)} placeholder="0,00" />
                  </label>
                  <label>Kategoria
                    <select required value={scenarioCategoryId} onChange={event => chooseScenarioCategory(event.target.value)}>
                      <option value="" disabled>Wybierz kategorię</option>
                      {categoryList.map(category => <option key={category.id} value={category.id}>{category.name} · {budgetTypeNames[category.budget_type]}</option>)}
                    </select>
                  </label>
                  <label>Rola
                    <select value={scenarioItemRole} disabled={selectedScenarioCategory?.budget_type !== 'saving'} onChange={event => setScenarioItemRole(event.target.value as FinanceAllocationRole)}>
                      <option value="standard">Standard</option>
                      {selectedScenarioCategory?.budget_type === 'saving' && <option value="personal_allowance">Osobista alokacja</option>}
                    </select>
                  </label>
                  <button className="primary-button" type="submit" disabled={!selectedScenarioCategory || createScenarioItem.isPending}>
                    {createScenarioItem.isPending ? 'Zapisuję…' : 'Dodaj pozycję'}
                  </button>
                </form>
                {!categories.isPending && categoryList.length === 0 && <p className="panel-message">Najpierw zaimportuj lub dodaj kategorie, aby tworzyć pozycje scenariusza.</p>}
                {createScenarioItem.isError && <p className="error-message finance-error" role="alert">{errorText(createScenarioItem.error)}</p>}
                {updateAllocationRole.isError && <p className="error-message finance-error" role="alert">{errorText(updateAllocationRole.error)}</p>}
              </>
            )}
            {scenarioList.length === 0 && !scenarios.isPending && <p className="panel-message">Dodaj scenariusz, aby wprowadzać jego pozycje.</p>}
          </section>
        </div>
      )}
    </>
  )
}
