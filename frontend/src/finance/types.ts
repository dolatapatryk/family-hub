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

export interface FinanceMonth extends Omit<FinanceRow, 'version'> {
  month_start: string
  display_name: string | null
}

export interface FinanceCategory extends FinanceRow {
  name: string
  budget_type: FinanceBudgetType
  allocation_role: FinanceAllocationRole
  parent_id: FinanceId | null
  color: string | null
}

export interface FinanceCreateCategoryInput {
  name: string
  section: FinanceSectionId
  parent_id?: FinanceId | null
}

export type FinanceSectionId = FinanceBudgetType | 'personal'

export interface FinanceRenameCategoryInput {
  id: FinanceId
  expected_version: number
  name: string
}

export interface FinanceBudgetItem extends FinanceRow {
  month_id: FinanceId
  category_id: FinanceId
  /** Optional description; an empty string displays only the category name. */
  name: string
  amount: FinanceMinorUnits
  is_planned: boolean
  is_recurring: boolean
  notes: string | null
}

export interface FinanceScenario extends FinanceRow {
  name: string
  description: string | null
}

export interface FinanceScenarioItem extends FinanceRow {
  scenario_id: FinanceId
  category_id: FinanceId
  /** Optional description; an empty string displays only the category name. */
  name: string
  amount: FinanceMinorUnits
  is_planned: boolean
  is_recurring: boolean
  notes: string | null
}

export interface FinanceSavingsAccount extends FinanceRow {
  name: string
  account_type: FinanceSavingsAccountType
  parent_id: FinanceId | null
  opening_balance: FinanceMinorUnits
  target_amount: FinanceMinorUnits | null
  is_archived: boolean
  visibility: FinanceVisibility
  owner_user_id: FinanceId
}

export interface FinanceSavingsTransfer extends FinanceRow {}

export interface FinanceSavingsTransaction extends FinanceRow {
  account_id: FinanceId
  transaction_date: string
  amount: FinanceMinorUnits
  description: string | null
  excluded_from_monthly_savings: boolean
  transfer_id: FinanceId | null
}

export interface FinanceSaveSavingsAccountInput {
  request_id: FinanceId
  account_id?: FinanceId | null
  expected_version?: number | null
  name: string
  account_type: FinanceSavingsAccountType
  parent_id: FinanceId | null
  /** Required for creation; account balance corrections use a separate contract. */
  opening_balance?: FinanceMoney | null
  target_amount: FinanceMoney | null
  visibility: FinanceVisibility
}

export type FinanceAccountLifecycleAction = 'archive' | 'restore' | 'balance' | 'visibility'

export interface FinanceAccountLifecyclePreview {
  account_id: FinanceId
  version: number
  snapshot_token: string
  account_count: number
  linked_plan_count: number
  own_balance_minor: FinanceMinorUnits
  active_children_balance_minor: FinanceMinorUnits
  display_balance_minor: FinanceMinorUnits
  is_archived: boolean
  ancestor_archived: boolean
  visibility: FinanceVisibility
  can_change_visibility: boolean
  external_transfer_count: number
}

export interface FinanceAccountLifecycleInput {
  request_id: FinanceId
  account_id: FinanceId
  expected_version: number
  snapshot_token: string
  action: FinanceAccountLifecycleAction
  display_balance?: FinanceMoney | null
  visibility?: FinanceVisibility | null
}

export interface FinanceSaveSavingsTransactionInput {
  request_id: FinanceId
  transaction_id?: FinanceId | null
  expected_version?: number | null
  account_id: FinanceId
  transaction_date: string
  /** Signed amount: positive deposits, negative withdrawals. */
  amount: FinanceMoney
  description: string | null
  excluded_from_monthly_savings: boolean
}

export interface FinanceDeleteSavingsTransactionInput {
  request_id: FinanceId
  transaction_id: FinanceId
  expected_version: number
}

export interface FinanceSavingsPlan extends FinanceRow {
  name: string
  plan_type: FinanceSavingsPlanType
  account_id: FinanceId | null
  monthly_amount: FinanceMinorUnits
  annual_amount_override: FinanceMinorUnits | null
  visibility: FinanceVisibility
  owner_user_id: FinanceId
}

export interface FinanceIrregularExpensePlan extends FinanceRow {
  name: string
  annual_amount: FinanceMinorUnits
}

export interface FinanceProject extends FinanceRow {
  name: string
  description: string | null
  target_budget: FinanceMinorUnits | null
  is_archived: boolean
}

export interface FinanceProjectExpense extends FinanceRow {
  project_id: FinanceId
  expense_date: string | null
  name: string
  amount: FinanceMinorUnits
  notes: string | null
}

export interface FinanceRecordMutationInput {
  request_id: FinanceId
  id?: FinanceId | null
  expected_version?: number | null
}

export interface FinanceSaveSavingsPlanInput extends FinanceRecordMutationInput {
  name: string
  plan_type: FinanceSavingsPlanType
  account_id: FinanceId | null
  monthly_amount: FinanceMoney
  annual_amount_override: FinanceMoney | null
  visibility: FinanceVisibility
}

export interface FinanceSaveIrregularReserveInput extends FinanceRecordMutationInput {
  name: string
  annual_amount: FinanceMoney
}

export interface FinanceSaveProjectInput extends FinanceRecordMutationInput {
  name: string
  description: string | null
  target_budget: FinanceMoney | null
  is_archived: boolean
}

export interface FinanceSaveProjectExpenseInput extends FinanceRecordMutationInput {
  project_id: FinanceId
  expense_date: string | null
  name: string
  amount: FinanceMoney
  notes: string | null
}

export interface FinanceDeleteRecordInput {
  request_id: FinanceId
  id: FinanceId
  expected_version: number
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
  is_planned: boolean
  is_recurring: boolean
  notes: string | null
}

export type FinanceBudgetItemMutation =
  | { kind: 'create'; changes: FinanceBudgetItemChanges }
  | { kind: 'update'; id: FinanceId; expected_version: number; changes: FinanceBudgetItemChanges }

export interface FinanceScenarioItemChanges {
  scenario_id: FinanceId
  category_id: FinanceId
  name: string
  /** Decimal major-unit input; the adapter converts it to bigint minor units. */
  amount: FinanceMoney
  is_planned: boolean
  is_recurring: boolean
  notes: string | null
}

export type FinanceScenarioItemMutation =
  | { kind: 'create'; changes: FinanceScenarioItemChanges }
  | { kind: 'update'; id: FinanceId; expected_version: number; changes: FinanceScenarioItemChanges }

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
  from_expected_version: number
  to_account_id: FinanceId
  to_expected_version: number
  amount: FinanceMoney
  transaction_date: string
  description: string | null
}

export interface FinanceTransferResult {
  transfer_id: FinanceId
  transaction_ids: [FinanceId, FinanceId]
}

export interface FinanceSavingsTransferRecord extends FinanceRow {
  from_account_id: FinanceId
  to_account_id: FinanceId
  amount: FinanceMinorUnits
  transaction_date: string
  description: string | null
  transaction_ids: [FinanceId, FinanceId]
}

export interface FinanceDeleteTransferInput {
  request_id: FinanceId
  transfer_id: FinanceId
  expected_version: number
}

export interface FinanceTransferConflict {
  conflict: true
  account_id?: FinanceId
  current_version: number
}

export interface FinanceMutationConflict {
  code: 'version_conflict'
  current_version: number | null
}
