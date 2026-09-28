# Family Hub — Implementation Plan

## Product direction

Family Hub is a small family PWA for two or more household members. It brings
shared tasks, shopping, a calendar agenda, and a Today view into one
responsive interface.

Supabase is the source of truth for data created in Family Hub:

- Supabase Auth identifies the current user.
- Postgres stores household data, including first-party calendar events.
- Row Level Security (RLS) is the household-isolation boundary.
- The browser uses the Supabase client and publishable key.
- Edge Functions handle integrations that need server-side credentials, such
  as importing Google Calendar events.

Tasks remain in the existing `tasks` table. First-party events, birthdays, and
anniversaries are stored in Supabase. Google Calendar is an optional read-only
source: selected Google events are copied into a normalized Supabase mirror so
other household members can see them without connecting Google themselves.
Google remains authoritative for those imported events; Family Hub never
writes changes back to Google.

The application has no custom Kotlin/Ktor API or local SQLite runtime. The
frontend is the primary application layer and owns presentation, input
handling, query caching, and mapping database rows into frontend models.

## Current architecture

    React / TypeScript / Vite
      AuthGate
      React Query
      Tasks
      Shopping
      Today, Calendar, and annual dates
            |
            | Supabase JS + authenticated session
            v
    Supabase Auth / Postgres REST / RLS
      first-party events and imported Google event mirror
            |
            +-- Edge Functions for Google OAuth and read-only sync

Do not add another application backend just to wrap a Supabase query. Never
put service-role keys, database credentials, Google client secrets, or refresh
tokens in `VITE_*` variables or browser code. Google OAuth tokens and sync
state must stay in server-controlled storage.

## Calendar provider decision

### Google Calendar: optional read-only import

- A household member may connect their own Google account and choose which
  calendars Family Hub imports.
- The connecting member owns the connection. Other household members do not
  need Google accounts or OAuth connections to see events that the owner has
  chosen to share with the household.
- Google events are stored as read-only imported rows in Supabase. The import
  records their Google calendar and event IDs so later syncs update or remove
  the corresponding mirror rows instead of creating duplicates.
- The owner controls whether each imported calendar is private or shared with
  the household. Private is the default. An event-level exclusion should be
  available for sensitive events in a shared source calendar.
- Imported event content can include reservation details or other personal
  information. Make the sharing choice clear before importing or sharing a
  calendar. RLS must enforce the choice; hiding an event in the UI is not an
  access-control boundary.
- Google synchronization is read-only. Users edit or delete imported events
  in Google Calendar; Family Hub refreshes the mirrored copy on the next sync.
- Use the narrowest Google OAuth scopes that support the selected-calendar
  picker and event reads. Likely scopes are `calendar.events.readonly` and,
  only if needed for calendar selection, `calendar.calendarlist.readonly`.
  Confirm Google OAuth verification requirements before production release.
- For each connected account and selected Google calendar, keep an independent
  sync token and sync state. Run one paginated initial full sync, then use the
  returned `nextSyncToken` for incremental syncs of that same calendar.
- Keep the list-request parameters consistent across syncs. Process every
  page, apply inserts/updates and Google cancellation/deletion records
  idempotently, and persist the new `nextSyncToken` only after all pages have
  been applied successfully. Filter the date range in Supabase rather than
  adding `timeMin` or `timeMax` to incremental sync requests.
- If Google returns `410 Gone` for an expired or invalid token, discard that
  calendar's sync state and run a fresh full sync. Do not reset sync state for
  other calendars connected to the same account.
- On disconnect, stop future syncs, delete/revoke the stored credentials, and
  remove that connection's imported mirror rows. Do not delete the original
  Google events.

