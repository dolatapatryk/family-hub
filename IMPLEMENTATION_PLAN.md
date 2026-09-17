# Family Hub — MVP Implementation Plan

## 1. Project Goal

Build a simple family PWA that allows two users to share:

* a task list,
* a shopping list,
* a Google Calendar view.

The app should work well on both mobile and desktop.

The backend must also expose an API that OpenClaw can use later for commands such as:

* “add buy milk to the shopping list”,
* “add a task for tomorrow to call the doctor”,
* “what do we need to do today?”,
* “what is currently on the shopping list?”,
* “what is on our calendar tomorrow?”.

OpenClaw is not part of the first implementation stage. First build a working application with a stable API.

---

# 2. Technology Stack

## Backend

* Kotlin
* Ktor
* Kotlin Serialization
* Exposed
* SQLite
* Flyway
* Koin
* Gradle Kotlin DSL

## Frontend

* React
* TypeScript
* Vite
* React Router
* TanStack Query
* PWA

Use either simple CSS or a lightweight UI library.

Do not build a complex design system.

## Integrations

* Google Calendar API

## Deployment

Target deployment:

* Docker
* Docker Compose
* access through Tailscale
* self-hosted on a home server

During development, everything may run locally.

---

# 3. Architecture

The system should look like this:

```text
┌─────────────────────┐
│ React PWA           │
│                     │
│ Tasks               │
│ Shopping            │
│ Calendar            │
└─────────┬───────────┘
          │ HTTP / JSON
          ▼
┌─────────────────────┐
│ Family API          │
│ Kotlin / Ktor       │
└─────┬─────────┬─────┘
      │         │
      │         └──────────────► Google Calendar API
      │
      ▼
   SQLite
```

Future integration:

```text
OpenClaw
    │
    ▼
Family API
```

OpenClaw should use the same API as the frontend.

The backend owns the application logic.

The frontend must not communicate directly with Google Calendar.

## Hexagonal architecture (ports and adapters)

The backend should use a lightweight hexagonal architecture. This is a boundary
between the application and its outside systems, not a reason to introduce a
large framework or a generic abstraction for every class.

Use these dependency rules:

* Domain models and application services must not depend on Ktor, Exposed,
  Flyway, SQLite, or Google client classes.
* Application use cases define the ports they need. For example,
  `TaskRepository`, `ShoppingRepository`, and `CalendarService` are application
  ports rather than database or HTTP concerns.
* HTTP routes, OpenClaw-facing HTTP clients, and other callers are inbound
  adapters. They translate transport data into application commands and call
  application services.
* Exposed/SQLite repositories and the Google Calendar client are outbound
  adapters. They implement application ports and translate external data into
  domain models.
* Ktor application startup is the composition root: it wires the application
  services to the selected adapters, runs Flyway migrations, and then starts
  serving requests.
* Database migrations belong to the persistence adapter. SQLite-specific SQL
  must not leak into the domain or application layers; a future database can
  provide its own adapter and migration set.

The intended dependency direction is:

```text
Inbound adapters → application ports/use cases ← outbound adapters
                         ↑
                       domain
```

This keeps the current SQLite implementation simple while allowing a later
database replacement without changing the API contract or application logic.

---

# 4. MVP Scope

The MVP includes only:

1. Tasks
2. Shopping list
3. Calendar view
4. Simple user identification
5. REST API
6. Responsive frontend/PWA

Do not implement yet:

* projects,
* tags,
* subtasks,
* priorities,
* push notifications,
* recurring tasks,
* comments,
* audit history,
* advanced permissions,
* offline data synchronization,
* custom calendar storage.

---

# 5. Domain Model

## User

```kotlin
data class User(
    val id: UUID,
    val householdId: UUID,
    val name: String
)
```

Initially, two users are enough.

Do not build a complete account-management system.

Users may initially be seeded in the database.

---

## Household

```kotlin
data class Household(
    val id: UUID,
    val name: String
)
```

Each user belongs to exactly one Household in the MVP.

Every Task and ShoppingItem belongs to a Household.

If users ever need to belong to multiple households, introduce a membership
entity at that point rather than adding it to the initial MVP.

---

## Task

