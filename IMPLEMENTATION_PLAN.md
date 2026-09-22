# Family Hub — Supabase Implementation Plan

## 1. Product direction

Family Hub is a small family PWA for two or more household members. It brings
the following into one responsive interface:

* shared tasks,
* a shared shopping list,
* a calendar agenda with event creation,
* a Today view combining the most useful information.

Supabase is the application backend. The browser uses the Supabase client with
the publishable key and the signed-in user's session. Supabase Auth, Postgres,
Row Level Security (RLS), and, where server-side code is unavoidable, Supabase
Edge Functions provide the backend capabilities we need.

The target architecture does not include a custom Kotlin/Ktor API, SQLite,
Flyway, Exposed, or a second application backend. The existing Kotlin/SQLite
implementation is a completed migration baseline only; it must not receive new
product features.

The frontend remains the primary application layer. It owns presentation,
query caching, input handling, and mapping Supabase rows into frontend models.
Postgres owns persistence and household isolation. RLS is the security boundary
and must not be replaced by frontend filtering.

---

## 2. Current status

The following work is already complete. The first six stages were implemented
against the original local backend; the Supabase stages changed the target
architecture afterwards.

### Stage 1 — Project skeleton — complete

Implemented:

* React, TypeScript, Vite, React Router, and TanStack Query setup.
* Responsive application shell and navigation.
* Initial frontend and container scaffolding.
* Local development and Tailscale-oriented configuration.

### Stage 2 — Local persistence baseline — complete, legacy

Implemented:

* Kotlin/Ktor project setup.
* SQLite database initialization.
* Flyway migrations and initial household/user seed data.
* Persistence tests.

This is historical work. Supabase Postgres is now the source of truth.

### Stage 3 — Tasks baseline — complete, legacy

Implemented:

* Task domain model and behavior.
* Task application service and repository.
* Ktor task routes for listing, creation, assignment, completion, reopening,
  and archiving.
* Backend unit, route, and persistence tests.

These behaviors are the reference for the Tasks Supabase migration, but the
Ktor routes are not part of the target architecture.

### Stage 4 — Tasks screen — complete, legacy integration

Implemented:

* `/tasks` route.
* Task creation with title and optional due date.
* Assignment, completion, reopening, and archiving actions.
* Overdue, Today, Upcoming, No due date, and Completed sections.
* Date-only handling that avoids timezone shifts.
* Loading, mutation, and connection error states.
* Frontend task grouping and legacy API tests.

The screen still calls the Ktor `/api/tasks` endpoints and uses the temporary
`VITE_USER_ID`. That integration must be replaced.

### Stage 5 — Shopping baseline — complete, legacy

Implemented:

* Shopping item domain model and service.
* Shopping persistence and Ktor routes.
* Optional `store` field.
* Backend tests.

The shopping backend is retained only as migration history.

### Stage 6 — Shopping screen — complete

Implemented:

* `/shopping` route.
* Fast add-item flow.
* Quantity and optional store support.
* Active and purchased item sections.
* Check-off and uncheck actions.
* React Query loading, refresh, and mutation feedback.

### Stage 7 — Supabase foundation — complete

Implemented:

* Supabase browser client and environment configuration.
* Email/password sign-up and sign-in.
* Persistent Supabase sessions and sign-out.
* Authenticated application gate.
* `households` and `profiles` tables.
* First-user household onboarding through the `create_household` RPC.
* Household membership-based RLS for the existing shared data.

The old local user picker and `X-User-Id` approach are superseded by Supabase
Auth. A signed-in user's profile supplies the user and household IDs.

### Stage 8 — Shopping moved to Supabase — complete

Implemented:

* Supabase migrations for `households`, `profiles`, and `shopping_items`.
* Shopping item normalization in the database.
* RLS policies for household-scoped reads and writes.
* Browser-side access using the authenticated Supabase client.
* Household member updates to shared shopping items.
* React Query integration keyed by household.
* Shopping no longer reads or writes through Ktor.

### Current gap

* Tasks still use Ktor/SQLite and static legacy identities.
* Supabase does not yet contain a `tasks` table.
* The member list is not yet used by the Tasks screen.
* The second household member still needs a safe join/invite path for the
  production MVP; first-user household creation is implemented.
* Today and Calendar are placeholders.
* PWA installation and final Supabase-oriented deployment still need to be
  completed.

---

## 3. Target architecture

