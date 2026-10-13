import type {
  FinanceBudgetLine,
  FinanceBudgetType,
  FinanceMoney,
  FinanceMonthSummary,
  FinanceSavingsAccount,
  FinanceSavingsTransaction,
  FinanceViewer,
  FinanceVisibility,
  FinanceSavingsAccountType,
  FinanceSavingsPlan,
  FinanceProject,
  FinanceProjectExpense,
} from './types'
import { addMoney, financeMinorUnitsToMoney, formatMoneyDecimal, moneyRatio, parseMoney, subtractMoney, sumMoney } from './money.ts'

export function calculateMonthSummary(items: FinanceBudgetLine[]): FinanceMonthSummary {
  const total = (type: FinanceBudgetType, predicate: (item: FinanceBudgetLine) => boolean = () => true) =>
    sumMoney(items.filter(item => item.budget_type === type && predicate(item)).map(item => item.amount))

  const income = total('income')
  const personalAllowances = total('saving', item => item.allocation_role === 'personal_allowance')
  const incomeAfterAllowances = subtractMoney(income, personalAllowances)
  const fixedExpenses = total('fixed_expense')
  const variableExpenses = total('variable_expense')
  const totalExpenses = addMoney(fixedExpenses, variableExpenses)
  const savings = total('saving', item => item.allocation_role !== 'personal_allowance')
  const investments = total('investment')
  const savingsAndInvestments = addMoney(savings, investments)
  const cashflow = subtractMoney(incomeAfterAllowances, addMoney(totalExpenses, savingsAndInvestments))
  const savingsInvestmentsAndLeftover = addMoney(savingsAndInvestments, cashflow)

  return {
    income,
    income_after_personal_allowances: incomeAfterAllowances,
    personal_allowances: personalAllowances,
    fixed_expenses: fixedExpenses,
    variable_expenses: variableExpenses,
    total_expenses: totalExpenses,
    savings,
    investments,
    savings_and_investments: savingsAndInvestments,
    cashflow,
    savings_investments_and_leftover: savingsInvestmentsAndLeftover,
    savings_rate: parseMoney(incomeAfterAllowances) > 0n ? moneyRatio(savingsAndInvestments, incomeAfterAllowances) : 0,
    savings_rate_with_leftover: parseMoney(incomeAfterAllowances) > 0n ? moneyRatio(savingsInvestmentsAndLeftover, incomeAfterAllowances) : 0,
  }
}

export interface SavingsAccountBalanceInput {
  id: string
  opening_balance: FinanceMoney
  parent_id?: string | null
  is_archived?: boolean | null
}

export interface SavingsTransactionBalanceInput {
  account_id: string
  amount: FinanceMoney
  transaction_date?: string
  excluded_from_monthly_savings?: boolean
}

export function calculateSavingsBalance(
  account: SavingsAccountBalanceInput,
  transactions: SavingsTransactionBalanceInput[],
): FinanceMoney {
  return addMoney(
    account.opening_balance,
    sumMoney(transactions.filter(transaction => transaction.account_id === account.id).map(transaction => transaction.amount)),
  )
}

export function calculateSavingsAccountTreeBalance(
  account: SavingsAccountBalanceInput,
  accounts: SavingsAccountBalanceInput[],
  transactions: SavingsTransactionBalanceInput[],
  visited = new Set<string>(),
): FinanceMoney {
  if (visited.has(account.id)) return '0.00'
  visited.add(account.id)

  const childBalances = accounts
    .filter(candidate => candidate.parent_id === account.id)
    .map(child => calculateSavingsAccountTreeBalance(child, accounts, transactions, visited))

  return addMoney(calculateSavingsBalance(account, transactions), ...childBalances)
}

export function isSavingsAccountArchived(
  account: SavingsAccountBalanceInput,
  accounts: SavingsAccountBalanceInput[],
): boolean {
  const accountsById = new Map(accounts.map(candidate => [candidate.id, candidate]))
  const visited = new Set<string>()
  let current: SavingsAccountBalanceInput | undefined = account

  while (current) {
    if (visited.has(current.id)) return false
    if (current.is_archived) return true
    visited.add(current.id)
    current = current.parent_id ? accountsById.get(current.parent_id) : undefined
  }

  return false
}

export function getActiveSavingsAccounts<T extends SavingsAccountBalanceInput>(accounts: T[]): T[] {
  return accounts.filter(account => !isSavingsAccountArchived(account, accounts))
}

