import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '../auth/supabase.ts'
import { moneyToFinanceMinorUnits } from './money.ts'
import { financeSections } from './categories.ts'
import type {
  FinanceAccountLifecycleAction,
  FinanceAccountLifecycleInput,
  FinanceAccountLifecyclePreview,
  FinanceBudgetItem,
  FinanceCategory,
  FinanceCreateCategoryInput,
  FinanceRenameCategoryInput,
  FinanceCreateMonthInput,
  FinanceDeleteTransferInput,
  FinanceId,
  FinanceMonth,
  FinanceMoney,
  FinanceMutationConflict,
  FinanceSavingsAccount,
  FinanceSavingsTransferRecord,
  FinanceSavingsTransaction,
  FinanceSaveSavingsAccountInput,
  FinanceSaveSavingsTransactionInput,
  FinanceDeleteSavingsTransactionInput,
  FinanceScenario,
  FinanceScenarioItem,
  FinanceTransferInput,
  FinanceTransferResult,
  FinanceSavingsPlan,
  FinanceIrregularExpensePlan,
  FinanceProject,
  FinanceProjectExpense,
  FinanceProjectExpensePage,
  FinanceProjectExpenseSummary,
  FinanceSaveSavingsPlanInput,
  FinanceSaveIrregularReserveInput,
  FinanceSaveProjectInput,
  FinanceSaveProjectExpenseInput,
  FinanceDeleteRecordInput,
  FinanceRecordMutationInput,
} from './types'

type FinanceBudgetItemRow = Omit<FinanceBudgetItem, 'amount'> & { amount_minor: string }
type FinanceScenarioItemRow = Omit<FinanceScenarioItem, 'amount'> & { amount_minor: string }
type FinanceSavingsAccountRow = Omit<FinanceSavingsAccount, 'opening_balance' | 'target_amount'> & {
  opening_balance_minor: string
  target_amount_minor: string | null
}
type FinanceTransferMovementRow = {
  id: FinanceId
  transfer_id: FinanceId
  account_id: FinanceId
  transaction_date: string
  amount_minor: string
  description: string | null
}
type FinanceSavingsTransactionRow = Omit<FinanceSavingsTransaction, 'amount'> & { amount_minor: string }

const savingsAccountColumns = 'id, household_id, created_by, created_at, updated_at, version, name, account_type, parent_id, opening_balance_minor:opening_balance::text, target_amount_minor:target_amount::text, is_archived, visibility, owner_user_id'
const savingsTransferColumns = 'id, household_id, created_by, created_at, updated_at, version'
const savingsTransactionColumns = 'id, household_id, created_by, created_at, updated_at, version, account_id, transaction_date, amount_minor:amount::text, description, excluded_from_monthly_savings, transfer_id'
const financePageSize = 500
export const financeProjectExpensePageSize = 15
const commonColumns = 'id, household_id, created_by, created_at, updated_at, version'
const savingsPlanColumns = `${commonColumns}, name, plan_type, account_id, monthly_amount_minor:monthly_amount::text, annual_amount_override_minor:annual_amount_override::text, visibility, owner_user_id`
const reserveColumns = `${commonColumns}, name, annual_amount_minor:annual_amount::text`
const projectColumns = `${commonColumns}, name, description, target_budget_minor:target_budget::text, is_archived`
const projectExpenseColumns = `${commonColumns}, project_id, expense_date, name, amount_minor:amount::text, notes`

const monthColumns = 'id, household_id, created_by, created_at, updated_at, month_start, display_name'
const categoryColumns = 'id, household_id, created_by, created_at, updated_at, version, name, budget_type, allocation_role, parent_id, color'
const scenarioColumns = 'id, household_id, created_by, created_at, updated_at, version, name, description'
const budgetItemColumns = 'id, household_id, created_by, created_at, updated_at, version, month_id, category_id, name, amount_minor:amount::text, is_planned, is_recurring, notes'
const scenarioItemColumns = 'id, household_id, created_by, created_at, updated_at, version, scenario_id, category_id, name, amount_minor:amount::text, is_planned, is_recurring, notes'

function requireSupabase(client: SupabaseClient | null): SupabaseClient {
  if (!client) throw new Error('Supabase is not configured. Check the Family Hub environment settings.')
  return client
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error
    && (error as { name?: unknown }).name === 'AbortError'
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error
  const message = typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message: unknown }).message)
    : ''
  return new Error(message || 'Could not complete the finance request. Please try again.')
}

