import type { FinanceCategory } from '../types'
import type { FinanceTransactionCategoryTotal, FinanceWalletWithBalance } from './types'

export type TransactionCategoryView = 'main' | 'detailed'

export interface TransactionReportCategoryRow {
  id: string
  name: string
  path: string
  amount_minor: bigint
  transaction_count: number
  category_ids: string[]
}

function getCategoryRoot(id: string, categoriesById: Map<string, FinanceCategory>): string {
  let currentId = id
  const seen = new Set([id])
  let parentId = categoriesById.get(currentId)?.parent_id ?? null
  while (parentId && !seen.has(parentId)) {
    currentId = parentId
    seen.add(parentId)
    parentId = categoriesById.get(currentId)?.parent_id ?? null
  }
  return currentId
}

function getCategoryPath(id: string, fallbackName: string, categoriesById: Map<string, FinanceCategory>): string {
  const names: string[] = []
  const seen = new Set<string>()
  let currentId: string | null = id
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId)
    const category = categoriesById.get(currentId)
    if (!category) break
    names.unshift(category.name)
    currentId = category.parent_id
  }
  return names.length ? names.join(' → ') : fallbackName
}

/**
 * Aggregate exact category rows into their current top-level category when
 * the overview is in its main-category view. Detailed rows keep the database
 * amounts intact, so parent transactions are never added to child rows.
 */
export function buildTransactionCategoryRows(
  categories: FinanceCategory[],
  totals: FinanceTransactionCategoryTotal[],
  view: TransactionCategoryView,
): TransactionReportCategoryRow[] {
  const categoriesById = new Map(categories.map(category => [category.id, category]))
  const detailed = totals.map(total => ({
    id: total.category_id,
    name: total.category_name,
    path: getCategoryPath(total.category_id, total.category_name, categoriesById),
    amount_minor: BigInt(total.amount_minor),
    transaction_count: total.transaction_count,
    category_ids: [total.category_id],
  })).sort((left, right) => left.path.localeCompare(right.path, 'pl-PL'))

  if (view === 'detailed') return detailed

  const groups = new Map<string, TransactionReportCategoryRow>()
  for (const row of detailed) {
    const rootId = getCategoryRoot(row.id, categoriesById)
    const existing = groups.get(rootId)
    if (existing) {
      existing.amount_minor += row.amount_minor
      existing.transaction_count += row.transaction_count
      existing.category_ids.push(row.id)
      continue
    }
    const category = categoriesById.get(rootId)
    groups.set(rootId, {
      id: rootId,
      name: category?.name ?? row.name,
      path: category?.name ?? row.path,
      amount_minor: row.amount_minor,
      transaction_count: row.transaction_count,
      category_ids: [row.id],
    })
  }
  return [...groups.values()].sort((left, right) => left.name.localeCompare(right.name, 'pl-PL'))
}

/** Return the last included day for a past month, or Warsaw-today this month. */
export function transactionBalanceDate(monthStart: string, today: string): string {
  if (monthStart.slice(0, 7) === today.slice(0, 7)) return today
  const [year, month] = monthStart.slice(0, 7).split('-').map(Number)
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
}

/** Sum exact wallet balance strings, optionally for one selected wallet. */
export function transactionBalanceMinor(
  wallets: FinanceWalletWithBalance[] | undefined,
  walletId?: string | null,
): bigint | null {
  if (!wallets) return null
  if (walletId) {
    const selected = wallets.find(wallet => wallet.id === walletId)
    return selected ? BigInt(selected.balance_minor) : null
  }
  return wallets.reduce((sum, wallet) => sum + BigInt(wallet.balance_minor), 0n)
}
