/**
 * The Home Budget export format. These IDs are arbitrary source strings, not
 * UUIDs; the importer must allocate FinanceIds and keep an explicit ID map.
 */
export type LegacyEntityId = string
export type LegacyMoney = string | number

export type LegacyBudgetItemType =
  | 'income'
  | 'fixedExpense'
  | 'variableExpense'
  | 'saving'
  | 'investment'

export interface LegacyBudgetMonth {
  id: LegacyEntityId
  year: number
  month: number
  name: string
  createdAt?: string
  updatedAt?: string
}

export interface LegacyCategory {
  id: LegacyEntityId
  name: string
  type: LegacyBudgetItemType
  parentId?: LegacyEntityId
  color?: string
}

export interface LegacyBudgetItem {
  id: LegacyEntityId
  monthId: LegacyEntityId
  name: string
  amount: LegacyMoney
  type: LegacyBudgetItemType
  categoryId: LegacyEntityId
  subcategoryId?: LegacyEntityId
  isPlanned: boolean
  isRecurring: boolean
  notes?: string
}

export interface LegacySavingsAccount {
  id: LegacyEntityId
  name: string
  initialBalance: LegacyMoney
  type: 'cash' | 'goal' | 'investment' | 'retirement'
  parentId?: LegacyEntityId
  targetAmount?: LegacyMoney
  color?: string
  isArchived?: boolean
}

export interface LegacySavingsTransaction {
  id: LegacyEntityId
  accountId: LegacyEntityId
  date: string
  amount: LegacyMoney
  description?: string
  linkedBudgetMonthId?: LegacyEntityId
  excludedFromMonthlySavings?: boolean
  transferId?: LegacyEntityId
  transferPeerAccountId?: LegacyEntityId
}

export interface LegacyPlannedSavingsTransaction {
  id: LegacyEntityId
  monthId: LegacyEntityId
  accountId: LegacyEntityId
  amount: LegacyMoney
  description?: string
}

export interface LegacyBudgetScenario {
  id: LegacyEntityId
  name: string
  description?: string
  items: Array<Omit<LegacyBudgetItem, 'monthId'>>
}

export interface LegacyProject {
  id: LegacyEntityId
  name: string
  description?: string
  targetBudget?: LegacyMoney
  createdAt?: string
  archived?: boolean
}

export interface LegacyProjectExpense {
  id: LegacyEntityId
  projectId: LegacyEntityId
  date?: string
  name: string
  amount: LegacyMoney
  notes?: string
}

export interface LegacySavingsPlan {
  id: LegacyEntityId
  name: string
  monthlyAmount: LegacyMoney
  annualAmount?: LegacyMoney
  type: 'cash' | 'goal' | 'investment' | 'retirement' | 'irregular'
}

export interface LegacyIrregularExpensePlan {
  id: LegacyEntityId
  name: string
  annualAmount: LegacyMoney
}

/** Optional collections remain optional so an import can report omissions. */
export interface LegacyHomeBudgetSnapshot {
  selectedMonthId?: LegacyEntityId
  months?: LegacyBudgetMonth[]
  categories?: LegacyCategory[]
  budgetItems?: LegacyBudgetItem[]
  savingsAccounts?: LegacySavingsAccount[]
  savingsTransactions?: LegacySavingsTransaction[]
  plannedSavingsTransactions?: LegacyPlannedSavingsTransaction[]
  scenarios?: LegacyBudgetScenario[]
  projects?: LegacyProject[]
  projectExpenses?: LegacyProjectExpense[]
  savingsPlans?: LegacySavingsPlan[]
  irregularExpensePlans?: LegacyIrregularExpensePlan[]
}