async function resolve<T>(
  request: PromiseLike<{ data: T | null; error: { message: string } | null }>
    | (() => PromiseLike<{ data: T | null; error: { message: string } | null }>),
): Promise<T> {
  try {
    const { data, error } = await (typeof request === 'function' ? request() : request)
    if (error) throw new Error(error.message)
    if (data === null) throw new Error('Family Hub returned an empty finance response. Please try again.')
    return data
  } catch (error) {
    if (isAbortError(error)) throw error
    throw normalizeError(error)
  }
}

async function readAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const allRows: T[] = []
  for (let from = 0; ; from += financePageSize) {
    const page = await resolve<T[]>(() => fetchPage(from, from + financePageSize - 1))
    allRows.push(...page)
    if (page.length < financePageSize) return allRows
  }
}

export class FinanceVersionConflictError extends Error implements FinanceMutationConflict {
  readonly code = 'version_conflict' as const
  readonly expected_version: number
  readonly current_version: number | null

  constructor(
    expectedVersion: number,
    currentVersion: number | null,
  ) {
    super(currentVersion === null
      ? 'This finance item was removed or is no longer available.'
      : 'This finance item changed after it was loaded. The latest version has been refreshed.')
    this.expected_version = expectedVersion
    this.current_version = currentVersion
    this.name = 'FinanceVersionConflictError'
  }
}

type VersionedUpdateResponse = {
  data: { id: FinanceId } | null
  error: { message: string } | null
}

type CurrentVersionResponse = {
  data: { version: number } | null
  error: { message: string } | null
}

async function resolveVersionedUpdate(
  request: () => PromiseLike<VersionedUpdateResponse>,
  readCurrentVersion: () => PromiseLike<CurrentVersionResponse>,
  expectedVersion: number,
): Promise<void> {
  try {
    const { data, error } = await request()
    if (error) throw normalizeError(error)
    if (data) return

    const current = await readCurrentVersion()
    if (current.error) throw normalizeError(current.error)
    throw new FinanceVersionConflictError(
      expectedVersion,
      current.data ? Number(current.data.version) : null,
    )
  } catch (error) {
    if (isAbortError(error)) throw error
    throw normalizeError(error)
  }
}

function toBudgetItem(row: FinanceBudgetItemRow): FinanceBudgetItem {
  const { amount_minor, ...item } = row
  return { ...item, amount: amount_minor }
}

function toScenarioItem(row: FinanceScenarioItemRow): FinanceScenarioItem {
  const { amount_minor, ...item } = row
  return { ...item, amount: amount_minor }
}

function toSavingsAccount(row: FinanceSavingsAccountRow): FinanceSavingsAccount {
  const { opening_balance_minor, target_amount_minor, ...account } = row
  return {
    ...account,
    opening_balance: opening_balance_minor,
    target_amount: target_amount_minor,
  }
}

function toSavingsTransaction(row: FinanceSavingsTransactionRow): FinanceSavingsTransaction {
  const { amount_minor, ...transaction } = row
  return { ...transaction, amount: amount_minor }
}

interface CreateBudgetItemInput {
  month_id: FinanceId
  category_id: FinanceId
  name: string
  amount: FinanceMoney
  is_recurring?: boolean
}

interface CreateScenarioItemInput {
  scenario_id: FinanceId
  category_id: FinanceId
  name: string
  amount: FinanceMoney
  is_recurring?: boolean
}

interface UpdateFinanceItemInput {
  id: FinanceId
  expected_version: number
  category_id: FinanceId
  name: string
  amount: FinanceMoney
  is_recurring?: boolean
}

