import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '../auth/supabase.ts'
import type { Bill, BillHistoryEntry } from './bills'

interface BillRow {
  id: string
  title: string
  due_day: number
  interval_months: number
  next_due_on: string
  expected_amount_minor: number | string | null
  currency: string
  active: boolean
  created_at: string
}

interface BillPaymentRow {
  id: string
  due_on: string
  paid_on: string
  amount_minor: number | string
  currency: string
  created_at: string
}

interface BillSkipRow {
  id: string
  due_on: string
  skipped_at: string
}

export interface SaveBillInput {
  title: string
  nextDueOn: string
  intervalMonths: 1 | 2
  /** Amounts are integer hundredths: 100.23 is sent as 10023. */
  expectedAmountMinor: number | null
  currency: string
}

const billColumns = 'id, title, due_day, interval_months, next_due_on, expected_amount_minor, currency, active, created_at'
const billPaymentColumns = 'id, due_on, paid_on, amount_minor, currency, created_at'
const billSkipColumns = 'id, due_on, skipped_at'

function requireSupabase(client: SupabaseClient | null): SupabaseClient {
  if (!client) throw new Error('Supabase is not configured. Check the Family Hub environment settings.')
  return client
}

function toBill(row: BillRow): Bill {
  return {
    id: row.id,
    title: row.title,
    dueDay: row.due_day,
    intervalMonths: row.interval_months === 2 ? 2 : 1,
    nextDueOn: row.next_due_on,
    expectedAmountMinor: row.expected_amount_minor === null ? null : Number(row.expected_amount_minor),
    currency: row.currency,
    active: row.active,
    createdAt: row.created_at,
  }
}

function toBillPayment(row: BillPaymentRow): BillHistoryEntry {
  return {
    id: row.id,
    dueOn: row.due_on,
    kind: 'paid',
    paidOn: row.paid_on,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    recordedAt: row.created_at,
  }
}

function toBillSkip(row: BillSkipRow): BillHistoryEntry {
  return {
    id: row.id,
    dueOn: row.due_on,
    kind: 'skipped',
    skippedAt: row.skipped_at,
  }
}

async function resolve<T>(request: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await request
  if (error) throw new Error(error.message)
  if (data === null) throw new Error('Family Hub returned an empty response. Please try again.')
  return data
}

export function createBillsApi(householdId: string, client: SupabaseClient | null = supabase) {
  async function list(signal?: AbortSignal): Promise<Bill[]> {
    const supabaseClient = requireSupabase(client)
    let query = supabaseClient
      .from('bills')
      .select(billColumns)
      .eq('household_id', householdId)
      .order('active', { ascending: false })
      .order('next_due_on', { ascending: true })
      .order('created_at', { ascending: true })
    if (signal) query = query.abortSignal(signal)
    const data = await resolve<BillRow[]>(query)
    return data.map(toBill)
  }

  async function listHistory(billId: string, signal?: AbortSignal): Promise<BillHistoryEntry[]> {
    const supabaseClient = requireSupabase(client)
    let paymentQuery = supabaseClient
      .from('bill_payments')
      .select(billPaymentColumns)
      .eq('household_id', householdId)
      .eq('bill_id', billId)
      .order('due_on', { ascending: false })
      .order('paid_on', { ascending: false })
    let skipQuery = supabaseClient
      .from('bill_skips')
      .select(billSkipColumns)
      .eq('household_id', householdId)
      .eq('bill_id', billId)
      .order('due_on', { ascending: false })
    if (signal) {
      paymentQuery = paymentQuery.abortSignal(signal)
      skipQuery = skipQuery.abortSignal(signal)
    }
    const [payments, skips] = await Promise.all([
      resolve<BillPaymentRow[]>(paymentQuery),
      resolve<BillSkipRow[]>(skipQuery),
    ])
    return [...payments.map(toBillPayment), ...skips.map(toBillSkip)]
      .sort((a, b) => b.dueOn.localeCompare(a.dueOn))
  }

  async function create(input: SaveBillInput): Promise<string> {
    const supabaseClient = requireSupabase(client)
    return resolve<string>(supabaseClient.rpc('create_bill', {
      p_household_id: householdId,
      p_title: input.title,
      p_next_due_on: input.nextDueOn,
      p_interval_months: input.intervalMonths,
      p_expected_amount_minor: input.expectedAmountMinor,
      p_currency: input.currency,
    }))
  }

  async function update(id: string, input: SaveBillInput): Promise<string> {
    const supabaseClient = requireSupabase(client)
    return resolve<string>(supabaseClient.rpc('update_bill', {
      p_bill_id: id,
      p_title: input.title,
      p_next_due_on: input.nextDueOn,
      p_interval_months: input.intervalMonths,
      p_expected_amount_minor: input.expectedAmountMinor,
      p_currency: input.currency,
    }))
  }

  async function setActive(id: string, active: boolean): Promise<string> {
    const supabaseClient = requireSupabase(client)
    return resolve<string>(supabaseClient.rpc('set_bill_active', { p_bill_id: id, p_active: active }))
  }

  async function recordPayment(billId: string, dueOn: string, paidOn: string, amountMinor: number): Promise<string> {
    const supabaseClient = requireSupabase(client)
    return resolve<string>(supabaseClient.rpc('record_bill_payment', {
      p_bill_id: billId,
      p_due_on: dueOn,
      p_paid_on: paidOn,
      p_amount_minor: amountMinor,
    }))
  }

  async function skipCycle(billId: string, dueOn: string): Promise<string> {
    const supabaseClient = requireSupabase(client)
    return resolve<string>(supabaseClient.rpc('skip_bill_cycle', {
      p_bill_id: billId,
      p_due_on: dueOn,
    }))
  }

  return { list, listHistory, create, update, setActive, recordPayment, skipCycle }
}
