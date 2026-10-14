import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '../../auth/supabase.ts'
import { FinanceVersionConflictError } from '../api.ts'
import { moneyToFinanceMinorUnits } from '../money.ts'
import type { FinanceId } from '../types.ts'
import type {
  FinanceCorrectWalletOpeningInput,
  FinanceCorrectWalletBalanceInput,
  FinanceCreateWalletInput,
  FinanceDeleteTransactionInput,
  FinanceSaveTransactionInput,
  FinanceSetWalletArchivedInput,
  FinanceTransactionCursor,
  FinanceTransactionFilters,
  FinanceTransactionMonthSummary,
  FinanceTransactionPage,
  FinanceTransactionScope,
  FinanceUpdateWalletInput,
  FinanceWalletBalanceCorrectionPreview,
  FinanceWalletBalanceCorrectionResult,
  FinanceWalletOpeningCorrectionPreview,
  FinanceWalletOpeningCorrectionResult,
  FinanceWalletWithBalance,
} from './types.ts'

type RpcResponse<T> = PromiseLike<{ data: T | null; error: { message: string; code?: string } | null }>

type MutationResult = {
  conflict?: true
  current_version?: number
}

function requireSupabase(client: SupabaseClient | null): SupabaseClient {
  if (!client) throw new Error('Supabase is not configured. Check the Family Hub environment settings.')
  return client
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error
  const message = typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message: unknown }).message)
    : ''
  return new Error(message || 'Could not complete the finance request. Please try again.')
}

async function resolve<T>(request: RpcResponse<T>, snapshotVersion?: number): Promise<T> {
  try {
    const { data, error } = await request
    if (error?.code === '40001' && snapshotVersion !== undefined) {
      // Wallet history can change without changing the wallet row version.
      throw new FinanceVersionConflictError(snapshotVersion, snapshotVersion)
    }
    if (error) throw new Error(error.message)
    if (data === null) throw new Error('Family Hub returned an empty finance response. Please try again.')
    return data
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'name' in error
      && (error as { name?: unknown }).name === 'AbortError') throw error
    throw normalizeError(error)
  }
}

function throwIfConflict(result: MutationResult, expectedVersion: number): void {
  if (result.conflict) {
    throw new FinanceVersionConflictError(
      expectedVersion,
      result.current_version == null ? null : Number(result.current_version),
    )
  }
}

type FinanceWalletListRow = Omit<FinanceWalletWithBalance, 'balance_as_of_date'> & {
  as_of_date: string
}