```kotlin
data class Task(
    val id: UUID,
    val householdId: UUID,
    val title: String,
    val dueDate: LocalDate?,
    val completed: Boolean,
    val assignedTo: UUID?,
    val createdBy: UUID,
    val createdAt: Instant
)
```

`assignedTo` is optional.

A task without `assignedTo` is shared.

---

## ShoppingItem

```kotlin
data class ShoppingItem(
    val id: UUID,
    val householdId: UUID,
    val name: String,
    val quantity: String?,
    val completed: Boolean,
    val addedBy: UUID,
    val createdAt: Instant
)
```

Do not model ShoppingItem as Task.

It is a separate domain concept.

---

# 6. Database

Use SQLite.

Use Flyway for migrations.

Minimum tables:

```text
users
households
tasks
shopping_items
```

## users

```text
id UUID PK
household_id UUID NOT NULL FK households(id)
name TEXT NOT NULL
```

## households

```text
id UUID PK
name TEXT NOT NULL
```

## tasks

```text
id UUID PK
household_id UUID NOT NULL
title TEXT NOT NULL
due_date DATE NULL
completed BOOLEAN NOT NULL
assigned_to UUID NULL
created_by UUID NOT NULL
created_at TIMESTAMP NOT NULL
```

## shopping_items

```text
id UUID PK
household_id UUID NOT NULL
name TEXT NOT NULL
quantity TEXT NULL
completed BOOLEAN NOT NULL
added_by UUID NOT NULL
created_at TIMESTAMP NOT NULL
```

---

# 7. Backend Project Structure

Do not build an excessively complex Clean Architecture setup.

Use a simple separation of responsibilities:

```text
backend/
  src/main/kotlin/

    application/
      task/
      shopping/
      calendar/

    domain/
      task/
      shopping/
      user/

    infrastructure/
      persistence/
      google/

    api/
      task/
      shopping/
      calendar/
```

HTTP code should not directly contain Exposed queries.

Use this flow:

```text
Route
  ↓
Application Service
  ↓
Repository
  ↓
Exposed / SQLite
```

---

# 8. Tasks API

## GET /api/tasks

Optional query parameters:

```text
completed
from
to
assignedTo
```

Example:

```http
GET /api/tasks?completed=false
```

Response:

```json
[
  {
    "id": "...",
    "title": "Call the doctor",
    "dueDate": "2026-09-15",
    "completed": false,
    "assignedTo": null,
    "createdBy": "..."
  }
]
```

---

## POST /api/tasks

Request:

```json
{
  "title": "Call the doctor",
  "dueDate": "2026-09-15",
  "assignedTo": null
}
```

---

## PATCH /api/tasks/{id}

Request may contain:

```json
{
  "title": "Call the pediatrician",
  "dueDate": "2026-09-16",
  "assignedTo": "...",
  "completed": true
}
```

---

## DELETE /api/tasks/{id}

Deletes a task.

---

# 9. Shopping API

## GET /api/shopping-items

By default, return non-completed items.

Optional parameter:

```text
completed=true|false
```

---

## POST /api/shopping-items

```json
{
  "name": "Milk",
  "quantity": "2"
}
```

---

## PATCH /api/shopping-items/{id}

```json
{
  "name": "Milk",
  "quantity": "3",
  "completed": true
}
```

---

## DELETE /api/shopping-items/{id}

Deletes the item.

---

## Optional endpoint

Later, add:

```http
DELETE /api/shopping-items/completed
```

to remove all completed shopping items.

This is not required for the first milestone.

---

# 10. Google Calendar

Google Calendar remains the source of truth.

Do not copy calendar events into SQLite.

The backend should expose:

```text
CalendarService
```

with an implementation:

```text
GoogleCalendarService
```

API:

## GET /api/calendar/events

Parameters:

```text
from
to
```

Example:

```http
GET /api/calendar/events?from=2026-09-12&to=2026-09-19
```

Response:

```json
[
  {
    "id": "...",
    "title": "Pediatrician",
    "start": "2026-09-14T10:00:00+02:00",
    "end": "2026-09-14T10:30:00+02:00",
    "allDay": false
  }
]
```

For the initial MVP, read-only calendar support is enough.

Creating calendar events may be added later.

---

