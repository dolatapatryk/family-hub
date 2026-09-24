# Family Hub — Implementation Plan

## Product direction

Family Hub is a small family PWA for two or more household members. It brings
shared tasks, shopping, a calendar agenda, and a Today view into one
responsive interface.

Supabase is the application backend:

- Supabase Auth identifies the current user.
- Postgres stores household data.
- Row Level Security (RLS) is the household-isolation boundary.
- The browser uses the Supabase client and publishable key.
- Edge Functions are used only where browser code cannot safely perform an
  integration, such as access to Google Calendar credentials or a privileged
  invite operation.

The application has no custom Kotlin/Ktor API or local SQLite runtime. The
frontend is the primary application layer and owns presentation, input
handling, query caching, and mapping database rows into frontend models.

## Current architecture

    React / TypeScript / Vite
      AuthGate
      React Query
      Tasks
      Shopping
      Today and Calendar placeholders
            |
            | Supabase JS + authenticated session
            v
    Supabase Auth / Postgres REST / RLS
            |
            +-- optional Edge Functions for privileged integrations

Do not add another application backend just to wrap a Supabase query. Never
put service-role keys, database credentials, Google client secrets, or refresh
tokens in VITE_* variables or browser code.

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

### Current product gap

- The safe household invite and join flow is implemented; two-user Supabase
  verification is still pending.
- Today and Calendar are placeholders.
- Calendar integration and event creation are not implemented.
- PWA installation metadata and final deployment documentation are not
  complete.
- RLS and migration behavior still need a repeatable two-user integration
  verification pass.

## MVP scope

The MVP includes:

1. Supabase Auth sign-up, sign-in, session persistence, and sign-out.
2. Household creation and a safe way for another authenticated user to join.
3. Household-scoped Tasks stored in Supabase.
4. Household-scoped Shopping stored in Supabase.
5. A shared Google Calendar agenda with event creation.
6. A Today view with today's tasks and calendar events.
7. A responsive, installable PWA.

Do not add yet:

- projects, tags, subtasks, priorities, comments, or audit-history screens;
- recurring tasks;
- push notifications;
- offline mutation queues or conflict resolution;
- custom calendar event storage;
- advanced roles and permission management;
- a replacement custom REST API.

## Supabase data model

The current schema is recorded in supabase/migrations. All application rows
are scoped by household_id.

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

Task due_date is a date-only value. Archived tasks remain readable in the
database but cannot be changed through the browser. The normal frontend query
loads active tasks only.

## Security rules

Keep these invariants in Postgres rather than relying on frontend checks:

- Every application table has RLS enabled.
- Authenticated users can read only rows from their household.
- Insert policies require household membership and the current Auth user for
  audit columns.
- Browser writes cannot change IDs, household scope, ownership, or creation
  timestamps after insert.
- Task assignees must belong to the task's household.
- Archived tasks cannot be edited or reopened.
- Household creation is performed by the create_household security-definer
  function.
- A future join flow must create the authenticated user's own profile and must
  not accept arbitrary profile IDs or household IDs from the browser.

Use explicit table and column grants. Keep the private membership helper
outside the exposed API schemas.

## Frontend conventions

AuthGate exposes the current profile:

    profile: {
      id: string
      household_id: string
      name: string
    }

Feature pages should read this context. They must not invent user IDs or
maintain a second user-selection mechanism.

Each feature keeps a small Supabase adapter in frontend/src/<feature>/api.ts.
Adapters:

- hide table names and snake_case mapping from components;
- scope reads and writes by household_id;
- set audit columns from the authenticated profile;
- accept AbortSignal for list requests where appropriate;
- convert database and connection failures into useful UI errors.

Use household-scoped React Query keys:

- tasks, household ID
- shopping items, household ID
- members, household ID
- calendar events, household ID, start, and end

Treat task due_date as YYYY-MM-DD. Do not parse date-only values as UTC
timestamps. Keep stable ordering by due date, creation time, and ID.

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

### 2. Add Calendar through a narrow Edge Function

Google Calendar remains the source of truth. Do not copy events into an
application table only to render the agenda.

The function should:

- require a valid Supabase session and household profile;
- validate the requested time range and event fields;
- read Google credentials from Supabase secrets;
- list events from and create events in the configured shared calendar;
- return a small normalized event shape;
- never return credentials to the browser.

Add frontend/src/calendar/api.ts using supabase.functions.invoke. Use a
14-day default range, household-scoped query keys, independent loading/error
states, and a small event creation form.

### 3. Replace the Today placeholder

Show:

- active tasks due today;
- today's calendar events;
- independent loading and error states;
- empty states for either section;
- links to the full Tasks and Calendar pages.

Reuse the existing feature adapters and query keys. Do not duplicate
Supabase queries or introduce another global store. Do not include Shopping
in the initial Today view.

### 4. Finish PWA and deployment behavior

Add:

- a web app manifest and application icons;
- standalone display metadata;
- static asset caching through a service worker or equivalent;
- mobile touch-target and safe-area checks.

Cache static assets only at first. Supabase data still requires a network
connection; do not add offline writes or synchronization yet.

The frontend can be served as the existing static Nginx container or by a
static hosting provider. Configure VITE_SUPABASE_URL and
VITE_SUPABASE_PUBLISHABLE_KEY at build time, and configure Supabase Auth site
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
- foreign-household task assignments are rejected;
- archived tasks remain immutable;
- household onboarding is atomic;
- a successful write remains visible after a refresh failure where the UI
  promises that behavior.

Run the manual pass on a narrow mobile viewport and a desktop viewport. Check
refresh, sign-out/sign-in, and a second browser session.

## Definition of done

The MVP is complete when:

1. A user can sign up, sign in, and keep a session across refreshes.
2. A first user can create a household.
3. A second authenticated user can join that household safely.
4. Both members share Shopping and Tasks data through Supabase.
5. Users can create, assign, complete, reopen, and archive tasks.
6. Archived tasks cannot be changed through the browser.
7. RLS prevents cross-household reads and writes.
8. Calendar can display and create events in the shared Google Calendar.
9. Today shows today's tasks and calendar events.
10. The app is usable as an installable mobile PWA.
11. The frontend builds and tests successfully from a clean install.
12. Deployment requires only the frontend and configured Supabase services.

OpenClaw integration is deferred. If it is added later, expose narrow,
authenticated Supabase Edge Functions or database RPCs instead of introducing
another application backend.