```text
┌─────────────────────────────────────────────┐
│ React / TypeScript PWA                      │
│                                             │
│ AuthGate  React Query  Tasks  Shopping      │
│                           Calendar  Today   │
└───────────────┬─────────────────────────────┘
                │ Supabase JS + authenticated session
                ▼
┌─────────────────────────────────────────────┐
│ Supabase                                    │
│                                             │
│ Auth → Postgres REST/Data API → RLS         │
│                                             │
│ Optional Edge Functions → Google Calendar   │
└─────────────────────────────────────────────┘
```

Responsibilities:

* Supabase Auth identifies the current user.
* `profiles.household_id` identifies the current household.
* Postgres stores household data.
* RLS ensures a user can only read and mutate rows from their household.
* The frontend calls Supabase directly for Tasks and Shopping.
* An Edge Function is used for Google Calendar only if a server-side Google
  credential is required.
* React Query handles request status and cache invalidation; it is not the
  source of truth.

Do not add a custom HTTP API between the frontend and Supabase. Do not put a
Supabase service-role key, Google client secret, or refresh token in a `VITE_*`
variable or in browser code.

---

## 4. MVP scope

The MVP includes:

1. Supabase Auth sign-up, sign-in, session persistence, and sign-out.
2. Household creation and a safe way for another authenticated user to join.
3. Household-scoped Tasks stored in Supabase.
4. Household-scoped Shopping stored in Supabase.
5. A Google Calendar agenda that can also create events in the shared calendar.
6. A Today view with today's tasks and calendar events.
7. A responsive, installable PWA.

Do not implement yet:

* a custom Kotlin/Ktor backend,
* SQLite or Flyway as application storage,
* a second REST API for OpenClaw,
* projects, tags, subtasks, priorities, comments, or audit history,
* recurring tasks,
* push notifications,
* offline mutation queues or conflict resolution,
* custom calendar event storage,
* advanced role and permission management.

---

## 5. Supabase data model

All application tables are in the `public` schema and use UUIDs. All rows
belonging to the shared application are scoped by `household_id`.

### households — implemented

```text
id         UUID PK DEFAULT gen_random_uuid()
name       TEXT NOT NULL
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
```

The database rejects blank household names.

### profiles — implemented

```text
id           UUID PK REFERENCES auth.users(id) ON DELETE CASCADE
household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE
name         TEXT NOT NULL
created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
```

`id` is the Supabase Auth user ID. A profile belongs to one household in the
MVP. The frontend uses the signed-in profile returned by `AuthGate` rather than
local storage or a manually selected user ID.

### shopping_items — implemented

```text
id           UUID PK DEFAULT gen_random_uuid()
household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE
name         TEXT NOT NULL
quantity     TEXT NULL
store        TEXT NULL
completed    BOOLEAN NOT NULL DEFAULT false
added_by     UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT
created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
```

Names, quantities, and stores are trimmed in the database; empty optional text
becomes `NULL`.

### tasks — to be added in the next migration

```text
id           UUID PK DEFAULT gen_random_uuid()
household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE
title        TEXT NOT NULL
due_date     DATE NULL
completed    BOOLEAN NOT NULL DEFAULT false
assigned_to  UUID NULL REFERENCES profiles(id) ON DELETE SET NULL
created_by   UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT
created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
archived_at  TIMESTAMPTZ NULL
```

Constraints and indexes:

* `title` must not be blank after trimming.
* `due_date` remains a date-only value; do not convert it through a timestamp in
  the browser.
* `assigned_to` must be `NULL` or a profile in the same household.
* `household_id`, `due_date`, `completed`, and `archived_at` need indexes that
  support the Tasks query.
* An archived task remains readable but cannot be edited, assigned, completed,
  reopened, or archived again.

The archived-task and same-household-assignment rules must be enforced by the
database, using an appropriate combination of RLS, column grants, constraints,
and a trigger or security-definer function. A browser check alone is not enough.

---

## 6. Supabase security rules

The existing `private.is_household_member(uuid)` helper is the basis for
household checks. Keep it outside the exposed API schemas and use it from RLS
policies.

For every household table:

* Enable RLS.
* Allow authenticated users to read rows only when they belong to the row's
  household.
* Require `auth.uid()` for audit columns such as `created_by` and `added_by`.
* Never allow the browser to change `household_id`, ownership columns, IDs, or
  creation timestamps after insert.
* Use explicit table and column grants instead of relying on broad defaults.

