import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFinanceApi, FinanceVersionConflictError } from '../src/finance/api.ts'
import { calculateActiveSavingsTreeBalance, calculateIrregularMonthlyReserve, calculateProjectTotals, calculateSavingsAudienceSummary, calculateSavingsPlanAnnualAmount, previewSavingsDraftAcceptance } from '../src/finance/calculations.ts'
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
  insert(values) { this.operations.push(['insert', values]); return this }
  update(values) { this.operations.push(['update', values]); return this }
  delete() { this.operations.push(['delete']); return this }
  single() { this.operations.push(['single']); return this }
  maybeSingle() { this.operations.push(['maybeSingle']); return this }
  eq(column, value) { this.operations.push(['eq', column, value]); return this }
  not(column, operator, value) { this.operations.push(['not', column, operator, value]); return this }
  order(column, options) { this.operations.push(['order', column, options]); return this }
  range(from, to) { this.operations.push(['range', from, to]); return this }
  abortSignal(signal) { this.operations.push(['abortSignal', signal]); return this }

  then(resolve, reject) {
    this.calls.push({ table: this.table, operations: this.operations })
    const range = this.operations.find(([name]) => name === 'range')
    const response = typeof this.result === 'function' ? this.result(this.operations) : this.result
    const result = range && Array.isArray(response.data)
      ? { ...response, data: response.data.slice(range[1], range[2] + 1) }
      : response
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

test('category creation trims the name and binds scope and attribution to the signed-in household member', async () => {
  const category = { id: 'category-1', name: 'Zakupy spożywcze', budget_type: 'variable_expense' }
  const client = fakeClient({ tableResults: { finance_categories: { data: category, error: null } } })
  const result = await createFinanceApi(household, owner, client).createCategory({
    name: '  Zakupy spożywcze  ', section: 'variable_expense', sort_order: 3,
    household_id: 'another-household', created_by: 'another-member', version: 999,
  })
  assert.deepEqual(result, category)
  assert.equal(client.calls[0].table, 'finance_categories')
  assert.deepEqual(client.calls[0].operations.find(([op]) => op === 'insert')[1], {
    household_id: household, created_by: owner, name: 'Zakupy spożywcze', budget_type: 'variable_expense', allocation_role: 'standard', sort_order: 3,
  })
})

test('invalid category names and classifications are rejected before a database write', async () => {
  const client = fakeClient()
  const api = createFinanceApi(household, owner, client)
  await assert.rejects(api.createCategory({ name: '   ', section: 'income', sort_order: 0 }), /Podaj nazwę/)
  await assert.rejects(api.renameCategory({ id: 'category-1', expected_version: 1, name: 'x'.repeat(161) }), /160/)
  await assert.rejects(api.createCategory({ name: 'Zakupy', section: 'unknown', sort_order: 0 }), /sekcję budżetu/)
  assert.equal(client.calls.length, 0)
})

test('individual-account category creation persists the classification without a separate item role choice', async () => {
  const client = fakeClient({ tableResults: { finance_categories: { data: { id: 'personal-category' }, error: null } } })
  await createFinanceApi(household, owner, client).createCategory({ name: 'Patryk — środki osobiste', section: 'personal', sort_order: 0 })
  const values = client.calls[0].operations.find(([op]) => op === 'insert')[1]
  assert.equal(values.budget_type, 'saving')
  assert.equal(values.allocation_role, 'personal_allowance')
})

test('budgets and forecasts save a category and amount with an optional description', async () => {
  for (const [method, table, scope] of [
    ['createBudgetItem', 'finance_budget_items', { month_id: 'month-1' }],
    ['createScenarioItem', 'finance_scenario_items', { scenario_id: 'scenario-1' }],
  ]) {
    const client = fakeClient({ tableResults: { [table]: { data: { id: 'line-1', name: '', amount_minor: '150000' }, error: null } } })
    await createFinanceApi(household, owner, client)[method]({ ...scope, category_id: 'category-1', category_type: 'saving',
      allocation_role: 'personal_allowance', name: '', amount: '1500.00', sort_order: 0 })
    const values = client.calls[0].operations.find(([op]) => op === 'insert')[1]
    assert.equal(values.name, '')
    assert.equal(values.amount, '150000')
    assert.equal(values.category_id, 'category-1')
    assert.equal(values.allocation_role, 'personal_allowance')
  }
})

test('renaming a category preserves its classification and protects household scope and row version', async () => {
  const client = fakeClient({ tableResults: { finance_categories: { data: { id: 'category-1' }, error: null } } })
  await createFinanceApi(household, owner, client).renameCategory({
    id: 'category-1', expected_version: 4, name: '  Jedzenie  ', budget_type: 'income', parent_id: 'other',
  })
  const operations = client.calls[0].operations
  assert.deepEqual(operations.find(([op]) => op === 'update'), ['update', { name: 'Jedzenie' }])
  assert.deepEqual(operations.filter(([op]) => op === 'eq'), [
    ['eq', 'household_id', household], ['eq', 'id', 'category-1'], ['eq', 'version', 4],
  ])
})

test('stale category edits and deletes surface conflicts instead of overwriting another member', async () => {
  for (const operation of ['renameCategory', 'deleteCategory']) {
    const client = fakeClient({ tableResults: { finance_categories: operations => ({
      data: operations.some(([op, columns]) => op === 'select' && columns === 'version') ? { version: 5 } : null,
      error: null,
    }) } })
    await assert.rejects(createFinanceApi(household, owner, client)[operation]({
      id: 'category-1', expected_version: 4, name: 'Jedzenie',
    }), error => error instanceof FinanceVersionConflictError && error.current_version === 5)
    assert.deepEqual(client.calls[0].operations.filter(([op]) => op === 'eq'), [
      ['eq', 'household_id', household], ['eq', 'id', 'category-1'], ['eq', 'version', 4],
    ])
    assert.deepEqual(client.calls[1].operations.filter(([op]) => op === 'eq'), [
      ['eq', 'household_id', household], ['eq', 'id', 'category-1'],
    ])
  }
})

test('removing a referenced category explains the restriction and never removes its budget history', async () => {
  const client = fakeClient({ tableResults: { finance_categories: {
    data: null, error: { code: '23503', message: 'foreign key constraint' },
  } } })
  await assert.rejects(createFinanceApi(household, owner, client).deleteCategory({
    id: 'category-1', expected_version: 4,
  }), /Nie można usunąć kategorii używanej/)
  assert.equal(client.calls.length, 1)
  assert.equal(client.calls[0].table, 'finance_categories')
  assert.ok(client.calls[0].operations.some(([op]) => op === 'delete'))
})

test('active tree balance excludes archived descendants without double counting', () => {
  const root = { id: 'root', opening_balance: '100.00' }
  const child = { id: 'child', parent_id: 'root', opening_balance: '50.00' }
  const archived = { id: 'archive', parent_id: 'root', opening_balance: '1000.00', is_archived: true }
  const hiddenChild = { id: 'hidden', parent_id: 'archive', opening_balance: '900.00' }
  const accounts = [root, child, archived, hiddenChild]
  const movements = [{ account_id: 'root', amount: '-20.00' }, { account_id: 'child', amount: '12.34' }]
  assert.equal(calculateActiveSavingsTreeBalance(root, accounts, movements), '142.34')
  assert.equal(calculateActiveSavingsTreeBalance(child, accounts, movements), '62.34')
  assert.equal(calculateActiveSavingsTreeBalance(hiddenChild, accounts, movements), '0.00')
  assert.equal(calculateActiveSavingsTreeBalance({ ...root, is_archived: true }, [{ ...root, is_archived: true }, child], movements), '0.00')
})

test('lifecycle uses a snapshot token and exact correction amount through a dedicated RPC', async () => {
  const client = fakeClient({ rpcResult: { data: { account_id: 'root', version: 2 }, error: null } })
  const api = createFinanceApi(household, owner, client)
  await api.previewAccountLifecycle('root')
  await api.applyAccountLifecycle({ request_id: 'correction', account_id: 'root', expected_version: 1,
    snapshot_token: 'tree-and-history-hash', action: 'balance', display_balance: '90071992547409.93' })
  assert.deepEqual(client.rpcCalls[0], { name: 'finance_preview_account_lifecycle', args: { p_household_id: household, p_account_id: 'root' } })
  assert.deepEqual(client.rpcCalls[1], { name: 'finance_apply_account_lifecycle', args: {
    p_household_id: household, p_request_id: 'correction', p_account_id: 'root', p_expected_version: 1,
    p_snapshot_token: 'tree-and-history-hash', p_action: 'balance', p_display_balance_minor: '9007199254740993', p_visibility: null,
  } })
})

test('lifecycle conflict survives even when the account version did not change', async () => {
  const client = fakeClient({ rpcResult: { data: { conflict: true, current_version: 1 }, error: null } })
  await assert.rejects(createFinanceApi(household, owner, client).applyAccountLifecycle({
    request_id: 'archive', account_id: 'root', expected_version: 1, snapshot_token: 'stale-history', action: 'archive',
  }), error => error instanceof FinanceVersionConflictError && error.current_version === 1)
})

test('reserve rounding covers the annual amount and plan annual overrides remain exact', () => {
  assert.equal(calculateIrregularMonthlyReserve('10000'), '8.34')
  assert.equal(calculateIrregularMonthlyReserve('1'), '0.01')
  assert.equal(calculateIrregularMonthlyReserve('0'), '0.00')
  assert.equal(calculateIrregularMonthlyReserve('9007199254740993'), '7505999378950.83')
  assert.throws(() => calculateIrregularMonthlyReserve('-1'))
  assert.equal(calculateSavingsPlanAnnualAmount({ monthly_amount: '12345', annual_amount_override: null }), '1481.40')
  assert.equal(calculateSavingsPlanAnnualAmount({ monthly_amount: '12345', annual_amount_override: '150000' }), '1500.00')
})

test('savings summaries keep private audiences isolated, avoid tree double counts, and retain archived history', () => {
  const accounts = [
    { ...account('root'), opening_balance: '10000' },
    { ...account('child', { parent_id: 'root' }), opening_balance: '5000' },
    { ...account('archived', { is_archived: true }), opening_balance: '90000' },
    { ...account('inactive-child', { parent_id: 'archived' }), opening_balance: '10000' },
    { ...account('private', { visibility: 'private' }), opening_balance: '20000' },
    { ...account('other-private', { visibility: 'private', owner_user_id: 'other-member' }), opening_balance: '99999' },
    { ...account('other-household', { household_id: 'outside' }), opening_balance: '88888' },
  ]
  const movement = (account_id, amount, overrides = {}) => ({ id: `movement-${account_id}-${amount}`, household_id: household,
    account_id, amount, transaction_date: '2026-10-11', excluded_from_monthly_savings: false, transfer_id: null, ...overrides })
  const movements = [movement('root', '1000'), movement('child', '-500'), movement('archived', '700'),
    movement('root', '500', { excluded_from_monthly_savings: true }), movement('root', '-200', { transfer_id: 'transfer' }),
    movement('child', '200', { transfer_id: 'transfer' }), movement('private', '333'), movement('other-private', '888'),
    movement('other-household', '999', { household_id: 'outside' }), movement('root', '600', { transaction_date: '2026-09-30' })]
  const viewer = { household_id: household, user_id: owner }
  const shared = calculateSavingsAudienceSummary(accounts, movements, viewer, 'household', '2026-10-01')
  assert.equal(shared.active_balance, '166.00')
  assert.equal(shared.actual_monthly_savings, '17.00')
  assert.deepEqual(shared.history, [{ month_start: '2026-10-01', amount: '17.00' }, { month_start: '2026-09-01', amount: '6.00' }])
  const personal = calculateSavingsAudienceSummary(accounts, movements, viewer, 'private', '2026-10-01')
  assert.equal(personal.active_balance, '203.33')
  assert.equal(personal.actual_monthly_savings, '3.33')
  assert.equal(calculateSavingsAudienceSummary(accounts, movements, { ...viewer, user_id: 'other-member' }, 'private', '2026-10-01').actual_monthly_savings, '8.88')
})

test('project totals preserve signed refunds and absent targets, and cannot include other projects or households', () => {
  const project = { id: 'project', household_id: household, target_budget: '10000' }
  const expenses = [{ project_id: 'project', household_id: household, amount: '12345' },
    { project_id: 'project', household_id: household, amount: '-2345' },
    { project_id: 'other', household_id: household, amount: '99999' },
    { project_id: 'project', household_id: 'outside', amount: '88888' }]
  assert.deepEqual(calculateProjectTotals(project, expenses), { spent: '100.00', target: '100.00', remaining: '0.00' })
  assert.deepEqual(calculateProjectTotals({ ...project, target_budget: null }, expenses), { spent: '100.00', target: null, remaining: null })
  assert.equal(calculateProjectTotals(project, expenses.slice(0, 1)).remaining, '-23.45')
})

test('plan, reserve, project and expense reads retain bigint text and page through all rows', async () => {
  const client = fakeClient({ tableResults: {
    finance_savings_plans: { data: Array.from({ length: 1003 }, (_, i) => ({ id: `plan-${i}`, monthly_amount_minor: '9007199254740993', annual_amount_override_minor: '99999999999999999' })), error: null },
    finance_irregular_expense_plans: { data: [{ annual_amount_minor: '9007199254740993' }], error: null },
    finance_projects: { data: [{ target_budget_minor: null }], error: null },
    finance_project_expenses: { data: [{ amount_minor: '-9007199254740993', expense_date: null }], error: null },
  } })
  const api = createFinanceApi(household, owner, client)
  const plans = await api.listSavingsPlans()
  assert.equal(plans.length, 1003)
  assert.equal(plans[1002].monthly_amount, '9007199254740993')
  assert.equal((await api.listIrregularReserves())[0].annual_amount, '9007199254740993')
  assert.equal((await api.listProjects())[0].target_budget, null)
  assert.equal((await api.listProjectExpenses())[0].amount, '-9007199254740993')
  for (const call of client.calls) {
    assert.ok(call.operations.some(op => op[0] === 'eq' && op[1] === 'household_id' && op[2] === household))
    assert.match(call.operations.find(op => op[0] === 'select')[1], /::text/)
  }
})

test('plan mutation carries explicit links, exact amounts, expected versions and idempotent request IDs', async () => {
  const client = fakeClient({ rpcResult: { data: { plan_id: 'plan', version: 2 }, error: null } })
  const api = createFinanceApi(household, owner, client)
  await api.saveSavingsPlan({ request_id: 'save-plan', id: 'plan', expected_version: 1, name: ' Goal ', plan_type: 'goal', account_id: 'account',
    monthly_amount: '123,45', annual_amount_override: '1500.00', visibility: 'private', sort_order: 4 })
  assert.deepEqual(client.rpcCalls[0], { name: 'finance_mutate_savings_plan', args: {
    p_household_id: household, p_request_id: 'save-plan', p_plan_id: 'plan', p_expected_version: 1, p_delete: false,
    p_details: { name: 'Goal', plan_type: 'goal', account_id: 'account', monthly_amount_minor: '12345', annual_amount_override_minor: '150000', visibility: 'private', sort_order: 4 },
  } })
  await api.deleteSavingsPlan({ request_id: 'delete-plan', id: 'plan', expected_version: 2 })
  assert.equal(client.rpcCalls[1].args.p_delete, true)
  assert.equal(client.rpcCalls[1].args.p_details, null)
  await api.loadSavingsPlans({ request_id: 'load-plans', month_id: 'october' })
  assert.deepEqual(client.rpcCalls[2], { name: 'finance_load_savings_plan', args: { p_household_id: household, p_request_id: 'load-plans', p_month_id: 'october' } })
})

test('shared mutations use narrow RPCs, retain null dates, and send signed expense minor units', async () => {
  const client = fakeClient({ rpcResult: { data: { id: 'record', version: 2 }, error: null } })
  const api = createFinanceApi(household, owner, client)
  await api.saveIrregularReserve({ request_id: 'reserve', name: ' Insurance ', annual_amount: '100.01', sort_order: 0 })
  await api.saveProject({ request_id: 'project', id: 'project', expected_version: 1, name: 'Kitchen', description: null, target_budget: '90071992547409.93', is_archived: true, sort_order: 0 })
  await api.saveProjectExpense({ request_id: 'expense', project_id: 'project', name: 'Refund', amount: '-23.45', expense_date: null, notes: null, sort_order: 0 })
  assert.equal(client.rpcCalls[0].args.p_details.amount_minor, '10001')
  assert.equal(client.rpcCalls[1].args.p_details.target_budget_minor, '9007199254740993')
  assert.equal(client.rpcCalls[1].args.p_details.is_archived, true)
  assert.equal(client.rpcCalls[2].args.p_details.amount_minor, '-2345')
  assert.equal(client.rpcCalls[2].args.p_details.expense_date, null)
  assert.ok(client.rpcCalls.every(call => call.name === 'finance_mutate_shared_record'))
  await api.deleteProjectExpense({ request_id: 'delete-expense', id: 'expense', expected_version: 2 })
  assert.equal(client.rpcCalls[3].args.p_delete, true)
})

test('plan and shared record stale versions surface conflicts', async () => {
  const api = createFinanceApi(household, owner, fakeClient({ rpcResult: { data: { conflict: true, current_version: 7 }, error: null } }))
  await assert.rejects(api.deleteSavingsPlan({ request_id: 'plan', id: 'plan', expected_version: 6 }), FinanceVersionConflictError)
  await assert.rejects(api.deleteProject({ request_id: 'project', id: 'project', expected_version: 6 }), FinanceVersionConflictError)
})

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

test('savings draft reads are month-scoped and cast bigint values to exact minor-unit text', async () => {
  const client = fakeClient({
    tableResults: {
      finance_planned_savings_transactions: {
        data: [{
          id: 'draft-1', household_id: household, created_by: owner,
          created_at: '2026-10-09T12:00:00Z', updated_at: '2026-10-09T12:00:00Z', version: 3,
          month_id: 'month-1', account_id: 'source', amount_minor: '12345',
          description: 'Planned deposit', source_savings_plan_id: null,
        }],
        error: null,
      },
    },
  })

  const drafts = await createFinanceApi(household, owner, client).listSavingsDrafts('month-1')
  assert.deepEqual(drafts, [{
    id: 'draft-1', household_id: household, created_by: owner,
    created_at: '2026-10-09T12:00:00Z', updated_at: '2026-10-09T12:00:00Z', version: 3,
    month_id: 'month-1', account_id: 'source', amount: '12345',
    description: 'Planned deposit', source_savings_plan_id: null,
  }])
  assert.ok(client.calls[0].operations.some(([name, column, value]) => name === 'eq' && column === 'month_id' && value === 'month-1'))
  assert.match(client.calls[0].operations.find(([name]) => name === 'select')[1], /amount::text/)
})

test('savings draft acceptance preview excludes zero, archived, and unavailable accounts', () => {
  const draft = (id, amount, accountId) => ({
    id,
    household_id: household,
    created_by: owner,
    created_at: '2026-10-09T12:00:00Z',
    updated_at: '2026-10-09T12:00:00Z',
    version: 1,
    month_id: 'month-1',
    account_id: accountId,
    amount,
    description: null,
    source_savings_plan_id: null,
  })
  const accounts = [
    { id: 'active', parent_id: null, is_archived: false },
    { id: 'archived-parent', parent_id: null, is_archived: true },
    { id: 'archived-child', parent_id: 'archived-parent', is_archived: false },
  ]

  assert.deepEqual(previewSavingsDraftAcceptance([
    draft('ready', '12500', 'active'),
    draft('zero', '0', 'active'),
    draft('archived', '400', 'archived-child'),
    draft('unavailable', '500', 'private-account'),
  ], accounts).map(item => ({ id: item.draft.id, state: item.state, reasons: item.reasons })), [
    { id: 'ready', state: 'ready', reasons: [] },
    { id: 'zero', state: 'skipped', reasons: ['zero_amount'] },
    { id: 'archived', state: 'skipped', reasons: ['archived_account'] },
    { id: 'unavailable', state: 'skipped', reasons: ['account_inaccessible'] },
  ])
})

test('savings draft acceptance sends the selected month and returns provenance result', async () => {
  const result = {
    month_id: 'month-1',
    month_start: '2026-10-01',
    posted: [{
      draft_id: 'draft-1', transaction_id: 'transaction-1', account_id: 'account-1',
      amount_minor: '12505', description: 'Planned deposit', source_savings_plan_id: 'plan-1',
    }],
    skipped: [{
      draft_id: 'draft-zero', account_id: 'account-1', amount_minor: '0', description: null,
      source_savings_plan_id: null, reasons: ['zero_amount'],
    }],
    posted_count: 1,
    skipped_count: 1,
    inaccessible_draft_policy: 'remain_pending',
  }
  const client = fakeClient({ rpcResult: { data: result, error: null } })
  assert.deepEqual(await createFinanceApi(household, owner, client).acceptSavingsDrafts({
    request_id: 'accept-request', month_id: 'month-1',
  }), result)
  assert.deepEqual(client.rpcCalls[0], {
    name: 'finance_accept_savings_plan',
    args: {
      p_household_id: household,
      p_request_id: 'accept-request',
      p_month_id: 'month-1',
    },
  })
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

test('savings draft writes send exact minor units and stable create, edit, and delete request IDs', async () => {
  const saveClient = fakeClient({ rpcResult: { data: { draft_id: 'draft-1', version: 1 }, error: null } })
  const api = createFinanceApi(household, owner, saveClient)
  await api.saveSavingsDraft({
    request_id: 'draft-create', month_id: 'month-1', account_id: 'account-1',
    amount: '125.05', description: '  Deposit next month  ',
  })
  assert.deepEqual(saveClient.rpcCalls[0], {
    name: 'finance_save_draft',
    args: {
      p_household_id: household,
      p_request_id: 'draft-create',
      p_draft_id: null,
      p_expected_version: null,
      p_month_id: 'month-1',
      p_account_id: 'account-1',
      p_amount_minor: '12505',
      p_description: 'Deposit next month',
      p_source_savings_plan_id: null,
    },
  })

  const updateClient = fakeClient({ rpcResult: { data: { draft_id: 'draft-1', version: 2 }, error: null } })
  await createFinanceApi(household, owner, updateClient).saveSavingsDraft({
    request_id: 'draft-edit', draft_id: 'draft-1', expected_version: 1,
    month_id: 'month-2', account_id: 'account-2', amount: '-2.50',
    description: null, source_savings_plan_id: 'plan-1',
  })
  assert.deepEqual(updateClient.rpcCalls[0].args, {
    p_household_id: household,
    p_request_id: 'draft-edit',
    p_draft_id: 'draft-1',
    p_expected_version: 1,
    p_month_id: 'month-2',
    p_account_id: 'account-2',
    p_amount_minor: '-250',
    p_description: null,
    p_source_savings_plan_id: 'plan-1',
  })

  const deleteClient = fakeClient({ rpcResult: {
    data: { deleted: true, draft_id: 'draft-1', account_id: 'account-1' }, error: null,
  } })
  await createFinanceApi(household, owner, deleteClient).deleteSavingsDraft({
    request_id: 'draft-delete', draft_id: 'draft-1', expected_version: 4,
  })
  assert.deepEqual(deleteClient.rpcCalls[0], {
    name: 'finance_delete_draft',
    args: {
      p_household_id: household,
      p_request_id: 'draft-delete',
      p_draft_id: 'draft-1',
      p_expected_version: 4,
    },
  })
})

test('stale savings draft saves and deletes surface frontend conflicts', async () => {
  const saveClient = fakeClient({ rpcResult: {
    data: { conflict: true, draft_id: 'draft-1', current_version: 5 }, error: null,
  } })
  await assert.rejects(createFinanceApi(household, owner, saveClient).saveSavingsDraft({
    request_id: 'draft-save-stale', draft_id: 'draft-1', expected_version: 4,
    month_id: 'month-1', account_id: 'account-1', amount: '20.00', description: null,
  }), error => error instanceof FinanceVersionConflictError
    && error.expected_version === 4 && error.current_version === 5)

  const deleteClient = fakeClient({ rpcResult: {
    data: { conflict: true, draft_id: 'draft-1', current_version: 5 }, error: null,
  } })
  await assert.rejects(createFinanceApi(household, owner, deleteClient).deleteSavingsDraft({
    request_id: 'draft-delete-stale', draft_id: 'draft-1', expected_version: 4,
  }), error => error instanceof FinanceVersionConflictError
    && error.expected_version === 4 && error.current_version === 5)
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