# 11. Google Calendar Configuration

Do not implement a complete OAuth flow in the first iteration.

For the MVP, configure a single shared calendar.

Backend configuration:

```text
GOOGLE_CALENDAR_ID
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REFRESH_TOKEN
```

Never commit secrets to the repository.

---

# 12. User Identification

Do not build a full authentication system for the first version.

Use a simple header:

```http
X-User-Id: <uuid>
```

The frontend stores the selected user locally.

On first visit:

```text
Who are you?

[ Patryk ]
[ Wife ]
```

Store the selected user in:

```text
localStorage
```

Every API request should send:

```http
X-User-Id
```

The backend uses it for:

```text
createdBy
addedBy
```

This is acceptable for the MVP because the application will only be accessible through a private Tailscale network.

Do not treat this as a real security mechanism.

It can later be replaced with proper authentication.

---

# 13. Frontend

Primary target: mobile.

The desktop version should also work correctly.

Main mobile navigation:

```text
┌────────────────────────┐
│ Family Hub             │
│                        │
│                        │
│                        │
├────────────────────────┤
│ Today | Tasks | Shop | Calendar
└────────────────────────┘
```

---

# 14. Today View

Route:

```text
/
```

Show:

```text
Today

Tasks
☐ Call the doctor
☐ Pick up a package

Calendar
10:00 Pediatrician
17:30 Shopping
```

Do not show the shopping list on the Today screen.

---

# 15. Tasks View

Route:

```text
/tasks
```

Sections:

```text
Today
Upcoming
No due date
Completed
```

Task item:

```text
☐ Call the pediatrician
  tomorrow
  Patryk
```

Checkbox action:

```text
PATCH /api/tasks/{id}
completed=true
```

Provide:

```text
+ Add task
```

Task form:

```text
title
dueDate
assignedTo
```

---

# 16. Shopping View

Route:

```text
/shopping
```

The UI should optimize for very fast interaction.

At the top:

```text
[ Add item... ] [+]
```

List:

```text
☐ Milk               2
☐ Diapers
☐ Bananas             1 kg
```

Checking an item sets:

```text
completed=true
```

Completed items may be:

* moved to the bottom,
* visually dimmed.

A future button may be added:

```text
Clear purchased
```

---

# 17. Calendar View

Route:

```text
/calendar
```

Do not implement a full month-view calendar initially.

Use a simple agenda view:

```text
Monday

10:00
Pediatrician

17:30
Dentist


Tuesday

All day
Birthday
```

Default range:

```text
today + next 14 days
```

This is significantly simpler and more appropriate for the MVP than building a full calendar UI.

---

# 18. TanStack Query

Use TanStack Query for:

```text
tasks
shopping
calendar
```

Suggested query keys:

```text
["tasks"]
["shoppingItems"]
["calendarEvents", from, to]
```

Mutations should invalidate the relevant queries.

Do not introduce another global state-management library unless there is a concrete need.

---

# 19. PWA

The application should:

* have a web app manifest,
* have an app icon,
* be installable to the iOS home screen,
* run in standalone mode.

Do not implement offline data synchronization.

The service worker may cache static frontend assets only.

API access requires connectivity to the home server.

---

# 20. CORS and Networking

Development:

```text
frontend localhost:5173
backend localhost:8080
```

Production should ideally expose everything under one host:

```text
https://family-server.<tailnet>.ts.net
```

Example routing:

```text
/       → frontend
/api/*  → backend
```

This avoids unnecessary CORS complexity.

---

# 21. Docker

Prepare:

```text
backend Dockerfile
frontend Dockerfile
docker-compose.yml
```

Target structure:

```text
docker compose
│
├── family-api
└── family-web
```

SQLite should use persistent storage:

```text
/data/family.db
```

Example:

```yaml
volumes:
  - ./data:/data
```

---

# 22. Configuration

Backend:

```text
DATABASE_PATH
GOOGLE_CALENDAR_ID
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REFRESH_TOKEN
```

Frontend:

```text
VITE_API_URL
```

In production, prefer:

```text
/api
```

instead of a full backend URL.

---

# 23. Tests

Backend minimum:

```text
TaskServiceTest
ShoppingServiceTest
```

Test at least:

