import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '../auth/supabase'
import { moneyToFinanceMinorUnits } from './money'
import type {
  FinanceAllocationRole,
  FinanceBudgetItem,
  FinanceBudgetType,
  FinanceCategory,
  FinanceId,
  FinanceMonth,
  FinanceMoney,
  FinanceScenario,
  FinanceScenarioItemChanges,
  FinanceScenarioItem,
} from './types'

type FinanceBudgetItemRow = Omit<FinanceBudgetItem, 'amount'> & { amount_minor: string }
type FinanceScenarioItemRow = Omit<FinanceScenarioItem, 'amount'> & { amount_minor: string }

const monthColumns = 'id, household_id, created_by, created_at, updated_at, version, month_start, display_name'
const categoryColumns = 'id, household_id, created_by, created_at, updated_at, version, name, budget_type, parent_id, color, sort_order'
const scenarioColumns = 'id, household_id, created_by, created_at, updated_at, version, name, description, sort_order'
const budgetItemColumns = 'id, household_id, created_by, created_at, updated_at, version, month_id, category_id, name, amount_minor:amount::text, allocation_role, is_planned, is_recurring, notes, sort_order'
const scenarioItemColumns = 'id, household_id, created_by, created_at, updated_at, version, scenario_id, category_id, name, amount_minor:amount::text, allocation_role, is_planned, is_recurring, notes, sort_order'

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

function toBudgetItem(row: FinanceBudgetItemRow): FinanceBudgetItem {
  const { amount_minor, ...item } = row
  return { ...item, amount: amount_minor }
}

function toScenarioItem(row: FinanceScenarioItemRow): FinanceScenarioItem {
  const { amount_minor, ...item } = row
  return { ...item, amount: amount_minor }
}

function assertRoleMatchesCategory(role: FinanceAllocationRole, categoryType: FinanceBudgetType) {
  if (role === 'personal_allowance' && categoryType !== 'saving') {
    throw new Error('Personal allowances can only use a saving category.')
  }
}

interface CreateBudgetItemInput {
  month_id: FinanceId
  category_id: FinanceId
  category_type: FinanceBudgetType
  name: string
  amount: FinanceMoney
  allocation_role: FinanceAllocationRole
  sort_order: number
}

type CreateScenarioItemInput = Omit<FinanceScenarioItemChanges, 'is_planned' | 'is_recurring' | 'notes'> & {
  category_type: FinanceBudgetType
}

interface UpdateFinanceItemInput {
  id: FinanceId
  expected_version: number
  category_id: FinanceId
  category_type: FinanceBudgetType
  name: string
  amount: FinanceMoney
  allocation_role: FinanceAllocationRole
}