For Tasks specifically:

* `SELECT`: authenticated household members may read tasks from their
  household, including archived tasks. The normal frontend query excludes
  archived rows.
* `INSERT`: require household membership and `created_by = auth.uid()`.
* `UPDATE`: require household membership, keep the row in the same household,
  validate `assigned_to`, and reject changes to archived rows.
* Archive is a one-way transition from `archived_at IS NULL` to a timestamp.
* A task assigned to another person must reference a profile from the same
  household.

For onboarding:

* Keep `create_household` as a security-definer function.
* Do not let the browser insert an arbitrary profile or choose another user's
  profile ID.
* Add a minimal join/invite flow before calling two-user sharing complete. The
  join operation should be an atomic security-definer RPC or Edge Function that
  validates an invite and creates the authenticated user's profile.

For browser configuration:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

Only the publishable/anon key belongs in the frontend. Database credentials,
service-role keys, and Google credentials belong in Supabase secrets.

---

## 7. Frontend conventions

### Authentication context

`AuthGate` provides:

```ts
{
  profile: {
    id: string
    household_id: string
    name: string
  }
  signOut(): Promise<void>
}
```

Feature pages should read this context. They must not read `VITE_USER_ID`,
invent a user ID, or maintain a second user-selection mechanism.

### Supabase feature adapters

Each feature gets a small adapter around the Supabase client, following the
working Shopping pattern:

```text
frontend/src/<feature>/api.ts
  Supabase row → frontend model
  list / create / update operations
  abort support for reads
  consistent Error conversion
```

The adapters are data-access helpers, not a replacement for a custom backend.
They should keep table names and snake_case mapping out of the UI components.

### React Query keys

Include the household ID in keys so cached data cannot leak between sessions or
households:

```text
["tasks", householdId]
["shoppingItems", householdId]
["members", householdId]
["calendarEvents", householdId, from, to]
```

Mutations invalidate or update the matching household-scoped query. Keep the
current behavior where a successful write remains visible even if a follow-up
refresh fails.

### Dates and ordering

* Treat task `due_date` as `YYYY-MM-DD`.
* Group dates using the browser's local calendar date.
* Do not parse a date-only task value as a UTC timestamp.
* Use stable ordering, such as due date, creation time, and ID.

---

## 8. Next implementation: migrate Tasks to Supabase

This is the next vertical slice. Complete the steps in order and keep the
existing Tasks UI behavior unless the Supabase data model requires a change.

### Stage 9 — Add the Tasks schema and RLS

Create the next Supabase migration, for example:

```text
supabase/migrations/20260922000004_create_tasks_schema.sql
```

The migration should:

1. Create `public.tasks` using the model above.
2. Add the household, due-date, completion, and archive indexes.
3. Add title normalization and a non-blank constraint.
4. Add the same-household validation for `assigned_to`.
5. Enable RLS.
6. Add household-scoped select, insert, and update policies.
7. Add explicit grants for only the columns the browser needs.
8. Enforce one-way archive and archived-row immutability.

Validate the migration with a local reset and at least two authenticated test
users. Verify that:

* a member sees only their household's tasks;
* an unauthenticated client cannot read or write tasks;
* a member cannot create a task for another household;
* a member cannot assign a task to a profile from another household;
* one household member can update a task created by another member;
* archived tasks cannot be edited or reopened.

### Stage 10 — Add the household member query

Add a small profiles adapter or shared household hook that loads:

```text
id, household_id, name
```

filtered by the current `household_id`.

Use it for assignment labels instead of the hard-coded `members` array in
`frontend/src/tasks/tasks.ts`.

If the second household member cannot yet join through the UI, implement the
minimal invite/join flow at this point. The first-user onboarding flow already
exists; the missing operation must create a profile for the authenticated user
without allowing arbitrary household membership.

### Stage 11 — Replace the Tasks data adapter

Replace the fetch-based implementation in
`frontend/src/tasks/api.ts` with a Supabase adapter modeled on
`frontend/src/shopping/api.ts`.

The adapter should accept the current household and authenticated user IDs and
provide:

```text
list(signal)
create({ title, dueDate, assignedTo })
setCompleted(id, completed)
setAssignedTo(id, profileId | null)
archive(id)
```

Implementation requirements:

* Select only the fields used by the Tasks UI.
* Exclude archived rows in the normal list query.
* Scope queries by `household_id` as defense in depth; RLS remains authoritative.
* Set `created_by` from the authenticated user, never from form input.
* Pass the selected member as `assigned_to` during creation when possible, so
  creation is one write rather than create-then-assign.
* Map `due_date`, `assigned_to`, `created_by`, `created_at`, and `archived_at`
  into the existing camelCase `Task` model.
* Preserve abort handling and useful connection/database error messages.
* Use Supabase errors for UI feedback without exposing secrets or raw tokens.

There are no `/api/tasks` routes in the target implementation. Do not add a
new REST wrapper for these operations.

### Stage 12 — Move the Tasks page to authenticated Supabase data

Update `frontend/src/tasks/TasksPage.tsx` and `frontend/src/tasks/tasks.ts` to:

* read `profile` from `useAuth()`;
* create the adapter with `profile.household_id` and `profile.id`;
* use `['tasks', profile.household_id]` as the query key;
* use the household member query for assignment options and display names;
* remove the static User 1/User 2 list;
* remove all `X-User-Id` assumptions;
* remove the two-request create-then-assign flow;
* keep task grouping, date formatting, completion, reopening, and archiving;
* keep loading, retry, mutation, and success feedback;
* invalidate the household task query after mutations.

The UI should continue to show shared tasks when `assigned_to` is `NULL` and
the signed-in member's display name when a task is assigned.

### Stage 13 — Verify the Tasks migration end to end

Use two real Supabase Auth accounts in the same household and, where possible,
a third account in another household.

Acceptance checks:

1. Sign in and load tasks from Supabase.
2. Create a task with no assignee.
3. Create a task assigned to a household member.
4. Complete and reopen a task.
5. Archive a task and confirm it leaves the active list.
6. Refresh the page and confirm all active data persists.
7. Sign in as the other household member and see the same task state.
8. Confirm the other household cannot read or mutate the task.
9. Confirm the browser makes no request to `/api/tasks`.
10. Confirm `VITE_USER_ID` is no longer required.

Run:

```sh
cd frontend
npm test
npm run build
```

Also run the local Supabase migration/reset and repeat the RLS checks before
considering the migration complete.

---

## 9. Retire the legacy backend path

Do this only after Tasks has passed the end-to-end checks.

Remove the application dependency on:

* `VITE_API_URL`,
* `VITE_USER_ID`,
* `X-User-Id`,
* frontend `fetch` calls to `/api`,
* the Ktor task and shopping routes,
* SQLite/Flyway/Exposed runtime setup,
* the backend service from the normal frontend development path.

Then simplify the project and documentation:

* remove or archive backend-only modules and tests that no longer have a
  product role;
* remove the Nginx `/api/` and `/health` proxy locations;
* remove `family-api` and its health dependency from Docker Compose;
* keep a frontend-only static container if local/Tailscale hosting is still
  useful;
* update `README.md`, `.env.example`, and deployment instructions to mention
  only Supabase and frontend configuration.

Do not delete migration history or existing data blindly. If old SQLite data
must be preserved, export and transform it before removing the local database.
For the current MVP, a fresh Supabase household is acceptable because the
Supabase project is the new source of truth.

---

## 10. Calendar through Supabase

Google Calendar remains the source of truth. Do not copy events into a local
database merely to render the agenda. The app must support both reading events
and adding new events to the configured shared calendar.

### Stage 14 — Secure calendar function

When Calendar work begins, add an authenticated Supabase Edge Function (or
separate narrowly scoped functions) for listing and creating Google Calendar
events:

* require a valid Supabase user session;
* verify that the caller has a household profile;
* validate `from` and `to` for event listing and reject an inverted range;
* validate event creation input, including a non-blank title and valid start/end
  values (including the all-day event case if supported);
* read Google Calendar credentials from Supabase secrets;
* list events from and create events in the configured shared Google Calendar;
* return a small normalized event shape and a clear result for successful
  creation;
* never return credentials to the browser.

The function may use a single shared calendar for the MVP. It should not become
a general custom backend. Keep the function narrowly scoped to the calendar
integration.

Frontend work:

* add `frontend/src/calendar/api.ts` using `supabase.functions.invoke`;
* use a 14-day default range starting today;
* add `['calendarEvents', householdId, from, to]` query keys;
* show loading, empty, authentication, and Google API error states;
* add a simple event creation form with a title, start, and end; support an
  all-day event if the selected Google Calendar API shape allows it cleanly;