* task creation,
* task completion,
* filtering incomplete tasks,
* ShoppingItem creation,
* marking ShoppingItem as completed.

Do not attempt complete endpoint coverage for the MVP.

---

# 24. Implementation Order

## Stage 1 — Project Skeleton

Create:

```text
/backend
/frontend
docker-compose.yml
```

Backend exposes:

```http
GET /health
```

Frontend has a basic application shell.

---

## Stage 2 — SQLite

Add:

* Exposed,
* Flyway,
* SQLite,
* initial migrations.

Seed:

```text
Household: Family

User 1
User 2
```

---

## Stage 3 — Tasks Backend

Implement:

```text
TaskRepository
TaskService
TaskRoutes
```

Endpoints:

```text
GET
POST
PATCH
DELETE
```

---

## Stage 4 — Tasks Frontend

Implement:

```text
/tasks
```

Features:

* list tasks,
* create task,
* complete task,
* delete task.

---

## Stage 5 — Shopping Backend

Implement:

```text
ShoppingRepository
ShoppingService
ShoppingRoutes
```

---

## Stage 6 — Shopping Frontend

Implement:

```text
/shopping
```

Prioritize the core flow:

```text
add → check off
```

---

## Stage 7 — User Selection

Add:

```text
Select user
```

Store `userId` in localStorage.

Attach:

```text
X-User-Id
```

to all API requests.

---

## Stage 8 — Calendar Integration

Add:

```text
CalendarService
GoogleCalendarService
```

Expose:

```http
GET /api/calendar/events
```

Verify the backend integration manually before building the frontend view.

---

## Stage 9 — Calendar UI

Build a simple 14-day agenda.

---

## Stage 10 — Today View

Combine:

```text
tasks due today
+
calendar events today
```

on the home screen.

---

## Stage 11 — PWA

Add:

* manifest,
* service worker,
* app icons,
* mobile-friendly layout.

Verify installation on iOS.

---

## Stage 12 — Docker

The complete system must start with:

```bash
docker compose up
```

---

# 25. Preparation for OpenClaw

Do not implement the OpenClaw integration yet.

However, design the API so that it can later support tools such as:

```text
create_task
list_tasks
complete_task

add_shopping_item
list_shopping_items
complete_shopping_item

get_calendar_events
```

OpenClaw should communicate only through the HTTP API.

It must not:

* read SQLite directly,
* execute SQL,
* depend on backend repositories,
* maintain a second copy of tasks or shopping items.

Target flow:

```text
User
 ↓
OpenClaw
 ↓
HTTP
 ↓
Family API
 ↓
SQLite / Google Calendar
```

---

# 26. MVP Completion Criteria

The MVP is complete when:

1. I can open the app on an iPhone.
2. I can select a user.
3. I can create a task.
4. The other user can see the same task.
5. I can complete a task.
6. I can add an item to the shopping list.
7. The other user can see the same item.
8. I can mark a shopping item as purchased.
9. I can see upcoming Google Calendar events.
10. I can see today's tasks and calendar events on the Today screen.
11. The app works as a PWA.
12. The entire system starts with Docker Compose.
13. SQLite data survives container restarts.
14. The backend exposes a stable REST API ready for future OpenClaw integration.

---

# 27. Implementation Principles

Prefer simplicity.

Do not add abstractions only because they may be useful someday.

Do not introduce:

```text
CQRS
event sourcing
microservices
message broker
DDD aggregates everywhere
generic repository abstractions
complex permission systems
```

This is a small family application.

Still maintain a clean basic separation between:

```text
HTTP
application logic
persistence
external integrations
```

so both the frontend and OpenClaw can rely on the same stable backend API.

---

# 28. First Milestone

The first milestone should deliver one complete vertical slice:

```text
React
   ↓
POST /api/tasks
   ↓
TaskService
   ↓
TaskRepository
   ↓
SQLite
```

and:

```text
React
   ↓
GET /api/tasks
   ↓
SQLite
```

Before implementing Shopping or Calendar, the user must be able to:

```text
open /tasks
→ add a task
→ see the task
→ complete the task
→ refresh the page
→ confirm that the task still exists
```

Only after this works correctly should implementation continue with the next module.
