import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initialDraft, sameWalletAudience, compatibleCategory, switchTab, draftKind, validateDraft, transactionInput, walletEffect } from '../src/finance/transactions/form.ts'
import { readTransactionFilters, todayDate, validDate } from '../src/finance/transactions/filters.ts'
import { resolveFinanceRoute, transactionsNavigation } from '../src/finance/navigation.ts'
import { createFinanceTransactionsApi } from '../src/finance/transactions/api.ts'
import { FinanceVersionConflictError } from '../src/finance/api.ts'

const today = '2026-10-15'
const a = { id: 'a', household_id: 'home', visibility: 'household', owner_user_id: 'u', opened_on: '2026-01-01', is_archived: false }
const b = { ...a, id: 'b' }
const categories = [
  { id: 'food', budget_type: 'variable_expense', allocation_role: 'standard' },
  { id: 'salary', budget_type: 'income', allocation_role: 'standard' },
  { id: 'saving', budget_type: 'saving', allocation_role: 'standard' },
  { id: 'allowance', budget_type: 'saving', allocation_role: 'personal_allowance' },
  { id: 'investment', budget_type: 'investment', allocation_role: 'standard' },
]
const draft = () => ({ ...initialDraft(today, '2026-10', 'a'), amount: '180,01', category: 'food' })

test('transaction routes do not require a budget month and preserve legacy routing', () => {
  for (const tab of transactionsNavigation) assert.equal(resolveFinanceRoute(tab.to).view, 'transactions')
  assert.equal(resolveFinanceRoute('/finance/transactions').view, 'transactions')
  assert.equal(resolveFinanceRoute('/finance/transactions/unknown'), null)
  assert.equal(resolveFinanceRoute('/finance/budget').view, 'budget')
})
test('date-only and URL filters validate leap days and preserve scope, month and history filters', () => {
  assert.ok(validDate('2024-02-29')); assert.ok(!validDate('2026-02-29')); assert.ok(!validDate('0000-01-01'))
  assert.equal(todayDate(new Date('2025-12-31T23:02:00Z')), '2026-01-01')
  assert.deepEqual(readTransactionFilters(new URLSearchParams('month=2026-02&scope=personal&wallet=a&category=food&kind=savings_refund&search=books'), today), {
    month_start: '2026-02-01', scope: 'personal', wallet_id: 'a', category_id: 'food', kinds: ['savings_refund'], search: 'books',
  })
  const invalid = readTransactionFilters(new URLSearchParams('month=2026-13&scope=outsider&kind=toString'), today)
  assert.equal(invalid.month_start, '2026-10-01'); assert.equal(invalid.scope, 'household'); assert.equal(invalid.kinds, undefined)
  assert.equal(initialDraft(today, '2026-09', 'a').date, '')
})
test('funding and refunds select the correct kind and one endpoint without floating point conversion', () => {
  const current = draft()
  for (const [savings, refund, kind] of [[false, false, 'expense'], [true, false, 'savings_expense'], [false, true, 'refund'], [true, true, 'savings_refund']]) {
    const value = { ...current, savings, refund }
    const input = transactionInput(value, 'request')
    assert.equal(draftKind(value), kind); assert.equal(input.kind, kind); assert.equal(input.amount, '180,01')
    assert.equal(input.source_wallet_id, refund ? null : 'a'); assert.equal(input.destination_wallet_id, refund ? 'a' : null)
    assert.equal(input.savings_effect, 'none')
  }
  const income = switchTab({ ...current, savings: true, refund: true, contribution: true }, 'income', categories)
  assert.equal(income.category, ''); assert.equal(income.savings, false); assert.equal(income.refund, false); assert.equal(income.contribution, false)
  assert.equal(income.amount, current.amount); assert.equal(income.date, current.date)
})
test('validation enforces cents, opening dates, past months, archived wallets and compatible categories', () => {
  assert.deepEqual(validateDraft(draft(), [a, b], categories, today), {})
  for (const amount of ['0', '-1', '1.001', '1e2', '10000000000000000']) assert.ok(validateDraft({ ...draft(), amount }, [a, b], categories, today).amount)
  for (const date of ['2026-10-16', '2026-02-30', '2025-12-31', '']) assert.ok(validateDraft({ ...draft(), date }, [a, b], categories, today).date)
  assert.ok(validateDraft(draft(), [a, b], categories, today, '2026-09').date)
  assert.ok(validateDraft(draft(), [{ ...a, is_archived: true }], categories, today).source)
  assert.ok(validateDraft({ ...draft(), category: 'salary' }, [a, b], categories, today).category)
  assert.ok(!validateDraft({ ...draft(), amount: '9000' }, [a, b], categories, today).amount, 'Negative projected balance is advisory')
})
test('transfers enforce different wallets and same audience and personal allowances never contribute', () => {
  assert.ok(sameWalletAudience(a, b)); assert.ok(!sameWalletAudience(a, a))
  assert.ok(!sameWalletAudience(a, { ...b, visibility: 'private' }))
  assert.ok(!sameWalletAudience(a, { ...b, household_id: 'other' }))
  assert.ok(!sameWalletAudience({ ...a, visibility: 'private' }, { ...b, visibility: 'private', owner_user_id: 'other' }))
  assert.ok(sameWalletAudience({ ...a, visibility: 'private' }, { ...b, visibility: 'private' }))
  const transfer = { ...draft(), tab: 'transfer', destination: 'b', category: 'saving', contribution: true }
  assert.deepEqual(validateDraft(transfer, [a, b], categories, today), {})
  assert.equal(transactionInput(transfer, 'r').savings_effect, 'contribution')
  assert.ok(validateDraft({ ...transfer, destination: 'a' }, [a, b], categories, today).destination)
  assert.ok(validateDraft({ ...transfer, category: 'allowance' }, [a, b], categories, today).category)
  assert.ok(compatibleCategory(categories[3], 'transfer', false)); assert.ok(!compatibleCategory(categories[3], 'transfer', true))
  assert.deepEqual(validateDraft({ ...transfer, category: '', contribution: false }, [a, b], categories, today), {})
})
test('editing retains version and wallet preview reverses both original transfer endpoints exactly', () => {
  const entry = { id: 'tx', version: 7, kind: 'transfer', amount_minor: '100000', source_wallet_id: 'a', destination_wallet_id: 'b', savings_effect: 'none', transaction_date: '2026-10-01' }
  const value = initialDraft(today, '2026-10', 'a', entry)
  assert.equal(value.amount, '1000.00'); assert.equal(value.effectExplicit, true)
  const input = transactionInput(value, 'r', entry)
  assert.equal(input.expected_version, 7); assert.equal(input.transaction_id, 'tx')
  assert.equal(walletEffect(entry, 'a'), -100000n); assert.equal(walletEffect(entry, 'b'), 100000n); assert.equal(walletEffect(entry, 'c'), 0n)
})

