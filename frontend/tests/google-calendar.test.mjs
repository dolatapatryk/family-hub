import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildGoogleEventsListUrl,
  normalizeGoogleEvent,
  normalizeGoogleEventItems,
  parseGoogleEventPage,
  SyncFailure,
} from '../../supabase/functions/_shared/google-calendar/google-events.ts'

const request = overrides => ({
  googleCalendarId: 'primary@example.com',
  pageToken: null,
  runKind: 'initial',
  syncToken: null,
  initialSyncTimeMin: '2026-10-08T09:30:00.000Z',
  ...overrides,
})

test('initial and rebuild Google requests use a timeMin cutoff without a timeMax', () => {
  for (const runKind of ['initial', 'rebuild']) {
    const url = buildGoogleEventsListUrl(request({ runKind }))
    assert.equal(url.searchParams.get('timeMin'), '2026-10-08T09:30:00.000Z')
    assert.equal(url.searchParams.has('timeMax'), false)
    assert.equal(url.searchParams.has('syncToken'), false)
    assert.equal(url.searchParams.get('singleEvents'), 'false')
    assert.equal(url.searchParams.get('showDeleted'), 'true')
    assert.equal(url.searchParams.get('maxResults'), '250')
    assert.equal(url.pathname.includes('primary%40example.com'), true)
  }
})

test('incremental Google requests use the saved sync token without date filters', () => {
  const url = buildGoogleEventsListUrl(request({
    runKind: 'incremental',
    syncToken: 'opaque-next-sync-token',
    initialSyncTimeMin: null,
    pageToken: 'opaque-page-token',
  }))
  assert.equal(url.searchParams.get('syncToken'), 'opaque-next-sync-token')
  assert.equal(url.searchParams.get('pageToken'), 'opaque-page-token')
  assert.equal(url.searchParams.has('timeMin'), false)
  assert.equal(url.searchParams.has('timeMax'), false)
  assert.equal(url.searchParams.has('orderBy'), false)
})

test('Google request construction rejects missing run checkpoints', () => {
  assert.throws(() => buildGoogleEventsListUrl(request({ initialSyncTimeMin: null })), error => {
    assert.ok(error instanceof SyncFailure)
    assert.equal(error.code, 'invalid_response')
    return true
  })
  assert.throws(() => buildGoogleEventsListUrl(request({ runKind: 'incremental', syncToken: null })), error => {
    assert.ok(error instanceof SyncFailure)
    assert.equal(error.code, 'invalid_response')
    return true
  })
})

test('Google pages require exactly one continuation or final sync token', () => {
  assert.deepEqual(parseGoogleEventPage({ items: [{ id: 'event-1' }], nextPageToken: 'page-2' }), {
    items: [{ id: 'event-1' }], nextPageToken: 'page-2',
  })
  assert.deepEqual(parseGoogleEventPage({ items: [], nextSyncToken: 'sync-final' }), {
    items: [], nextSyncToken: 'sync-final',
  })
  for (const invalid of [
    {},
    { items: 'not-an-array', nextSyncToken: 'sync' },
    { items: [], nextPageToken: 'page', nextSyncToken: 'sync' },
    { items: [], nextPageToken: 42 },
    null,
    [],
  ]) {
    assert.throws(() => parseGoogleEventPage(invalid), error => {
      assert.ok(error instanceof SyncFailure)
      assert.equal(error.code, 'invalid_response')
      return true
    })
  }
})

test('all-day Google events preserve date-only exclusive ends and sanitize details', () => {
  const event = normalizeGoogleEvent({
    id: '  event-1  ',
    summary: '  Wakacje  ',
    description: '  Rezerwacja  ',
    location: '  Gdańsk  ',
    htmlLink: 'https://calendar.google.com/calendar/event?eid=1',
    updated: '2026-10-01T12:30:00Z',
    start: { date: '2026-10-10' },
    end: { date: '2026-10-12' },
  }, { timeZone: 'Europe/Warsaw' })

  assert.deepEqual(event, {
    google_event_id: 'event-1',
    title: 'Wakacje',
    description: 'Rezerwacja',
    location: 'Gdańsk',
    html_link: 'https://calendar.google.com/calendar/event?eid=1',
    all_day: true,
    starts_at: null,
    ends_at: null,
    time_zone: null,
    start_date: '2026-10-10',
    end_date: '2026-10-12',
    google_updated_at: '2026-10-01T12:30:00.000Z',
  })
})

