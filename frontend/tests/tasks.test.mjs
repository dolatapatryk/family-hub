import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { groupTasks, localDate, formatDueDate } from '../src/tasks/tasks.ts'
import { createTasksApi } from '../src/tasks/api.ts'

const task = (id, overrides = {}) => ({ id, title: id, dueDate: null, completed: false, assignedTo: null, createdBy: 'user', createdAt: '2026-09-01T12:00:00Z', archivedAt: null, ...overrides })

test('groups all active tasks without dropping overdue or undated completed tasks', () => {
  const groups = groupTasks([
    task('shared'), task('today', { dueDate: '2026-09-19' }),
    task('later', { dueDate: '2026-09-22' }), task('tomorrow', { dueDate: '2026-09-20' }),
    task('overdue', { dueDate: '2026-09-18' }), task('done', { completed: true }),
    task('archived', { archivedAt: '2026-09-19T10:00:00Z' }),
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

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

test('API sends identification and separate create, assign, complete, reopen and archive requests', async () => {
  const calls = []
  globalThis.fetch = async (url, options) => { calls.push({ url, ...options }); return Response.json(task('new')) }
  const api = createTasksApi('/api/', 'user-1')
  const controller = new AbortController()
  await api.list(controller.signal)
  await api.create({ title: 'Call doctor', dueDate: null })
  await api.assign('new', 'user-2')
  for (const action of ['complete', 'reopen', 'archive']) await api.action('new', action)
  assert.deepEqual(calls.map(call => call.url), ['/api/tasks', '/api/tasks', '/api/tasks/new/assign', '/api/tasks/new/complete', '/api/tasks/new/reopen', '/api/tasks/new/archive'])
  assert.ok(calls.every(call => call.headers['X-User-Id'] === 'user-1'))
  assert.equal(calls[0].signal, controller.signal)
  assert.ok(calls.slice(1).every(call => call.method === 'POST'))
  assert.deepEqual(JSON.parse(calls[1].body), { title: 'Call doctor', dueDate: null })
  assert.deepEqual(JSON.parse(calls[2].body), { assignedTo: 'user-2' })
})

test('API surfaces backend, proxy and connection errors', async () => {
  const api = createTasksApi('/api', 'user')
  globalThis.fetch = async () => Response.json({ error: 'Task is archived' }, { status: 409 })
  await assert.rejects(api.action('id', 'complete'), /Task is archived/)
  globalThis.fetch = async () => new Response('Bad gateway', { status: 502 })
  await assert.rejects(api.list(), /502/)
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch') }
  await assert.rejects(api.list(), /Check your connection/)
})
