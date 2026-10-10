import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFinanceApi, FinanceVersionConflictError } from '../src/finance/api.ts'
import { canTransferBetweenSavingsAccounts } from '../src/finance/privacy.ts'

const owner = 'member-owner'
const household = 'household-1'

function account(id, overrides = {}) {
  return {
    id,
    household_id: household,
    created_by: owner,
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
    version: 1,
    name: id,
    account_type: 'cash',
    parent_id: null,
    opening_balance_minor: '12500',
    target_amount_minor: null,
    color: null,
    is_archived: false,
    visibility: 'household',
    owner_user_id: owner,
    sort_order: 0,
    ...overrides,
  }
}

class QueryBuilder {
  constructor(calls, table, result) {
    this.calls = calls
    this.table = table
    this.result = result
    this.operations = []
  }

  select(columns) { this.operations.push(['select', columns]); return this }
  eq(column, value) { this.operations.push(['eq', column, value]); return this }
  not(column, operator, value) { this.operations.push(['not', column, operator, value]); return this }
  order(column, options) { this.operations.push(['order', column, options]); return this }
  range(from, to) { this.operations.push(['range', from, to]); return this }
  abortSignal(signal) { this.operations.push(['abortSignal', signal]); return this }

  then(resolve, reject) {
    this.calls.push({ table: this.table, operations: this.operations })
    const range = this.operations.find(([name]) => name === 'range')
    const result = range && Array.isArray(this.result.data)
      ? { ...this.result, data: this.result.data.slice(range[1], range[2] + 1) }
      : this.result
    return Promise.resolve(result).then(resolve, reject)
  }
}

function fakeClient({ rpcResult, tableResults = {} } = {}) {
  const calls = []
  return {
    calls,
    rpcCalls: [],
    from(table) {
      const client = this
      return new QueryBuilder(client.calls, table, tableResults[table] ?? { data: [], error: null })
    },
    rpc(name, args) {
      this.rpcCalls.push({ name, args })
      return Promise.resolve(rpcResult ?? { data: { transfer_id: 'transfer-1', transaction_ids: ['leg-1', 'leg-2'] }, error: null })
    },
  }
}

test('transfer privacy permits matching household scope or same-owner private accounts only', () => {
  assert.equal(canTransferBetweenSavingsAccounts(
    { household_id: household, visibility: 'household', owner_user_id: owner },
    { household_id: household, visibility: 'household', owner_user_id: 'member-2' },
  ), true)
  assert.equal(canTransferBetweenSavingsAccounts(
    { household_id: household, visibility: 'private', owner_user_id: owner },
    { household_id: household, visibility: 'private', owner_user_id: owner },
  ), true)
  assert.equal(canTransferBetweenSavingsAccounts(
    { household_id: household, visibility: 'household', owner_user_id: owner },
    { household_id: household, visibility: 'private', owner_user_id: owner },
  ), false)
  assert.equal(canTransferBetweenSavingsAccounts(
    { household_id: household, visibility: 'private', owner_user_id: owner },
    { household_id: household, visibility: 'private', owner_user_id: 'member-2' },
  ), false)
})

test('finance adapter casts savings bigint fields to text and maps paired legs into transfer history', async () => {
  const client = fakeClient({
    tableResults: {
      finance_savings_accounts: { data: [account('source')], error: null },
      finance_savings_transfers: {
        data: [{
          id: 'transfer-1', household_id: household, created_by: owner,
          created_at: '2026-10-09T12:00:00Z', updated_at: '2026-10-09T12:00:00Z', version: 1,
        }],
        error: null,
      },
      finance_savings_transactions: {
        data: [
          { id: 'leg-out', transfer_id: 'transfer-1', account_id: 'source', transaction_date: '2026-10-09', amount_minor: '-12345', description: 'Move' },
          { id: 'leg-in', transfer_id: 'transfer-1', account_id: 'target', transaction_date: '2026-10-09', amount_minor: '12345', description: 'Move' },
        ],
        error: null,
      },
    },
  })
  const api = createFinanceApi(household, owner, client)

  const accounts = await api.listSavingsAccounts()
  assert.equal(accounts[0].opening_balance, '12500')
  assert.equal(accounts[0].target_amount, null)
  assert.match(client.calls[0].operations.find(([name]) => name === 'select')[1], /opening_balance::text/)
  assert.deepEqual(client.calls[0].operations.find(([name]) => name === 'range'), ['range', 0, 499])

  const transfers = await api.listSavingsTransfers()
  assert.deepEqual(transfers, [{
    id: 'transfer-1', household_id: household, created_by: owner,
    created_at: '2026-10-09T12:00:00Z', updated_at: '2026-10-09T12:00:00Z', version: 1,
    from_account_id: 'source', to_account_id: 'target', amount: '12345',
    transaction_date: '2026-10-09', description: 'Move', transaction_ids: ['leg-out', 'leg-in'],
  }])
  assert.ok(client.calls.some(call => call.table === 'finance_savings_transactions'
    && call.operations.some(([name, column, operator, value]) => name === 'not' && column === 'transfer_id' && operator === 'is' && value === null)))
})

