import type {
  FinanceAllocationRole,
  FinanceBudgetType,
  FinanceId,
  FinanceMinorUnits,
  FinanceMoney,
  FinanceRow,
  FinanceVisibility,
} from '../types'

/** A date-only value in YYYY-MM-DD form; transaction dates are not timestamps. */
export type FinanceDateOnly = string

/** Release 1 supports physical wallets denominated in PLN only. */
export type FinanceCurrency = 'PLN'

export type FinanceWalletType = 'bank' | 'cash' | 'savings_bank'

export type FinanceTransactionKind =
  | 'income'
  | 'expense'
  | 'savings_expense'
  | 'refund'
  | 'savings_refund'
  | 'transfer'
  | 'opening'
  | 'adjustment'

export type FinanceSavingsEffect = 'none' | 'contribution'

/** URL/query scope: Domowe, Moje, or Wszystkie dostępne. */
export type FinanceTransactionScope = 'household' | 'personal' | 'all_accessible'

/**
 * Release 1 domain constraints. Database mutations remain authoritative:
 * - Transfer endpoints must both be household-visible, or private to the same owner.
 * - Contribution is an explicit effect on a transfer, never inferred from a wallet name.
 * - Personal-allowance categories are permitted on transfers but add zero contributions.
 * - Current category definitions classify history; no category snapshot is stored.
 * - Legacy savings goals/transactions are not linked or copied into wallet history.
 */

/**
 * Wallets are flat physical accounts. Their balances are derived from dated
 * transactions; wallet records do not hold a mutable balance or goal link.
 */
export interface FinanceWallet extends FinanceRow {
  name: string
  wallet_type: FinanceWalletType
  currency: FinanceCurrency
  visibility: FinanceVisibility
  owner_user_id: FinanceId
  opened_on: FinanceDateOnly
  is_archived: boolean
  color: string | null
  icon: string | null
}

export interface FinanceWalletBalance {
  wallet_id: FinanceId
  as_of_date: FinanceDateOnly
  balance_minor: FinanceMinorUnits
}

/** A wallet row with its physical balance calculated through the requested date. */
export interface FinanceWalletWithBalance extends FinanceWallet {
  balance_as_of_date: FinanceDateOnly
  balance_minor: FinanceMinorUnits
}

/**
 * Shared persisted fields for one transaction header. amount_minor is the
 * transaction's only monetary amount. It is positive for ordinary activity;
 * opening and adjustment rows may be signed, and opening may be zero.
 */
interface FinanceTransactionFields extends FinanceRow {
  transaction_date: FinanceDateOnly
  amount_minor: FinanceMinorUnits
  /** Current shared category; the selected kind controls accounting behavior. */
  category_id: FinanceId | null
  description: string | null
}

/**
 * A transaction header owns all effects. Transfers have two wallet endpoints
 * but are still one row; signed wallet movements are derived by the API.
 */
export type FinanceTransaction = FinanceTransactionFields & (
  | {
    kind: 'income' | 'refund' | 'savings_refund'
    source_wallet_id: null
    destination_wallet_id: FinanceId
    savings_effect: 'none'
  }
  | {
    kind: 'expense' | 'savings_expense'
    source_wallet_id: FinanceId
    destination_wallet_id: null
    savings_effect: 'none'
  }
  | {
    kind: 'transfer'
    source_wallet_id: FinanceId
    destination_wallet_id: FinanceId
    savings_effect: FinanceSavingsEffect
  }
  | {
    kind: 'opening' | 'adjustment'
    source_wallet_id: null
    destination_wallet_id: FinanceId
    savings_effect: 'none'
  }
)

type FinanceTransactionMutationIdentity =
  | { request_id: FinanceId; transaction_id?: null; expected_version?: null }
  | { request_id: FinanceId; transaction_id: FinanceId; expected_version: number }

interface FinanceTransactionMutationFields {
  transaction_date: FinanceDateOnly
  /** Decimal string from the form; converted to exact minor units at the API boundary. */
  amount: FinanceMoney
  category_id: FinanceId | null
  description: string | null
}

/**
 * Ordinary transaction mutations exclude opening and adjustment rows.
 * Openings are created atomically with wallets; corrections use a dedicated
 * balance action. Category compatibility and endpoint access are DB rules.
 */
