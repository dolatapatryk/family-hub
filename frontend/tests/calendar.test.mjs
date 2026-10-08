import { test } from 'node:test'
import assert from 'node:assert/strict'
import { annualOccurrences } from '../src/annualDates/annualDates.ts'
import { addDays, eventOverlaps, validDate, zonedInstant } from '../src/calendar/dates.ts'
import { buildAgenda } from '../src/calendar/agenda.ts'

const item = (id, overrides = {}) => ({
  id,
  title: id,
  description: null,
  createdBy: 'member-1',
  visibility: 'household',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
})

test('annual birthdays skip their initial year and calculate later counts', () => {
  const birthday = item('birthday-1', { kind: 'birthday', initialDate: '2010-06-12', title: 'Patryk' })
  const occurrences = annualOccurrences([birthday], { start: '2010-01-01', end: '2013-01-01' })

  assert.deepEqual(occurrences.map(({ date, count, title }) => ({ date, count, title })), [
    { date: '2011-06-12', count: 1, title: 'Patryk · 1. urodziny' },
    { date: '2012-06-12', count: 2, title: 'Patryk · 2. urodziny' },
  ])
})

test('February 29 annual dates use February 28 in non-leap years and respect exclusive ranges', () => {
  const birthday = item('leap-birthday', { kind: 'birthday', initialDate: '2000-02-29', title: 'Ada' })
  const nameday = item('leap-other', { kind: 'other', month: 2, day: 29, title: 'Imieniny' })
  const occurrences = annualOccurrences([birthday, nameday], { start: '2001-02-28', end: '2004-03-01' })

  assert.deepEqual(occurrences.map(({ id, date, count }) => ({ id, date, count })), [
    { id: 'leap-birthday:2001-02-28', date: '2001-02-28', count: 1 },
    { id: 'leap-other:2001-02-28', date: '2001-02-28', count: null },
    { id: 'leap-birthday:2002-02-28', date: '2002-02-28', count: 2 },
    { id: 'leap-other:2002-02-28', date: '2002-02-28', count: null },
    { id: 'leap-birthday:2003-02-28', date: '2003-02-28', count: 3 },
    { id: 'leap-other:2003-02-28', date: '2003-02-28', count: null },
    { id: 'leap-birthday:2004-02-29', date: '2004-02-29', count: 4 },
    { id: 'leap-other:2004-02-29', date: '2004-02-29', count: null },
  ])
})

test('annual occurrences sort deterministically on the same day', () => {
  const definitions = [
    item('later', { kind: 'other', month: 10, day: 5, createdAt: '2026-01-02T00:00:00Z' }),
    item('earlier', { kind: 'other', month: 10, day: 5, createdAt: '2026-01-01T00:00:00Z' }),
  ]
  const occurrences = annualOccurrences(definitions, { start: '2026-10-05', end: '2026-10-06' })
  assert.deepEqual(occurrences.map(occurrence => occurrence.id), ['earlier:2026-10-05', 'later:2026-10-05'])
  assert.equal(annualOccurrences(definitions, { start: '2026-10-05', end: '2026-10-05' }).length, 0)
})

test('date arithmetic handles leap days and validates Gregorian leap years', () => {
  assert.equal(addDays('2024-02-28', 1), '2024-02-29')
  assert.equal(addDays('2024-03-01', -1), '2024-02-29')
  assert.equal(addDays('2023-12-31', 1), '2024-01-01')
  assert.equal(validDate('2000-02-29'), true)
  assert.equal(validDate('1900-02-29'), false)
  assert.equal(validDate('2026-04-31'), false)
})

test('calendar event ranges are half-open for all-day and timed events', () => {
  const previousTz = process.env.TZ
  process.env.TZ = 'UTC'
  try {
    const range = { start: '2026-10-10', end: '2026-10-11' }
    assert.equal(eventOverlaps({ allDay: true, startDate: '2026-10-09', endDate: '2026-10-10' }, range), false)
    assert.equal(eventOverlaps({ allDay: true, startDate: '2026-10-10', endDate: '2026-10-11' }, range), true)
    assert.equal(eventOverlaps({ allDay: false, startsAt: '2026-10-11T00:00:00Z', endsAt: '2026-10-11T01:00:00Z', timeZone: 'UTC' }, range), false)
    assert.equal(eventOverlaps({ allDay: false, startsAt: '2026-10-10T23:30:00Z', endsAt: '2026-10-11T00:30:00Z', timeZone: 'UTC' }, range), true)
  } finally {
    if (previousTz === undefined) delete process.env.TZ
    else process.env.TZ = previousTz
  }
})

test('zoned event input rejects DST gaps and repeated wall-clock times', () => {
  assert.equal(zonedInstant('2026-03-08T03:30', 'America/New_York'), '2026-03-08T07:30:00.000Z')
  assert.throws(() => zonedInstant('2026-03-08T02:30', 'America/New_York'), /godzina nie istnieje/)
  assert.throws(() => zonedInstant('2026-11-01T01:30', 'America/New_York'), /występuje dwukrotnie/)
})

test('agenda merges sources, expands multi-day events and excludes completed tasks', () => {
  const previousTz = process.env.TZ
  process.env.TZ = 'UTC'
  try {
    const nativeEvent = item('native', {
      title: 'Wyjazd', allDay: true, startDate: '2026-10-10', endDate: '2026-10-12',
    })
    const importedEvent = {
      id: 'google-1', title: 'Spotkanie', description: null, location: null, htmlLink: null,
      googleUpdatedAt: null, importedAt: '2026-09-01T00:00:00Z', allDay: false,
      startsAt: '2026-10-10T09:00:00Z', endsAt: '2026-10-10T10:00:00Z', timeZone: 'UTC',
    }
    const annual = item('annual', { kind: 'other', month: 10, day: 11, title: 'Imieniny', createdAt: '2026-02-01T00:00:00Z' })
    const tasks = [
      { id: 'task-open', title: 'Odebrać paczkę', dueDate: '2026-10-11', completed: false, assignedTo: null, createdAt: '2026-10-01T00:00:00Z' },
      { id: 'task-done', title: 'Gotowe', dueDate: '2026-10-11', completed: true, assignedTo: null, createdAt: '2026-10-01T00:00:00Z' },
    ]

    const entries = buildAgenda([nativeEvent], [importedEvent], [annual], tasks, { start: '2026-10-10', end: '2026-10-12' })

    assert.deepEqual(entries.map(entry => [entry.date, entry.source.kind, entry.id]), [
      ['2026-10-10', 'event', 'event:native:2026-10-10'],
      ['2026-10-10', 'google', 'google:google-1:2026-10-10'],
      ['2026-10-11', 'event', 'event:native:2026-10-11'],
      ['2026-10-11', 'annual', 'annual:annual:2026-10-11'],
      ['2026-10-11', 'task', 'task:task-open'],
    ])
  } finally {
    if (previousTz === undefined) delete process.env.TZ
    else process.env.TZ = previousTz
  }
})