export function createFinanceApi(
  householdId: FinanceId,
  userId: FinanceId,
  client: SupabaseClient | null = supabase,
) {
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
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true })
      if (signal) query = query.abortSignal(signal)
      return query
    })
  }

  async function listBudgetItems(monthId: FinanceId, signal?: AbortSignal): Promise<FinanceBudgetItem[]> {
    const supabaseClient = requireSupabase(client)
    const rows = await resolve<FinanceBudgetItemRow[]>(() => {
      let query = supabaseClient.from('finance_budget_items')
        .select(budgetItemColumns)
        .eq('household_id', householdId)
        .eq('month_id', monthId)
        .order('sort_order', { ascending: true })
        .order('id', { ascending: true })
      if (signal) query = query.abortSignal(signal)
      return query as unknown as PromiseLike<{ data: FinanceBudgetItemRow[] | null; error: { message: string } | null }>
    })
    return rows.map(toBudgetItem)
  }

  async function listScenarios(signal?: AbortSignal): Promise<FinanceScenario[]> {
    const supabaseClient = requireSupabase(client)
    return resolve<FinanceScenario[]>(() => {
      let query = supabaseClient.from('finance_scenarios')
        .select(scenarioColumns)
        .eq('household_id', householdId)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true })
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
        .order('sort_order', { ascending: true })
        .order('id', { ascending: true })
      if (signal) query = query.abortSignal(signal)
      return query as unknown as PromiseLike<{ data: FinanceScenarioItemRow[] | null; error: { message: string } | null }>
    })
    return rows.map(toScenarioItem)
  }

  async function createMonth(monthStart: string): Promise<FinanceMonth> {
    const supabaseClient = requireSupabase(client)
    return resolve<FinanceMonth>(() => supabaseClient.from('finance_months')
      .insert({ household_id: householdId, created_by: userId, month_start: monthStart })
      .select(monthColumns)
      .single())
  }

  async function createScenario(input: { name: string; description: string | null; sort_order: number }): Promise<FinanceScenario> {
    const supabaseClient = requireSupabase(client)
    return resolve<FinanceScenario>(() => supabaseClient.from('finance_scenarios')
      .insert({ household_id: householdId, created_by: userId, ...input })
      .select(scenarioColumns)
      .single())
  }

  async function createBudgetItem(input: CreateBudgetItemInput): Promise<FinanceBudgetItem> {
    assertRoleMatchesCategory(input.allocation_role, input.category_type)
    const supabaseClient = requireSupabase(client)
    const row = await resolve<FinanceBudgetItemRow>(() => supabaseClient.from('finance_budget_items')
      .insert({
        household_id: householdId,
        created_by: userId,
        month_id: input.month_id,
        category_id: input.category_id,
        name: input.name.trim(),
        amount: moneyToFinanceMinorUnits(input.amount),
        allocation_role: input.allocation_role,
        is_planned: false,
        is_recurring: false,
        notes: null,
        sort_order: input.sort_order,
      })
      .select(budgetItemColumns)
      .single() as unknown as PromiseLike<{ data: FinanceBudgetItemRow | null; error: { message: string } | null }>)
    return toBudgetItem(row)
  }

  async function createScenarioItem(input: CreateScenarioItemInput): Promise<FinanceScenarioItem> {
    assertRoleMatchesCategory(input.allocation_role, input.category_type)
    const supabaseClient = requireSupabase(client)
    const row = await resolve<FinanceScenarioItemRow>(() => supabaseClient.from('finance_scenario_items')
      .insert({
        household_id: householdId,
        created_by: userId,
        scenario_id: input.scenario_id,
        category_id: input.category_id,
        name: input.name.trim(),
        amount: moneyToFinanceMinorUnits(input.amount),
        allocation_role: input.allocation_role,
        is_planned: true,
        is_recurring: false,
        notes: null,
        sort_order: input.sort_order,
      })
      .select(scenarioItemColumns)
      .single() as unknown as PromiseLike<{ data: FinanceScenarioItemRow | null; error: { message: string } | null }>)
    return toScenarioItem(row)
  }

  async function updateBudgetItemAllocationRole(
    id: FinanceId,
    expectedVersion: number,
    allocationRole: FinanceAllocationRole,
    categoryType: FinanceBudgetType,
  ): Promise<void> {
    assertRoleMatchesCategory(allocationRole, categoryType)
    const supabaseClient = requireSupabase(client)
    await resolve<{ id: FinanceId }>(() => supabaseClient.from('finance_budget_items')
      .update({ allocation_role: allocationRole })
      .eq('id', id)
      .eq('household_id', householdId)
      .eq('version', expectedVersion)
      .select('id')
      .single())
  }

  async function updateScenarioItemAllocationRole(
    id: FinanceId,
    expectedVersion: number,
    allocationRole: FinanceAllocationRole,
    categoryType: FinanceBudgetType,
  ): Promise<void> {
    assertRoleMatchesCategory(allocationRole, categoryType)
    const supabaseClient = requireSupabase(client)
    await resolve<{ id: FinanceId }>(() => supabaseClient.from('finance_scenario_items')
      .update({ allocation_role: allocationRole })
      .eq('id', id)
      .eq('household_id', householdId)
      .eq('version', expectedVersion)
      .select('id')
      .single())
  }

  async function updateBudgetItem(input: UpdateFinanceItemInput): Promise<void> {
    assertRoleMatchesCategory(input.allocation_role, input.category_type)
    const supabaseClient = requireSupabase(client)
    await resolve<{ id: FinanceId }>(() => supabaseClient.from('finance_budget_items')
      .update({
        category_id: input.category_id,
        name: input.name.trim(),
        amount: moneyToFinanceMinorUnits(input.amount),
        allocation_role: input.allocation_role,
      })
      .eq('id', input.id)
      .eq('household_id', householdId)
      .eq('version', input.expected_version)
      .select('id')
      .single())
  }

  async function updateScenarioItem(input: UpdateFinanceItemInput): Promise<void> {
    assertRoleMatchesCategory(input.allocation_role, input.category_type)
    const supabaseClient = requireSupabase(client)
    await resolve<{ id: FinanceId }>(() => supabaseClient.from('finance_scenario_items')
      .update({
        category_id: input.category_id,
        name: input.name.trim(),
        amount: moneyToFinanceMinorUnits(input.amount),
        allocation_role: input.allocation_role,
      })
      .eq('id', input.id)
      .eq('household_id', householdId)
      .eq('version', input.expected_version)
      .select('id')
      .single())
  }

  return {
    listMonths,
    listCategories,
    listBudgetItems,
    listScenarios,
    listScenarioItems,
    createMonth,
    createScenario,
    createBudgetItem,
    createScenarioItem,
    updateBudgetItemAllocationRole,
    updateScenarioItemAllocationRole,
    updateBudgetItem,
    updateScenarioItem,
  }
}
