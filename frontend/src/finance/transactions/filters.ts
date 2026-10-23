import type { FinanceTransactionFilters, FinanceTransactionKind } from './types'

export const transactionKindLabels: Record<FinanceTransactionKind, string> = {
  expense: 'Wydatek bieżący', savings_expense: 'Wydatek z oszczędności',
  income: 'Przychód', refund: 'Zwrot bieżącego wydatku', savings_refund: 'Zwrot z oszczędności',
  transfer: 'Przelew', opening: 'Saldo początkowe', adjustment: 'Korekta salda',
}
// Match the wallet RPCs, independently of the browser or database session zone.
export const FINANCE_TIME_ZONE = 'Europe/Warsaw'
export function todayDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: FINANCE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)!.value
  return `${part('year')}-${part('month')}-${part('day')}`
}
export function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '0001-01-01'
    && !Number.isNaN(Date.parse(`${value}T12:00:00Z`))
    && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value
}
export function readTransactionFilters(params: URLSearchParams, today = todayDate()): FinanceTransactionFilters {
  const month = params.get('month') ?? ''
  const scope = params.get('scope')
  const selectedKinds = [...new Set(params.getAll('kind'))]
    .filter((kind): kind is FinanceTransactionKind => Object.hasOwn(transactionKindLabels, kind))
  const walletIds = [...new Set(params.getAll('wallet').filter(Boolean))]
  const categoryIds = [...new Set(params.getAll('category').filter(Boolean))]
  const currentMonth = today.slice(0, 7)
  const monthStart = validDate(`${month}-01`) && month <= currentMonth ? `${month}-01` : `${currentMonth}-01`
  return {
    month_start: monthStart,
    scope: scope === 'personal' || scope === 'all_accessible' ? scope : 'household',
    wallet_id: walletIds.length === 1 ? walletIds[0] : null,
    ...(walletIds.length > 1 ? { wallet_ids: walletIds } : {}),
    category_id: categoryIds.length === 1 ? categoryIds[0] : null,
    ...(categoryIds.length > 1 ? { category_ids: categoryIds } : {}),
    kinds: selectedKinds.length ? selectedKinds : undefined,
    search: (params.get('search') ?? '').slice(0, 200),
  }
}