* after creation, show confirmation and refresh the relevant calendar query.

Required secrets belong in Supabase's function configuration, not frontend
environment variables. Configure Google redirect/origin settings and Supabase
function secrets separately for local and hosted projects.

---

## 11. Today view

### Stage 15 — Combine Tasks and Calendar

Replace the placeholder home page with:

* active tasks due today;
* today's calendar events;
* clear empty states for either section;
* independent loading and error handling where one data source succeeds and
  the other fails;
* links to the full Tasks and Calendar views.

The Today view must use the same household-scoped query adapters as the full
pages. It must not duplicate Supabase queries or introduce a separate store.

Do not show the shopping list on Today in the initial MVP.

---

## 12. PWA and frontend delivery

### Stage 16 — PWA behavior

Add:

* a web app manifest;
* application icons;
* standalone display metadata;
* a service worker or equivalent static asset caching;
* mobile-friendly touch targets and safe-area handling.

Cache only static frontend assets initially. Supabase data requires a network
connection; do not introduce offline writes or synchronization yet.

Verify installation on iOS and a desktop browser.

### Stage 17 — Supabase-oriented deployment

The frontend can be served as a static Vite build from the existing Nginx
container, a static hosting provider, or a home server behind Tailscale. The
deployment must no longer require a family API container.

Configure:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

Set Supabase Auth site URL and redirect URLs for each environment. Keep local
and hosted Supabase projects/users distinct and document how to obtain the
publishable key.

Before deployment:

```sh
cd frontend
npm ci
npm test
npm run build
```

Do not put secrets into the generated frontend bundle.

---

## 13. Testing strategy

### Frontend tests

Keep focused tests for:

* task grouping and ordering;
* local date formatting;
* Supabase row-to-model mapping;
* query keys containing the household ID;
* mutation behavior and error presentation;
* shopping item normalization and grouping.

Do not keep tests whose only purpose is asserting the old `X-User-Id` HTTP
contract after the Tasks migration.

### Supabase database checks

Use the local Supabase project to verify migrations and RLS. At minimum test:

* anonymous reads and writes are denied;
* household members can read shared rows;
* household members can update shared rows;
* another household cannot read or update those rows;
* audit columns cannot be impersonated;
* foreign-household assignments are rejected;
* archived tasks remain immutable;
* deleting a household cascades only as intended;
* the household onboarding function is atomic.

Reset and inspect the local project after migration changes rather than editing
the database manually and relying on an unrecorded state.

### Manual acceptance pass

Run the application with two authenticated household members. Test the flows
on a narrow mobile viewport and a desktop viewport. Verify browser refresh,
sign-out/sign-in, and a second browser session.

---

## 14. Implementation principles

Prefer the smallest Supabase feature that satisfies the product behavior.

* Keep business invariants in Postgres when direct browser writes could bypass
  them.
* Keep UI state and request caching in React Query; do not add another global
  state library without a demonstrated need.
* Use the existing Shopping adapter as the reference for direct Supabase access.
* Keep all feature queries household-scoped and keyed by household ID.
* Treat RLS policies and migrations as production code and review them like
  application code.
* Do not duplicate data between Supabase tables and a custom local database.
* Do not add a custom backend just to wrap a single Supabase query.
* Use an Edge Function only when browser code cannot safely perform the
  integration, such as access to Google credentials or privileged onboarding.

---

## 15. Definition of done

The Supabase migration and MVP are complete when:

1. A user can sign up, sign in, and keep a session across refreshes.
2. A first user can create a household.
3. A second authenticated user can join the same household safely.
4. Both members see the same Shopping data through Supabase.
5. Both members see the same Tasks data through Supabase.
6. A user can create, assign, complete, reopen, and archive a task.
7. Archived tasks cannot be changed through the browser.
8. Household RLS prevents cross-household reads and writes.
9. No task or shopping operation depends on Ktor, SQLite, `X-User-Id`, or
   `VITE_USER_ID`.
10. The Calendar view displays events from the configured shared Google
    Calendar and can add a new event to it.
11. Today displays today's tasks and calendar events.
12. The app is usable as an installable mobile PWA.
13. The frontend builds and tests successfully in a clean install.
14. Deployment requires only the frontend and configured Supabase services.

OpenClaw integration is intentionally deferred. If it is added later, expose
narrow, authenticated Supabase Edge Functions or database RPCs rather than
reintroducing a separate application backend.