/** The displayed active tree excludes independently archived descendants. */
export function calculateActiveSavingsTreeBalance(
  account: SavingsAccountBalanceInput,
  accounts: SavingsAccountBalanceInput[],
  transactions: SavingsTransactionBalanceInput[],
): FinanceMoney {
  if (isSavingsAccountArchived(account, accounts)) return '0.00'
  return calculateSavingsAccountTreeBalance(account, getActiveSavingsAccounts(accounts), transactions)
}

/**
 * Legacy savings history is grouped by the transaction's calendar date, counts
 * only positive non-excluded movements, and still includes archived accounts.
 */
export function aggregateSavingsHistoryByDate(
  transactions: SavingsTransactionBalanceInput[],
): Array<{ date: string; amount: FinanceMoney }> {
  const totals = new Map<string, bigint>()
  for (const transaction of transactions) {
    if (transaction.excluded_from_monthly_savings || parseMoney(transaction.amount) <= 0n) continue
    if (!transaction.transaction_date) continue
    totals.set(transaction.transaction_date, (totals.get(transaction.transaction_date) ?? 0n) + parseMoney(transaction.amount))
  }

  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, amount]) => ({ date, amount: formatMoneyDecimal(amount) }))
}

/** Round up to one grosz, so twelve allocations cover the annual reserve. */
export function calculateIrregularMonthlyReserve(annualMinor: string): FinanceMoney {
  const annual = BigInt(annualMinor)
  if (annual < 0n) throw new Error('Annual reserve must be nonnegative.')
  return formatMoneyDecimal((annual + 11n) / 12n)
}

export function calculateSavingsPlanAnnualAmount(plan: Pick<FinanceSavingsPlan, 'monthly_amount' | 'annual_amount_override'>): FinanceMoney {
  return formatMoneyDecimal(plan.annual_amount_override == null ? BigInt(plan.monthly_amount) * 12n : BigInt(plan.annual_amount_override))
}

export function calculateSavingsAudienceSummary(
  accounts: FinanceSavingsAccount[],
  transactions: FinanceSavingsTransaction[],
  viewer: FinanceViewer,
  visibility: FinanceVisibility,
  monthStart: string | null,
) {
  const audienceAccounts = accounts.filter(a => a.household_id === viewer.household_id && a.visibility === visibility
    && (visibility === 'household' || a.owner_user_id === viewer.user_id))
  const ids = new Set(audienceAccounts.map(a => a.id))
  const movements = transactions.filter(t => t.household_id === viewer.household_id && ids.has(t.account_id))
  const balanceInputs = audienceAccounts.map(a => ({ ...a, opening_balance: financeMinorUnitsToMoney(a.opening_balance) }))
  const active = getActiveSavingsAccounts(balanceInputs)
  const moneyMovements = movements.map(t => ({ ...t, amount: financeMinorUnitsToMoney(t.amount) }))
  const typeBalances: Record<FinanceSavingsAccountType, FinanceMoney> = { cash: '0.00', goal: '0.00', investment: '0.00', retirement: '0.00' }
  for (const a of active) typeBalances[a.account_type] = addMoney(typeBalances[a.account_type], calculateSavingsBalance(a, moneyMovements))
  const monthly = new Map<string, bigint>()
  for (const movement of movements) {
    if (movement.transfer_id || movement.excluded_from_monthly_savings || BigInt(movement.amount) <= 0n) continue
    const month = `${movement.transaction_date.slice(0, 7)}-01`
    monthly.set(month, (monthly.get(month) ?? 0n) + BigInt(movement.amount))
  }
  return {
    active_balance: sumMoney(Object.values(typeBalances)),
    balances_by_type: typeBalances,
    actual_monthly_savings: formatMoneyDecimal(monthStart ? monthly.get(monthStart) ?? 0n : 0n),
    history: [...monthly.entries()].sort(([a], [b]) => b.localeCompare(a))
      .map(([month_start, amount]) => ({ month_start, amount: formatMoneyDecimal(amount) })),
  }
}

export function calculateProjectTotals(project: FinanceProject, expenses: FinanceProjectExpense[]) {
  const spent = sumMoney(expenses.filter(e => e.household_id === project.household_id && e.project_id === project.id)
    .map(e => financeMinorUnitsToMoney(e.amount)))
  const target = project.target_budget == null ? null : financeMinorUnitsToMoney(project.target_budget)
  return { spent, target, remaining: target == null ? null : subtractMoney(target, spent) }
}
