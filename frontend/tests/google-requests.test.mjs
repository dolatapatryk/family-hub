import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  GoogleCalendarAccessLost,
  GoogleSyncTokenExpired,
  requestGoogleEventPage,
} from '../../supabase/functions/_shared/google-calendar/google-requests.ts'
import { SyncFailure } from '../../supabase/functions/_shared/google-calendar/google-events.ts'

const request = {
  googleCalendarId: 'calendar@example.com',
  pageToken: null,
  runKind: 'initial',
  syncToken: null,
  initialSyncTimeMin: '2026-10-08T09:30:00.000Z',
}

const success = () => new Response(JSON.stringify({ items: [], nextSyncToken: 'sync-next' }), { status: 200 })
const googleError = (status, reason) => new Response(JSON.stringify({ error: { errors: [{ reason }] } }), { status })
const dependencies = (fetch, options = {}) => ({
  fetch,
  wait: async milliseconds => options.waits.push(milliseconds),
  now: () => options.now ?? Date.parse('2026-10-08T10:00:00Z'),
})

test('Google page retries network and server errors with bounded backoff', async () => {
  const waits = []
  let calls = 0
  const page = await requestGoogleEventPage('access-token', request, dependencies(async () => {
    calls += 1
    if (calls === 1) throw new Error('network reset')
    if (calls === 2) return googleError(503, 'backendError')
    return success()
  }, { waits }))

  assert.equal(page.nextSyncToken, 'sync-next')
  assert.equal(calls, 3)
  assert.deepEqual(waits, [300, 900])
})

test('Google 429 retries honor Retry-After seconds and HTTP dates within the cap', async () => {
  const waits = []
  let calls = 0
  const page = await requestGoogleEventPage('access-token', request, dependencies(async () => {
    calls += 1
    if (calls === 1) return new Response(JSON.stringify({}), { status: 429, headers: { 'retry-after': '1.25' } })
    if (calls === 2) return new Response(JSON.stringify({}), {
      status: 429,
      headers: { 'retry-after': 'Wed, 08 Oct 2026 10:00:05 GMT' },
    })
    return success()
  }, { waits }))

  assert.equal(page.nextSyncToken, 'sync-next')
  assert.deepEqual(waits, [1250, 2500])
})

test('Google request failures stop after three attempts with stable error codes', async () => {
  for (const [status, reason, expectedCode] of [
    [429, 'rateLimitExceeded', 'rate_limited'],
    [408, 'timeout', 'network_error'],
    [503, 'backendError', 'google_error'],
  ]) {
    const waits = []
    let calls = 0
    await assert.rejects(requestGoogleEventPage('access-token', request, dependencies(async () => {
      calls += 1
      return googleError(status, reason)
    }, { waits })), error => {
      assert.ok(error instanceof SyncFailure)
      assert.equal(error.code, expectedCode)
      return true
    })
    assert.equal(calls, 3)
    assert.deepEqual(waits, [300, 900])
  }
})

test('expired sync tokens, lost calendars, and expired authorization are classified without retries', async () => {
  const cases = [
    [new Response('', { status: 410 }), GoogleSyncTokenExpired],
    [new Response('', { status: 401 }), SyncFailure],
    [new Response('', { status: 404 }), GoogleCalendarAccessLost],
    [googleError(403, 'calendarNotFound'), GoogleCalendarAccessLost],
  ]

  for (const [response, errorType] of cases) {
    let calls = 0
    await assert.rejects(requestGoogleEventPage('access-token', request, dependencies(async () => {
      calls += 1
      return response
    }, { waits: [] })), error => {
      assert.ok(error instanceof errorType)
      if (error instanceof SyncFailure) assert.equal(error.code, 'reconnect_required')
      return true
    })
    assert.equal(calls, 1)
  }
})

test('malformed successful Google responses fail closed without retrying', async () => {
  let calls = 0
  await assert.rejects(requestGoogleEventPage('access-token', request, dependencies(async () => {
    calls += 1
    return new Response('{bad json', { status: 200 })
  }, { waits: [] })), error => {
    assert.ok(error instanceof SyncFailure)
    assert.equal(error.code, 'invalid_response')
    return true
  })
  assert.equal(calls, 1)
})