export function createFinanceApi(
  householdId: FinanceId,
  userId: FinanceId,
  client: SupabaseClient | null = supabase,
) {
  async function listManagedRecords<T>(table: string, columns: string, signal?: AbortSignal): Promise<T[]> {
    return readAllPages<T>((from, to) => {
      let query = requireSupabase(client).from(table).select(columns).eq('household_id', householdId)
        .order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to)
      if (signal) query = query.abortSignal(signal)
      return query as unknown as PromiseLike<{ data: T[] | null; error: { message: string } | null }>
    })
  }

  async function listSavingsPlans(signal?: AbortSignal): Promise<FinanceSavingsPlan[]> {
    const rows = await listManagedRecords<Omit<FinanceSavingsPlan, 'monthly_amount' | 'annual_amount_override'> & {
      monthly_amount_minor: string; annual_amount_override_minor: string | null
    }>('finance_savings_plans', savingsPlanColumns, signal)
    return rows.map(({ monthly_amount_minor, annual_amount_override_minor, ...row }) => ({
      ...row, monthly_amount: monthly_amount_minor, annual_amount_override: annual_amount_override_minor,
    }))
  }

  async function listIrregularReserves(signal?: AbortSignal): Promise<FinanceIrregularExpensePlan[]> {
    const rows = await listManagedRecords<Omit<FinanceIrregularExpensePlan, 'annual_amount'> & { annual_amount_minor: string }>('finance_irregular_expense_plans', reserveColumns, signal)
    return rows.map(({ annual_amount_minor, ...row }) => ({ ...row, annual_amount: annual_amount_minor }))
  }

  async function listProjects(signal?: AbortSignal): Promise<FinanceProject[]> {
    const rows = await listManagedRecords<Omit<FinanceProject, 'target_budget'> & { target_budget_minor: string | null }>('finance_projects', projectColumns, signal)
    return rows.map(({ target_budget_minor, ...row }) => ({ ...row, target_budget: target_budget_minor }))
  }

  async function listProjectExpenseSummaries(signal?: AbortSignal): Promise<FinanceProjectExpenseSummary[]> {
    return resolve<FinanceProjectExpenseSummary[]>(() => {
      let query = requireSupabase(client).rpc('finance_project_expense_summaries', { p_household_id: householdId })
      if (signal) query = query.abortSignal(signal)
      return query as unknown as PromiseLike<{ data: FinanceProjectExpenseSummary[] | null; error: { message: string } | null }>
    })
  }

  async function listProjectExpenses(signal?: AbortSignal): Promise<FinanceProjectExpense[]> {
    const rows = await listManagedRecords<Omit<FinanceProjectExpense, 'amount'> & { amount_minor: string }>('finance_project_expenses', projectExpenseColumns, signal)
    return rows.map(({ amount_minor, ...row }) => ({ ...row, amount: amount_minor }))
  }

  async function listProjectExpensePage(projectId: string, page: number, signal?: AbortSignal): Promise<FinanceProjectExpensePage> {
    const pageIndex = Math.max(0, Math.floor(page))
    const firstRow = pageIndex * financeProjectExpensePageSize
    const rows = await resolve<(Omit<FinanceProjectExpense, 'amount'> & { amount_minor: string })[]>(() => {
      let query = requireSupabase(client).from('finance_project_expenses').select(projectExpenseColumns)
        .eq('household_id', householdId).eq('project_id', projectId)
        .order('expense_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false }).order('id', { ascending: false })
        .range(firstRow, firstRow + financeProjectExpensePageSize)
      if (signal) query = query.abortSignal(signal)
      return query as unknown as PromiseLike<{ data: (Omit<FinanceProjectExpense, 'amount'> & { amount_minor: string })[] | null; error: { message: string } | null }>
    })
    return {
      items: rows.slice(0, financeProjectExpensePageSize).map(({ amount_minor, ...row }) => ({ ...row, amount: amount_minor })),
      hasMore: rows.length > financeProjectExpensePageSize,
    }
  }

  async function mutateManagedRecord(input: FinanceRecordMutationInput, details: Record<string, unknown> | null, entity: 'plan' | 'reserve' | 'project' | 'expense'): Promise<void> {
    const result = await resolve<{ conflict?: boolean; current_version?: number }>(() => requireSupabase(client).rpc(
      entity === 'plan' ? 'finance_mutate_savings_plan' : 'finance_mutate_shared_record', {
        p_household_id: householdId, p_request_id: input.request_id,
        ...(entity === 'plan' ? { p_plan_id: input.id ?? null } : { p_entity: entity, p_id: input.id ?? null }),
        p_expected_version: input.expected_version ?? null, p_delete: details === null, p_details: details,
      }))
    if (result.conflict) throw new FinanceVersionConflictError(input.expected_version ?? 0, result.current_version ?? null)
  }

  function saveSavingsPlan(input: FinanceSaveSavingsPlanInput) {
    return mutateManagedRecord(input, { name: input.name.trim(), plan_type: input.plan_type, account_id: input.account_id,
      monthly_amount_minor: moneyToFinanceMinorUnits(input.monthly_amount),
      annual_amount_override_minor: input.annual_amount_override == null ? null : moneyToFinanceMinorUnits(input.annual_amount_override),
      visibility: input.visibility }, 'plan')
  }
  function deleteSavingsPlan(input: FinanceDeleteRecordInput) { return mutateManagedRecord(input, null, 'plan') }
  function saveIrregularReserve(input: FinanceSaveIrregularReserveInput) {
    return mutateManagedRecord(input, { name: input.name.trim(), amount_minor: moneyToFinanceMinorUnits(input.annual_amount) }, 'reserve')
  }
  function deleteIrregularReserve(input: FinanceDeleteRecordInput) { return mutateManagedRecord(input, null, 'reserve') }
  function saveProject(input: FinanceSaveProjectInput) {
    return mutateManagedRecord(input, { name: input.name.trim(), description: input.description,
      target_budget_minor: input.target_budget == null ? null : moneyToFinanceMinorUnits(input.target_budget),
      is_archived: input.is_archived }, 'project')
  }
  function deleteProject(input: FinanceDeleteRecordInput) { return mutateManagedRecord(input, null, 'project') }
  function saveProjectExpense(input: FinanceSaveProjectExpenseInput) {
    return mutateManagedRecord(input, { project_id: input.project_id, expense_date: input.expense_date,
      name: input.name.trim(), amount_minor: moneyToFinanceMinorUnits(input.amount), notes: input.notes }, 'expense')
  }
  function deleteProjectExpense(input: FinanceDeleteRecordInput) { return mutateManagedRecord(input, null, 'expense') }
  async function listMonths(signal?: AbortSignal): Promise<FinanceMonth[]> {
    const supabaseClient = requireSupabase(client)
    return resolve<FinanceMonth[]>(() => {
      let query = supabaseClient.from('finance_months')
        .select(monthColumns)
        .eq('household_id', householdId)
        .order('month_start', { ascending: false })
        .order('id', { ascending: true })
      if (signal) query = query.abortSignal(signal)
      return query
    })
  }

  async function listCategories(signal?: AbortSignal): Promise<FinanceCategory[]> {
    const supabaseClient = requireSupabase(client)
    return resolve<FinanceCategory[]>(() => {
      let query = supabaseClient.from('finance_categories')
        .select(categoryColumns)
        .eq('household_id', householdId)
        .order('name', { ascending: true })
        .order('id', { ascending: true })
      if (signal) query = query.abortSignal(signal)
      return query
    })
  }

  function categoryName(name: string): string {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('Podaj nazwę kategorii.')
    if (trimmed.length > 160) throw new Error('Nazwa kategorii może mieć maksymalnie 160 znaków.')
    return trimmed
  }

  async function createCategory(input: FinanceCreateCategoryInput): Promise<FinanceCategory> {
    const name = categoryName(input.name)
    const section = financeSections.find(candidate => candidate.id === input.section)
    if (!section) throw new Error('Wybierz prawidłową sekcję budżetu.')
    return resolve<FinanceCategory>(() => requireSupabase(client).from('finance_categories')
      .insert({ household_id: householdId, created_by: userId, name,
        budget_type: section.budget_type, allocation_role: section.allocation_role,
        ...(input.parent_id ? { parent_id: input.parent_id } : {}) })
      .select(categoryColumns)
      .single())
  }

  async function renameCategory(input: FinanceRenameCategoryInput): Promise<void> {
    const name = categoryName(input.name)
    const supabaseClient = requireSupabase(client)
    await resolveVersionedUpdate(
      () => supabaseClient.from('finance_categories').update({ name })
        .eq('household_id', householdId).eq('id', input.id).eq('version', input.expected_version)
        .select('id').maybeSingle() as unknown as PromiseLike<VersionedUpdateResponse>,
      () => supabaseClient.from('finance_categories').select('version')
        .eq('household_id', householdId).eq('id', input.id)
        .maybeSingle() as unknown as PromiseLike<CurrentVersionResponse>,
      input.expected_version,
    )
  }

  async function deleteCategory(input: { id: FinanceId; expected_version: number }): Promise<void> {
    const supabaseClient = requireSupabase(client)
    await resolveVersionedUpdate(
      async () => {
        const result = await supabaseClient.from('finance_categories').delete()
          .eq('household_id', householdId).eq('id', input.id).eq('version', input.expected_version)
          .select('id').maybeSingle()
        if (result.error?.code === '23503') {
          throw new Error('Nie można usunąć kategorii używanej w budżecie, prognozach lub mającej podkategorie.')
        }
        return result as VersionedUpdateResponse
      },
      () => supabaseClient.from('finance_categories').select('version')
        .eq('household_id', householdId).eq('id', input.id)
        .maybeSingle() as unknown as PromiseLike<CurrentVersionResponse>,
      input.expected_version,
    )
  }

  async function listBudgetItems(monthId: FinanceId, signal?: AbortSignal): Promise<FinanceBudgetItem[]> {
    const supabaseClient = requireSupabase(client)
    const rows = await resolve<FinanceBudgetItemRow[]>(() => {
      let query = supabaseClient.from('finance_budget_items')
        .select(budgetItemColumns)
        .eq('household_id', householdId)
        .eq('month_id', monthId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
      if (signal) query = query.abortSignal(signal)
      return query as unknown as PromiseLike<{ data: FinanceBudgetItemRow[] | null; error: { message: string } | null }>
    })
    return rows.map(toBudgetItem)
  }

  async function listSavingsAccounts(signal?: AbortSignal): Promise<FinanceSavingsAccount[]> {
    const supabaseClient = requireSupabase(client)
    const rows = await readAllPages<FinanceSavingsAccountRow>((from, to) => {
      let query = supabaseClient.from('finance_savings_accounts')
        .select(savingsAccountColumns)
        .eq('household_id', householdId)
        .order('name', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)
      if (signal) query = query.abortSignal(signal)
      return query as unknown as PromiseLike<{ data: FinanceSavingsAccountRow[] | null; error: { message: string } | null }>
    })
    return rows.map(toSavingsAccount)
  }

  async function listSavingsTransactions(signal?: AbortSignal): Promise<FinanceSavingsTransaction[]> {
    const supabaseClient = requireSupabase(client)
    const rows = await readAllPages<FinanceSavingsTransactionRow>((from, to) => {
      let query = supabaseClient.from('finance_savings_transactions')
        .select(savingsTransactionColumns)
        .eq('household_id', householdId)
        .order('transaction_date', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to)
      if (signal) query = query.abortSignal(signal)
      return query as unknown as PromiseLike<{ data: FinanceSavingsTransactionRow[] | null; error: { message: string } | null }>
    })
    return rows.map(toSavingsTransaction)
  }

  async function listSavingsTransfers(signal?: AbortSignal): Promise<FinanceSavingsTransferRecord[]> {
    const supabaseClient = requireSupabase(client)
    const [transfers, movements] = await Promise.all([
      readAllPages<Pick<FinanceSavingsTransferRecord, 'id' | 'household_id' | 'created_by' | 'created_at' | 'updated_at' | 'version'>>((from, to) => {
        let query = supabaseClient.from('finance_savings_transfers')
          .select(savingsTransferColumns)
          .eq('household_id', householdId)
          .order('created_at', { ascending: false })
          .order('id', { ascending: true })
          .range(from, to)
        if (signal) query = query.abortSignal(signal)
        return query as unknown as PromiseLike<{ data: Array<Pick<FinanceSavingsTransferRecord, 'id' | 'household_id' | 'created_by' | 'created_at' | 'updated_at' | 'version'>> | null; error: { message: string } | null }>
      }),
      readAllPages<FinanceTransferMovementRow>((from, to) => {
        let query = supabaseClient.from('finance_savings_transactions')
          .select('id, transfer_id, account_id, transaction_date, amount_minor:amount::text, description')
          .eq('household_id', householdId)
          .not('transfer_id', 'is', null)
          .order('transaction_date', { ascending: false })
          .range(from, to)
        if (signal) query = query.abortSignal(signal)
        return query as unknown as PromiseLike<{ data: FinanceTransferMovementRow[] | null; error: { message: string } | null }>
      }),
    ])

    const movementsByTransfer = new Map<FinanceId, FinanceTransferMovementRow[]>()
    for (const movement of movements) {
      const legs = movementsByTransfer.get(movement.transfer_id) ?? []
      legs.push(movement)
      movementsByTransfer.set(movement.transfer_id, legs)
    }

    return transfers.flatMap(transfer => {
      const legs = movementsByTransfer.get(transfer.id) ?? []
      if (legs.length !== 2) return []
      const fromLeg = legs.find(leg => BigInt(leg.amount_minor) < 0n)
      const toLeg = legs.find(leg => BigInt(leg.amount_minor) > 0n)
      if (!fromLeg || !toLeg || fromLeg.transaction_date !== toLeg.transaction_date
        || BigInt(fromLeg.amount_minor) + BigInt(toLeg.amount_minor) !== 0n) return []
      return [{
        ...transfer,
        from_account_id: fromLeg.account_id,
        to_account_id: toLeg.account_id,
        amount: toLeg.amount_minor,
        transaction_date: fromLeg.transaction_date,
        description: fromLeg.description,
        transaction_ids: [fromLeg.id, toLeg.id],
      }]
    })
  }

  async function listScenarios(signal?: AbortSignal): Promise<FinanceScenario[]> {
    const supabaseClient = requireSupabase(client)
    return resolve<FinanceScenario[]>(() => {
      let query = supabaseClient.from('finance_scenarios')
        .select(scenarioColumns)
        .eq('household_id', householdId)
        .order('name', { ascending: true })
        .order('id', { ascending: true })
      if (signal) query = query.abortSignal(signal)
      return query
    })
  }

  async function listScenarioItems(scenarioId: FinanceId, signal?: AbortSignal): Promise<FinanceScenarioItem[]> {
    const supabaseClient = requireSupabase(client)
    const rows = await resolve<FinanceScenarioItemRow[]>(() => {
      let query = supabaseClient.from('finance_scenario_items')
        .select(scenarioItemColumns)
        .eq('household_id', householdId)
        .eq('scenario_id', scenarioId)
        .order('id', { ascending: true })
      if (signal) query = query.abortSignal(signal)
      return query as unknown as PromiseLike<{ data: FinanceScenarioItemRow[] | null; error: { message: string } | null }>
    })
    return rows.map(toScenarioItem)
  }

  async function createMonth(input: FinanceCreateMonthInput): Promise<FinanceMonth> {
    const supabaseClient = requireSupabase(client)
    const sourceKind = input.source.kind
    return resolve<FinanceMonth>(() => supabaseClient.rpc('finance_create_month', {
      p_household_id: householdId,
      p_request_id: input.request_id,
      p_month_start: input.month_start,
      p_source_kind: sourceKind,
      p_source_month_id: input.source.kind === 'recurring' ? input.source.source_month_id : null,
      p_scenario_id: input.source.kind === 'scenario' ? input.source.scenario_id : null,
    }))
  }

  async function createSavingsTransfer(input: FinanceTransferInput): Promise<FinanceTransferResult> {
    const supabaseClient = requireSupabase(client)
    const amountMinor = moneyToFinanceMinorUnits(input.amount)
    if (BigInt(amountMinor) <= 0n) throw new Error('Transfer amount must be greater than zero.')

    const result = await resolve<FinanceTransferResult | {
      conflict: true
      account_id: FinanceId
      current_version: number
    }>(() => supabaseClient.rpc('finance_transfer_savings', {
      p_household_id: householdId,
      p_request_id: input.request_id,
      p_from_account_id: input.from_account_id,
      p_from_expected_version: input.from_expected_version,
      p_to_account_id: input.to_account_id,
      p_to_expected_version: input.to_expected_version,
      p_amount_minor: amountMinor,
      p_transaction_date: input.transaction_date,
      p_description: input.description?.trim() || null,
    }) as unknown as PromiseLike<{ data: FinanceTransferResult | { conflict: true; account_id: FinanceId; current_version: number } | null; error: { message: string } | null }>)

    if ('conflict' in result) {
      const expectedVersion = result.account_id === input.from_account_id
        ? input.from_expected_version
        : input.to_expected_version
      throw new FinanceVersionConflictError(expectedVersion, Number(result.current_version))
    }
    return result
  }

  async function deleteSavingsTransfer(input: FinanceDeleteTransferInput): Promise<void> {
    const supabaseClient = requireSupabase(client)
    const result = await resolve<{ deleted: true; transfer_id: FinanceId } | {
      conflict: true
      current_version: number
    }>(() => supabaseClient.rpc('finance_delete_transfer', {
      p_household_id: householdId,
      p_request_id: input.request_id,
      p_transfer_id: input.transfer_id,
      p_expected_version: input.expected_version,
    }) as unknown as PromiseLike<{ data: { deleted: true; transfer_id: FinanceId } | { conflict: true; current_version: number } | null; error: { message: string } | null }>)

    if ('conflict' in result) {
      throw new FinanceVersionConflictError(input.expected_version, Number(result.current_version))
    }
  }

  async function previewAccountLifecycle(accountId: FinanceId): Promise<FinanceAccountLifecyclePreview> {
    return resolve<FinanceAccountLifecyclePreview>(() => requireSupabase(client).rpc('finance_preview_account_lifecycle', {
      p_household_id: householdId,
      p_account_id: accountId,
    }))
  }

  async function applyAccountLifecycle(input: FinanceAccountLifecycleInput): Promise<{ account_id: FinanceId; version: number; action: FinanceAccountLifecycleAction }> {
    const result = await resolve<{
      account_id?: FinanceId
      version?: number
      action?: FinanceAccountLifecycleAction
      conflict?: boolean
      current_version?: number
    }>(() => requireSupabase(client).rpc('finance_apply_account_lifecycle', {
      p_household_id: householdId,
      p_request_id: input.request_id,
      p_account_id: input.account_id,
      p_expected_version: input.expected_version,
      p_snapshot_token: input.snapshot_token,
      p_action: input.action,
      p_display_balance_minor: input.display_balance == null ? null : moneyToFinanceMinorUnits(input.display_balance),
      p_visibility: input.visibility ?? null,
    }))
    if (result.conflict) throw new FinanceVersionConflictError(input.expected_version, result.current_version ?? null)
    return {
      account_id: result.account_id ?? input.account_id,
      version: Number(result.version ?? input.expected_version),
      action: result.action ?? input.action,
    }
  }

  async function saveSavingsAccount(input: FinanceSaveSavingsAccountInput): Promise<void> {
    const supabaseClient = requireSupabase(client)
    const response = await resolve<{
      account_id: FinanceId
      version?: number
      conflict?: true
      current_version?: number
    }>(() => supabaseClient.rpc('finance_save_account', {
      p_household_id: householdId,
      p_request_id: input.request_id,
      p_account_id: input.account_id ?? null,
      p_expected_version: input.expected_version ?? null,
      p_name: input.name.trim(),
      p_account_type: input.account_type,
      p_parent_id: input.parent_id,
      p_opening_balance_minor: input.opening_balance == null
        ? null
        : moneyToFinanceMinorUnits(input.opening_balance),
      p_target_amount_minor: input.target_amount == null
        ? null
        : moneyToFinanceMinorUnits(input.target_amount),
      p_visibility: input.visibility,
    }) as unknown as PromiseLike<{ data: {
      account_id: FinanceId
      version?: number
      conflict?: true
      current_version?: number
    } | null; error: { message: string } | null }>)
    if (response.conflict) {
      throw new FinanceVersionConflictError(
        input.expected_version ?? 0,
        response.current_version == null ? null : Number(response.current_version),
      )
    }
  }

  async function saveSavingsTransaction(input: FinanceSaveSavingsTransactionInput): Promise<void> {
    const supabaseClient = requireSupabase(client)
    const response = await resolve<{
      transaction_id: FinanceId
      version?: number
      conflict?: true
      current_version?: number
    }>(() => supabaseClient.rpc('finance_save_transaction', {
      p_household_id: householdId,
      p_request_id: input.request_id,
      p_transaction_id: input.transaction_id ?? null,
      p_expected_version: input.expected_version ?? null,
      p_account_id: input.account_id,
      p_transaction_date: input.transaction_date,
      p_amount_minor: moneyToFinanceMinorUnits(input.amount),
      p_description: input.description?.trim() || null,
      p_excluded_from_monthly_savings: input.excluded_from_monthly_savings,
    }) as unknown as PromiseLike<{ data: {
      transaction_id: FinanceId
      version?: number
      conflict?: true
      current_version?: number
    } | null; error: { message: string } | null }>)
    if (response.conflict) {
      throw new FinanceVersionConflictError(
        input.expected_version ?? 0,
        response.current_version == null ? null : Number(response.current_version),
      )
    }
  }

  async function deleteSavingsTransaction(input: FinanceDeleteSavingsTransactionInput): Promise<void> {
    const supabaseClient = requireSupabase(client)
    const response = await resolve<{
      deleted: true
      transaction_id: FinanceId
      account_id: FinanceId
    } | { conflict: true; transaction_id: FinanceId; current_version: number }>(() => supabaseClient.rpc('finance_delete_transaction', {
      p_household_id: householdId,
      p_request_id: input.request_id,
      p_transaction_id: input.transaction_id,
      p_expected_version: input.expected_version,
    }) as unknown as PromiseLike<{ data: {
      deleted: true
      transaction_id: FinanceId
      account_id: FinanceId
    } | { conflict: true; transaction_id: FinanceId; current_version: number } | null; error: { message: string } | null }>)
    if ('conflict' in response) {
      throw new FinanceVersionConflictError(input.expected_version, Number(response.current_version))
    }
  }

  async function createScenario(input: { name: string; description: string | null }): Promise<FinanceScenario> {
    const supabaseClient = requireSupabase(client)
    return resolve<FinanceScenario>(() => supabaseClient.from('finance_scenarios')
      .insert({ household_id: householdId, created_by: userId, ...input })
      .select(scenarioColumns)
      .single())
  }

  async function createBudgetItem(input: CreateBudgetItemInput): Promise<FinanceBudgetItem> {
    const supabaseClient = requireSupabase(client)
    const row = await resolve<FinanceBudgetItemRow>(() => supabaseClient.from('finance_budget_items')
      .insert({
        household_id: householdId,
        created_by: userId,
        month_id: input.month_id,
        category_id: input.category_id,
        name: input.name.trim(),
        amount: moneyToFinanceMinorUnits(input.amount),
        is_planned: false,
        is_recurring: input.is_recurring ?? false,
        notes: null,
      })
      .select(budgetItemColumns)
      .single() as unknown as PromiseLike<{ data: FinanceBudgetItemRow | null; error: { message: string } | null }>)
    return toBudgetItem(row)
  }

  async function createScenarioItem(input: CreateScenarioItemInput): Promise<FinanceScenarioItem> {
    const supabaseClient = requireSupabase(client)
    const row = await resolve<FinanceScenarioItemRow>(() => supabaseClient.from('finance_scenario_items')
      .insert({
        household_id: householdId,
        created_by: userId,
        scenario_id: input.scenario_id,
        category_id: input.category_id,
        name: input.name.trim(),
        amount: moneyToFinanceMinorUnits(input.amount),
        is_planned: true,
        is_recurring: input.is_recurring ?? false,
        notes: null,
      })
      .select(scenarioItemColumns)
      .single() as unknown as PromiseLike<{ data: FinanceScenarioItemRow | null; error: { message: string } | null }>)
    return toScenarioItem(row)
  }

  async function updateBudgetItem(input: UpdateFinanceItemInput): Promise<void> {
    const supabaseClient = requireSupabase(client)
    await resolveVersionedUpdate(
      () => supabaseClient.from('finance_budget_items')
        .update({
          category_id: input.category_id,
          name: input.name.trim(),
          amount: moneyToFinanceMinorUnits(input.amount),
          ...(input.is_recurring === undefined ? {} : { is_recurring: input.is_recurring }),
        })
        .eq('id', input.id)
        .eq('household_id', householdId)
        .eq('version', input.expected_version)
        .select('id')
        .maybeSingle() as unknown as PromiseLike<VersionedUpdateResponse>,
      () => supabaseClient.from('finance_budget_items')
        .select('version')
        .eq('id', input.id)
        .eq('household_id', householdId)
        .maybeSingle() as unknown as PromiseLike<CurrentVersionResponse>,
      input.expected_version,
    )
  }

  async function deleteBudgetItem(input: { id: FinanceId; expected_version: number }): Promise<void> {
    const supabaseClient = requireSupabase(client)
    await resolveVersionedUpdate(
      () => supabaseClient.from('finance_budget_items').delete()
        .eq('household_id', householdId)
        .eq('id', input.id)
        .eq('version', input.expected_version)
        .select('id')
        .maybeSingle() as unknown as PromiseLike<VersionedUpdateResponse>,
      () => supabaseClient.from('finance_budget_items').select('version')
        .eq('household_id', householdId)
        .eq('id', input.id)
        .maybeSingle() as unknown as PromiseLike<CurrentVersionResponse>,
      input.expected_version,
    )
  }

  async function updateScenarioItem(input: UpdateFinanceItemInput): Promise<void> {
    const supabaseClient = requireSupabase(client)
    await resolveVersionedUpdate(
      () => supabaseClient.from('finance_scenario_items')
        .update({
          category_id: input.category_id,
          name: input.name.trim(),
          amount: moneyToFinanceMinorUnits(input.amount),
          ...(input.is_recurring === undefined ? {} : { is_recurring: input.is_recurring }),
        })
        .eq('id', input.id)
        .eq('household_id', householdId)
        .eq('version', input.expected_version)
        .select('id')
        .maybeSingle() as unknown as PromiseLike<VersionedUpdateResponse>,
      () => supabaseClient.from('finance_scenario_items')
        .select('version')
        .eq('id', input.id)
        .eq('household_id', householdId)
        .maybeSingle() as unknown as PromiseLike<CurrentVersionResponse>,
      input.expected_version,
    )
  }

  return {
    listSavingsPlans, listIrregularReserves, listProjects, listProjectExpenses,
    listProjectExpenseSummaries, listProjectExpensePage,
    saveSavingsPlan, deleteSavingsPlan, saveIrregularReserve, deleteIrregularReserve,
    saveProject, deleteProject, saveProjectExpense, deleteProjectExpense,
    listMonths,
    listCategories,
    createCategory,
    renameCategory,
    deleteCategory,
    listBudgetItems,
    listSavingsAccounts,
    listSavingsTransactions,
    listSavingsTransfers,
    listScenarios,
    listScenarioItems,
    createMonth,
    createSavingsTransfer,
    deleteSavingsTransfer,
    saveSavingsAccount,
    previewAccountLifecycle,
    applyAccountLifecycle,
    saveSavingsTransaction,
    deleteSavingsTransaction,
    createScenario,
    createBudgetItem,
    createScenarioItem,
    updateBudgetItem,
    updateScenarioItem,
    deleteBudgetItem,
  }
}
