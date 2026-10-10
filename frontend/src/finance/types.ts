/**
 * Browser-facing contracts for the Finance tables described in
 * BUDGET_MIGRATION_IMPLEMENTATION_PLAN.md. Adapters cast persisted bigint
 * amounts to text before JSON serialization; UI and calculation amounts use
 * decimal strings.
 */

export type FinanceId = string
/** Major-unit decimal string used by forms, calculations, and summaries. */
export type FinanceMoney = string
/** Signed minor-unit integer string used by persisted bigint row fields. */
export type FinanceMinorUnits = string

export type FinanceBudgetType =
  | 'income'
  | 'fixed_expense'
  | 'variable_expense'
  | 'saving'
  | 'investment'

export type FinanceAllocationRole = 'standard' | 'personal_allowance'
export type FinanceSavingsAccountType = 'cash' | 'goal' | 'investment' | 'retirement'
export type FinanceVisibility = 'household' | 'private'
export type FinanceSavingsPlanType = FinanceSavingsAccountType | 'irregular'

export interface FinanceRow {
  id: FinanceId
  household_id: FinanceId
  created_by: FinanceId
  created_at: string
  updated_at: string
  version: number
}

export interface FinanceMonth extends FinanceRow {
  month_start: string
  display_name: string | null
}

export interface FinanceCategory extends FinanceRow {
  name: string
  budget_type: FinanceBudgetType
  parent_id: FinanceId | null
  color: string | null
  sort_order: number
}

export interface FinanceBudgetItem extends FinanceRow {
  month_id: FinanceId
  category_id: FinanceId
  name: string
  amount: FinanceMinorUnits
  allocation_role: FinanceAllocationRole
  is_planned: boolean
  is_recurring: boolean
  notes: string | null
  sort_order: number
}

export interface FinanceScenario extends FinanceRow {
  name: string
  description: string | null
  sort_order: number
}

export interface FinanceScenarioItem extends FinanceRow {
  scenario_id: FinanceId
  category_id: FinanceId
  name: string
  amount: FinanceMinorUnits
  allocation_role: FinanceAllocationRole
  is_planned: boolean
  is_recurring: boolean
  notes: string | null
  sort_order: number
}

export interface FinanceSavingsAccount extends FinanceRow {
  name: string
  account_type: FinanceSavingsAccountType
  parent_id: FinanceId | null
  opening_balance: FinanceMinorUnits
  target_amount: FinanceMinorUnits | null
  color: string | null
  is_archived: boolean
  visibility: FinanceVisibility
  owner_user_id: FinanceId
  sort_order: number
}

export interface FinanceSavingsTransfer extends FinanceRow {}

export interface FinanceSavingsTransaction extends FinanceRow {
  account_id: FinanceId
  transaction_date: string
  amount: FinanceMinorUnits
  description: string | null
  budget_month_id: FinanceId | null
  excluded_from_monthly_savings: boolean
  transfer_id: FinanceId | null
  source_planned_transaction_id: FinanceId | null
}

export interface FinancePlannedSavingsTransaction extends FinanceRow {
  month_id: FinanceId
  account_id: FinanceId
  amount: FinanceMinorUnits
  description: string | null
  source_savings_plan_id: FinanceId | null
}

export interface FinanceSavingsPlan extends FinanceRow {
  name: string
  plan_type: FinanceSavingsPlanType
  account_id: FinanceId | null
  monthly_amount: FinanceMinorUnits
  annual_amount_override: FinanceMinorUnits | null
  visibility: FinanceVisibility
  owner_user_id: FinanceId
  sort_order: number
}

export interface FinanceIrregularExpensePlan extends FinanceRow {
  name: string
  annual_amount: FinanceMinorUnits
  sort_order: number
}

export interface FinanceProject extends FinanceRow {
  name: string
  description: string | null
  target_budget: FinanceMinorUnits | null
  is_archived: boolean
  sort_order: number
}

export interface FinanceProjectExpense extends FinanceRow {
  project_id: FinanceId
  expense_date: string | null
  name: string
  amount: FinanceMinorUnits
  notes: string | null
  sort_order: number
}

/** A budget item with its normalized category classification joined for reads. */
export interface FinanceBudgetLine {
  id: FinanceId
  name: string
  amount: FinanceMoney
  budget_type: FinanceBudgetType
  allocation_role: FinanceAllocationRole
  is_planned: boolean
  is_recurring: boolean
}

export interface FinanceMonthSummary {
  income: FinanceMoney
  income_after_personal_allowances: FinanceMoney
  personal_allowances: FinanceMoney
  fixed_expenses: FinanceMoney
  variable_expenses: FinanceMoney
  total_expenses: FinanceMoney
  savings: FinanceMoney
  investments: FinanceMoney
  savings_and_investments: FinanceMoney
  cashflow: FinanceMoney
  savings_investments_and_leftover: FinanceMoney
  savings_rate: number
  savings_rate_with_leftover: number
}

export interface FinanceViewer {
  household_id: FinanceId
  user_id: FinanceId
}

export interface FinanceVersionedUpdate<T> {
  id: FinanceId
  expected_version: number
  changes: T
}

export interface FinanceCreateMonthInput {
  request_id: FinanceId
  month_start: string
  source:
    | { kind: 'empty' }
    | { kind: 'recurring'; source_month_id: FinanceId }
    | { kind: 'scenario'; scenario_id: FinanceId }
}

export interface FinanceBudgetItemChanges {
  month_id: FinanceId
  category_id: FinanceId
  name: string
  /** Decimal major-unit input; the adapter converts it to bigint minor units. */
  amount: FinanceMoney
  allocation_role: FinanceAllocationRole
  is_planned: boolean
  is_recurring: boolean
  notes: string | null
  sort_order: number
}

export type FinanceBudgetItemMutation =
  | { kind: 'create'; changes: FinanceBudgetItemChanges }
  | { kind: 'update'; id: FinanceId; expected_version: number; changes: FinanceBudgetItemChanges }

/** Implementations cast persisted bigint amount fields to text in PostgREST selects. */
export type FinanceBudgetApi = {
  listMonths(signal?: AbortSignal): Promise<FinanceMonth[]>
  listCategories(signal?: AbortSignal): Promise<FinanceCategory[]>
  listBudgetItems(monthId: FinanceId, signal?: AbortSignal): Promise<FinanceBudgetItem[]>
  createMonth(input: FinanceCreateMonthInput): Promise<FinanceMonth>
  saveBudgetItem(input: FinanceBudgetItemMutation): Promise<FinanceBudgetItem>
  deleteBudgetItem(input: { id: FinanceId; expected_version: number }): Promise<void>
}

export interface FinanceTransferInput {
  request_id: FinanceId
  from_account_id: FinanceId
  to_account_id: FinanceId
  amount: FinanceMoney
  transaction_date: string
  description: string | null
}

export interface FinanceTransferResult {
  transfer_id: FinanceId
  transaction_ids: [FinanceId, FinanceId]
}

export interface FinanceMutationConflict {
  code: 'version_conflict'
  current_version: number | null
}