export type FinanceSaveTransactionInput = FinanceTransactionMutationIdentity &
  FinanceTransactionMutationFields & (
    | {
      kind: 'income' | 'refund' | 'savings_refund'
      source_wallet_id: null
      destination_wallet_id: FinanceId
      savings_effect: 'none'
    }
    | {
      kind: 'expense' | 'savings_expense'
      source_wallet_id: FinanceId
      destination_wallet_id: null
      savings_effect: 'none'
    }
    | {
      kind: 'transfer'
      source_wallet_id: FinanceId
      destination_wallet_id: FinanceId
      savings_effect: FinanceSavingsEffect
    }
  )

export interface FinanceDeleteTransactionInput {
  request_id: FinanceId
  transaction_id: FinanceId
  expected_version: number
}

export interface FinanceCreateWalletInput {
  request_id: FinanceId
  name: string
  wallet_type: FinanceWalletType
  visibility: FinanceVisibility
  opened_on: FinanceDateOnly
  /** Signed opening balance in major units; zero is allowed. */
  opening_balance: FinanceMoney
  color: string | null
  icon: string | null
}

export interface FinanceUpdateWalletInput {
  request_id: FinanceId
  wallet_id: FinanceId
  expected_version: number
  name: string
  wallet_type: FinanceWalletType
  color: string | null
  icon: string | null
}

export interface FinanceSetWalletArchivedInput {
  request_id: FinanceId
  wallet_id: FinanceId
  expected_version: number
  is_archived: boolean
}

export interface FinanceCorrectWalletBalanceInput {
  request_id: FinanceId
  wallet_id: FinanceId
  expected_version: number
  snapshot_token: string
  effective_date: FinanceDateOnly
  observed_balance: FinanceMoney
  reason: string
}

export interface FinanceTransactionFilters {
  month_start: FinanceDateOnly
  scope: FinanceTransactionScope
  wallet_id?: FinanceId | null
  /** Present when the URL selects more than one wallet. */
  wallet_ids?: FinanceId[]
  category_id?: FinanceId | null
  /** Present when the URL selects more than one category. */
  category_ids?: FinanceId[]
  kinds?: FinanceTransactionKind[]
  search?: string
}

export interface FinanceTransactionCursor {
  transaction_date: FinanceDateOnly
  transaction_id: FinanceId
}

export interface FinanceTransactionPage {
  items: FinanceTransaction[]
  next_cursor: FinanceTransactionCursor | null
}

/** Full-dataset aggregates from one database read, serialized as minor-unit strings. */
export interface FinanceTransactionMonthSummary {
  income_minor: FinanceMinorUnits
  regular_expenses_minor: FinanceMinorUnits
  regular_refunds_minor: FinanceMinorUnits
  monthly_balance_minor: FinanceMinorUnits
  savings_contributions_minor: FinanceMinorUnits
  savings_spending_minor: FinanceMinorUnits
  savings_refunds_minor: FinanceMinorUnits
  savings_change_minor: FinanceMinorUnits
  total_spending_minor: FinanceMinorUnits
  transaction_count: number
  regular_category_totals: FinanceTransactionCategoryTotal[]
  savings_category_totals: FinanceTransactionCategoryTotal[]
  income_category_totals: FinanceTransactionCategoryTotal[]
}

export interface FinanceTransactionCategoryTotal {
  category_id: FinanceId
  category_name: string
  budget_type: FinanceBudgetType
  allocation_role: FinanceAllocationRole
  parent_id: FinanceId | null
  amount_minor: FinanceMinorUnits
  transaction_count: number
}

export interface FinanceWalletBalanceCorrectionPreview {
  wallet_id: FinanceId
  wallet_version: number
  effective_date: FinanceDateOnly
  current_balance_minor: FinanceMinorUnits
  snapshot_token: string
}

export interface FinanceWalletBalanceCorrectionResult {
  wallet_id: FinanceId
  transaction_id: FinanceId | null
  adjustment_minor: FinanceMinorUnits
  observed_balance_minor: FinanceMinorUnits
  version: number
}

export interface FinanceWalletOpeningCorrectionPreview {
  wallet_id: FinanceId
  wallet_version: number
  opening_transaction_id: FinanceId
  opening_transaction_version: number
  opened_on: FinanceDateOnly
  opening_balance_minor: FinanceMinorUnits
  snapshot_token: string
}

export interface FinanceCorrectWalletOpeningInput {
  request_id: FinanceId
  wallet_id: FinanceId
  expected_version: number
  snapshot_token: string
  opened_on: FinanceDateOnly
  opening_balance: FinanceMoney
}

export interface FinanceWalletOpeningCorrectionResult {
  wallet_id: FinanceId
  opening_transaction_id: FinanceId
  opened_on: FinanceDateOnly
  opening_balance_minor: FinanceMinorUnits
  version: number
}
