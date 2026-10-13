import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBillsApi } from '../src/bills/api.ts'

class Query {
  constructor(calls, table, result) {
    this.calls = calls
    this.table = table
    this.result = result
    this.operations = []
  }

  select(columns) { this.operations.push(['select', columns]); return this }
  eq(column, value) { this.operations.push(['eq', column, value]); return this }
  order(column, options) { this.operations.push(['order', column, options]); return this }
  abortSignal(signal) { this.operations.push(['abortSignal', signal]); return this }
  then(resolve, reject) {
    this.calls.push({ table: this.table, operations: this.operations })
    return Promise.resolve(this.result).then(resolve, reject)
  }
}

function fakeClient(results) {
  const calls = []
  return {
    calls,
    from(table) { return new Query(calls, table, results[table] ?? { data: [], error: null }) },
    rpc() { throw new Error('Unexpected RPC') },
  }
}

test('bill history reads paid and skipped rows from the unified bill_payments table', async () => {
  const client = fakeClient({
    bill_payments: { data: [
      { id: 'skip-1', due_on: '2026-10-10', status: 'skipped', paid_on: null, amount_minor: null, currency: null, created_at: '2026-10-10T08:00:00Z' },
      { id: 'paid-1', due_on: '2026-09-10', status: 'paid', paid_on: '2026-09-11', amount_minor: '12345', currency: 'PLN', created_at: '2026-09-11T10:00:00Z' },
    ], error: null },
  })

  const history = await createBillsApi('household-1', client).listHistory('bill-1')
  assert.deepEqual(history, [
    { id: 'skip-1', dueOn: '2026-10-10', kind: 'skipped', skippedAt: '2026-10-10T08:00:00Z' },
    { id: 'paid-1', dueOn: '2026-09-10', kind: 'paid', paidOn: '2026-09-11', amountMinor: 12345, currency: 'PLN', recordedAt: '2026-09-11T10:00:00Z' },
  ])
  assert.equal(client.calls[0].table, 'bill_payments')
  assert.match(client.calls[0].operations.find(([op]) => op === 'select')[1], /status/)
  assert.ok(client.calls[0].operations.some(([op, column, value]) => op === 'eq' && column === 'bill_id' && value === 'bill-1'))
  assert.equal(client.calls.some(call => call.table === 'bill_skips'), false)
})

test('paid history rows with skipped-style NULL values are rejected', async () => {
  const client = fakeClient({
    bill_payments: { data: [
      { id: 'bad-paid', due_on: '2026-10-10', status: 'paid', paid_on: null, amount_minor: null, currency: null, created_at: '2026-10-10T08:00:00Z' },
    ], error: null },
  })
  await assert.rejects(createBillsApi('household-1', client).listHistory('bill-1'), /invalid paid bill entry/)
})