function fakeClient(responses) {
  const calls = []
  return { calls, rpc(name, args) {
    const result = responses.shift()
    calls.push({ name, args })
    return { abortSignal() { return this }, then(resolve, reject) { return Promise.resolve(result).then(resolve, reject) } }
  } }
}
test('history API passes stable cursors and all filters on every page', async () => {
  const cursor = { transaction_date: '2026-10-02', transaction_id: 'last-id' }
  const client = fakeClient([{ data: { items: [], next_cursor: cursor }, error: null }, { data: { items: [], next_cursor: null }, error: null }])
  const api = createFinanceTransactionsApi('home', client)
  const filters = readTransactionFilters(new URLSearchParams('month=2026-10&scope=personal&wallet=a&category=food&kind=refund&search=  book  '), today)
  const first = await api.listTransactions(filters)
  await api.listTransactions(filters, first.next_cursor)
  assert.equal(client.calls[0].args.p_cursor_id, null)
  assert.equal(client.calls[1].args.p_cursor_id, 'last-id')
  for (const call of client.calls) {
    assert.equal(call.args.p_scope, 'personal'); assert.equal(call.args.p_wallet_id, 'a'); assert.equal(call.args.p_category_id, 'food')
    assert.equal(call.args.p_page_size, 50); assert.equal(call.args.p_search, 'book'); assert.deepEqual(call.args.p_kinds, ['refund'])
  }
})
test('transaction API converts exact amounts and exposes conflicts without silent overwrites', async () => {
  const client = fakeClient([{ data: { transaction_id: 'tx' }, error: null }, { data: { conflict: true, current_version: 8 }, error: null }])
  const api = createFinanceTransactionsApi('home', client)
  await api.saveTransaction(transactionInput(draft(), 'request'))
  assert.equal(client.calls[0].args.p_amount_minor, '18001')
  assert.equal(client.calls[0].args.p_request_id, 'request')
  await assert.rejects(api.deleteTransaction({ request_id: 'delete', transaction_id: 'tx', expected_version: 7 }), FinanceVersionConflictError)
})

test('balance and opening snapshot conflicts require review even when the wallet row version is unchanged', async () => {
  const client = fakeClient([
    { data: null, error: { code: '40001', message: 'Wallet balance changed since the correction preview' } },
    { data: null, error: { code: '40001', message: 'Wallet opening changed since the correction preview' } },
  ])
  const api = createFinanceTransactionsApi('home', client)
  const identity = { request_id: 'r', wallet_id: 'a', expected_version: 7, snapshot_token: 'stale' }
  for (const operation of [
    () => api.correctWalletBalance({ ...identity, effective_date: today, observed_balance: '10', reason: 'Reconcile' }),
    () => api.correctWalletOpening({ ...identity, opened_on: '2026-01-01', opening_balance: '10' }),
  ]) await assert.rejects(operation, error => error instanceof FinanceVersionConflictError && error.current_version === 7)
})


test('finance today uses Warsaw across UTC midnight, DST, and year boundaries', () => {
  for (const [instant, expected] of [
    ['2026-10-14T21:59:59Z', '2026-10-14'],
    ['2026-10-14T22:00:00Z', '2026-10-15'],
    ['2026-01-14T22:59:59Z', '2026-01-14'],
    ['2026-01-14T23:00:00Z', '2026-01-15'],
    ['2026-03-29T00:59:59Z', '2026-03-29'],
    ['2026-03-29T01:00:00Z', '2026-03-29'],
    ['2026-10-25T00:59:59Z', '2026-10-25'],
    ['2026-10-25T01:00:00Z', '2026-10-25'],
    ['2026-12-31T23:00:00Z', '2027-01-01'],
  ]) assert.equal(todayDate(new Date(instant)), expected)
})
