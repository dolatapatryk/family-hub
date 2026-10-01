# Google Calendar integration — implementation plan

Status: the base integration schema and RLS migration have been applied to the
current test Supabase database and manually verified. OAuth, calendar
management, user-triggered sync, and imported-event display code are now in the
repository. The OAuth-management and event-sync migrations have not yet been
applied; Google Cloud credentials, deployed function secrets, and a real import
are still pending.

## Progress snapshot

Completed:

- Agreed on the read-only, future/ongoing one-off event MVP contract in this
  plan.
- Added `supabase/migrations/20260929000000_google_calendar_integration.sql`
  with private connection/calendar metadata, the normalized imported-event
  mirror, constraints, grants, and RLS policies.
- Applied the migration and manually checked the imported-event access rules
  with test rows and simulated authenticated users: the owner can read private
  events; another household member cannot until the calendar is shared; a
  household member can read after sharing; an outside household member cannot
  read; authenticated users cannot write imported rows.

The manual checks verify database behavior. Repeatable automated RLS tests and
verification in staging/production remain part of rollout.

Added in the current OAuth and selection batch:

- Added `supabase/migrations/20260930000000_google_calendar_oauth_management.sql`
  with service-role-only RPCs for OAuth state, connection credentials, calendar
  list metadata, owner choices, and serialized token refresh leases. The
  migration is not yet applied to a Supabase project.
- Added authenticated management and state-validated callback Edge Functions,
  AES-GCM refresh-token storage, read-only Google consent scopes, full calendar
  list pagination, and owner-only selection/sharing controls in Calendar.
- Added development setup instructions. No Google credentials were available,
  so deployment and a real consent/reconnect pass remain pending. Calendar
  selection and list loading do not start event synchronization.

Added in the user-triggered import batch:

- Added `supabase/migrations/20261001000000_google_calendar_event_sync.sql` with
  service-role-only sync start, lease, page-commit, failure, `410` rebuild, and
  lost-calendar RPCs. The migration has not been applied to a Supabase project.
- Added a bounded Google events worker that imports normalized one-off events,
  saves per-page checkpoints, retries transient requests, applies cancellations,
  skips recurring records, and retains past imports during incremental sync and
  token rebuilds.
- Added an owner-clicked import/synchronize action and Calendar/Today read-only
  event display with Google links. A real Google import and automated database
  verification remain pending.

### Resume here: apply migrations and exercise an import

Apply the pending migrations, configure a Google development OAuth client and
server-side secrets, then complete a real connect/reconnect and button-triggered
import pass. The private schema bridge uses narrowly scoped, service-role-only
RPCs. Connecting, selecting calendars, opening a page, and navigating dates do
not start event synchronization.

This expands milestone 3 of [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).
Google remains authoritative. Family Hub imports a read-only copy into Supabase;
the connection owner chooses what their household can see.

## Existing foundation

- Native calendar schema: `supabase/migrations/20260928000000_create_calendar_schema.sql`.
- Google connection/calendar tables and imported-event RLS:
  `supabase/migrations/20260929000000_google_calendar_integration.sql` (applied
  and manually verified in the current test database; automated and
  staging/production verification remain pending).
- Shared Calendar/Today queries: `frontend/src/calendar/queries.ts`.
- Shared agenda construction: `frontend/src/calendar/agenda.ts`.
- Calendar presentation: `frontend/src/calendar/CalendarPage.tsx` and `AgendaComponents.tsx`.
- Today presentation: `frontend/src/dashboard/DashboardPage.tsx`.
- Google settings UI: `frontend/src/googleCalendar/GoogleCalendarSettings.tsx`.
- Google Edge Functions and private-schema RPC bridge: `supabase/functions/`
  and `supabase/migrations/20260930000000_google_calendar_oauth_management.sql`.

## 1. Fix the integration contract and keep the MVP to future one-off events

Use these proposed MVP defaults:

- One connected Google account per member initially; model each connection separately so this can grow later.
- Multiple selected calendars per connection, each private by default.
- Sharing is controlled only per selected Google calendar: the owner sets each calendar to Private or Household. This applies to all imported events from that calendar, including its retained history; there are no per-event privacy exclusions.
- The initial import includes only one-off events that are ongoing or in the future. It does not backfill completed historical events.
- Recurring series and their instances/exceptions are out of scope for the MVP and are not imported. Request unexpanded events, then skip recurring masters (`recurrence`) and instances/exceptions (`recurringEventId`); do not expand recurrence rules or add a source-events table.
- Synchronization starts only when the connection owner clicks Refresh/Synchronize. This applies to the initial import and every subsequent update; connecting an account, selecting calendars, opening a page, and navigating dates do not start a Google event sync.
- Store only fields used by the UI: title, description, optional location/link, schedule, source identity, and timestamps. Do not copy raw Google payloads, guests, or attachments by default.