export function createFinanceTransactionsApi(
  householdId: FinanceId,
  client: SupabaseClient | null = supabase,
) {
  async function listWallets(
    scope: FinanceTransactionScope,
    asOfDate: string,
    signal?: AbortSignal,
  ): Promise<FinanceWalletWithBalance[]> {
    const supabaseClient = requireSupabase(client)
    let request = supabaseClient.rpc('finance_list_wallets', {
      p_household_id: householdId,
      p_scope: scope,
      p_as_of_date: asOfDate,
    }) as unknown as ReturnType<SupabaseClient['rpc']>
    if (signal) request = request.abortSignal(signal) as typeof request
    const rows = await resolve<FinanceWalletListRow[]>(request as unknown as RpcResponse<FinanceWalletListRow[]>)
    return rows.map(({ as_of_date, ...wallet }) => ({
      ...wallet,
      balance_as_of_date: as_of_date,
    }))
  }

  async function listTransactions(
    filters: FinanceTransactionFilters,
    cursor?: FinanceTransactionCursor | null,
    pageSize = 50,
    signal?: AbortSignal,
  ): Promise<FinanceTransactionPage> {
    const supabaseClient = requireSupabase(client)
    let request = supabaseClient.rpc('finance_list_transactions', {
      p_household_id: householdId,
      p_month_start: filters.month_start,
      p_scope: filters.scope,
      p_wallet_id: filters.wallet_id ?? null,
      p_category_id: filters.category_id ?? null,
      p_kinds: filters.kinds ?? null,
      p_search: filters.search?.trim() || null,
      p_cursor_date: cursor?.transaction_date ?? null,
      p_cursor_id: cursor?.transaction_id ?? null,
      p_page_size: pageSize,
    }) as unknown as ReturnType<SupabaseClient['rpc']>
    if (signal) request = request.abortSignal(signal) as typeof request
    return resolve<FinanceTransactionPage>(request as unknown as RpcResponse<FinanceTransactionPage>)
  }

  async function getTransactionMonthSummary(
    filters: Pick<FinanceTransactionFilters, 'month_start' | 'scope' | 'wallet_id' | 'category_id'>,
    signal?: AbortSignal,
  ): Promise<FinanceTransactionMonthSummary> {
    const supabaseClient = requireSupabase(client)
    let request = supabaseClient.rpc('finance_transaction_month_summary', {
      p_household_id: householdId,
      p_month_start: filters.month_start,
      p_scope: filters.scope,
      p_wallet_id: filters.wallet_id ?? null,
      p_category_id: filters.category_id ?? null,
    }) as unknown as ReturnType<SupabaseClient['rpc']>
    if (signal) request = request.abortSignal(signal) as typeof request
    return resolve<FinanceTransactionMonthSummary>(request as unknown as RpcResponse<FinanceTransactionMonthSummary>)
  }

  async function saveWallet(input: FinanceCreateWalletInput | FinanceUpdateWalletInput): Promise<FinanceId> {
    const supabaseClient = requireSupabase(client)
    const isCreate = !('wallet_id' in input)
    const result = await resolve<MutationResult & { wallet_id: FinanceId; version?: number }>(
      supabaseClient.rpc('finance_save_wallet', {
        p_household_id: householdId,
        p_request_id: input.request_id,
        p_wallet_id: isCreate ? null : input.wallet_id,
        p_expected_version: isCreate ? null : input.expected_version,
        p_name: input.name.trim(),
        p_wallet_type: input.wallet_type,
        p_visibility: isCreate ? input.visibility : null,
        p_opened_on: isCreate ? input.opened_on : null,
        p_opening_balance_minor: isCreate ? moneyToFinanceMinorUnits(input.opening_balance) : null,
        p_color: input.color,
        p_icon: input.icon,
      }) as unknown as RpcResponse<MutationResult & { wallet_id: FinanceId; version?: number }>,
    )
    throwIfConflict(result, isCreate ? 0 : input.expected_version)
    return result.wallet_id
  }

  async function setWalletArchived(input: FinanceSetWalletArchivedInput): Promise<void> {
    const supabaseClient = requireSupabase(client)
    const result = await resolve<MutationResult & { wallet_id: FinanceId; version?: number }>(
      supabaseClient.rpc('finance_set_wallet_archived', {
        p_household_id: householdId,
        p_request_id: input.request_id,
        p_wallet_id: input.wallet_id,
        p_expected_version: input.expected_version,
        p_is_archived: input.is_archived,
      }) as unknown as RpcResponse<MutationResult & { wallet_id: FinanceId; version?: number }>,
    )
    throwIfConflict(result, input.expected_version)
  }

  async function previewWalletBalanceCorrection(
    walletId: FinanceId,
    effectiveDate: string,
    signal?: AbortSignal,
  ): Promise<FinanceWalletBalanceCorrectionPreview> {
    const supabaseClient = requireSupabase(client)
    let request = supabaseClient.rpc('finance_preview_wallet_balance', {
      p_household_id: householdId,
      p_wallet_id: walletId,
      p_effective_date: effectiveDate,
    }) as unknown as ReturnType<SupabaseClient['rpc']>
    if (signal) request = request.abortSignal(signal) as typeof request
    const preview = await resolve<FinanceWalletBalanceCorrectionPreview>(
      request as unknown as RpcResponse<FinanceWalletBalanceCorrectionPreview>,
    )
    return { ...preview, wallet_version: Number(preview.wallet_version) }
  }

  async function correctWalletBalance(input: FinanceCorrectWalletBalanceInput): Promise<FinanceWalletBalanceCorrectionResult> {
    const supabaseClient = requireSupabase(client)
    const result = await resolve<MutationResult & FinanceWalletBalanceCorrectionResult>(
      supabaseClient.rpc('finance_correct_wallet_balance', {
        p_household_id: householdId,
        p_request_id: input.request_id,
        p_wallet_id: input.wallet_id,
        p_expected_version: input.expected_version,
        p_snapshot_token: input.snapshot_token,
        p_effective_date: input.effective_date,
        p_observed_balance_minor: moneyToFinanceMinorUnits(input.observed_balance),
        p_reason: input.reason.trim(),
      }) as unknown as RpcResponse<MutationResult & FinanceWalletBalanceCorrectionResult>,
      input.expected_version,
    )
    throwIfConflict(result, input.expected_version)
    return { ...result, version: Number(result.version) }
  }

  async function previewWalletOpeningCorrection(
    walletId: FinanceId,
    signal?: AbortSignal,
  ): Promise<FinanceWalletOpeningCorrectionPreview> {
    const supabaseClient = requireSupabase(client)
    let request = supabaseClient.rpc('finance_preview_wallet_opening_correction', {
      p_household_id: householdId,
      p_wallet_id: walletId,
    }) as unknown as ReturnType<SupabaseClient['rpc']>
    if (signal) request = request.abortSignal(signal) as typeof request
    const preview = await resolve<FinanceWalletOpeningCorrectionPreview>(
      request as unknown as RpcResponse<FinanceWalletOpeningCorrectionPreview>,
    )
    return {
      ...preview,
      wallet_version: Number(preview.wallet_version),
      opening_transaction_version: Number(preview.opening_transaction_version),
    }
  }

  async function correctWalletOpening(
    input: FinanceCorrectWalletOpeningInput,
  ): Promise<FinanceWalletOpeningCorrectionResult> {
    const supabaseClient = requireSupabase(client)
    const result = await resolve<MutationResult & FinanceWalletOpeningCorrectionResult>(
      supabaseClient.rpc('finance_correct_wallet_opening', {
        p_household_id: householdId,
        p_request_id: input.request_id,
        p_wallet_id: input.wallet_id,
        p_expected_version: input.expected_version,
        p_snapshot_token: input.snapshot_token,
        p_opened_on: input.opened_on,
        p_opening_balance_minor: moneyToFinanceMinorUnits(input.opening_balance),
      }) as unknown as RpcResponse<MutationResult & FinanceWalletOpeningCorrectionResult>,
      input.expected_version,
    )
    throwIfConflict(result, input.expected_version)
    return { ...result, version: Number(result.version) }
  }

  async function saveTransaction(input: FinanceSaveTransactionInput): Promise<FinanceId> {
    const supabaseClient = requireSupabase(client)
    const result = await resolve<MutationResult & { transaction_id: FinanceId; version?: number }>(
      supabaseClient.rpc('finance_save_wallet_transaction', {
        p_household_id: householdId,
        p_request_id: input.request_id,
        p_transaction_id: input.transaction_id ?? null,
        p_expected_version: input.expected_version ?? null,
        p_kind: input.kind,
        p_transaction_date: input.transaction_date,
        p_amount_minor: moneyToFinanceMinorUnits(input.amount),
        p_source_wallet_id: input.source_wallet_id,
        p_destination_wallet_id: input.destination_wallet_id,
        p_category_id: input.category_id,
        p_description: input.description?.trim() || null,
        p_savings_effect: input.savings_effect,
      }) as unknown as RpcResponse<MutationResult & { transaction_id: FinanceId; version?: number }>,
    )
    throwIfConflict(result, input.expected_version ?? 0)
    return result.transaction_id
  }

  async function deleteTransaction(input: FinanceDeleteTransactionInput): Promise<void> {
    const supabaseClient = requireSupabase(client)
    const result = await resolve<MutationResult & { deleted?: true; transaction_id: FinanceId }>(
      supabaseClient.rpc('finance_delete_wallet_transaction', {
        p_household_id: householdId,
        p_request_id: input.request_id,
        p_transaction_id: input.transaction_id,
        p_expected_version: input.expected_version,
      }) as unknown as RpcResponse<MutationResult & { deleted?: true; transaction_id: FinanceId }>,
    )
    throwIfConflict(result, input.expected_version)
  }

  return {
    listWallets,
    listTransactions,
    getTransactionMonthSummary,
    saveWallet,
    setWalletArchived,
    previewWalletBalanceCorrection,
    correctWalletBalance,
    previewWalletOpeningCorrection,
    correctWalletOpening,
    saveTransaction,
    deleteTransaction,
  }
}