Google documents the read-only event scopes and incremental sync flow in its
[Calendar API authorization guide](https://developers.google.com/workspace/calendar/api/auth)
and [synchronization guide](https://developers.google.com/workspace/calendar/api/guides/sync).

## Current status

### Complete

- React, TypeScript, Vite, React Router, and TanStack Query setup.
- Responsive application shell and navigation.
- Supabase email/password sign-up, sign-in, persistent sessions, and sign-out.
- Authenticated application gate and first-user household onboarding.
- Household-scoped RLS for households, profiles, shopping items, and tasks.
- Shopping item creation, completion, reopening, and household member updates.
- Task creation, assignment at creation time, completion, reopening, and
  archiving.
- Household member lookup for task assignment labels.
- Database-side text normalization and write invariants.
- Frontend adapter tests and production build checks.
- Installable PWA manifest, application icons, and static shell caching.
- Mobile touch targets and safe-area spacing; static Nginx deployment guidance.
- Native calendar and annual-date implementation: schema migration, scoped
  adapters, separate forms, 14-day agenda, and generated annual occurrences in
  Calendar and Today. Migration application and runtime verification are pending.

### Current product gap

- The safe household invite and join flow is implemented; two-user Supabase
  verification is still pending.
- Native Calendar and Today data integration are implemented; frontend and
  database verification are still pending.
- Google Calendar import is not implemented.
- RLS and migration behavior still need a repeatable two-user integration
  verification pass.

## MVP scope

The MVP includes:

1. Supabase Auth sign-up, sign-in, session persistence, and sign-out.
2. Household creation and a safe way for another authenticated user to join.
3. Household-scoped Tasks stored in Supabase.
4. Household-scoped Shopping stored in Supabase.
5. First-party household and private one-off calendar events stored in
   Supabase.
6. A separate `Ważne daty` tab for annual birthdays, anniversaries, and other
   recurring dates, with its own form and Supabase table.
7. Optional read-only Google Calendar import. A connected member can share
   selected imported events with the household; other members do not need to
   connect Google.
8. A Today view with today's tasks and visible calendar events.
9. A responsive, installable PWA.

Deliver the native Supabase calendar before the Google importer. The app must
remain useful when no household member connects Google.

Do not add yet:

- projects, tags, subtasks, priorities, comments, or audit-history screens;
- recurring tasks;
- push notifications;
- offline mutation queues or conflict resolution;
- advanced roles and permission management;
- a replacement custom REST API.

## Supabase data model

The current schema is recorded in `supabase/migrations`. Household-owned
application rows include `household_id` and are protected by RLS.

### households

- id: UUID primary key
- name: non-blank text
- created_at: timestamp

### profiles

- id: Supabase Auth user ID
- household_id: owning household
- name: non-blank display name
- created_at: timestamp

A profile belongs to one household in the MVP.

### shopping_items

- id, household_id, name, quantity, store, completed
- added_by: authenticated creator
- created_at

Names and optional text are normalized in the database. Empty optional text
becomes NULL.

### tasks

- id, household_id, title, due_date, completed
- assigned_to: nullable profile from the same household
- created_by: authenticated creator
- created_at, archived_at

Task `due_date` is a date-only value. Tasks remain separate from calendar
events and may appear in calendar/Today views by due date. Archived tasks
remain readable in the database but cannot be changed through the browser.
The normal frontend query loads active tasks only.

### calendar_events

First-party, normal one-off events created and managed in the Calendar tab:

- id, household_id, title, description
- created_by: authenticated creator
- visibility: `household` or `private`
- `all_day`: chooses the event's schedule shape
- timed `starts_at`/`ends_at` timestamps and `time_zone`, or date-only
  `start_date`/`end_date`; end values are exclusive
- created_at, updated_at; deletion removes the row

This table contains only normal one-off events. Its create/edit form does not
offer birthdays, anniversaries, or annual recurrence. Household events can be
read by household members; private events can be read only by their creator.
Do not parse all-day dates as UTC timestamps.

### annual_dates

Annual birthdays, anniversaries, and other recurring dates, managed only from
the separate `Ważne daty` tab:

- id, household_id, title, description
- created_by: authenticated creator
- visibility: `household` or `private`
- kind: `birthday`, `anniversary`, or `other`
- birthday/anniversary `initial_date DATE`, including year
- `other` month and day, with no year and no placeholder date
- created_at, updated_at; deletion removes the definition

Birthdays and anniversaries require the full initial date. `Other` (for
example, namedays) requires only month and day. Household annual dates can be
read by household members; private ones can be read only by their creator.

### Annual occurrence generation and display

Store one definition per annual date, not a new database row for every year.
For the visible calendar date range, expand `annual_dates` definitions into
in-memory occurrences. A shared recurrence helper supplies occurrences to the
Calendar page, Today view, and `Ważne daty` page.

- For a birthday or anniversary, the occurrence year minus the initial year
  gives the number being celebrated. Do not create an occurrence in the
  initial year; the first is one year later.
- Display birthdays as the event title plus the calculated `N. urodziny` and
  anniversaries as the title plus `N. rocznica`.
- Display `other` as an ordinary all-day item with its title and no calculated
  number (for example, “Imieniny Patryka”).
- The `Ważne daty` form uses a full date, including year, for birthdays and
  anniversaries. For `Inne`, use a month/day picker that has no year field.
- `Ważne daty` is where users create, edit, and delete annual-date definitions.
  Calendar and Today show generated annual occurrences as read-only items;
  they cannot be created or edited from the Calendar form.
- The Calendar form creates only normal one-off events.
- Opening a generated occurrence shows its kind and, for birthdays or
  anniversaries, its initial date and calculated count.
- For 29 February, use 28 February in non-leap years unless product direction
  changes this rule.

### Google connection metadata and imported event mirror

Keep OAuth connections, refresh tokens, selected calendar IDs, sharing
preferences, and sync tokens in server-controlled storage outside the browser
API. Keep credentials in a private schema or another encrypted
server-controlled store; never expose them through PostgREST.

Store only normalized fields needed by Family Hub for imported Google events.
This is a persistent synchronized copy, not a temporary browser cache. Its
purpose is to let RLS serve shared events to household members who do not have
Google connections of their own.
Each imported row needs its household, owning profile, source calendar ID,
source event ID, source update time, event dates/times, and the owner's sharing
choice. Enforce uniqueness on the Google source identity so incremental sync
updates a row instead of duplicating it. Treat cancelled/deleted Google
events as removals from the imported view.

The Google mirror is read-only in Family Hub. The original Google event
remains authoritative: edits and deletions in Google update or remove the
corresponding Supabase mirror row during sync. On disconnect, purge the
mirrored rows from that connection so previously shared events are no longer
visible to the household.

## Security rules

Keep these invariants in Postgres rather than relying on frontend checks:

- Every application table has RLS enabled.
- Authenticated users can read only rows from their household, subject to
  private-event and imported-event sharing rules.
- First-party private events and annual dates are visible only to their
  creator.
- First-party household events and annual dates are visible to household
  members.
- Household members can edit/delete shared first-party items. Only their
  creator can change visibility; private items can be managed only by that
  creator. Creation/update timestamps are controlled by the database.
- Imported Google event details are visible to the owner by default. Other
  household members can read them only when the owner has explicitly shared
  the source/calendar or event with the household.
- Insert policies require household membership and the current Auth user for
  audit/owner columns.
- Browser writes cannot change IDs, household scope, ownership, source IDs, or
  creation timestamps after insert.
- Google OAuth and refresh tokens are only accessible to trusted server-side
  functions. The browser receives normalized event data, never credentials.
- Task assignees must belong to the same household.
- Archived tasks cannot be edited or reopened.
- Household creation is performed by the `create_household`
  security-definer function.
- The join flow must create the authenticated user's own profile and must not
  accept arbitrary profile IDs or household IDs from the browser.

Use explicit table and column grants. Keep private membership and integration
helpers outside the exposed API schemas.

## Frontend conventions

AuthGate exposes the current profile:

    profile: {
      id: string
      household_id: string
      name: string
    }

Feature pages should read this context. They must not invent user IDs or
maintain a second user-selection mechanism.

Each feature keeps a small Supabase adapter in `frontend/src/<feature>/api.ts`.
Adapters:

- hide table names and snake_case mapping from components;
- scope reads and writes by household_id;
- set audit/owner columns from the authenticated profile;
- accept AbortSignal for list requests where appropriate;
- convert database and connection failures into useful UI errors.

Use household-scoped React Query keys:

- tasks, household ID
- shopping items, household ID
- members, household ID
- calendar events, household ID, start, end, user ID, and viewer time zone
- annual dates, household ID, and user ID
- imported calendar events, household ID, start, and end

The calendar agenda merges first-party events, Google events readable under
the current user's sharing rules, and active tasks due in the displayed range.
Clearly label imported Google rows as read-only and identify their source.
Never allow a calendar UI action to update or delete the original Google event.

Treat task due dates and all-day event dates as date-only values. Keep stable
ordering by start/due date, creation time, and ID.

## Next milestones

### 1. Verify the household join and invite flow

The initial implementation uses this smallest flow:

- a household member creates a short-lived invite token through a
  security-definer RPC;
- the second authenticated user submits the token;
- the database validates the token and creates that user's profile
  atomically;
- the token cannot be reused or used for an arbitrary household.

Invite records are stored in the private schema, and tokens expire after 24
hours. The onboarding screen supports either household creation or joining.
Verify expired, reused, invalid, and already-member attempts, plus isolation
between two households. Do not expose service-role credentials to the browser.

Verify that two authenticated users in the same household see the same Tasks
and Shopping data.

### 2. Add first-party calendar events in Supabase

Implementation is complete; the migration has not been applied and tests,
builds, and application/manual verification have not been run for this change.

- Add `calendar_events` and `annual_dates` migrations with constraints,
  indexes, RLS, and explicit column grants.
- Add the `Ważne daty` navigation tab, its list, and a dedicated form for
  birthdays, anniversaries, and `Inne` annual dates.
- Keep the Calendar tab's event form limited to normal one-off events.
- Store birthday/anniversary initial dates with their year; store `Inne` as
  month/day only. Generate annual occurrences for the visible range without
  inserting yearly copies, and show the calculated count in Calendar and
  Today as read-only occurrences.
- Add small adapters for listing, creating, editing, and deleting or archiving
  first-party events and annual-date definitions.
- Ensure every member can create household items and each member can manage
  their own private items.
- Build the calendar view from first-party events, annual occurrences, and
  due tasks. Use a 14-day default range and household-scoped query keys.

### 3. Add optional read-only Google Calendar import

- Let a household member connect Google through OAuth and select calendars to
  import. The connecting user must be able to disconnect at any time.
- Ask whether imported calendar data should remain private or be shared with
  the household. Default to private and provide an event-level way to keep a
  sensitive item private when its source calendar is shared.
- Handle OAuth callbacks and sync only in a narrow Supabase Edge Function.
- Store refresh tokens and per-account/per-calendar sync metadata in
  server-controlled storage.
- For each selected calendar, perform a paginated initial full sync, then
  incremental syncs with its own `nextSyncToken`. Keep request parameters
  consistent, apply every page idempotently, and persist the next token only
  after all page changes have been applied successfully.
- Propagate Google cancellation/deletion records to the imported-event mirror.
  If a sync request returns `410 Gone`, rebuild that calendar's mirror with a
  full sync; leave other calendars' sync state untouched.
- Return normalized rows only. Do not write, edit, or delete events in Google.
- Other household members must be able to see explicitly shared imported
  events without connecting Google themselves.
- On disconnect, stop sync, revoke/delete credentials, and purge the imported
  event mirror for that connection.

### 4. Replace the Today placeholder

Show:

- active tasks due today;
- today's first-party and visible imported calendar events;
- independent loading and error states;
- empty states for either section;
- links to the full Tasks and Calendar pages.

Reuse existing feature adapters and query keys. Do not duplicate Supabase
queries or introduce another global store. Do not include Shopping in the
initial Today view.

### 5. Finish PWA and deployment behavior (complete)

Add:

- a web app manifest and application icons;
- standalone display metadata;
- static asset caching through a service worker or equivalent;
- mobile touch-target and safe-area checks.

Cache static assets only at first. Supabase data still requires a network
connection; do not add offline writes or synchronization yet.

The frontend can be served as the existing static Nginx container or by a
static hosting provider. Configure `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY` at build time, and configure Supabase Auth site
and redirect URLs for each environment.

## Verification

Run after frontend or adapter changes:

    cd frontend
    npm ci
    npm test
    npm run build

For Supabase changes, reset the local project and verify with at least two
authenticated users:

- anonymous reads and writes are denied;
- household members can read and update shared rows;
- another household cannot read or update those rows;
- audit columns cannot be impersonated;
- private first-party events are visible only to their owner;
- household first-party events are visible to household members;
- imported Google events remain private unless the owner explicitly shares
  them;
- household members without Google connections can read shared imported rows;
- Google sync updates and deletions do not create duplicates;
- disconnect removes that connection's imported mirror and credentials;
- the browser cannot read OAuth credentials or modify Google events;
- foreign-household task assignments are rejected;
- archived tasks remain immutable;
- household onboarding is atomic;
- a successful write remains visible after a refresh failure where the UI
  promises that behavior.

Run the manual pass on a narrow mobile viewport and a desktop viewport. Check
refresh, sign-out/sign-in, and a second browser session.

For the native calendar milestone, also verify:

- Create/edit/delete timed and multi-day all-day events. Confirm a midnight
  end is exclusive and all-day dates keep their day in different browser zones.
- Switch between private and household visibility as the creator. A second
  member can edit shared content but cannot change its visibility; private
  events and annual dates remain inaccessible to that member and another household.
- Try direct writes to IDs, household/owner fields, and timestamps; verify
  grants reject them and database constraints reject mixed or invalid schedules.
- Create a birthday/anniversary and an `Inne` month/day definition. Confirm no
  occurrence in the initial year, the correct subsequent count, and February
  29 falling on February 28 in non-leap years.
- Confirm annual occurrences open read-only details in Calendar and Today,
  and editing/deletion is available only for definitions in `Ważne daty`.
- Edit an event into/out of the visible range and delete an annual definition;
  check cached Calendar/Today views after navigation and a failed refresh.

## Definition of done

The MVP is complete when:

1. A user can sign up, sign in, and keep a session across refreshes.
2. A first user can create a household.
3. A second authenticated user can join that household safely.
4. Both members share Shopping and Tasks data through Supabase.
5. Users can create, assign, complete, reopen, and archive tasks.
6. Archived tasks cannot be changed through the browser.
7. RLS prevents cross-household reads and writes.
8. Members can create household calendar events; private events stay visible
   only to their owner. The Calendar form creates only normal one-off events.
9. Members can manage birthdays, anniversaries, and `Inne` annual dates in a
   separate `Ważne daty` tab and form.
10. Annual-date occurrences appear without generating yearly database rows;
    birthdays and anniversaries display the correct occurrence number, while
    `Inne` stores only month/day and has no count.
11. A connected member can import Google events read-only and explicitly share
    selected imported data with household members who have not connected
    Google.
12. Google changes and deletions are reflected in the mirror; Family Hub never
    writes to Google.
13. Today shows today's tasks and visible calendar events, including annual
    date occurrences.
14. The app is usable as an installable mobile PWA.
15. The frontend builds and tests successfully from a clean install.
16. Deployment requires only the frontend and configured Supabase services.

OpenClaw integration is deferred. If it is added later, expose narrow,
authenticated Supabase Edge Functions or database RPCs instead of introducing
another application backend.
