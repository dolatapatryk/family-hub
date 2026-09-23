import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupTasks, localDate, formatDueDate } from '../src/tasks/tasks.ts'
import { createTasksApi } from '../src/tasks/api.ts'

const task = (id, overrides = {}) => ({ id, title: id, dueDate: null, completed: false, assignedTo: null, createdAt: '2026-09-01T12:00:00Z', ...overrides })

test('groups all active tasks without dropping overdue or undated completed tasks', () => {
  const groups = groupTasks([
    task('shared'), task('today', { dueDate: '2026-09-19' }),
    task('later', { dueDate: '2026-09-22' }), task('tomorrow', { dueDate: '2026-09-20' }),
    task('overdue', { dueDate: '2026-09-18' }), task('done', { completed: true }),
  ], '2026-09-19')
  assert.deepEqual(Object.fromEntries(Object.entries(groups).map(([key, tasks]) => [key, tasks.map(t => t.id)])), {
    Overdue: ['overdue'], Today: ['today'], Upcoming: ['tomorrow', 'later'], 'No due date': ['shared'], Completed: ['done'],
  })
})

test('date-only values use local dates near midnight', () => {
  const previous = process.env.TZ
  try {
    process.env.TZ = 'America/Los_Angeles'
    assert.equal(localDate(new Date('2026-09-20T01:00:00Z')), '2026-09-19')
    assert.equal(formatDueDate('2026-09-19'), new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(2026, 8, 19)))
  } finally {
    if (previous === undefined) delete process.env.TZ
    else process.env.TZ = previous
  }
})

const row = (id = 'task-1', overrides = {}) => ({
  id,
  title: 'Call doctor',
  due_date: '2026-09-20',
  completed: false,
  assigned_to: 'member-2',
  created_at: '2026-09-01T12:00:00Z',
  ...overrides,
})

class QueryBuilder {
  constructor(calls, result) {
    this.calls = calls
    this.result = result
    this.operations = []
  }

  select(columns) { this.operations.push(['select', columns]); return this }
  insert(values) { this.operations.push(['insert', values]); return this }
  update(values) { this.operations.push(['update', values]); return this }
  eq(column, value) { this.operations.push(['eq', column, value]); return this }
  is(column, value) { this.operations.push(['is', column, value]); return this }
  order(column, options) { this.operations.push(['order', column, options]); return this }
  abortSignal(signal) { this.operations.push(['abortSignal', signal]); return this }
  single() { this.operations.push(['single']); return this }

  then(resolve, reject) {
    this.calls.push(this.operations)
    return Promise.resolve(this.result).then(resolve, reject)
  }
}

function fakeClient(result = { data: row(), error: null }) {
  const calls = []
  return {
    calls,
    from: () => new QueryBuilder(calls, result),
  }
}

test('Supabase adapter scopes, maps, and writes task rows', async () => {
  const client = fakeClient({ data: [row()], error: null })
  const api = createTasksApi('household-1', 'member-1', client)
  const controller = new AbortController()

  const listed = await api.list(controller.signal)
  assert.deepEqual(listed, [task('task-1', {
    title: 'Call doctor', dueDate: '2026-09-20', assignedTo: 'member-2',
  })])
  assert.equal(client.calls[0].find(operation => operation[0] === 'abortSignal')[1], controller.signal)
  assert.ok(client.calls[0].some(operation => operation[0] === 'is' && operation[1] === 'archived_at' && operation[2] === null))
  assert.ok(client.calls[0].some(operation => operation[0] === 'eq' && operation[1] === 'household_id' && operation[2] === 'household-1'))

  const createClient = fakeClient({ data: row('created'), error: null })
  const createApi = createTasksApi('household-1', 'member-1', createClient)
  await createApi.create({ title: '  Call doctor  ', dueDate: null, assignedTo: 'member-2' })
  const createOperations = createClient.calls[0]
  assert.deepEqual(createOperations.find(operation => operation[0] === 'insert')[1], {
    household_id: 'household-1', title: '  Call doctor  ', due_date: null, assigned_to: 'member-2', created_by: 'member-1',
  })

  const updateClient = fakeClient({ data: row('updated'), error: null })
  const updateApi = createTasksApi('household-1', 'member-1', updateClient)
  await updateApi.setCompleted('task-1', true)
  await updateApi.archive('task-1')
  const updates = updateClient.calls.map(operations => operations.find(operation => operation[0] === 'update')[1])
  assert.deepEqual(updates[0], { completed: true })
  assert.equal(updates.length, 2)
  assert.equal(typeof updates[1].archived_at, 'string')
  assert.ok(updateClient.calls.every(operations => operations.some(operation => operation[0] === 'eq' && operation[1] === 'household_id' && operation[2] === 'household-1')))
})

test('Supabase adapter preserves aborts and surfaces database and connection errors', async () => {
  const abortError = Object.assign(new Error('The request was aborted'), { name: 'AbortError' })
  const abortClient = fakeClient()
  abortClient.from = () => { throw abortError }
  await assert.rejects(createTasksApi('household', 'user', abortClient).list(), error => error === abortError)

  const databaseClient = fakeClient({ data: null, error: { message: 'Task is archived' } })
  await assert.rejects(createTasksApi('household', 'user', databaseClient).setCompleted('id', true), /Task is archived/)

  const connectionClient = fakeClient()
  connectionClient.from = () => { throw new TypeError('Failed to fetch') }
  await assert.rejects(createTasksApi('household', 'user', connectionClient).list(), /Check your connection/)
})