test('transfer history reads every page beyond the PostgREST default result window', async () => {
  const transfers = Array.from({ length: 501 }, (_, index) => ({
    id: `transfer-${index}`,
    household_id: household,
    created_by: owner,
    created_at: '2026-10-09T12:00:00Z',
    updated_at: '2026-10-09T12:00:00Z',
    version: 1,
  }))
  const movements = transfers.flatMap(transfer => [
    { id: `${transfer.id}-out`, transfer_id: transfer.id, account_id: 'source', transaction_date: '2026-10-09', amount_minor: '-100', description: null },
    { id: `${transfer.id}-in`, transfer_id: transfer.id, account_id: 'target', transaction_date: '2026-10-09', amount_minor: '100', description: null },
  ])
  const client = fakeClient({
    tableResults: {
      finance_savings_transfers: { data: transfers, error: null },
      finance_savings_transactions: { data: movements, error: null },
    },
  })

  const history = await createFinanceApi(household, owner, client).listSavingsTransfers()
  assert.equal(history.length, 501)
  assert.ok(client.calls.filter(call => call.table === 'finance_savings_transfers').length > 1)
  assert.ok(client.calls.filter(call => call.table === 'finance_savings_transactions').length > 1)
})

test('savings transaction reads cast bigint values to exact minor-unit text and page through history', async () => {
  const movements = Array.from({ length: 501 }, (_, index) => ({
    id: `movement-${index}`,
    household_id: household,
    created_by: owner,
    created_at: '2026-10-09T12:00:00Z',
    updated_at: '2026-10-09T12:00:00Z',
    version: 1,
    account_id: 'source',
    transaction_date: '2026-10-09',
    amount_minor: String(index - 250),
    description: null,
    budget_month_id: null,
    excluded_from_monthly_savings: false,
    transfer_id: null,
    source_planned_transaction_id: null,
  }))
  const client = fakeClient({ tableResults: { finance_savings_transactions: { data: movements, error: null } } })
  const history = await createFinanceApi(household, owner, client).listSavingsTransactions()

  assert.equal(history.length, 501)
  assert.equal(history[0].amount, '-250')
  assert.equal(history[500].amount, '250')
  assert.match(client.calls[0].operations.find(([name]) => name === 'select')[1], /amount::text/)
  assert.ok(client.calls.filter(call => call.table === 'finance_savings_transactions').length > 1)
})

test('account save RPC sends exact opening and target minor units', async () => {
  const client = fakeClient({ rpcResult: { data: { account_id: 'account-new', version: 1 }, error: null } })
  const api = createFinanceApi(household, owner, client)
  await api.saveSavingsAccount({
    request_id: 'account-request',
    name: '  Emergency fund  ',
    account_type: 'goal',
    parent_id: null,
    opening_balance: '125.05',
    target_amount: '500.00',
    color: null,
    visibility: 'private',
    sort_order: 4,
  })

  assert.deepEqual(client.rpcCalls[0], {
    name: 'finance_save_account',
    args: {
      p_household_id: household,
      p_request_id: 'account-request',
      p_account_id: null,
      p_expected_version: null,
      p_name: 'Emergency fund',
      p_account_type: 'goal',
      p_parent_id: null,
      p_opening_balance_minor: '12505',
      p_target_amount_minor: '50000',
      p_color: null,
      p_visibility: 'private',
      p_sort_order: 4,
    },
  })
})

test('account and transaction stale versions surface frontend conflicts', async () => {
  const accountClient = fakeClient({ rpcResult: {
    data: { conflict: true, account_id: 'account-1', current_version: 9 }, error: null,
  } })
  await assert.rejects(createFinanceApi(household, owner, accountClient).saveSavingsAccount({
    request_id: 'account-update', account_id: 'account-1', expected_version: 8,
    name: 'Updated', account_type: 'cash', parent_id: null, opening_balance: null,
    target_amount: null, color: null, visibility: 'household', sort_order: 0,
  }), error => error instanceof FinanceVersionConflictError
    && error.expected_version === 8 && error.current_version === 9)

  const transactionClient = fakeClient({ rpcResult: {
    data: { conflict: true, transaction_id: 'movement-1', current_version: 3 }, error: null,
  } })
  await assert.rejects(createFinanceApi(household, owner, transactionClient).saveSavingsTransaction({
    request_id: 'movement-update', transaction_id: 'movement-1', expected_version: 2,
    account_id: 'account-1', transaction_date: '2026-10-09', amount: '-1.25',
    description: null, budget_month_id: null, excluded_from_monthly_savings: true,
  }), error => error instanceof FinanceVersionConflictError
    && error.expected_version === 2 && error.current_version === 3)
})

