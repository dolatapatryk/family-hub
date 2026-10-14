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
  const kind = params.get('kind')
  return {
    month_start: validDate(`${month}-01`) ? `${month}-01` : `${today.slice(0, 7)}-01`,
    scope: scope === 'personal' || scope === 'all_accessible' ? scope : 'household',
    wallet_id: params.get('wallet') || null,
    category_id: params.get('category') || null,
    kinds: kind && Object.hasOwn(transactionKindLabels, kind) ? [kind as FinanceTransactionKind] : undefined,
    search: (params.get('search') ?? '').slice(0, 200),
  }
}
