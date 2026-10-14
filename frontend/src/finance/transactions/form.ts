import { financeMinorUnitsToMoney, parseMoney } from '../money.ts'
import type { FinanceCategory } from '../types'
import type { FinanceSaveTransactionInput, FinanceTransaction, FinanceWallet } from './types'
import { validDate } from './filters.ts'

export type EntryTab = 'expense' | 'income' | 'transfer'
export interface TransactionDraft {
  tab: EntryTab
  amount: string
  date: string
  source: string
  destination: string
  category: string
  description: string
  savings: boolean
  refund: boolean
  contribution: boolean
  effectExplicit: boolean
}
export function initialDraft(today: string, month: string, wallet: string, entry?: FinanceTransaction, saving = false): TransactionDraft {
  return {
    tab: entry?.kind === 'income' ? 'income' : entry?.kind === 'transfer' || saving ? 'transfer' : 'expense',
    amount: entry ? financeMinorUnitsToMoney(entry.amount_minor) : '',
    date: entry?.transaction_date ?? (today.startsWith(month) ? today : ''),
    source: entry?.source_wallet_id ?? wallet, destination: entry?.destination_wallet_id ?? (saving ? '' : wallet),
    category: entry?.category_id ?? '', description: entry?.description ?? '',
    savings: entry?.kind === 'savings_expense' || entry?.kind === 'savings_refund',
    refund: entry?.kind === 'refund' || entry?.kind === 'savings_refund',
    contribution: entry?.savings_effect === 'contribution' || saving,
    effectExplicit: Boolean(entry) || saving,
  }
}
export function sameWalletAudience(a: FinanceWallet, b: FinanceWallet): boolean {
  return a.id !== b.id && a.household_id === b.household_id && a.visibility === b.visibility
    && (a.visibility === 'household' || a.owner_user_id === b.owner_user_id)
}
export function compatibleCategory(category: FinanceCategory, tab: EntryTab, contribution: boolean): boolean {
  if (tab === 'income') return category.budget_type === 'income'
  if (tab === 'expense') return ['fixed_expense', 'variable_expense'].includes(category.budget_type)
  if (contribution) return category.budget_type === 'saving' && category.allocation_role === 'standard'
  return ['saving', 'investment'].includes(category.budget_type)
}
export function switchTab(draft: TransactionDraft, tab: EntryTab, categories: FinanceCategory[]): TransactionDraft {
  const category = categories.find(item => item.id === draft.category)
  return { ...draft, tab, savings: false, refund: false, contribution: false, effectExplicit: false,
    category: category && compatibleCategory(category, tab, false) ? category.id : '',
    destination: tab === 'transfer' && draft.destination === draft.source ? '' : draft.destination }
}
export function draftKind(draft: TransactionDraft): FinanceSaveTransactionInput['kind'] {
  return draft.tab !== 'expense' ? draft.tab : draft.refund
    ? draft.savings ? 'savings_refund' : 'refund' : draft.savings ? 'savings_expense' : 'expense'
}
export function validateDraft(draft: TransactionDraft, wallets: FinanceWallet[], categories: FinanceCategory[], today: string, requiredMonth?: string): Record<string, string> {
  const errors: Record<string, string> = {}
  try { if (parseMoney(draft.amount) <= 0n) errors.amount = 'Kwota musi być większa od zera.' }
  catch { errors.amount = 'Podaj kwotę z maksymalnie dwoma miejscami po przecinku, bez separatorów tysięcy.' }
  if (!validDate(draft.date) || draft.date > today) errors.date = 'Podaj prawidłową datę, nie późniejszą niż dziś.'
  else if (requiredMonth && !draft.date.startsWith(requiredMonth)) errors.date = `Wybierz datę w miesiącu ${requiredMonth}.`
  const sourceNeeded = draft.tab === 'transfer' || (draft.tab === 'expense' && !draft.refund)
  const destinationNeeded = !sourceNeeded || draft.tab === 'transfer'
  const source = wallets.find(wallet => wallet.id === draft.source && !wallet.is_archived)
  const destination = wallets.find(wallet => wallet.id === draft.destination && !wallet.is_archived)
  if (sourceNeeded && !source) errors.source = 'Wybierz dostępny portfel źródłowy.'
  if (destinationNeeded && !destination) errors.destination = 'Wybierz dostępny portfel docelowy.'
  if (sourceNeeded && source && draft.date < source.opened_on || destinationNeeded && destination && draft.date < destination.opened_on) errors.date = 'Data nie może poprzedzać otwarcia portfela.'
  if (draft.tab === 'transfer' && source && destination && !sameWalletAudience(source, destination)) errors.destination = 'Wybierz inny portfel o tej samej widoczności i właścicielu.'
  const category = categories.find(item => item.id === draft.category)
  if ((!category && (draft.tab !== 'transfer' || draft.contribution || draft.category))
    || category && !compatibleCategory(category, draft.tab, draft.contribution)) errors.category = 'Wybierz kategorię zgodną z rodzajem transakcji.'
  if (draft.description.length > 2000) errors.description = 'Opis może mieć maksymalnie 2000 znaków.'
  return errors
}
export function transactionInput(draft: TransactionDraft, requestId: string, entry?: FinanceTransaction): FinanceSaveTransactionInput {
  const common = {
    request_id: requestId, ...(entry ? { transaction_id: entry.id, expected_version: entry.version } : { transaction_id: null, expected_version: null }),
    transaction_date: draft.date, amount: draft.amount, category_id: draft.category || null, description: draft.description || null,
  }
  const kind = draftKind(draft)
  if (kind === 'transfer') return { ...common, kind, source_wallet_id: draft.source, destination_wallet_id: draft.destination, savings_effect: draft.contribution ? 'contribution' : 'none' }
  if (kind === 'expense' || kind === 'savings_expense') return { ...common, kind, source_wallet_id: draft.source, destination_wallet_id: null, savings_effect: 'none' }
  return { ...common, kind, source_wallet_id: null, destination_wallet_id: draft.destination, savings_effect: 'none' }
}
/** Form-only preview. Reports remain authoritative database aggregates. */
export function walletEffect(entry: Pick<FinanceTransaction, 'kind' | 'source_wallet_id' | 'destination_wallet_id' | 'amount_minor'>, walletId: string): bigint {
  const amount = BigInt(entry.amount_minor)
  return (entry.destination_wallet_id === walletId ? amount : 0n) - (entry.source_wallet_id === walletId ? amount : 0n)
}