test('ordinary transaction writes preserve signed minor units and deletion request identity', async () => {
  const saveClient = fakeClient({ rpcResult: { data: { transaction_id: 'movement-1', version: 1 }, error: null } })
  const api = createFinanceApi(household, owner, saveClient)
  await api.saveSavingsTransaction({
    request_id: 'movement-create', account_id: 'account-1', transaction_date: '2026-10-09',
    amount: '-25.40', description: '  Withdrawal  ', budget_month_id: null,
    excluded_from_monthly_savings: false,
  })
  assert.equal(saveClient.rpcCalls[0].name, 'finance_save_transaction')
  assert.equal(saveClient.rpcCalls[0].args.p_amount_minor, '-2540')
  assert.equal(saveClient.rpcCalls[0].args.p_description, 'Withdrawal')

  const deleteClient = fakeClient({ rpcResult: {
    data: { deleted: true, transaction_id: 'movement-1', account_id: 'account-1' }, error: null,
  } })
  await createFinanceApi(household, owner, deleteClient).deleteSavingsTransaction({
    request_id: 'movement-delete', transaction_id: 'movement-1', expected_version: 5,
  })
  assert.deepEqual(deleteClient.rpcCalls[0], {
    name: 'finance_delete_transaction',
    args: {
      p_household_id: household,
      p_request_id: 'movement-delete',
      p_transaction_id: 'movement-1',
      p_expected_version: 5,
    },
  })
})

test('transfer RPC receives exact minor units and both endpoint versions', async () => {
  const client = fakeClient()
  const api = createFinanceApi(household, owner, client)
  const result = await api.createSavingsTransfer({
    request_id: 'request-1',
    from_account_id: 'source',
    from_expected_version: 4,
    to_account_id: 'target',
    to_expected_version: 7,
    amount: '100.25',
    transaction_date: '2026-10-09',
    description: '  Move money  ',
  })

  assert.deepEqual(result, { transfer_id: 'transfer-1', transaction_ids: ['leg-1', 'leg-2'] })
  assert.deepEqual(client.rpcCalls[0], {
    name: 'finance_transfer_savings',
    args: {
      p_household_id: household,
      p_request_id: 'request-1',
      p_from_account_id: 'source',
      p_from_expected_version: 4,
      p_to_account_id: 'target',
      p_to_expected_version: 7,
      p_amount_minor: '10025',
      p_transaction_date: '2026-10-09',
      p_description: 'Move money',
    },
  })
})

test('stale account and transfer versions surface frontend conflicts', async () => {
  const createClient = fakeClient({ rpcResult: {
    data: { conflict: true, account_id: 'target', current_version: 8 }, error: null,
  } })
  const createApi = createFinanceApi(household, owner, createClient)
  await assert.rejects(createApi.createSavingsTransfer({
    request_id: 'request-2', from_account_id: 'source', from_expected_version: 4,
    to_account_id: 'target', to_expected_version: 7, amount: '1.00',
    transaction_date: '2026-10-09', description: null,
  }), error => error instanceof FinanceVersionConflictError
    && error.expected_version === 7 && error.current_version === 8)

  const deleteClient = fakeClient({ rpcResult: {
    data: { conflict: true, current_version: 3 }, error: null,
  } })
  const deleteApi = createFinanceApi(household, owner, deleteClient)
  await assert.rejects(deleteApi.deleteSavingsTransfer({
    request_id: 'delete-1', transfer_id: 'transfer-1', expected_version: 2,
  }), error => error instanceof FinanceVersionConflictError
    && error.expected_version === 2 && error.current_version === 3)
})

test('delete RPC carries the stable request ID and expected transfer version', async () => {
  const client = fakeClient({ rpcResult: { data: { deleted: true, transfer_id: 'transfer-1' }, error: null } })
  const api = createFinanceApi(household, owner, client)
  await api.deleteSavingsTransfer({ request_id: 'delete-1', transfer_id: 'transfer-1', expected_version: 5 })
  assert.deepEqual(client.rpcCalls[0], {
    name: 'finance_delete_transfer',
    args: {
      p_household_id: household,
      p_request_id: 'delete-1',
      p_transfer_id: 'transfer-1',
      p_expected_version: 5,
    },
  })
})

test('transfer adapter rejects zero amounts before sending an RPC', async () => {
  const client = fakeClient()
  const api = createFinanceApi(household, owner, client)
  await assert.rejects(api.createSavingsTransfer({
    request_id: 'request-zero', from_account_id: 'source', from_expected_version: 1,
    to_account_id: 'target', to_expected_version: 1, amount: '0.00',
    transaction_date: '2026-10-09', description: null,
  }), /greater than zero/)
  assert.equal(client.rpcCalls.length, 0)
})