- On initial sync, use Google's `timeMin` filter starting at the sync time and do not set a `timeMax`, so there is no historical backfill or arbitrary future coverage boundary. Ongoing events may be included because their end is still in the future.
- Google does not allow `timeMin` or `timeMax` with `syncToken`. Incremental syncs use the saved token without a local date filter: apply Google changes and cancellations regardless of event date, and retain imported events that have passed. On `410 Gone`, preserve already-imported past events while rebuilding/reconciling the current and future set with the initial `timeMin` cutoff.

Completion: documented request parameters, initial-import cutoff, historical retention, recurring-event exclusion, and per-calendar sharing semantics.

## 2. Configure Google and Supabase environments

1. Create a Google Cloud project, enable Calendar API, and configure OAuth consent/test users.
2. Register a Web OAuth client and exact Edge Function callback URLs for development and production.
3. Request `calendar.events.readonly` and `calendar.calendarlist.readonly`; do not request write scopes. Use the calendar-list permission for the picker. See [Google's scope reference](https://developers.google.com/workspace/calendar/api/auth).
4. Configure the client ID, client secret, callback URL, allowed frontend origins, and token-encryption configuration as server secrets. No tokens or secrets in `VITE_*`.
5. Record production consent/verification requirements and any required privacy-policy/domain setup before rollout. External apps in Google's Testing state generally receive seven-day refresh tokens for these scopes; test reconnect behavior accordingly. See [OAuth token lifecycle](https://developers.google.com/identity/protocols/oauth2).

Completion: environment-specific configuration with a working development consent screen.

## 3. Integration schema and access controls — implemented

The migration below is already implemented and applied in the current test
database. Do not create a duplicate migration. Keep imported events separate
from native `calendar_events`; use this section as the schema and security
contract for the Edge Functions and frontend.

| Proposed object | Purpose |
| --- | --- |
| `private.google_connections` | Owner, household, encrypted credentials or secret references, granted scopes, lifecycle status, one pending OAuth state hash and expiry |
| `private.google_calendars` | Connection/calendar identity, selection, timezone, Private/Household sharing mode, sync token, request configuration, run/progress/lease fields, generation, last success/error |
| `public.imported_calendar_events` | Normalized one-off event rows used by Calendar and Today |

There are no separate OAuth-state, recurrence-source, per-event exclusion, or sync-job tables in the MVP.

Store a single pending OAuth state on the connection. Starting another authorization attempt replaces it and invalidates the previous attempt without clearing working credentials. Store synchronization checkpoints and expiring leases per calendar, rather than introducing a separate job queue.

Enforce these database rules:

- RLS on application tables; no browser grants for private integration tables or credentials.
- Public mirror has authenticated SELECT only. Browser INSERT/UPDATE/DELETE are denied.
- Readers must belong to the row's household and either own it or have access through the current Private/Household setting of the source calendar.
- Owner-only management operations validate the current profile and ownership server-side. Client-supplied owner/household IDs never authorize an operation.
- Uniqueness uses `(connection_id, google_calendar_id, google_event_id)` for imported Google events. Do not deduplicate unrelated copies by title or `iCalUID`.
- Schedule checks preserve date-only all-day values and exclusive ends; timed rows preserve timezone information.
- Add household/range and connection/source indexes. Keep Google update timestamps separate from local import timestamps.
- Changing a calendar between Private and Household takes effect transactionally for all its existing rows. Sync must never overwrite the owner's sharing choice or publish using stale settings. RLS must enforce the current calendar setting through a narrowly scoped private helper or transactionally maintained visibility fields, without exposing private calendar metadata to the browser.

Edge Functions need an explicit route to private storage: a server-only database connection or narrowly scoped service-only RPCs with fixed search paths and revoked browser execution. A private schema cannot simply be queried through the ordinary exposed PostgREST API.

Completion: the migration is applied and the manual owner/private, household
sharing, cross-household, and browser-write checks pass. Add repeatable database
tests before rollout and verify the same rules in staging.

## 4. Implement OAuth and credential lifecycle

Create separate Edge Function entry points for authenticated management, the Google callback, and user-requested synchronization, with shared modules under `supabase/functions/_shared/google-calendar/`.

1. An authenticated connect action resolves the current member, stores the hash and expiry of a random state on their connection, and returns the consent URL. Allow one pending authorization attempt per connection.
2. Request offline access. The callback atomically validates and clears the matching state fields, rechecks the member's eligibility, and exchanges the code server-side.
3. Encrypt and store tokens; preserve an existing refresh token if a reconnect response omits it. Handle declined or partial consent and missing required scopes.
4. Redirect only to an allowlisted frontend route with a generic result; never put Google tokens in frontend URLs or responses.
5. Refresh access tokens server-side when needed for a user-requested Google operation. Serialize token refreshes and turn revoked/invalid credentials into a reconnect-required state.
6. Redact authorization codes, tokens, and event content from logs.

The callback cannot require a Supabase bearer token from Google's browser redirect; its authorization boundary is the validated one-time state. Management and synchronization actions require a validated user session and connection ownership. Configure each endpoint accordingly. See [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [token-storage practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices), and [Supabase function authentication](https://supabase.com/docs/guides/functions/auth).

Completion: a member can connect, refresh credentials, and reconnect without exposing credentials to the browser.

## 5. Implement calendar selection and privacy controls

1. Fetch every page of the connected account's calendar list server-side; return safe display metadata only.
2. Let the owner select calendars and choose Private or Household for each. Explain that Household sharing exposes all imported event details, including retained history, and future imports from that calendar.
3. Persist choices through owner-authorized management actions, then show Refresh/Synchronize to let the owner start the import.
4. Support a private preview after a user-requested import before the owner chooses whether to share the whole calendar with the household.
5. Do not add event-level privacy actions; other household members get read-only details for events from calendars shared with the household.
6. Deselecting a calendar invalidates its active run and purges its imported data. Switching it to Private immediately removes household access to all of its events in the database.

Completion: selected private events are visible only to the owner, and sharing is deliberate and enforceable outside the UI.

## 6. Build the synchronization engine

Implement one reusable per-calendar worker for user-requested runs:

1. Atomically acquire a lease on `google_calendars`, set the run ID, and capture the current connection/calendar generation.
2. Refresh credentials when necessary.
3. On initial sync, fetch all pages using the fixed request configuration, with `timeMin` set to the run start and no `timeMax`. Process cancellations before requiring title/date fields because deletion records may be sparse. Exclude recurring series and their instances/exceptions.
4. Upsert one-off events idempotently and remove events Google marks cancelled. Ignore recurring masters/instances/exceptions in every response; if an update turns an imported one-off into a recurring event, remove its local row. Apply incremental upserts and cancellations regardless of event date; do not prune or hide imported events just because they have passed.
5. Persist the new sync token only after all pages and row changes succeed. Retried pages must be harmless.
6. On later runs, use that calendar's saved token and supported request settings; do not send `timeMin`, `timeMax`, or `orderBy` with the token. Do not add a local date filter to token results.
7. On `410 Gone`, invalidate only that calendar's sync state and rebuild the current/future set using the initial future-only request. Preserve already-imported events that have ended; reconcile only the current/future set against the rebuilt snapshot, so recovery does not erase retained history.
8. Commit only while the lease and generation remain valid. Disconnect, deselection, and newer runs must prevent stale workers from restoring rows.

Checkpoint work in the selected calendar's progress fields across bounded Edge Function invocations rather than relying on one request to finish a large calendar. The frontend can request successive batches within the same user-started run; each request must validate ownership and run identity. If the session closes or the run fails, the next Refresh/Synchronize click resumes or safely restarts it. A failed run must not advance the sync token. Google's [sync guide](https://developers.google.com/workspace/calendar/api/guides/sync) and [events.list contract](https://developers.google.com/workspace/calendar/api/v3/reference/events/list) define pagination, incremental parameters, and token invalidation.

Completion: the initial import avoids historical backfill; incremental changes converge without date filtering while retaining imported history, including through per-calendar token resets.

## 7. Add the Refresh/Synchronize action and recovery

- Provide an owner-authorized Refresh/Synchronize button for the selected calendars. Clicking it starts the initial import or an incremental sync, depending on each calendar's saved state.
- Disable the button during a run and reject duplicate concurrent starts server-side.
- Use durable progress, bounded batches, lease expiry, and bounded retries within the user-requested run for network failures, quota responses, and transient Google errors. After retries are exhausted, show an error and let the owner retry with the button.
- Separate transient failures from revoked credentials and lost calendar permissions. Hide/purge data from sources whose access is definitively lost; transient failures can retain the last copy with a stale-data indication.
- Show last successful sync, sync in progress, reconnect required, and concise actionable errors. Other household viewers also need a safe stale-source indication.
- Track duration, counts, retry state, and failures without logging personal event data.

Completion: clicking Refresh/Synchronize imports Google changes and updates the displayed copy; failures do not block other calendars or native features.

## 8. Integrate Calendar and Today

Add `frontend/src/googleCalendar/` with types, a small Supabase/Edge Function adapter, query keys, management UI, and imported-event details.

- Extend `useCalendarSources` with an independent imported-events query.
- Include household, viewer user ID, range, and viewer timezone in its query key. The parent plan's abbreviated imported key should be expanded to protect private cached data across account switches.
- Extend `AgendaSource` with a distinct Google variant; do not pass imported items to native edit/delete handlers.
- Merge imports using the existing overlap and ordering conventions in Calendar and Today. Label source and read-only status; offer a safe Google link for editing there.
- Provide independent loading/error/empty states so Google failures do not hide native events or tasks.
- Paginate Supabase reads when a range exceeds the API row limit.
- Invalidate both views after a user-requested sync, calendar sharing changes, deselection, and disconnect. Cancel and clear relevant caches on account changes. Loading the saved Supabase mirror must never invoke Google synchronization.
- On permission reduction, drop stale private/shared data from the current client immediately. RLS prevents subsequent unauthorized reads; information already delivered to another session cannot be retroactively erased.
- Keep integration responses and event data out of the static service-worker cache.

Completion: the owner's private imports and household-visible imports appear consistently in both existing views.

## 9. Implement complete disconnect and cleanup

1. Verify connection ownership and atomically mark it disabled, invalidate active per-calendar runs, and make its mirrored rows unreadable.
2. Purge imported rows and selected-calendar records, including their sync state.
3. Attempt Google token revocation, then delete stored credentials and OAuth state. If revocation fails, finish local disconnect and report that remote revocation was not confirmed; do not keep an active credential indefinitely.
4. Clear current-client caches and make repeated disconnect requests harmless.
5. Apply equivalent local cleanup on owner/household deletion; test disconnect during a running sync.

Original Google events are untouched. Account for Google's project-level token-revocation behavior if other Google integrations are added later; see [revocation documentation](https://developers.google.com/identity/protocols/oauth2/web-server).

Completion: disconnected data cannot reappear through an in-flight job or remain readable by another member.

## 10. Verify the integration

Add meaningful automated tests for:

- OAuth state expiry/replay/replacement on the connection, wrong owner, denied consent, token refresh, and reconnect.
- Multi-page imports, repeated pages, partial failures, cancellations, token advancement, isolated `410` recovery, and overlapping workers.
- Timed/all-day/multi-day one-off events, timezone and DST boundaries, initial historical cutoff, no local date filtering on token results, retaining past rows on incremental sync and `410` recovery, and cancellations.
- Anonymous access denial, owner-only credentials/management, Private versus Household calendar visibility for the owner's and other household members' views, visibility changes applying to existing rows, and cross-household isolation.
- Direct REST writes to imported content denied; the transport issues no Google event mutation requests.
- Privacy changes during sync, revoked access, disconnect races, and account switching without cached-data leakage.
- Shared events readable by a household member with no Google connection.
- Initial and incremental imports start only after Refresh/Synchronize is clicked; connecting, selecting calendars, page loads, focus changes, and date navigation do not trigger a Google event sync.

Run frontend clean-install tests/build, Edge Function unit tests, and repeatable local database integration tests. Complete a real Google test-account pass in two browser sessions and on mobile/desktop; fake API fixtures cannot validate consent or refresh-token behavior.

## 11. Deploy in dependency order

1. Apply integration migrations and verify grants/RLS in staging.
2. Configure secrets and deploy callback, management, and synchronization functions with their distinct authentication rules.
3. Deploy the frontend integration controls and update README setup/troubleshooting instructions.
4. Validate a real connection, button-triggered private import, explicit sharing, button-triggered incremental changes, and disconnect.
5. Complete applicable Google production requirements and repeat the smoke test in production.
6. Document rollback: disable new connections and synchronization requests, hide integration UI, and preserve native Calendar/Today operation; never revert by exposing private tables.

Suggested reviewable implementation batches:

1. [x] Contract/schema/RLS — migration applied and manual access checks passed.
2. [~] OAuth and calendar selection — code added; migration, secrets, and real consent check pending.
3. [~] User-triggered one-off event sync — worker and migration added; migration deployment and real Google validation pending.
4. [~] Calendar/Today import display — read-only queries and user controls added; disconnect and shared-viewer stale-source status remain.
5. [ ] Automated and end-to-end verification, then rollout.

The integration is done when a member can connect and privately import selected calendars,
set each calendar to Private or Household, share it with a member who has no Google connection,
import Google changes and deletions by clicking Refresh/Synchronize, and disconnect completely—while
native calendar features remain usable and credentials never reach the browser.