test('timed Google events normalize instants and use the calendar time zone', () => {
  const withOffset = normalizeGoogleEvent({
    id: 'timed-1',
    start: { dateTime: '2026-10-10T11:00:00+02:00', timeZone: 'Europe/Warsaw' },
    end: { dateTime: '2026-10-10T12:00:00+02:00', timeZone: 'Europe/Warsaw' },
  }, { timeZone: 'UTC' })
  assert.equal(withOffset.starts_at, '2026-10-10T09:00:00.000Z')
  assert.equal(withOffset.ends_at, '2026-10-10T10:00:00.000Z')
  assert.equal(withOffset.time_zone, 'Europe/Warsaw')
  assert.equal(withOffset.title, 'Wydarzenie bez tytułu')

  const localWallTime = normalizeGoogleEvent({
    id: 'timed-2',
    start: { dateTime: '2026-10-10T11:00:00' },
    end: { dateTime: '2026-10-10T12:00:00' },
  }, { timeZone: 'Europe/Warsaw' })
  assert.equal(localWallTime.starts_at, '2026-10-10T09:00:00.000Z')
  assert.equal(localWallTime.time_zone, 'Europe/Warsaw')
})

test('Google event normalization rejects invalid schedules and ambiguous wall times', () => {
  const invalidEvents = [
    { id: 'bad-date', start: { date: '2026-02-29' }, end: { date: '2026-03-01' } },
    { id: 'empty-range', start: { date: '2026-10-10' }, end: { date: '2026-10-10' } },
    { id: 'reverse-time', start: { dateTime: '2026-10-10T10:00:00Z' }, end: { dateTime: '2026-10-10T09:00:00Z' } },
    { id: 'dst-gap', start: { dateTime: '2026-03-08T02:30:00', timeZone: 'America/New_York' }, end: { dateTime: '2026-03-08T03:30:00', timeZone: 'America/New_York' } },
    { id: 'dst-repeat', start: { dateTime: '2026-11-01T01:30:00', timeZone: 'America/New_York' }, end: { dateTime: '2026-11-01T02:30:00', timeZone: 'America/New_York' } },
    { id: 'missing-schedule' },
  ]
  for (const event of invalidEvents) {
    assert.throws(() => normalizeGoogleEvent(event, { timeZone: 'UTC' }), error => {
      assert.ok(error instanceof SyncFailure)
      assert.equal(error.code, 'invalid_response')
      return true
    }, event.id)
  }
})

test('page normalization removes cancellations and recurring records before scheduling checks', () => {
  const result = normalizeGoogleEventItems([
    { id: ' canceled-1 ', status: 'cancelled' },
    { id: 'series-1', recurrence: ['RRULE:FREQ=DAILY'], start: { date: '2026-10-10' }, end: { date: '2026-10-11' } },
    { id: 'instance-1', recurringEventId: 'series-1', start: { date: '2026-10-10' }, end: { date: '2026-10-11' } },
    { id: 'single-1', start: { date: '2026-10-10' }, end: { date: '2026-10-11' } },
  ], { timeZone: 'UTC' })

  assert.deepEqual(result.events.map(event => event.google_event_id), ['single-1'])
  assert.deepEqual(result.removedEventIds, ['canceled-1', 'series-1', 'instance-1'])
})

test('Google links are restricted to Google Calendar and invalid response items fail closed', () => {
  const event = normalizeGoogleEvent({
    id: 'link-1',
    htmlLink: 'https://example.com/fake-google-event',
    start: { date: '2026-10-10' },
    end: { date: '2026-10-11' },
  }, { timeZone: null })
  assert.equal(event.html_link, null)
  assert.throws(() => normalizeGoogleEventItems([null], { timeZone: 'UTC' }), error => {
    assert.ok(error instanceof SyncFailure)
    assert.equal(error.code, 'invalid_response')
    return true
  })
  assert.throws(() => normalizeGoogleEventItems([{ status: 'cancelled' }], { timeZone: 'UTC' }), error => {
    assert.ok(error instanceof SyncFailure)
    assert.equal(error.code, 'invalid_response')
    return true
  })
})
